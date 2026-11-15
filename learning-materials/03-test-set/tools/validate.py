#!/usr/bin/env python3
"""Offline corpus integrity checks; no student scoring and no network calls."""
import argparse
import hashlib
import json
import zipfile
from contextlib import nullcontext
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from subtitles import parse_srt, reading_text, select

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


class AozoraText(HTMLParser):
    """Extract main_text with base ruby characters; retain every nonempty BR line."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.ignored = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            if self.depth:
                self.depth += 1
            elif dict(attrs).get('class') == 'main_text':
                self.depth = 1
        if self.depth:
            if tag in ('rt', 'rp'):
                self.ignored += 1
            elif tag == 'br' and not self.ignored:
                self.parts.append('\n')

    def handle_endtag(self, tag):
        if self.depth:
            if tag in ('rt', 'rp'):
                self.ignored -= 1
            elif tag == 'div':
                self.depth -= 1

    def handle_data(self, text):
        if self.depth and not self.ignored:
            self.parts.append(text)


def validate(subtitle_dir=None, image_dir=None, check_material_baseline=False, metadata_only=False):
    sources = read('sources.json')
    samples = read('samples.json')
    answers = read('answers.json')
    source_map = {s['id']: s for s in sources}
    sample_map = {s['id']: s for s in samples}
    answer_map = {a['sample_id']: a for a in answers}
    check(len(source_map) == len(sources), 'Duplicate source ID')
    check(len(sample_map) == len(samples), 'Duplicate sample ID')
    check(len(answer_map) == len(answers), 'Duplicate answer sample ID')
    check(set(answer_map) <= set(sample_map), 'Answer references nonexistent sample')
    profile = read('target-profile.json')
    weights = profile['core_weights']
    check(weights and all(w > 0 for w in weights.values()) and sum(weights.values()) == 1, 'Invalid core weights')
    check(not set(weights).intersection(profile['extension_genres']), 'Core and extension overlap')
    check({s['genre'] for s in sources} <= set(weights) | set(profile['extension_genres']), 'Unassigned genre')

    assets = read('asset-hashes.json')
    actual_assets = {str(p.relative_to(ROOT)) for p in (ROOT / 'sources').iterdir() if p.is_file()}
    check(actual_assets <= set(assets) if metadata_only else set(assets) == actual_assets, 'Unregistered or missing source asset')
    for path, expected in assets.items():
        if metadata_only and not (ROOT / path).exists():
            continue
        check(digest((ROOT / path).read_bytes()) == expected, f'Asset changed: {path}')
    for fixture in read('sources/blackjack-upstream-manifest.json')['fixtures']:
        path = 'sources/' + Path(fixture['file']).name
        check(assets[path] == fixture['sha256'], f'Manga mirror hash differs: {path}')

    groups = defaultdict(set)
    selections = set()
    texts = set()
    units = set()
    used_paths = set()
    pd_cache = {}
    subtitle_cache = {}
    cue_ranges = defaultdict(list)
    image_urls = set()
    for source in sources:
        if source['genre'] != 'anime_subtitles':
            continue
        meta = source['subtitle']
        check(source['commit'] in source['url'] and source['commit'] in meta['raw_url'], 'Subtitle URL is not pinned')
        check(meta['format'] == 'srt', 'Unsupported subtitle format')
        if subtitle_dir is not None:
            raw = (subtitle_dir / meta['file_name']).read_bytes()
            check(len(raw) == meta['bytes'] and digest(raw) == meta['sha256'], 'Subtitle source bytes changed: ' + source['id'])
            git_blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
            check(git_blob == meta['git_blob_sha1'], 'Subtitle Git blob differs: ' + source['id'])
            cues = parse_srt(raw)
            check(len(cues) == meta['cue_count'], 'Subtitle cue count differs: ' + source['id'])
            subtitle_cache[source['id']] = cues
    with (nullcontext() if metadata_only else zipfile.ZipFile(ROOT / 'sources/nucc.zip')) as archive:
        if archive is not None:
            check(archive.testzip() is None, 'NUCC archive CRC failure')
        for sample in samples:
            sid = sample['id']
            check(sample['source_id'] in source_map, f'Missing source: {sid}')
            source = source_map[sample['source_id']]
            check(sample['split'] in ('development', 'holdout', 'regression'), f'Invalid split: {sid}')
            groups[source['group']].add(sample['split'])
            key = (sample['source_id'], json.dumps(sample['locator'], sort_keys=True))
            check(key not in selections, f'Duplicate selected range: {sid}')
            selections.add(key)
            check(sample['annotation'] in ('pending', 'draft_needs_review'), f'Unreviewed status promotion: {sid}')
            check((sid in answer_map) == (sample['annotation'] == 'draft_needs_review'), f'Annotation mismatch: {sid}')
            for field in ('text_path', 'image_path', 'transcript_path'):
                if field in sample:
                    path = ROOT / sample[field]
                    check(metadata_only or path.is_file(), f'Missing {field}: {sid}')
                    used_paths.add(sample[field])
            if 'transcript_path' in sample and not metadata_only:
                check(digest((ROOT / sample['transcript_path']).read_bytes()) == sample['transcript_sha256'], f'Transcript changed: {sid}')
            if sample['access'] == 'local_image':
                check(sample['image_path'] in assets, f'Unregistered image: {sid}')
            elif sample['access'] == 'local_text':
                if not metadata_only:
                    content = (ROOT / sample['text_path']).read_text(encoding='utf-8')
                    check('\ufffd' not in content, f'Encoding replacement character: {sid}')
                    check(digest(content.encode()) == sample['text_sha256'], f'Text hash differs: {sid}')
                    check(len(content.rstrip('\n')) == sample['characters'], f'Character count differs: {sid}')
                    loc = sample['locator']
                    if source['genre'] == 'spoken_transcript':
                        lines = archive.read(loc['member']).decode('utf-8-sig').splitlines()
                        a, b = loc['lines']
                        expected = '\n'.join(lines[a-1:b]).strip() + '\n'
                    else:
                        if source['id'] not in pd_cache:
                            parser = AozoraText()
                            parser.feed((ROOT / source['snapshot']).read_bytes().decode('cp932'))
                            pd_cache[source['id']] = [p.strip() for p in ''.join(parser.parts).splitlines() if p.strip()]
                        a, b = loc['paragraphs']
                        expected = '\n'.join(pd_cache[source['id']][a-1:b]).strip() + '\n'
                    check(expected == content, f'Selected source range differs: {sid}')
            else:
                check(sample['access'] == 'external_original', f'Unknown access: {sid}')
                check(source['url'].startswith('https://'), f'Missing original URL: {sid}')
                loc = sample['locator']
                check(('pages' in loc and source['genre'] == 'manga') or
                      (('paragraphs' in loc or 'subtitle_cues' in loc) and 'text_sha256' in sample), f'External locator missing: {sid}')
                check('text_path' not in sample, f'External text unexpectedly copied: {sid}')
                if 'pages' in loc:
                    pages = loc['pages']
                    check(pages and [p['number'] for p in pages] == list(range(pages[0]['number'], pages[-1]['number'] + 1)), f'Non-contiguous manga: {sid}')
                    for page in pages:
                        check(page['url'].startswith(source['url']) and page['image_url'].startswith('https://'), f'Invalid manga URL: {sid}')
                        check(len(page['sha256']) == 64 and page['bytes'] > 0, f'Missing image fingerprint: {sid}')
                        check(page['image_url'] not in image_urls, f'Duplicate manga page: {sid}')
                        image_urls.add(page['image_url'])
                        if image_dir is not None:
                            raw = (image_dir / page['file_name']).read_bytes()
                            check(len(raw) == page['bytes'] and digest(raw) == page['sha256'], f'Manga image changed: {sid}')
                if 'subtitle_cues' in loc:
                    a, b = loc['subtitle_cues']
                    check(source['genre'] == 'anime_subtitles', f'Subtitle category mismatch: {sid}')
                    check(1 <= a <= b <= source['subtitle']['cue_count'], f'Invalid cue range: {sid}')
                    check(loc['episode'] == source['episode'], f'Episode mismatch: {sid}')
                    for first, last in cue_ranges[source['id']]:
                        check(b < first or a > last, f'Overlapping subtitle samples: {sid}')
                    cue_ranges[source['id']].append((a, b))
                    if subtitle_dir is not None:
                        selected = select(subtitle_cache[source['id']], a, b)
                        content = reading_text(selected)
                        check(digest(content.encode()) == sample['text_sha256'], f'Subtitle text differs: {sid}')
                        check(len(content.rstrip('\n')) == sample['characters'], f'Subtitle character count differs: {sid}')
                        check([selected[0]['source_lines'][0], selected[-1]['source_lines'][1]] == loc['source_lines'], f'Subtitle line locator differs: {sid}')
                        check(selected[0]['start'] == loc['time_start'] and selected[-1]['end'] == loc['time_end'], f'Subtitle time locator differs: {sid}')
            if 'text_sha256' in sample:
                check(sample['text_sha256'] not in texts, f'Duplicate text: {sid}')
                texts.add(sample['text_sha256'])
            if sid in answer_map:
                answer = answer_map[sid]
                check(answer['status'] == 'draft_needs_review' and answer['units'], f'Invalid draft: {sid}')
                for unit in answer['units']:
                    check(unit['id'] not in units, f'Duplicate meaning unit: {sid}')
                    units.add(unit['id'])
                    check(unit['evidence'] and unit['meaning_zh'], f'Empty meaning or evidence: {sid}')
    for group, splits in groups.items():
        check(len(splits) == 1, f'Work leaks across splits: {group}')
    passages = {str(p.relative_to(ROOT)) for p in (ROOT / 'passages').iterdir() if p.is_file()}
    check(passages <= used_paths if metadata_only else passages == {p for p in used_paths if p.startswith('passages/')}, 'Orphan passage file')
    # Historical evaluation records own their sample membership. Exposed works cannot
    # silently become fresh holdouts after a later test-bank revision.
    history = json.loads((ROOT.parent / '04-evaluation/round-02/lexical-results.json').read_text(encoding='utf-8'))
    exposed_groups = {source_map[sample_map[s['id']]['source_id']]['group'] for s in history['samples']}
    for group in exposed_groups:
        check(groups[group] == {'regression'}, f'Previously evaluated work reused as fresh material: {group}')
    for result_path in sorted((ROOT.parent / '04-evaluation').glob('round-*/lexical-results.json')):
        evaluated = json.loads(result_path.read_text(encoding='utf-8'))
        consumed = {source_map[sample_map[s['id']]['source_id']]['group']
                    for s in evaluated['samples'] if s['split'] == 'holdout'}
        for group in consumed:
            check(groups[group] == {'regression'}, f'Evaluated holdout reused: {group}')
    if check_material_baseline:
        baseline = read('materials-baseline.json')['files']
        material_root = ROOT.parent / '01-materials'
        current = {str(p.relative_to(material_root)): digest(p.read_bytes()) for p in material_root.rglob('*') if p.is_file()}
        check(current == baseline, 'Materials differ from historical baseline (expected after curriculum changes)')
    return sources, samples, answers, len(units)


def catalog(sources, samples):
    source_map = {s['id']: s for s in sources}
    lines = ['# 原文条目目录', '', '> 自动生成；编辑来源数据后执行 `python3 tools/validate.py --metadata-only --write-catalog`。', '',
             '本页不展示评分答案。外部原文按所列范围阅读；保留材料不要用于修订课程。', '']
    for split, title in [('development', '新开发材料'), ('holdout', '新保留材料'), ('regression', '历史回归材料（不能算新材料成绩）')]:
        lines += ['## ' + title, '']
        for sample in samples:
            if sample['split'] != split:
                continue
            source = source_map[sample['source_id']]
            status = '评分草稿待复核' if sample['annotation'] == 'draft_needs_review' else '未编写评分点'
            lines += [f"### {sample['id']} · {sample['title']}", '', f"{source['title']} · {source['genre']} · {status}", '']
            loc = sample['locator']
            if sample['access'] == 'local_image':
                lines.append(f"[查看漫画原页]({sample['image_path']}) · PDF 第 {loc['pdf_page']} 页")
                if 'transcript_path' in sample:
                    lines.append(f" · [审校用转写]({sample['transcript_path']})")
            elif sample['access'] == 'local_text':
                lines.append(f"[阅读本地原文]({sample['text_path']})")
                if 'lines' in loc:
                    lines.append(f"原包 `{loc['member']}`，第 {loc['lines'][0]}—{loc['lines'][1]} 行。")
                else:
                    lines.append(f"正文非空段 {loc['paragraphs'][0]}—{loc['paragraphs'][1]}，原页标题计段。")
            else:
                if 'pages' in loc:
                    lines.append('连续漫画原页；按编号从小到大读，每张自上而下。')
                    lines.append('')
                    for page in loc['pages']:
                        lines.append(f"- [#{page['number']:04} · {page['title']}]({page['url']}) · [原图]({page['image_url']})")
                elif 'subtitle_cues' in loc:
                    a, b = loc['source_lines']
                    lines.append(f"[阅读所选字幕范围]({source['url']}#L{a}-L{b}) · [官方分集信息]({source['official_episode_url']})")
                    lines.append(f"第 {loc['episode']} 集；字幕编号 {loc['subtitle_cues'][0]}—{loc['subtitle_cues'][1]}；{loc['time_start']}—{loc['time_end']}。")
                    lines.append('社区字幕；已核对固定文件版本，未逐句比对音轨。正文外部访问，非开放再分发授权。')
                else:
                    lines.append(f"[阅读官方原文]({source['url']})")
                    lines.append(f"范围：{loc.get('section', loc.get('selector', '正文'))}；第 {loc['paragraphs'][0]}—{loc['paragraphs'][1]} 段。{loc.get('counting', '')}")
            lines += ['']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-only', action='store_true', help='Validate registry, splits, annotations and present assets; explicitly skip unavailable original bodies.')
    parser.add_argument('--write-catalog', action='store_true')
    parser.add_argument('--subtitle-dir', type=Path, help='Directory containing all registered SRT files; verifies bytes, cue ranges, times and selected text. No download.')
    parser.add_argument('--image-dir', type=Path, help='Directory containing external manga images, named by locator.pages[].file_name. No download.')
    parser.add_argument('--check-material-baseline', action='store_true', help='Explicitly compare current materials to the historical 2026-11-11 snapshot; separate from corpus integrity.')
    args = parser.parse_args()
    sources, samples, answers, units = validate(args.subtitle_dir, args.image_dir, args.check_material_baseline, args.metadata_only)
    expected_catalog = catalog(sources, samples)
    if args.write_catalog:
        (ROOT / 'CATALOG.md').write_text(expected_catalog, encoding='utf-8', newline='\n')
    else:
        check((ROOT / 'CATALOG.md').read_text(encoding='utf-8') == expected_catalog, 'Catalog is stale')
    print(json.dumps({'result': 'passed', 'mode': 'metadata_only' if args.metadata_only else 'full_local_assets', 'sources': len(sources), 'groups': len({s['group'] for s in sources}),
                      'samples': len(samples), 'split': dict(Counter(s['split'] for s in samples)),
                      'access': dict(Counter(s['access'] for s in samples)), 'draft_answers': len(answers),
                      'draft_meaning_units': units, 'reviewed_answers': 0,
                      'external_pages_rechecked': False,
                      'subtitle_files_rechecked': sum(s['genre'] == 'anime_subtitles' for s in sources) if args.subtitle_dir is not None else 0,
                      'external_manga_images_rechecked': sum(len(s['locator'].get('pages', [])) for s in samples) if args.image_dir is not None else 0,
                      'historical_material_baseline_checked': args.check_material_baseline,
                      'student_test_performed': False}, ensure_ascii=False, indent=2))
