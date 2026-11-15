"""Build the research material catalog offline; never modifies application data.

Usage: python tools/build.py [--check]
Dependencies: openpyxl, pypdf, lxml (see requirements.txt).
"""
import argparse
import csv
import hashlib
import html as stdhtml
import io
import json
import re
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

from lxml import etree, html
from openpyxl import load_workbook
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'sources'


def plain(value):
    if not value:
        return ''
    node = html.fragment_fromstring(str(value), create_parent='div')
    for br in node.xpath('.//br'):
        br.tail = '\n' + (br.tail or '')
    return node.text_content().strip()


def book_name(value):
    return str(value).replace('１', '1').replace('２', '2').strip()


def build(out):
    def save(name, value):
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

    # Keep source GUIDs; row order is deck order, NOT an independently verified frequency rank.
    raw = (SOURCES / 'kaishi-zh-cn.tsv').read_text(encoding='utf-8')
    rows = list(csv.reader(io.StringIO('\n'.join(raw.splitlines()[3:])), delimiter='\t'))
    assert len(rows) == 1501 and all(len(row) == 17 for row in rows)
    assert rows[0][13] == '0' and not rows[0][2]  # Welcome card, not a vocabulary item.
    patches = json.loads((ROOT / 'corrections.json').read_text(encoding='utf-8'))
    vocabulary, applied = [], []
    for number, row in enumerate(rows[1:], 1):
        entry = dict(id='kaishi:' + row[0], sourceOrder=number, term=plain(row[1]),
                     reading=plain(row[2]), meaningZh=plain(row[3]), wordFurigana=plain(row[4]),
                     sentence=plain(row[6]), sentenceZh=plain(row[7]), sentenceFurigana=plain(row[8]),
                     notesZh=plain(row[10]), partOfSpeechZh=plain(row[15]), usageNotesZh=plain(row[16]))
        for patch in patches:
            if patch.get('sourceGuid') and patch['sourceGuid'] != row[0]:
                continue
            field = patch['field']
            if entry[field] == patch['original']:
                entry[field] = patch['replacement']
                applied.append(dict(id=entry['id'], correction=patch['id']))
        assert all(entry[key] for key in ('term', 'reading', 'meaningZh', 'sentence', 'sentenceZh'))
        vocabulary.append(entry)
    assert len({v['id'] for v in vocabulary}) == 1500
    assert {p['id'] for p in patches} == {a['correction'] for a in applied}
    save('data/vocabulary-kaishi.json', vocabulary)

    # Preserve occurrences and sense distinctions rather than merge homographs.
    word_rows = []
    ws = load_workbook(SOURCES / 'irodori-vocabulary.xlsx', data_only=True).active
    for row_number, row in enumerate(ws.values, 1):
        if not isinstance(row[0], (int, float)):
            continue
        word_rows.append(dict(id=f'irodori-word:{row_number}', sourceRow=row_number,
                              term=str(row[2]), reading=row[3], meaningEn=row[6], partOfSpeech=row[7],
                              note=row[8], book=row[9], lesson=row[10], activity=row[11],
                              subactivity=row[12], recurrence=row[13], firstOccurrence=row[14],
                              referenceVocabulary=row[15]))
    save('data/vocabulary-irodori.json', word_rows)

    # PDF text is a searchable derivative. The PDF is authoritative for tables/ruby/layout.
    pdf_pages, lesson_pages = [], defaultdict(list)
    reader = PdfReader(SOURCES / 'irodori-grammar-all-en.pdf')
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ''
        match = re.search(r'(入門|初級[12１２]|初中級)\s*L\s*(\d+)\s*[-－]\s*(\d+)', text)
        assert match, f'Unrecognized Irodori chapter on PDF page {number}'
        book, lesson = book_name(match[1]), int(match[2])
        lesson_pages[(book, lesson)].append(number)
        pdf_pages.append(dict(pdfPage=number, book=book, lesson=lesson,
                              printedPage=f'{book} L{lesson}-{match[3]}', text=text))
    save('data/irodori-grammar-pages.json', pdf_pages)

    grammar, book, topic, lesson_title = [], None, None, None
    ws = load_workbook(SOURCES / 'irodori-patterns.xlsx', data_only=True).active
    for number, row in enumerate(ws.values, 1):
        if number <= 3:
            continue
        book = book_name(row[0]) if row[0] else book
        topic = row[1] or topic
        lesson_title = row[2] or lesson_title
        if not row[4]:
            continue
        lesson = int(re.search(r'第(\d+)課', lesson_title)[1])
        pages = lesson_pages[(book, lesson)]
        assert pages, (book, lesson)
        grammar.append(dict(id=f'irodori-pattern:{number}', sourceRow=number, book=book,
                            topic=topic, lesson=lesson, lessonTitle=lesson_title, marker=row[3],
                            pattern=row[4], examples=row[5], explanationPdfPages=pages,
                            referenceScope='whole lesson; not an exact pattern-to-page alignment'))
    save('data/grammar-irodori.json', grammar)

    characters = {}
    ws = load_workbook(SOURCES / 'irodori-kanji.xlsx', data_only=True).worksheets[0]
    kanji_occurrences = 0
    for row_number, row in enumerate(ws.values, 1):
        if not isinstance(row[0], (int, float)):
            continue
        kanji_occurrences += 1
        item = characters.setdefault(row[2], dict(character=row[2], sourceNumber=row[0], occurrences=[]))
        item['occurrences'].append(dict(sourceRow=row_number, reading=row[3], word=row[4],
                                        wordReading=row[5], book=row[7], lesson=row[8]))
    save('data/kanji-irodori.json', list(characters.values()))

    kana = []
    basic = [('あいうえお', 'a i u e o'), ('かきくけこ', 'ka ki ku ke ko'),
             ('さしすせそ', 'sa shi su se so'), ('たちつてと', 'ta chi tsu te to'),
             ('なにぬねの', 'na ni nu ne no'), ('はひふへほ', 'ha hi fu he ho'),
             ('まみむめも', 'ma mi mu me mo'), ('やゆよ', 'ya yu yo'),
             ('らりるれろ', 'ra ri ru re ro'), ('わをん', 'wa wo n')]
    voiced = [('がぎぐげご', 'ga gi gu ge go'), ('ざじずぜぞ', 'za ji zu ze zo'),
              ('だぢづでど', 'da ji zu de do'), ('ばびぶべぼ', 'ba bi bu be bo'),
              ('ぱぴぷぺぽ', 'pa pi pu pe po')]
    for group, rows_ in [('basic', basic), ('voiced', voiced)]:
        for letters, romaji in rows_:
            for hira, roman in zip(letters, romaji.split(), strict=True):
                kana.append(dict(hiragana=hira, katakana=chr(ord(hira) + 0x60), romaji=roman, group=group))
    for hira, stem in [('き', 'ky'), ('し', 'sh'), ('ち', 'ch'), ('に', 'ny'), ('ひ', 'hy'),
                       ('み', 'my'), ('り', 'ry'), ('ぎ', 'gy'), ('じ', 'j'), ('び', 'by'), ('ぴ', 'py')]:
        for small, vowel in [('ゃ', 'a'), ('ゅ', 'u'), ('ょ', 'o')]:
            kana.append(dict(hiragana=hira+small, katakana=''.join(chr(ord(c)+0x60) for c in hira+small),
                             romaji=stem+vowel, group='contracted'))
    assert Counter(k['group'] for k in kana) == dict(basic=46, voiced=25, contracted=33)
    save('data/kana.json', kana)

    # A static, offline reference copy: keep tables/strikethrough/ruby, remove active content.
    book_dir = SOURCES / 'tae-kim-zh'
    toc = html.parse(str(book_dir / 'index.html'))
    ordered = [a.get('href') for a in toc.xpath('//h2/following-sibling::ol//a')]
    assert len(ordered) == len(set(ordered))
    chapter_index = []
    for filename in ordered:
        assert (book_dir / filename).is_file(), filename
        doc = html.parse(str(book_dir / filename))
        title = doc.xpath('//*[@id="page-title"]')[0]
        body = html.Element('article')
        for node in [title, *list(title.itersiblings())]:
            if node.tag == 'nav':
                break
            body.append(node)
        for node in list(body.xpath('.//script|.//iframe|.//audio|.//video|.//button|.//input|.//form')):
            node.drop_tree()
        for img in list(body.xpath('.//img')):
            placeholder = etree.Element('span')
            placeholder.text = '[原教材插图：' + (img.get('alt') or img.get('src') or '') + '；见来源网页]'
            img.getparent().replace(img, placeholder)
        for node in body.iter():
            for attr in list(node.attrib):
                if attr.lower().startswith('on') or attr == 'style':
                    del node.attrib[attr]
        for a in body.xpath('.//a[@href]'):
            href = a.get('href')
            if href.startswith('javascript:'):
                del a.attrib['href']
            elif not href.startswith(('http:', 'https:', '#', 'mailto:')):
                target = href.split('#')[0]
                if target not in ordered:
                    a.set('href', 'https://res.wokanxing.info/jpgramma/' + href)
        title_text = title.text_content().strip()
        headings = [n.text_content().strip() for n in body.xpath('.//h2')]
        chapter_index.append(dict(id='taekim:' + Path(filename).stem, title=title_text,
                                  headings=headings, file='reader/tae-kim-zh/' + filename,
                                  source='https://github.com/pizzamx/jpgramma/blob/master/' + filename))
        attribution = ('<p class="source">原作者 Tae Kim；中文译者 pizzamx；'
                       'CC BY-NC-SA 3.0 US。此副本仅调整排版、移除联网脚本及影音，未校订译文。'
                       '<a href="https://res.wokanxing.info/jpgramma/' + filename + '">来源</a> · '
                       '<a href="https://creativecommons.org/licenses/by-nc-sa/3.0/us/">许可</a> · '
                       '<a href="../index.html">教材目录</a></p>')
        style = 'body{max-width:900px;margin:32px auto;padding:0 20px;font:18px/1.8 sans-serif;color:#222}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 12px}em{color:#b33434}.source{font-size:14px;color:#555}.sumbox{background:#eef4f7;padding:16px}rt{font-size:.6em}'
        content = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + stdhtml.escape(title_text) + '</title><style>' + style + '</style>' + attribution + etree.tostring(body, encoding='unicode', method='html') + '</html>\n'
        target = out / 'reader/tae-kim-zh' / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8', newline='\n')
    save('data/grammar-tae-kim-index.json', chapter_index)

    counts = dict(kaishiVocabulary=len(vocabulary), kaishiAppliedCorrections=len(applied),
                  irodoriVocabularyOccurrences=len(word_rows),
                  irodoriDistinctTermReadingMeaningPos=len({(w['term'].strip(), w['reading'], w['meaningEn'], w['partOfSpeech']) for w in word_rows}),
                  irodoriPatternOccurrences=len(grammar),
                  irodoriPatternsByBook=dict(Counter(g['book'] for g in grammar)),
                  irodoriGrammarPdfPages=len(pdf_pages),
                  irodoriKanjiCharacters=len(characters), irodoriKanjiOccurrences=kanji_occurrences,
                  taeKimContentsEntries=len(chapter_index), kanaPairs=len(kana))
    save('data/inventory.json', counts)
    save('data/applied-corrections.json', applied)

    def esc(text):
        return stdhtml.escape(str(text or ''))

    style = 'body{max-width:1080px;margin:32px auto;padding:0 24px;font:17px/1.7 sans-serif;color:#222}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;vertical-align:top}td{white-space:pre-line}h2{margin-top:40px}small{color:#555}'
    catalog = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>日语教材资料目录</title><style>' + style + '</style><h1>日语教材资料目录</h1><p>第一阶段：教材内容。未安排课时，未接入应用。词卡与语法保留原来源；采集量不代表学习效果。</p><p><a href="#kana">假名</a> · <a href="#vocabulary">1500 词</a> · <a href="#grammar">中文语法教材</a> · <a href="#irodori">官方句型目录</a></p><p>完整来源与质量说明见上层 README.md。可使用浏览器查找（⌘F / Ctrl+F）。</p>']
    catalog.append('<h2 id="kana">假名对照表</h2><p>46 组基本字、25 组浊音/半浊音、33 组拗音；促音、长音、助词读法及外来语组合见《假名与阅读基础》。</p><table><tr><th>组别</th><th>平假名</th><th>片假名</th><th>罗马字辅助</th></tr>')
    for k in kana:
        catalog.append('<tr>' + ''.join('<td>' + esc(k[f]) + '</td>' for f in ('group', 'hiragana', 'katakana', 'romaji')) + '</tr>')
    catalog.append('</table><h2 id="grammar">Tae Kim 中文教材</h2><p>包括章节引言和练习，不把目录条目数称为语法规则数。中文社区译本，保留署名和许可。</p><ol>')
    for c in chapter_index:
        catalog.append('<li><a href="tae-kim-zh/' + esc(Path(c['file']).name) + '">' + esc(c['title']) + '</a></li>')
    catalog.append('</ol><h2 id="vocabulary">Kaishi 中文词卡</h2><p>保持来源顺序，不称为词频排名。已知修订见 corrections.json；其余沿用来源，尚未逐条教学审校。</p><table><tr><th>序号 / 词 / 读音</th><th>中文释义 / 词性</th><th>例句与翻译</th><th>补充</th></tr>')
    for v in vocabulary:
        cells = [f"{v['sourceOrder']}. {v['term']}\n{v['reading']}", v['meaningZh']+'\n'+v['partOfSpeechZh'], v['sentence']+'\n'+v['sentenceZh'], v['notesZh']+'\n'+v['usageNotesZh']]
        catalog.append('<tr>' + ''.join('<td>'+esc(s)+'</td>' for s in cells) + '</tr>')
    catalog.append('</table><h2 id="irodori">Irodori 官方句型目录</h2><p>保留教材重复出现的条目。PDF 链接定位到该课语法笔记的第一页；具体页范围记录在 JSON 中。</p><table><tr><th>册 / 课</th><th>句型</th><th>例句</th><th>讲解</th></tr>')
    for g in grammar:
        catalog.append('<tr><td>'+esc(g['book'])+' / '+str(g['lesson'])+'</td><td>'+esc(g['pattern'])+'</td><td>'+esc(g['examples'])+'</td><td><a href="../sources/irodori-grammar-all-en.pdf#page='+str(g['explanationPdfPages'][0])+'">官方讲解（日英）</a></td></tr>')
    catalog.append('</table></html>\n')
    (out / 'reader/index.html').write_text(''.join(catalog), encoding='utf-8', newline='\n')
    return counts


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--check', action='store_true', help='verify source hashes and reproducible output without changing files')
    options = args.parse_args()
    if options.check:
        manifest = json.loads((ROOT / 'sources-manifest.json').read_text(encoding='utf-8'))
        for item in manifest['files']:
            path = ROOT / item['path']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], path
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            counts = build(out)
            expected = {str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()}
            actual = {str(p.relative_to(ROOT)) for d in ('data', 'reader') for p in (ROOT / d).rglob('*') if p.is_file()}
            assert expected == actual, ('output file set differs', expected ^ actual)
            for name in expected:
                assert (out / name).read_bytes() == (ROOT / name).read_bytes(), name
        print('PASS: source hashes, source counts, required vocabulary fields, chapter links, PDF chapter mapping, corrections, and reproducible output')
    else:
        counts = build(ROOT)
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
