"""Frozen matchable word forms, derived from existing frequency sources, not test sentences."""
import csv
import gzip
import hashlib
import io
import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def vocabulary():
    scope = ROOT / '01-materials/vocabulary-scope'
    forms = set()
    for source in json.loads((scope / 'sources.json').read_text(encoding='utf-8'))['files']:
        archive = (scope / source['file']).read_bytes()
        if hashlib.sha256(archive).hexdigest() != source['archiveSha256']:
            raise ValueError('Frequency archive changed: ' + source['file'])
        raw = gzip.decompress(archive)
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            raise ValueError('Frequency content changed: ' + source['file'])
        forms.update(row['Word'] for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    baseline = ROOT / '04-evaluation/round-05/before/02-course-design/inventory.json'
    forms.update(w['form'] for w in json.loads(baseline.read_text(encoding='utf-8'))['words'])
    return sorted({unicodedata.normalize('NFKC', f).strip() for f in forms})

if __name__ == '__main__':
    print(json.dumps(vocabulary(), ensure_ascii=False, separators=(',', ':')))
