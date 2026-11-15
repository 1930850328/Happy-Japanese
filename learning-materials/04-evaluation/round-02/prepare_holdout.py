"""Reconstruct round 2's historical holdouts, not the current test bank's reserve."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

LEARNING = Path(__file__).resolve().parents[2]
TEST = LEARNING / '03-test-set'
sys.path.insert(0, str(TEST / 'tools'))
from subtitles import parse_srt, reading_text, select


def read(p):
    return json.loads(p.read_text(encoding='utf-8'))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def prepare(captures):
    snapshot = read(Path(__file__).with_name('course-snapshot.json'))
    for rel, digest in snapshot['sha256'].items():
        assert sha((LEARNING / rel).read_bytes()) == digest, 'Course changed after freeze: ' + rel
    sources = {s['id']: s for s in read(TEST / 'sources.json')}
    historical = read(Path(__file__).with_name('lexical-results.json'))
    sample_ids = {s['id'] for s in historical['samples'] if s['split'] == 'holdout'}
    included = []
    for sample in read(TEST / 'samples.json'):
        if sample['id'] not in sample_ids:
            continue
        source = sources[sample['source_id']]
        loc = sample['locator']
        if 'text_path' in sample:
            text = (TEST / sample['text_path']).read_text(encoding='utf-8')
        elif source['genre'] == 'anime_subtitles':
            raw = (captures / source['subtitle']['file_name']).read_bytes()
            assert sha(raw) == source['subtitle']['sha256'], source['id']
            text = reading_text(select(parse_srt(raw), *loc['subtitle_cues']))
        else:
            paragraphs = read(captures / (source['id'] + '.paragraphs.json'))
            a, b = loc['paragraphs']
            text = '\n'.join(paragraphs[a-1:b]).strip() + '\n'
        assert sha(text.encode()) == sample['text_sha256'], sample['id']
        included.append(dict(id=sample['id'], source_id=source['id'], group=source['group'],
                             genre=source['genre'], split='holdout', sha256=sample['text_sha256'], text=text))
    assert {s['id'] for s in included} == sample_ids
    return dict(included=included, source='03-test-set reserved bodies, course v2 frozen first')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--captures', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    assert not args.output.resolve().is_relative_to(LEARNING.parent.resolve()), 'Keep full external text outside repository'
    result = prepare(args.captures)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(dict(reserved_passages=len(result['included']), all_source_hashes_match=True)))
