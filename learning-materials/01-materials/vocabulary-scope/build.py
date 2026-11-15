"""Reproduce the frozen anime/manga selection, with no network or lesson/test access."""
import argparse
import collections
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import unicodedata

HERE = Path(__file__).resolve().parent


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def key(term, reading):
    term = unicodedata.normalize('NFKC', term)
    reading = unicodedata.normalize('NFKC', reading)
    reading = ''.join(chr(ord(c) - 96) if 'ァ' <= c <= 'ヶ' else c for c in reading)
    return term, reading


def escape(value):
    value = str(value).replace('\\', '\\\\').replace('\n', ' / ')
    for c in '|[]`<>*_':
        value = value.replace(c, '\\' + c)
    return value


def table_row(values):
    return '| ' + ' | '.join(escape(v) for v in values) + ' |'


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = read_json(HERE / 'sources.json')
    selection = read_json(HERE / 'selection.json')
    limit = selection['policy']['maxRankInEachMedium']
    assert selection['policy']['mediaJoin'] == 'any'
    ranks = {}
    source_counts = {}
    for source in manifest['files']:
        archive = (HERE / source['file']).read_bytes()
        assert hashlib.sha256(archive).hexdigest() == source['archiveSha256']
        raw = gzip.decompress(archive)
        assert len(raw) == source['bytes']
        assert hashlib.sha256(raw).hexdigest() == source['sha256']
        reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        assert reader.fieldnames == ['Word', 'Form', 'Rank']
        groups = collections.defaultdict(set)
        rows = 0
        for r in reader:
            assert r['Word'] and r['Form']
            rank = int(r['Rank'])
            assert rank > 0
            groups[key(r['Word'], r['Form'])].add(rank)
            rows += 1
        ranks[source['media']] = {k: sorted(v) for k, v in groups.items()}
        source_counts[source['media']] = {'csvRows': rows, 'formReadingKeys': len(groups)}
    for name in ['statistics', 'mediaSpotChecks', 'meaningChecks']:
        source = manifest[name]
        assert hashlib.sha256((HERE / source['file']).read_bytes()).hexdigest() == source['sha256']
    source_ids = set()
    for source in manifest['localMaterialInputs']:
        raw = (HERE / source['file']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == source['sha256']
        source_ids.update(x['id'] for x in json.loads(raw))

    def rank(k, medium):
        values = ranks[medium].get(k)
        return min(values) if values else None

    def candidates_at(n):
        return {k for medium in ranks.values() for k, values in medium.items() if min(values) <= n}

    candidates = candidates_at(limit)
    decisions = {key(x['term'], x['reading']): x for x in selection['decisions']}
    assert len(decisions) == len(selection['decisions']), 'Duplicate editorial decision'
    assert set(decisions) == candidates, 'Every candidate must have exactly one editorial decision'
    assert all(x['status'] in ['core', 'grammar', 'alias', 'defer'] for x in decisions.values())
    members = {k: [k] for k, v in decisions.items() if v['status'] in ['core', 'grammar']}
    for k, value in decisions.items():
        assert value['reason']
        assert set(value.get('sourceIds', [])) <= source_ids
        if value['status'] == 'alias':
            target = key(*value['target'])
            assert target in members, 'Alias target must be a core/grammar root, never another alias'
            members[target].append(k)
        elif value['status'] in ['core', 'grammar']:
            assert value['meaningZh'].strip()
    orthographic = {key(*x['target']): x for x in selection.get('orthographicNotes', [])}
    assert all(k in members and decisions[k]['status'] == 'core' for k in orthographic)

    def group_ranks(k):
        return {m: min(rank(member, m) for member in members[k]) for m in ranks}

    def sort_key(k):
        rr = group_ranks(k)
        return min(rr.values()), max(rr.values()), k

    selected = []
    grammar = []
    for k in sorted(members, key=sort_key):
        source = decisions[k]
        entry = {'term': k[0], 'reading': k[1], 'meaningZh': source['meaningZh'], 'groupRanks': group_ranks(k), 'sourceIds': source.get('sourceIds', []), 'glossSource': source.get('glossSource', 'editor-zh'), 'variants': []}
        for member in members[k]:
            entry['variants'].append({'term': member[0], 'reading': member[1], 'ranks': {m: ranks[m][member] for m in ranks}})
        if k in orthographic:
            entry['orthographicNote'] = orthographic[k]
        if 'reviewNote' in source:
            entry['reviewNote'] = source['reviewNote']
        (selected if source['status'] == 'core' else grammar).append(entry)
    stats = read_json(HERE / manifest['statistics']['file'])
    counts = collections.Counter(x['status'] for x in decisions.values())
    summary = {'version': selection['version'], 'date': selection['date'], 'candidateRule': f'rank <= {limit} in EITHER anime or manga, followed by editorial review', 'candidateForms': len(candidates), 'coreTeachingGroups': len(selected), 'grammarSurfaceRoots': len(grammar), 'mergedVariants': counts['alias'], 'deferredFragments': counts['defer'], 'partition': dict(counts), 'coreSurfaceFormsIncludingMerged': sum(len(x['variants']) for x in selected), 'grammarSurfaceFormsIncludingMerged': sum(len(x['variants']) for x in grammar), 'publisherMediaSnapshot': {m: stats['mediaByType'][m] for m in ['Anime', 'Manga']}, 'inputs': source_counts, 'rankBoundarySensitivityBeforeEditorialReview': {str(n): len(candidates_at(n)) for n in [500, 750, 1000, 1500, 2000]}, 'duplicateRankKeysInCandidates': [{'term': k[0], 'reading': k[1], 'ranks': {m: ranks[m].get(k, []) for m in ranks}} for k in sorted(candidates) if any(len(ranks[m].get(k, [])) > 1 for m in ranks)], 'meaningChecks': 'All selected teaching glosses read through; ambiguous つく/つける/すむ additionally checked against public dictionary API. Not every sense has independently measured frequency.', 'scope': 'Selection is compiled into the current course; this builder reads only the editorial selection and source assets, not lessons or tests.'}
    assert len(selected) + len(grammar) + counts['alias'] + counts['defer'] == len(candidates)
    assert sum(len(x['variants']) for x in selected + grammar) + counts['defer'] == len(candidates)

    def word_report(title, entries, description):
        lines = [title, '', description, '', '由 selection.json 和冻结的番剧、漫画词频表生成。排名列是明确合并的教学组内最靠前排名；原始各写法及所有同形排名保存在 selected.json / grammar.json，不是出现次数或理解率。', '', '| 序号 | 词／表达 | 读音 | 优先教学义 | 合并或关联写法 | 番剧排名 | 漫画排名 |', '| ---: | --- | --- | --- | --- | ---: | ---: |']
        for n, x in enumerate(entries, 1):
            variants = [f"{v['term']}（{v['reading']}）" for v in x['variants'][1:]]
            variants += x.get('orthographicNote', {}).get('otherForms', [])
            lines.append(table_row([n, x['term'], x['reading'], x['meaningZh'], '、'.join(variants) or '—', x['groupRanks']['anime'], x['groupRanks']['manga']]))
        return '\n'.join(lines) + '\n'

    review = ['# 筛选与审校记录', '', 'v3 改为任一媒体前1000后逐项审阅；保留双榜原排名。出版信息、专名、发声、语法和异写分流，不用清单行数凑词汇量。', '', f'双榜并集候选 {len(candidates)} 条表面形式 → {len(selected)} 组核心词与常用表达＋{len(grammar)} 条语法表面形式＋{counts["alias"]} 条并入其他组的形式＋{counts["defer"]} 条暂缓片段。语法表面形式还包含重复结构，不能叫做同样数量的独立语法点。', '', '## 本轮暂缓的高排名片段', '', '| 形式 | 理由 |', '| --- | --- |']
    for k, v in decisions.items():
        if v['status'] == 'defer':
            review.append(table_row([k[0], v['reason']]))
    review += ['', '## 明确合并的形式', '', '| 原形式 | 归入 | 理由 |', '| --- | --- | --- |']
    for k, v in decisions.items():
        if v['status'] == 'alias':
            review.append(table_row([f'{k[0]}（{k[1]}）', f'{v["target"][0]}（{v["target"][1]}）', v['reason']]))
    review += ['', '## 重点纠正', '', '- つく：原材料只给灯亮义。独立核对后，CSV 的 372/336 对应 JMdict 1495740 假名形式的附着、连上等义；点灯词条 1441400 的同媒体排名是 3182/2603，不能混用。', '- つける、すむ的选定义项另用公开词条和分媒体排名核对；原始返回保存在 sources/meaning-checks.json。', '- さあ补入催促、开始行动义；甘い补入天真、要求不严义；なかなか补入与否定搭配的不容易义；落とす改为使掉落、弄丢，避免和落ちる混淆。', f'- {len(summary["duplicateRankKeysInCandidates"])} 组候选存在多个同形同读音排名，保存全部排名，不把低频同形词的意义借用为高频词义；取最靠前排名仅用于建立表面候选。', f'- {len(selected)} 组所用中文释义已逐条通读，但词频表没有义项级频率；这不是第三方教师审校或学生理解测试。', '', '## 阈值敏感性（尚未语法归类及合并）', '', '| 单榜门槛 | 并集表面候选 |', '| ---: | ---: |']
    for n, amount in summary['rankBoundarySensitivityBeforeEditorialReview'].items():
        review.append(table_row([n, amount]))
    payloads = {'selected.json': selected, 'grammar.json': grammar, 'summary.json': summary}
    outputs = {name: json.dumps(data, ensure_ascii=False, indent=2) + '\n' for name, data in payloads.items()}
    outputs['WORDS.md'] = word_report('# 番剧与漫画：首批核心词与常用表达', selected, f'共 {len(selected)} 组。按两类媒体中较高的优先程度排列；这是选词清单，不是课次顺序。')
    outputs['GRAMMAR.md'] = word_report('# 高频语法与功能表达：另行归类', grammar, f'共 {len(grammar)} 条语法表面形式，另有部分同组变体；不计入 {len(selected)} 组核心词汇，也不代表 {len(grammar)} 个独立语法点。')
    outputs['REVIEW.md'] = '\n'.join(review) + '\n'
    for name, content in outputs.items():
        p = HERE / name
        if args.check:
            assert p.read_text(encoding='utf-8') == content, f'Stale generated file: {name}'
        else:
            p.write_text(content, encoding='utf-8', newline='\n')
    print(json.dumps({'mode': 'check' if args.check else 'write', 'candidates': len(candidates), **dict(counts), 'all_candidates_accounted_for': True, 'sources_verified': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
