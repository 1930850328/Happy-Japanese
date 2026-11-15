"""Reconstruct round 1's historical development passages, not new test-bank samples."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

LEARNING = Path(__file__).resolve().parents[2]
TEST = LEARNING / '03-test-set'
sys.path.insert(0, str(TEST / 'tools'))
from subtitles import parse_srt, reading_text, select


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def prepare(captures):
    sources = {s['id']: s for s in read(TEST / 'sources.json')}
    historical = read(LEARNING / '04-evaluation/lexical-results.json')
    sample_ids = {s['id'] for s in historical['samples'] + historical['skipped']}
    included, skipped = [], []
    for sample in read(TEST / 'samples.json'):
        if sample['id'] not in sample_ids:
            continue
        source = sources[sample['source_id']]
        loc = sample['locator']
        if 'text_path' in sample:
            text = (TEST / sample['text_path']).read_text(encoding='utf-8')
            expected = sample['text_sha256']
        elif 'transcript_path' in sample:
            text = (TEST / sample['transcript_path']).read_text(encoding='utf-8')
            expected = sample['transcript_sha256']
        elif sample['access'] == 'local_image':
            skipped.append(dict(id=sample['id'], reason='image_without_verified_transcript'))
            continue
        elif source['genre'] == 'anime_subtitles':
            raw = (captures / source['subtitle']['file_name']).read_bytes()
            if sha(raw) != source['subtitle']['sha256']:
                raise ValueError('Subtitle capture changed: ' + source['id'])
            text = reading_text(select(parse_srt(raw), *loc['subtitle_cues']))
            expected = sample['text_sha256']
        elif source['id'] in ('naruse', 'kaiwa'):
            book = next(b for b in read(captures / 'books-web.json') if b['url'] == source['url'])
            a, b = loc['observed_web_lines']
            text = '\n'.join(line['text'].strip() for line in book['lines'] if a <= line['line'] <= b) + '\n'
            expected = sample['text_sha256']
        else:
            paragraphs = read(captures / (source['id'] + '.paragraphs.json'))
            a, b = loc['paragraphs']
            text = '\n'.join(paragraphs[a-1:b]).strip() + '\n'
            expected = sample['text_sha256']
        if sha(text.encode()) != expected:
            raise ValueError('Passage capture changed: ' + sample['id'])
        included.append(dict(id=sample['id'], source_id=source['id'], group=source['group'],
                             genre=source['genre'], split='development', sha256=expected, text=text))
    return dict(included=included, skipped=skipped, holdout_bodies_loaded=0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--captures', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    # Protected external text is an intermediate input, not a delivered corpus copy.
    if args.output.resolve().is_relative_to(LEARNING.parent.resolve()):
        raise ValueError('Use a temporary directory outside the repository for reconstructed text')
    result = prepare(args.captures)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(dict(included=len(result['included']), skipped=len(result['skipped']), holdout_bodies_loaded=0)))
