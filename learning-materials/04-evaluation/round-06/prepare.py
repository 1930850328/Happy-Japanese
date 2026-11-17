"""Extract pinned source passages locally; never put third-party text in Git.
Requires the repository's lxml dependency and cached originals from sources.json.
Manga transcripts are private manual inputs; --check verifies them, not OCR.
"""
import argparse,csv,hashlib,json,re,sys
from pathlib import Path
from lxml import html
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
CACHE=ROOT/'.cache/round-06'
sys.path.insert(0,str(ROOT/'03-test-set/tools'))
from subtitles import parse_srt,select,reading_text
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
def emit(p,data,check):
    if check:assert p.read_text()==data, 'Changed generated file: '+str(p)
    else:p.write_text(data)
def paragraphs(s):
    raw=(CACHE/s['raw_file']).read_bytes();assert sha(raw)==s['raw_sha256']
    t=html.fromstring(re.sub(r'<\?xml[^>]+\?>', '', raw.decode('cp932' if s['id']=='terada' else 'utf-8')))
    for e in t.xpath('//rt|//rp|//script|//style'):e.drop_tree()
    sid=s['id']
    if sid in ['slime','mushoku']:els=t.xpath('//div[contains(@class,"js-novel-text") and not(contains(@class,"maegaki")) and not(contains(@class,"atogaki"))]/p')
    elif sid=='terada':
        e=t.xpath('//div[@class="main_text"]')[0]
        for br in e.xpath('.//br'):br.tail='\n'+(br.tail or '')
        return [x.strip() for x in e.text_content().splitlines() if x.strip()]
    elif sid=='jma':els=t.xpath('//main/div[@class="jma-cms"]/*[self::h2 or self::p]')
    elif sid=='japanpost':
        # Preserve headings and whole table rows, without repeating nested list items.
        els=t.xpath('//article/section//h2|//article/section//h3|//article/section//h4|//article/section//tr[td]|//article/section//p[not(ancestor::table)]|//article/section//li[not(ancestor::table) and not(ancestor::li)]')
    elif sid=='jrwest':
        # One desktop representation of steps; mobile slider repeats the same text.
        els=t.xpath('//div[@class="contents__inner"]/div[@class="text -noPadding-pc"]/p|//span[contains(@class,"pagination-text")]|//div[@class="contents__inner"]/section[2]//h3|//div[@class="contents__inner"]/section[2]//h4|//div[@class="contents__inner"]/section[2]//li')
    else:raise ValueError(sid)
    return [re.sub(r'\s+',' ',e.text_content()).strip() for e in els if e.text_content().strip()]
def blocks(ps):
    # All offsets are in the normalized main-text paragraph sequence, never navigation.
    def take(start):
        end=start;n=0
        while end<len(ps) and n<220:n+=len(ps[end]);end+=1
        return end,'\n'.join(ps[start:end])+'\n'
    end1,text1=take(0)
    offsets=[];n=0
    for p in ps:offsets.append(n);n+=len(p)
    start2=next((i for i,o in enumerate(offsets) if i>=end1 and o>=600),end1)
    assert start2<len(ps),'Source too short for two non-overlapping blocks'
    end2,text2=take(start2)
    return [(0,end1,text1),(start2,end2,text2)]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');args=ap.parse_args()
    freeze=load(HERE/'freeze.json')
    for p,h in freeze['files'].items():assert sha((ROOT/p).read_bytes())==h,p
    inv=load(ROOT/'02-course-design/inventory.json')
    v3={w['form'] for w in inv['words']}
    additions=list(csv.DictReader((ROOT/'05-curriculum-audit/priority-additions.tsv').open(),delimiter='\t'))
    candidates=list(csv.DictReader((ROOT/'05-curriculum-audit/vocabulary-proposal.tsv').open(),delimiter='\t'))
    profiles={'v3':sorted(v3),'plus79':sorted(v3|{w['term'] for w in additions}),'plus1308':sorted(v3|{f for w in candidates if w['decision']=='基础候选' for f in w['teaching_forms'].split(';')})}
    emit(HERE/'profiles.json',json.dumps(profiles,ensure_ascii=False,indent=2)+'\n',args.check)
    sources=load(HERE/'sources.json'); samples=[]
    for s in sources:
        if s['genre']=='manga':continue
        if s['genre']=='anime_subtitles':
            raw=(CACHE/s['raw_file']).read_bytes();assert sha(raw)==s['raw_sha256']
            cues=parse_srt(raw)
            parts=[(a,b,reading_text(select(cues,a,b)))for a,b in [(31,55),(151,175)]]
        else:parts=blocks(paragraphs(s))
        for n,(a,b,text) in enumerate(parts,1):
            sid=s['id']+'-'+str(n);file=sid+'.txt';emit(CACHE/file,text,args.check)
            # Mask definitions are explicit editor-reviewed labels, not generic parentheses.
            masks=s.get('sample_masks',{}).get(str(n),[]);analysis=text
            for m in masks:
                assert analysis.count(m['text'])==m['count'],(sid,m)
                analysis=analysis.replace(m['text'],' ')
            samples.append(dict(id=sid,group=s['id'],genre=s['genre'],url=s['url'],file=file,characters=len(text),sha256=sha(text.encode()),analysis_sha256=sha(analysis.encode()),masks=masks,locator={'kind':'cue_numbers_inclusive' if s['genre']=='anime_subtitles' else 'normalized_paragraph_indices_half_open','start':a,'end':b},split='regression_after_this_run'))
    for s in sources:
        if s['genre']!='manga':continue
        for n,(a,b)in enumerate([(1,2),(3,4)],1):
            text='\n'.join((CACHE/f"{s['id']}-{i}.txt").read_text().strip() for i in range(a,b+1)).strip()+'\n'
            sid=s['id']+'-pair'+str(n);file=sid+'.txt';emit(CACHE/file,text,args.check)
            masks=s.get('sample_masks',{}).get(str(n),[]);analysis=text
            for m in masks:
                assert analysis.count(m['text'])==m['count'],(sid,m)
                analysis=analysis.replace(m['text'],' ')
            samples.append(dict(id=sid,group=s['id'],genre='manga',url=s['url'],file=file,characters=len(text),sha256=sha(text.encode()),analysis_sha256=sha(analysis.encode()),masks=masks,locator={'kind':'numbered_pages_inclusive','start':a,'end':b},split='regression_after_this_run'))
    emit(HERE/'samples.json',json.dumps(samples,ensure_ascii=False,indent=2)+'\n',args.check)
    print('Prepared',len(samples),'samples and three frozen scopes')
if __name__=='__main__':main()
