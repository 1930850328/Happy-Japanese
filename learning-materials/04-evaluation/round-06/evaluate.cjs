/* Frozen scope comparison; raw originals stay in .cache. Not a learner test. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = path.join(root, '.cache/round-06');
const featureMode=process.argv.includes('--features');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const norm = x => x.normalize('NFKC').trim();
const frozen = read(path.join(__dirname, 'freeze.json'));
for (const [file, hash] of Object.entries(frozen.files)) {
  if (sha(fs.readFileSync(path.join(root, file))) !== hash) throw Error('Frozen content changed: '+file);
}
const inventory = read(path.join(root,'02-course-design/inventory.json'));
const profiles = read(path.join(__dirname,'profiles.json'));
const sets = Object.fromEntries(Object.entries(profiles).map(([k,v])=>[k,new Set(v.map(norm))]));
if (JSON.stringify([...sets.v3].sort()) !== JSON.stringify([...new Set(inventory.words.map(w=>norm(w.form)))].sort())) throw Error('v3 inventory mismatch');
for (const k of ['plus79','plus1308']) for (const w of sets.v3) if (!sets[k].has(w)) throw Error('Baseline form removed');
const sources = read(path.join(__dirname,'samples.json'));
const manifest = read(path.join(__dirname,'test-manifest.json'));
for (const [file, hash] of Object.entries(manifest.files)) if (sha(fs.readFileSync(path.join(__dirname,file)))!==hash) throw Error('Test definition changed: '+file);
let cachedFeatures;
if(featureMode){
 const bytes=fs.readFileSync(path.join(__dirname,'coverage-features.json'));
 if(sha(bytes)!==read(path.join(__dirname,'result-manifest.json')).files['coverage-features.json'])throw Error('Feature hash mismatch');
 cachedFeatures=JSON.parse(bytes);
 if(cachedFeatures.scope_hash!==sha(fs.readFileSync(path.join(__dirname,'profiles.json'))))throw Error('Feature scope mismatch');
}
const oldGroups = new Set(manifest.prior_groups);
if(new Set(sources.map(s=>s.id)).size!==sources.length || sources.some(s=>oldGroups.has(s.group))) throw Error('Duplicate or old series');
const kuromoji = require('kuromoji');
const base = t=>norm(t.basic_form==='*'?t.surface_form:t.basic_form);
// Same eligibility and contiguous surface/base matching as frozen round-05.
const eligible = t=>['名詞','動詞','形容詞','副詞','連体詞','接続詞'].includes(t.pos)
 && !(t.pos==='名詞'&&['固有名詞','数','非自立','代名詞','接尾'].includes(t.pos_detail_1))
 && !(t.pos==='動詞'&&['非自立','接尾'].includes(t.pos_detail_1)) && /[ぁ-ヺ一-龯]/u.test(t.surface_form);
const mean = xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
kuromoji.builder({dicPath:path.join(path.dirname(require.resolve('kuromoji/package.json')),'dict')}).build((error,tok)=>{
 if(error)throw error;
 const all = new Set(Object.values(sets).flatMap(s=>[...s]));
 const longest = Math.max(...[...all].map(s=>s.length));
 const results=[], diagnostics=[], featureSamples=[];
 for(const s of sources){
  let rows;
  if(featureMode){
   const f=cachedFeatures.samples.find(x=>x.id===s.id);
   if(!f || f.sha256!==s.sha256 || f.analysis_sha256!==s.analysis_sha256)throw Error('Feature source mismatch');
   rows=f.features.map(r=>({...r,basic_form:r.lemma,surface_form:r.surface}));
  }else{
  const raw=fs.readFileSync(path.join(cache,s.file));
  if(sha(raw)!==s.sha256)throw Error('Sample changed: '+s.id);
  let text=raw.toString('utf8');
  for(const m of s.masks){
   for(let i=0;i<m.count;i++){ if(!text.includes(m.text))throw Error('Mask absent'); text=text.replace(m.text,' '); }
  }
  if(sha(text)!==s.analysis_sha256)throw Error('Analysis hash changed: '+s.id);
  const ts=tok.tokenize(text), matches=ts.map(()=>new Set());
  for(let i=0;i<ts.length;i++){
   let prefix='';
   for(let j=i;j<Math.min(ts.length,i+longest);j++){
    for(const f of new Set([norm(prefix+ts[j].surface_form),norm(prefix+base(ts[j]))])){
     if(all.has(f))for(let k=i;k<=j;k++)matches[k].add(f);
    }
    prefix+=ts[j].surface_form;
   }
  }
  rows=ts.map((t,i)=>({...t,count:1,forms:[...matches[i]].sort()})).filter(eligible);
  }
  const total=rows.reduce((n,r)=>n+r.count,0);
  if(!rows.length)throw Error('Empty denominator: '+s.id);
  const scores=Object.fromEntries(Object.entries(sets).map(([k,set])=>{
   const matched=rows.filter(r=>r.forms.some(f=>set.has(f))).reduce((n,r)=>n+r.count,0);
   return [k,{matched,total,percent:100*matched/total}];
  }));
  results.push({id:s.id,source_id:s.group,group:s.group,genre:s.genre,split:'holdout',characters:s.characters,scores});
  const buckets=new Map();
  for(const r of rows){
   const item={lemma:base(r),surface:r.surface_form,pos:r.pos,reading:r.reading||'',forms:r.forms};
   const key=JSON.stringify(item); if(!buckets.has(key))buckets.set(key,{...item,count:0});buckets.get(key).count+=r.count;
  }
  const features=[...buckets.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  featureSamples.push({id:s.id,sha256:s.sha256,analysis_sha256:s.analysis_sha256,features});
  diagnostics.push({id:s.id,gained79:features.filter(r=>!r.forms.some(f=>sets.v3.has(f))&&r.forms.some(f=>sets.plus79.has(f))),gained1308:features.filter(r=>!r.forms.some(f=>sets.v3.has(f))&&r.forms.some(f=>sets.plus1308.has(f))),remaining:features.filter(r=>!r.forms.some(f=>sets.plus1308.has(f)))});
 }
 const works=[...new Set(results.map(s=>s.group))].map(group=>{
  const rows=results.filter(r=>r.group===group);return{group,genre:rows[0].genre,samples:rows.length,scores:Object.fromEntries(Object.keys(sets).map(k=>[k,mean(rows.map(r=>r.scores[k].percent))]))};
 });
 const genres=[...new Set(works.map(w=>w.genre))].map(genre=>{
  const ws=works.filter(w=>w.genre===genre);return{genre,works:ws.length,scores:Object.fromEntries(Object.keys(sets).map(k=>[k,mean(ws.map(w=>w.scores[k]))]))};
 });
 const report={type:'frozen_material_scope_comparison',student_test:false,comprehension_percent:null,form_counts:Object.fromEntries(Object.entries(sets).map(([k,s])=>[k,s.size])),samples:results,works,genres,descriptive_equal_genre_average:Object.fromEntries(Object.keys(sets).map(k=>[k,mean(genres.map(g=>g.scores[k]))])),limitations:['Exact form/lemma matches, not sense-disambiguated understanding.','plus79 and plus1308 are unimplemented scope scenarios, not lessons completed in 21 hours.','Convenience sample, two works per category, not a population estimate.']};
 const outputs={'lexical-results.json':report,'diagnostics.json':diagnostics,'coverage-features.json':{schema:'frozen-three-scope-features',scope_hash:sha(fs.readFileSync(path.join(__dirname,'profiles.json'))),purpose:'Unordered counts for these three frozen scopes only; cannot reconstruct text or score arbitrary new words',samples:featureSamples}};
 for(const [file,data]of Object.entries(outputs)){
  const body=JSON.stringify(data,null,2)+'\n', dest=path.join(__dirname,file);
  if(process.argv.includes('--check') || featureMode){if(fs.readFileSync(dest,'utf8')!==body)throw Error('Result changed: '+file);}else fs.writeFileSync(dest,body);
 }
 console.log(JSON.stringify({samples:results.length,works:works.length,genres,average:report.descriptive_equal_genre_average},null,2));
});
