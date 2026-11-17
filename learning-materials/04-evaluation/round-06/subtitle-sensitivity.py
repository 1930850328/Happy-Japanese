"""Check continuing subtitle display cues in an isolated copy; never alter the primary run."""
import hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parent.parent
sys.path.insert(0,str(ROOT/'03-test-set/tools'))
from subtitles import parse_srt,select,reading_text
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
with tempfile.TemporaryDirectory(prefix='hj-round06-display-') as td:
    root=Path(td)/'learning-materials';dest=root/'04-evaluation/round-06';shutil.copytree(HERE,dest)
    frozen=load(HERE/'freeze.json')
    for filename in frozen['files']:
        p=root/filename;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/filename,p)
    (root/'03-test-set').mkdir(exist_ok=True);shutil.copy2(ROOT/'03-test-set/sources.json',root/'03-test-set/sources.json')
    (root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
    cache=root/'.cache/round-06';cache.mkdir(parents=True)
    samples=load(dest/'samples.json');sources={s['id']:s for s in load(dest/'sources.json')};removed={}
    for sample in samples:
        raw=(ROOT/'.cache/round-06'/sample['file']).read_text()
        source=sources[sample['group']]
        if sample['genre']=='anime_subtitles':
            n=sample['id'].rsplit('-',1)[1];drop=source['continued_display_cues'][n]
            if drop:
                cues=select(parse_srt((ROOT/'.cache/round-06'/source['raw_file']).read_bytes()),sample['locator']['start'],sample['locator']['end'])
                raw=reading_text([c for c in cues if c['number'] not in drop]);removed[sample['id']]=drop
        analysis=raw;masks=[]
        for m in sample['masks']:
            count=analysis.count(m['text'])
            if count:masks.append({**m,'count':count});analysis=analysis.replace(m['text'],' ')
        sample.update(sha256=sha(raw.encode()),analysis_sha256=sha(analysis.encode()),characters=len(raw),masks=masks)
        (cache/sample['file']).write_text(raw)
    (dest/'samples.json').write_text(json.dumps(samples,ensure_ascii=False,indent=2)+'\n')
    manifest=load(dest/'test-manifest.json');manifest['files']['samples.json']=sha((dest/'samples.json').read_bytes());(dest/'test-manifest.json').write_text(json.dumps(manifest))
    p=subprocess.run(['node',str(dest/'evaluate.cjs')],text=True,capture_output=True);assert p.returncode==0,p.stderr
    r=load(dest/'lexical-results.json');primary=load(HERE/'lexical-results.json')
    result={'purpose':'input_display_duplication_sensitivity_not_replacement_score','removed_cues':removed,'primary_average':primary['descriptive_equal_genre_average'],'deduplicated_average':r['descriptive_equal_genre_average'],'deduplicated_anime':next(g for g in r['genres']if g['genre']=='anime_subtitles'),'limits':'Only identical text in overlapping or touching cue intervals removed; no audio verification. No change to primary corpus or material.'}
    output=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if '--check' in sys.argv:assert (HERE/'subtitle-sensitivity.json').read_text()==output
    else:(HERE/'subtitle-sensitivity.json').write_text(output)
    print(output)
