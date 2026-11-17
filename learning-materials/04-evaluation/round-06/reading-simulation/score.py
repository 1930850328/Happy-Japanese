"""Recompute editorial simulation judgments; never infer comprehension from word hits."""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROUND = HERE.parent
ROOT = ROUND.parent.parent


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(rows):
    counts = Counter(float(row['score']) for row in rows)
    earned = sum(float(row['score']) for row in rows)
    return {
        'units': len(rows), 'fully_understood': counts[1],
        'partly_understood': counts[0.5], 'not_understood_or_wrong': counts[0],
        'earned': earned, 'possible': len(rows),
        'simulated_content_comprehension_percent': earned / len(rows) * 100,
        'fully_understood_unit_percent': counts[1] / len(rows) * 100,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    for name, expected in read(HERE / 'freeze.json')['files'].items():
        if digest(ROOT / name) != expected:
            raise ValueError('Frozen input changed: ' + name)
    for name, expected in read(HERE / 'judgment-manifest.json')['files'].items():
        if digest(HERE / name) != expected:
            raise ValueError('Editorial judgment changed: ' + name)
    samples = {s['id']: s for s in read(ROUND / 'samples.json')}
    with (HERE / 'units.tsv').open(encoding='utf-8', newline='') as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    if {row['sample_id'] for row in rows} != set(samples):
        raise ValueError('Missing or additional passage')
    seen = set()
    for row in rows:
        if None in row or any(not value for value in row.values()):
            raise ValueError('Missing field')
        key = (row['sample_id'], row['meaning_label'])
        if key in seen or float(row['score']) not in (0, 0.5, 1):
            raise ValueError('Duplicate judgment or invalid score')
        seen.add(key)
        for day in row['course_days'].split(','):
            if not re.fullmatch(r'0[1-9]|1[0-9]|2[01]', day):
                raise ValueError('Invalid course day')
        if row['locator'].startswith('image:'):
            if samples[row['sample_id']]['genre'] != 'manga':
                raise ValueError('Image inference outside manga')
        else:
            match = re.fullmatch(r'(\d+)(?:-(\d+))?', row['locator'])
            if not match or int(match[1]) > int(match[2] or match[1]):
                raise ValueError('Invalid text locator')
            source = ROOT / '.cache/round-06' / samples[row['sample_id']]['file']
            if source.exists():
                if digest(source) != samples[row['sample_id']]['sha256']:
                    raise ValueError('Original changed')
                if int(match[2] or match[1]) > len(source.read_text().splitlines()):
                    raise ValueError('Locator outside passage')
    genres = sorted({sample['genre'] for sample in samples.values()})
    report = {
        'type': 'editorial_course_constrained_reading_simulation',
        'real_student_test': False, 'new_holdout': False,
        'assumption': 'Full recall and use of explicitly taught material; Chinese and visible-context inference allowed and recorded.',
        'grading': {'full': 1, 'partial': 0.5, 'unknown_or_key_relation_wrong': 0},
        'overall': summarize(rows),
        'language_units_excluding_image_only': summarize([row for row in rows if not row['locator'].startswith('image:')]),
        'genres': {genre: summarize([row for row in rows if samples[row['sample_id']]['genre'] == genre]) for genre in genres},
        'samples': {sid: summarize([row for row in rows if row['sample_id'] == sid]) for sid in samples},
        'limits': [
            'Model-authored novice interpretations and grades, not independent human responses.',
            'Meaning-unit boundaries and partial credit are editorial choices, not a calibrated measurement instrument.',
            'Recomputation verifies arithmetic and frozen inputs, not the truth of semantic judgments.',
            'No pre-course control; Chinese and picture inference cannot be attributed solely to the course.',
            'Not evidence of 21-hour retention, speed, broad population comprehension or improvement over lexical scores.',
        ],
    }
    body = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    output = HERE / 'results.json'
    if args.check:
        if output.read_text() != body:
            raise ValueError('Result differs')
    else:
        output.write_text(body, encoding='utf-8')
    print(json.dumps(report['overall'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
