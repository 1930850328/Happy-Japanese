#!/usr/bin/env python3
"""Resolve the selected next content against frozen existing materials; never activate lessons.

Human decisions live in decisions.json and the three input TSVs. Generated outputs
are an inventory of those decisions, not a frequency-based vocabulary selector.
"""
import argparse
import collections
import csv
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import unicodedata
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / '.cache/content-scope'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table(path):
    with path.open(encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f, delimiter='\t'))
    assert all(None not in r for r in rows), path
    return rows


def key(term, reading):
    reading = unicodedata.normalize('NFKC', reading).strip()
    return term.strip(), ''.join(chr(ord(c)-96) if 'ァ' <= c <= 'ヶ' else c for c in reading)


class PublicTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag == 'td' and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(''.join(self.cell))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def main():
    ap = argparse.ArgumentParser(__doc__)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--fetch', action='store_true', help='Restore only the public JEV corroboration table, by content hash')
    args = ap.parse_args()
    manifest, decision = read(HERE/'sources.json'), read(HERE/'decisions.json')
    for name, expected in manifest['base_files'].items():
        assert sha(ROOT/name) == expected, 'Frozen material changed: '+name
    assert manifest['test_inputs'] == decision['test_inputs'] == []
    selected = read(ROOT/'01-materials/vocabulary-scope/selected.json')
    inv = read(ROOT/'02-course-design/inventory.json')
    cards = {r['id']: r for r in read(ROOT/'01-materials/data/vocabulary-kaishi.json')}
    irodori = {r['id']: r for r in read(ROOT/'01-materials/data/vocabulary-irodori.json')}
    old_policy = read(ROOT/'05-curriculum-audit/policy.json')
    grammar = table(HERE/'grammar-targets.tsv')
    old_grammar = {r['id']: r for r in table(ROOT/'05-curriculum-audit/grammar-scope.tsv')}
    assert len({r['id'] for r in grammar}) == len(grammar)
    assert {r['audit_group'] for r in grammar} == set(old_grammar)
    assert all(r['forms'] and r['must_understand'] and r['action'] for r in grammar)

    # Use only previously documented spelling equivalences; never merge by reading alone.
    links = collections.defaultdict(set)
    def link(group):
        for k in group:
            links[k].update(group)
    for r in selected:
        link({key(r['term'], r['reading'])} | {key(v['term'], v['reading']) for v in r['variants']}
             | {key(v, r['reading']) for v in r.get('orthographicNote', {}).get('otherForms', [])})
    for group in old_policy['reviewed_spelling_groups']:
        link({key(*v) for v in group})
    for r in inv['selected_group_to_course']:
        link({key(r['term'], r['reading']), key(r['course_form'], r['reading'])})
    def variants(k):
        found, todo = {k}, [k]
        while todo:
            for other in links[todo.pop()] - found:
                found.add(other)
                todo.append(other)
        return found
    preferred = [key(r['term'], r['reading']) for r in selected]
    preferred += [key(r['form'], r['reading']) for r in inv['words']]
    preferred_rank = {k: i for i, k in reversed(list(enumerate(preferred)))}
    def canonical(k):
        return min(variants(k), key=lambda v: (preferred_rank.get(v, 100000), v))

    words = {}
    def add(k, ref, role, why, meaning):
        k = canonical(k)
        if k not in words:
            words[k] = {'term': k[0], 'reading': k[1], 'refs': set(), 'roles': set(), 'reasons': set(), 'meaning_refs': set(), 'course_days': set()}
        r = words[k]
        r['refs'].add(ref)
        r['roles'].add(role)
        r['reasons'].add(why)
        if meaning:
            r['meaning_refs'].add(meaning)
        return r
    for r in inv['words']:
        w = add(key(r['form'], r['reading']), 'v3:inventory:'+r['form']+'|'+r['reading'], 'v3保留', '保留已有教学基础，不因语料词元未对齐删除', 'v3:'+r['form']+'|'+r['reading']+'#gloss+lesson')
        w['course_days'].update(r['table_days'])
    original_keys = set(words)
    for r in decision['source_card_selections']:
        card = cards[r['source_id']]
        assert (card['term'], card['reading'], card['sourceOrder']) == (r['term'], r['reading'], r['source_order'])
        for role in r['roles']:
            add(key(r['term'], r['reading']), r['source_id'], role, r['reason'], r['meaning_ref'])
    priority = table(ROOT/'05-curriculum-audit/priority-additions.tsv')
    for r in priority:
        add(key(r['term'], r['reading']), 'priority79:'+r['term'], '原增补逐项保留', r['teaching_note'], 'priority79:'+r['term']+'#meaning_zh+collocation')
    for r in table(HERE/'supplements.tsv'):
        refs = decision['supplement_source_refs'][r['term']+'|'+r['reading']]
        assert refs and all(key(irodori[x]['term'], irodori[x]['reading']) == key(r['term'], r['reading']) for x in refs)
        w = add(key(r['term'], r['reading']), 'supplement:'+r['term'], r['role'], '补足已有Irodori中的普通生活/文字操作功能；非专业物种或菜单穷举', 'supplements.tsv:'+r['term']+'#meaning_zh+usage')
        w['refs'].update(refs)
    usage = table(HERE/'usage-targets.tsv')
    usage_only = []
    for r in usage:
        k = canonical(key(r['term'], r['reading']))
        if k not in words:
            usage_only.append(r['term']+'|'+r['reading'])
            continue
        words[k]['meaning_refs'].add('usage-targets.tsv:'+r['term']+'|'+r['reading']+'#override')
    # These bounds are deliberately owned by the number/quantity grammar unit.
    assert usage_only == ['以下|いか'], usage_only
    recognition = set(decision['recognition_only_terms'])
    missing_recognition = recognition - {r['term'] for r in words.values()}
    assert not missing_recognition, missing_recognition

    # Published JEV is corroboration only: changing its level cannot select/remove a word.
    source = manifest['new_references'][0]
    path = CACHE/source['cache_file']
    if not path.exists() and args.fetch:
        with urllib.request.urlopen(source['url'], timeout=60) as response:
            data = response.read()
        parser = PublicTable()
        parser.feed(data.decode('utf-8'))
        digest = hashlib.sha256(json.dumps(parser.rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        assert digest == source['parsed_rows_sha256'], 'JEV published content changed; do not replace frozen evidence'
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    assert path.exists(), 'Run build.py --fetch to restore JEV corroboration source'
    parser = PublicTable()
    parser.feed(path.read_text(encoding='utf-8'))
    assert hashlib.sha256(json.dumps(parser.rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest() == source['parsed_rows_sha256']
    jev = collections.defaultdict(list)
    for r in parser.rows:
        if len(r) >= 4 and r[0].isdigit():
            jev[key(r[1], r[2])].append(r[3])
    corroboration = collections.Counter()
    for k in words:
        levels = sorted({level for v in variants(k) for level in jev[v]})
        corroboration['multiple_level_matches' if len(levels) > 1 else levels[0] if levels else 'no_exact_or_reviewed_spelling_match'] += 1

    def meaning_authority(refs):
        # One effective definition layer; keep lower layers as source provenance only.
        for prefix in ['usage-targets.tsv:', 'supplements.tsv:', 'priority79:', 'v3:', 'kaishi:']:
            matching = sorted(x for x in refs if x.startswith(prefix))
            if matching:
                return ';'.join(matching)
        raise AssertionError('No teaching meaning authority')
    fields = ['term', 'reading', 'scope', 'v3_relation', 'v3_table_days', 'roles', 'meaning_authority', 'source_refs', 'selection_reason']
    rows = []
    for k, r in sorted(words.items()):
        rows.append(dict(zip(fields, [r['term'], r['reading'], '随文识别' if r['term'] in recognition else '核心阅读', '正式表项已有' if k in original_keys else '正式表项未列；正文须另查', ','.join(map(str, sorted(r['course_days']))), ';'.join(sorted(r['roles'])), meaning_authority(r['meaning_refs']), ';'.join(sorted(r['refs'])), ';'.join(sorted(r['reasons']))])))
    assert all(r['meaning_authority'] and r['source_refs'] for r in rows)
    assert len({(r['term'], r['reading']) for r in rows}) == len(rows)
    legacy = table(ROOT/'05-curriculum-audit/v3-priority-audit.tsv')
    reviewed_legacy = []
    for r in legacy:
        if r['decision'].startswith(('转', '未')):
            k = canonical(key(r['term'], r['reading']))
            assert k in words
            reviewed_legacy.append({'term': r['term'], 'reading': r['reading'], 'previous_action': r['decision'], 'decision': '随文识别' if k[0] in recognition else '保留核心阅读', 'reason': decision['legacy_dispositions'][r['term']], 'course_days': ','.join(map(str, sorted(words[k]['course_days'])))})
    assert {r['term'] for r in reviewed_legacy} == set(decision['legacy_dispositions'])
    priority_review = []
    for r in priority:
        prior = decision['priority_prose_evidence'].get(r['term'])
        location = ''
        if prior:
            location = f"02-course-design/lessons/{prior['day']:02d}.md:{prior['line']}"
            line = (ROOT/location.split(':')[0]).read_text(encoding='utf-8').splitlines()[prior['line']-1]
            assert r['term'] in line or r['term'] == '要る' and 'いらない' in line, location
        priority_review.append({'term':r['term'], 'reading':r['reading'], 'decision':'纳入当前内容范围', 'existing_teaching':prior['status'] if prior else '未确认有独立日文词义教学；中文说明或复合词包含不算', 'evidence':location, 'required_action':prior['note'] if prior else r['teaching_note'], 'target_meaning_ref':meaning_authority(words[canonical(key(r['term'],r['reading']))]['meaning_refs'])})
    summary = {'version': decision['version'], 'unit': 'explicit-spelling-linked form+reading groups, not disambiguated sense count', 'base_form_reading_entries': len(inv['words']), 'base_groups_after_documented_spelling_links': len(original_keys), 'target_groups': len(words), 'core_reading_groups': sum(r['scope']=='核心阅读' for r in rows), 'context_recognition_groups': sum(r['scope']=='随文识别' for r in rows), 'not_in_formal_v3_table_groups': len(set(words)-original_keys), 'explicit_source_card_senses': len(decision['source_card_selections']), 'priority_items_reviewed': len(priority), 'supplement_items': len(table(HERE/'supplements.tsv')), 'usage_targets': len(usage), 'grammar_units': len(grammar), 'grammar_core_units': sum(old_grammar[r['audit_group']]['priority']=='基础' for r in grammar), 'legacy_31_plus_8_dispositions': len(reviewed_legacy), 'jev_corrob_exact_or_reviewed_spelling_levels': dict(corroboration), 'semantically_selected_not_frequency_gated': True, 'new_course_authored': False, 'new_comprehension_score': None, 'time_feasibility_verified': False, 'test_inputs': []}
    def emit(name, data):
        path = HERE/name
        if args.check:
            assert path.read_text(encoding='utf-8') == data, 'Stale generated file: '+name
        else:
            path.write_text(data, encoding='utf-8')
    def emit_table(name, records):
        buf = io.StringIO(newline='')
        writer = csv.DictWriter(buf, list(records[0]), delimiter='\t', lineterminator='\n')
        writer.writeheader()
        writer.writerows(records)
        emit(name, buf.getvalue())
    emit_table('WORDS.tsv', rows)
    emit_table('legacy-review.tsv', reviewed_legacy)
    emit_table('priority-review.tsv', priority_review)
    emit('summary.json', json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
