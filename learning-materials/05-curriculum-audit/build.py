#!/usr/bin/env python3
"""Reproduce an independent curriculum audit, never read test passages/answers.

This writes a proposal, NOT selection.json, lessons, or historical results.
Raw corpora remain in the ignored cache. Standard library only.
"""
import argparse
import collections
import csv
import hashlib
import io
import json
from pathlib import Path
import unicodedata
import zipfile
from fetch_source import fetch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = ROOT / '.cache/curriculum-audit'
REGISTERS = ['PB', 'PM', 'PN', 'OC', 'OY']


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def norm(s):
    return unicodedata.normalize('NFKC', s or '').strip()


def kana(s):
    return ''.join(chr(ord(c)-96) if 'ァ' <= c <= 'ヶ' else c for c in norm(s))


def key(form, reading):
    return norm(form), kana(reading)


def emit(name, data, check):
    p = HERE / name
    if check:
        assert p.read_text(encoding='utf-8') == data, 'Stale generated file: ' + name
    else:
        p.write_text(data, encoding='utf-8')


def tsv(name, rows, fields, check):
    buf = io.StringIO(newline='')
    writer = csv.DictWriter(buf, fields, delimiter='\t', lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    emit(name, buf.getvalue(), check)


def zip_rows(name, member):
    with zipfile.ZipFile(CACHE / name) as archive:
        return list(csv.DictReader(io.StringIO(archive.read(member).decode('utf-8-sig')), delimiter='\t'))


def lexical(pos):
    # 助数詞可能 includes lexical nouns such as 手, 年, 時間; it is not 数詞.
    return not pos.startswith('名詞-数詞') and not any(x in pos for x in ['固有名詞', '助詞', '助動詞', '接尾辞', '接頭辞', '補助記号', '記号', 'フィラー'])


def main():
    ap = argparse.ArgumentParser(__doc__)
    ap.add_argument('--fetch', action='store_true', help='Download hash-pinned sources into ignored cache')
    ap.add_argument('--check', action='store_true', help='Verify generated audit and frozen v3 without writing')
    args = ap.parse_args()
    manifest = read(HERE / 'sources.json')
    CACHE.mkdir(parents=True, exist_ok=True)
    for source in manifest['downloads']:
        p = CACHE / source['file']
        if not p.exists() and args.fetch:
            data = fetch(source['url'], source.get('member_suffix'))
            assert hashlib.sha256(data).hexdigest() == source['sha256'], source['file']
            p.write_bytes(data)
        assert p.exists(), 'Run build.py --fetch; missing ' + str(p)
        assert sha(p) == source['sha256'], 'Source hash mismatch: ' + str(p)
    baseline = read(HERE / 'baseline.json')
    for path, expected in baseline['files'].items():
        assert sha(ROOT / path) == expected, 'v3 changed; start a new audit baseline: ' + path

    policy = read(HERE / 'policy.json')
    limit = policy['written_rank_limit']
    required = policy['minimum_written_registers']
    written = zip_rows('bccwj.zip', 'BCCWJ_frequencylist_suw_ver1_1.tsv')
    with (CACHE / 'cejc.tsv').open(encoding='utf-8-sig') as handle:
        spoken = list(csv.DictReader(handle, delimiter='\t'))
    # The CEJC header is frozen and described in sources.json, not guessed/fuzzy.
    ch = manifest['cejc_columns']
    spoken_by_key = collections.defaultdict(list)
    for r in spoken:
        spoken_by_key[key(r[ch['lemma']], r[ch['reading']])].append(r)
    written_by_key = collections.defaultdict(list)
    for r in written:
        written_by_key[key(r['lemma'], r['lForm'])].append(r)

    source_words = collections.defaultdict(list)
    for filename in ['vocabulary-kaishi.json', 'vocabulary-irodori.json']:
        for r in read(ROOT / '01-materials/data' / filename):
            source_words[key(r['term'], r['reading'])].append(r['id'])
    selected = read(ROOT / '01-materials/vocabulary-scope/selected.json')
    inventory = read(ROOT / '02-course-design/inventory.json')['words']
    # Explicitly documented variants only. Same reading alone is not equivalence.
    aliases = collections.defaultdict(set)
    for r in selected:
        variants = {key(r['term'], r['reading'])} | {key(v['term'], v['reading']) for v in r['variants']}
        variants |= {key(v, r['reading']) for v in r.get('orthographicNote', {}).get('otherForms', [])}
        for k in variants:
            aliases[k].update(variants)
    for group in policy['reviewed_spelling_groups']:
        variants = {key(v[0], v[1]) for v in group}
        for k in variants:
            aliases[k].update(variants)
    course_by_key = collections.defaultdict(set)
    for w in inventory:
        k = key(w['form'], w['reading'])
        for variant in {k} | aliases[k]:
            course_by_key[variant].add((w['form'], w['reading'], w['first_day']))

    def ranks(r):
        return {g: int(r[g+'_rank']) if r[g+'_rank'] else 0 for g in REGISTERS}

    def broad(r, threshold=limit):
        return lexical(r['pos']) and sum(0 < v <= threshold for v in ranks(r).values()) >= required

    rows, scope = [], {}
    for k, entries in sorted(written_by_key.items()):
        qualifying = [r for r in entries if broad(r)]
        if not qualifying:
            continue
        # One concrete lexeme must pass across registers; never mix senses to pass.
        best = min(qualifying, key=lambda r: (int(r['rank']), r['pos'], r['subLemma'], r['wType']))
        ids = sorted(set(source_words[k]))
        present = sorted(course_by_key[k])
        candidates = [r for r in spoken_by_key[k] if r[ch['pos']].split('-')[0] == best['pos'].split('-')[0]]
        cejc_rank = min((int(r[ch['rank']]) for r in candidates), default=0)
        decision = '基础候选' if ids or present else '跨体裁扩展候选'
        if k in {key(*v) for v in policy['ambiguous_defer']}:
            decision = '歧义待核'
        scope[k] = decision
        rows.append(dict(term=k[0], reading=k[1], teaching_forms=';'.join(sorted({x[0] for x in present})) or k[0], decision=decision,
                         evidence_pos=best['pos'], evidence_sublemma=best['subLemma'], evidence_wtype=best['wType'],
                         written_registers=sum(0 < v <= limit for v in ranks(best).values()),
                         **{g+'_rank': ranks(best)[g] for g in REGISTERS},
                         CEJC_rank=cejc_rank or '',
                         textbook_ids=';'.join(ids),
                         v3_table_days=','.join(map(str, sorted({x[2] for x in present}))),
                         v3_forms=';'.join(x[0]+'('+x[1]+')' for x in present),
                         teaching_status='词头候选；义项/搭配须按content-spec.md编写；未成为学生课程'))
    fields = ['term', 'reading', 'teaching_forms', 'decision', 'evidence_pos', 'evidence_sublemma', 'evidence_wtype', 'written_registers'] + [g+'_rank' for g in REGISTERS] + ['CEJC_rank', 'textbook_ids', 'v3_table_days', 'v3_forms', 'teaching_status']
    tsv('vocabulary-proposal.tsv', rows, fields, args.check)

    def audit(form, reading, variants):
        ks = {key(form, reading)} | variants
        ks |= set().union(*(aliases[k] for k in list(ks)))
        matches = [(k, r) for k in sorted(ks) for r in written_by_key[k]]
        lexical_matches = [(k, r) for k, r in matches if lexical(r['pos'])]
        broad_matches = [(k, r) for k, r in lexical_matches if broad(r)]
        cs = [r for k in ks for r in spoken_by_key[k] if lexical(r[ch['pos']])]
        c_rank = min((int(r[ch['rank']]) for r in cs), default=0)
        if broad_matches:
            decision = '保留通用基础候选'
        elif c_rank and c_rank <= policy['conversation_rank_limit']:
            decision = '保留会话补充候选'
        elif form in policy['whole_expression_groups']:
            decision = '保留完整表达/构词组；短单位排名不适用'
        elif form in policy['variant_recognition_groups']:
            decision = '变体识别；未用母词频率冒充本形频率'
        elif lexical_matches:
            decision = '转专题或搭配复核；不自动删除'
        else:
            decision = '未对齐；核对异写/短单位切分，不能断言低频'
        return dict(term=form, reading=reading, decision=decision,
                    BCCWJ_matches=';'.join(sorted({k[0]+'('+k[1]+'):'+r['pos'] for k,r in matches})),
                    broad_matches=';'.join(sorted({k[0]+'('+k[1]+')' for k,r in broad_matches})),
                    CEJC_rank=c_rank or '',
                    limit='词头匹配不证明义项覆盖；POS/语种歧义保留在匹配证据中')
    old = [audit(r['term'], r['reading'], {key(v['term'],v['reading']) for v in r['variants']}) for r in selected]
    f = ['term','reading','decision','BCCWJ_matches','broad_matches','CEJC_rank','limit']
    tsv('v3-priority-audit.tsv', old, f, args.check)
    table_audit = [dict(**audit(w['form'],w['reading'],set()), first_day=w['first_day'],recall_days=','.join(map(str,w['recall_days']))) for w in inventory]
    tsv('v3-table-audit.tsv', table_audit, f+['first_day','recall_days'], args.check)

    additions = list(csv.DictReader((HERE/'priority-additions.tsv').open(encoding='utf-8'), delimiter='\t'))
    proposed = {key(r['term'],r['reading']): r for r in rows}
    assert len({key(r['term'],r['reading']) for r in additions}) == len(additions)
    addition_evidence = []
    for a in additions:
        r = proposed[key(a['term'],a['reading'])]
        assert r['decision'] == '基础候选' and not r['v3_table_days'], a['term']
        assert a['meaning_zh'] and a['teaching_class'] and a['collocation']
        addition_evidence.append({k:r[k] for k in fields if k != 'teaching_status'})
    tsv('priority-additions-evidence.tsv', addition_evidence, [k for k in fields if k != 'teaching_status'], args.check)

    grammar = list(csv.DictReader((HERE/'grammar-scope.tsv').open(encoding='utf-8'), delimiter='\t'))
    by_id = {g['id']:g for g in grammar}
    assert len(by_id) == len(grammar)
    iro = {r['id'].split(':')[1]:r for r in read(ROOT/'01-materials/data/grammar-irodori.json')}
    tae = {r['id'].split(':')[1] for r in read(ROOT/'01-materials/data/grammar-tae-kim-index.json')}
    for g in grammar:
        assert all(x in iro for x in g['irodori_pattern_ids'].split(',') if x), g['id']
        assert all(x in tae for x in g['tae_kim_chapter'].split(',') if x), g['id']
        assert all(x in by_id for x in g['prerequisites'].split(',') if x), g['id']
    def visit(k, stack):
        assert k not in stack, 'Prerequisite cycle: '+str(stack+[k])
        for dep in by_id[k]['prerequisites'].split(','):
            if dep: visit(dep, stack+[k])
    for k in by_id: visit(k, [])
    # Link every source pattern to its reviewed functional owner or explicit scope note.
    alignment=[]
    for sid, source in iro.items():
        owners=[g['id'] for g in grammar if sid in g['irodori_pattern_ids'].split(',')]
        alignment.append(dict(source_id=source['id'],book=source['book'],lesson=source['lesson'],modules=','.join(owners),
                              status='明确对照' if owners else '教材特定话术/细分形式；本轮未逐项认定独立必教单元'))
    tsv('irodori-alignment.tsv', alignment, ['source_id','book','lesson','modules','status'], args.check)
    reviews=list(csv.DictReader((HERE/'lesson-review.tsv').open(encoding='utf-8'), delimiter='\t'))
    assert [int(r['day']) for r in reviews]==list(range(1,22))
    metrics=[]
    for day in range(1,22):
        new=[w for w in inventory if w['first_day']==day]
        recall=sum(day in w['recall_days'] for w in inventory)
        metrics.append(dict(day=day,new_table_entries=len(new),scheduled_recall_entries=recall,
                            new_seconds_each_if_entire_21min_spent_on_words=round(1260/len(new),2) if day>=4 else '',
                            recall_seconds_each_if_entire_10min_spent_on_recall=round(600/recall,2) if day>=4 and recall else ''))
    tsv('lesson-metrics.tsv',metrics,list(metrics[0]),args.check)
    summary=dict(date='2026-11-16',purpose='independent_content_audit_not_learner_test',
                 test_inputs_used=[],existing_lessons=21,existing_table_entries=len(inventory),existing_priority_groups=len(selected),
                 corpus_rows=dict(BCCWJ=len(written),CEJC=len(spoken)),
                 proposal_counts=dict(collections.Counter(r['decision'] for r in rows)),
                 foundation_candidates_without_exact_or_reviewed_variant_table_match=sum(r['decision']=='基础候选' and not r['v3_table_days'] for r in rows),
                 old_priority_actions=dict(collections.Counter(r['decision'] for r in old)),
                 grammar_module_count=len(grammar),grammar_status=dict(collections.Counter(g['v3_status'] for g in grammar)),
                 curated_priority_additions=len(additions),
                 irodori_source_patterns=len(iro),irodori_explicitly_aligned=sum(bool(a['modules']) for a in alignment),
                 written_threshold_sensitivity={str(n):len({key(r['lemma'],r['lForm']) for r in written if broad(r,n)}) for n in [2000,3000,4000]},
                 v3_unchanged=True,student_comprehension_score=None,
                 limitations=['Word-head and selected POS matches, not disambiguated senses or learning outcomes.',
                              'Five BCCWJ registers belong to one corpus; CEJC is separate conversational evidence.',
                              'Candidate threshold is editorial; not selected by exam scores or optimized for 90%.',
                              'No 21-day lesson rewrite or novice timing validation in this content-audit stage.'])
    emit('summary.json',json.dumps(summary,ensure_ascii=False,indent=2)+'\n',args.check)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
