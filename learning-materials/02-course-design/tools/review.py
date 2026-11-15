"""Check the authored course; derive its inventory and fixed recall pages.

The 21 lesson Markdown files own teaching text and contextual glosses. Generated
files are indexes/practice copies, never a second editable vocabulary database.
This checks editorial invariants, not human mastery or elapsed learning time.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

COURSE = Path(__file__).resolve().parents[1]
LEARNING = COURSE.parent


def vocabulary(text):
    active = False
    rows = []
    for line in text.splitlines():
        if line.startswith('| 词形 |'):
            active = True
            continue
        if active and not line.startswith('|'):
            active = False
        if active and '---' not in line:
            cells = [x.strip() for x in line.strip('|').split('|')]
            assert len(cells) == 3, line
            rows.append(dict(form=cells[0], reading=cells[1], gloss=cells[2]))
    return rows


def make():
    paths = sorted((COURSE / 'lessons').glob('*.md'))
    assert [p.stem for p in paths] == [f'{n:02}' for n in range(1, 22)]
    cards, lessons, quoted = {}, [], {}
    for day, path in enumerate(paths, 1):
        text = path.read_text(encoding='utf-8')
        assert text.startswith(f'# 第 {day} 天：'), path
        assert '时间上限：' in text and '先修：' in text, path
        line = next(s for s in text.splitlines() if s.startswith('时间上限：'))
        minutes = sum(map(int, re.findall(r'\d+', line.split('。')[0])))
        assert minutes == 60, (path, minutes)
        assert text.count('<details>') == text.count('</details>') >= 2, path
        assert not re.search(r'TODO|待编写|待补写|占位符', text), path
        for link in re.findall(r'\]\(([^)]+)\)', text):
            if not link.startswith(('https:', 'http:', '#')):
                assert (path.parent / link.split('#')[0]).exists(), (path, link)
        words = vocabulary(text)
        assert len({(w['form'], w['reading']) for w in words}) == len(words), path
        new, reused = [], []
        for word in words:
            form = word['form']
            key = (form, word['reading'])
            if key not in cards:
                cards[key] = dict(**word, first_day=day, table_days=[])
                new.append(form)
            else:
                reused.append(form)
            cards[key]['table_days'].append(day)
        # Long identical sentences across days merit review. Short formulaic
        # strings and deliberate within-lesson rereading are not duplicate lessons.
        for sentence in re.findall(r'^> (.{24,})$', text, re.M):
            quoted.setdefault(sentence, set()).add(day)
        lessons.append(dict(day=day, path=str(path.relative_to(LEARNING)),
                            title=text.splitlines()[0][2:], budget_minutes=minutes,
                            vocabulary_table_forms=len(words), new_table_forms=new,
                            reused_table_forms=reused, feedback_sections=text.count('<details>'),
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    duplicates = [dict(text=s, days=sorted(ds)) for s, ds in quoted.items() if len(ds) > 1]
    assert not duplicates, duplicates

    sources = []
    for filename in ['vocabulary-kaishi.json', 'vocabulary-irodori.json']:
        sources.extend(json.loads((LEARNING / '01-materials/data' / filename).read_text(encoding='utf-8')))
    source_by_form = {}
    for source in sources:
        source_by_form.setdefault(source['term'], []).append(source)
    for (form, reading), card in cards.items():
        card['source_form_candidates'] = [dict(id=s['id'], reading=s['reading'])
                                           for s in source_by_form.get(form, [])]
        # A scheduling decision, not a claim of an optimal memory interval.
        card['recall_days'] = [d for d in [card['first_day']+1, card['first_day']+3,
                                         card['first_day']+7] if d <= 21]

    recall = ['# 每日词形回想（由课文词表生成）', '',
              '本页占用每天已有的复现时间，不是加课。先看词形想意思，再打开答案。',
              '按首次词表教学后的第 1、3、7 个学习日安排，是本版的固定编排，',
              '不是已验证的最佳间隔。较晚引入的词在本期内复现较少，不能宣称已经学熟。',
              '词表条目包含少量字形重现，不把这里的行数叫作独立词汇掌握量。',
              '若规定时间内做不完，记录未完成项，不在当天追加学习时间。', '']
    for day in range(1, 22):
        due = [v for v in cards.values() if day in v['recall_days']]
        # Reverse form order varies from introduction order without random state.
        due.sort(key=lambda v: v['form'], reverse=day % 2 == 0)
        recall += [f'## Day {day:02}', '', f'词形数：{len(due)}。', '',
                   '　／　'.join(v['form'] for v in due) if due else '今天没有前课词表要回想，做课内字形活动即可。', '']
        if due:
            recall += ['<details><summary>展开核对词义</summary>', '', '| 词形 | 读法 | 当初教学的义项 |',
                       '| --- | --- | --- |']
            recall += [f"| {v['form']} | {v['reading']} | {v['gloss']} |" for v in due]
            recall += ['', '</details>', '']

    kaishi = json.loads((LEARNING / '01-materials/data/vocabulary-kaishi.json').read_text(encoding='utf-8'))
    mapping = [dict(id=v['id'], term=v['term'], reading=v['reading'],
                    exact_course_form_first_day=cards.get((v['term'], v['reading']), {}).get('first_day')) for v in kaishi]
    selected = json.loads((LEARNING / '01-materials/vocabulary-scope/selected.json').read_text(encoding='utf-8'))
    selected_mapping = []
    for word in selected:
        variants = {(word['term'], word['reading'])} | {(v['term'], v['reading']) for v in word['variants']}
        canonical = cards.get((word['term'], word['reading']))
        matches = [canonical] if canonical else [cards[key] for key in variants if key in cards]
        assert matches, ('Selected group not actually taught', word['term'], word['reading'])
        first = min(matches, key=lambda c: c['first_day'])
        selected_mapping.append(dict(term=word['term'], reading=word['reading'],
                                     first_day=first['first_day'], course_form=first['form']))
    report = dict(type='course_editorial_checks', learner_test=False, comprehension_percent=None,
                  complete_lesson_files=len(paths), feedback_sections=sum(v['feedback_sections'] for v in lessons),
                  distinct_vocabulary_table_forms=len(cards),
                  selected_priority_groups=len(selected),
                  selected_priority_groups_taught=len(selected_mapping),
                  maximum_new_forms_per_day=max(len(l['new_table_forms']) for l in lessons),
                  exact_source_form_matched=sum(bool(c['source_form_candidates']) for c in cards.values()),
                  kaishi_pool_preserved=len(mapping),
                  kaishi_records_with_exact_course_form=sum(v['exact_course_form_first_day'] is not None for v in mapping),
                  duplicate_long_reading_lines_across_lessons=duplicates,
                  budget_check='60 minutes allocated in each lesson; not empirically timed',
                  maximum_recall_forms_per_day=max(sum(d in c['recall_days'] for c in cards.values()) for d in range(1,22)),
                  limits=['Source form matches are lookup candidates, not verified sense equivalence.',
                          'Tables do not enumerate every function expression or inflection taught in prose.',
                          'No automatic check proves naturalness, human mastery or feasible learning time.'],
                  lessons=lessons)
    inventory = dict(authority='lessons/*.md; this is a derived index',
                     words=list(cards.values()), selected_group_to_course=selected_mapping,
                     kaishi_source_to_course=mapping)
    return {'RECALL.md':'\n'.join(recall)+'\n',
            'inventory.json':json.dumps(inventory,ensure_ascii=False,indent=2)+'\n',
            'review-results.json':json.dumps(report,ensure_ascii=False,indent=2)+'\n'}, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='regenerate derived indexes after editing lessons')
    args = parser.parse_args()
    outputs, report = make()
    for name, body in outputs.items():
        path = COURSE / name
        if args.write:
            path.write_text(body, encoding='utf-8', newline='\n')
        else:
            assert path.read_text(encoding='utf-8') == body, 'Stale generated file: ' + name
    print(json.dumps({k:v for k,v in report.items() if k != 'lessons'}, ensure_ascii=False,indent=2))
