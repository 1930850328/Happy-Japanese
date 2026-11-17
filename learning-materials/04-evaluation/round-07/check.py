"""Verify v4 freeze and recompute editorial support judgments, not student ability."""
import argparse
import collections
import csv
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = ROOT / '.cache/round-07'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Plain(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ['script', 'style', 'rt', 'rp']:
            self.skip += 1
        if tag in ['br', 'p', 'div', 'h1', 'h2', 'h3', 'li', 'tr']:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ['script', 'style', 'rt', 'rp']:
            self.skip -= 1
        if tag in ['p', 'div', 'h1', 'h2', 'h3', 'li', 'tr']:
            self.parts.append('\n')

    def handle_data(self, text):
        if not self.skip:
            self.parts.append(text)


def main():
    ap = argparse.ArgumentParser(__doc__)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--fetch-originals', action='store_true')
    args = ap.parse_args()
    freeze = read(HERE / 'freeze.json')
    for name, expected in freeze['files'].items():
        assert sha((ROOT / name).read_bytes()) == expected, 'Frozen v4 changed: ' + name
    for name, expected in read(HERE / 'before/manifest.json')['files'].items():
        assert sha((HERE / 'before' / name).read_bytes()) == expected, 'Baseline changed: ' + name
    for name, expected in read(HERE / 'evidence-manifest.json')['files'].items():
        assert sha((HERE / name).read_bytes()) == expected, 'Evaluation evidence changed: ' + name
    samples = read(HERE / 'samples.json')['samples']
    assert len({s['id'] for s in samples}) == len(samples)
    if args.fetch_originals:
        CACHE.mkdir(parents=True, exist_ok=True)
        for sample in samples:
            path = CACHE / (sample['id'] + '.html')
            if path.exists():
                data = path.read_bytes()
            else:
                with urllib.request.urlopen(sample['url'], timeout=30) as response:
                    data = response.read()
            assert sha(data) == sample['raw_sha256'], 'Original changed: ' + sample['id']
            parser = Plain()
            parser.feed(data.decode(sample['encoding']))
            text = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())
            start = text.index(sample['start'])
            end = text.index(sample['end_before'], start + len(sample['start']))
            excerpt = text[start:end].strip() + '\n'
            assert sha(excerpt.encode()) == sample['excerpt_sha256'], 'Extraction changed: ' + sample['id']
            if not path.exists():
                path.write_bytes(data)
            (CACHE / (sample['id'] + '-excerpt.txt')).write_text(excerpt, encoding='utf-8')
    with (HERE / 'support-units.tsv').open(encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle, delimiter='\t'))
    assert len({r['id'] for r in rows}) == len(rows)
    assert {r['sample'] for r in rows} == {s['id'] for s in samples}
    assert all(r['meaning'] and r['gap'] and r['v4_supported_reading'] for r in rows)

    def summarize(rs, version):
        scores = [float(r[version]) for r in rs]
        assert all(s in [0, 0.5, 1] for s in scores)
        counts = collections.Counter(scores)
        return dict(units=len(scores), full=counts[1], partial=counts[0.5], unsupported=counts[0],
                    earned=sum(scores), editorial_support_percent=100 * sum(scores) / len(scores))

    result = dict(type='editorial_course_support_diagnostic', student_test_performed=False,
                  independent_raters=0, original_sources=len(samples), meaning_units=len(rows),
                  by_source={s['id']: {v: summarize([r for r in rows if r['sample'] == s['id']], v)
                                      for v in ['v3', 'v4']} for s in samples},
                  pooled={v: summarize(rows, v) for v in ['v3', 'v4']},
                  claim='Ideal recall, author-limited support judgments; neither real novice comprehension nor a generalization estimate')
    body = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    path = HERE / 'support-results.json'
    if args.check:
        assert path.read_text(encoding='utf-8') == body, 'Stale support-results.json'
    else:
        path.write_text(body, encoding='utf-8')
    print(body)


if __name__ == '__main__':
    main()
