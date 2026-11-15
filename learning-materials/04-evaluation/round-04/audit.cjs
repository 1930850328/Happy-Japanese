/* Reproducible vocabulary-scope audit; never produces learner comprehension scores. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const learning=path.resolve(process.argv[2]),inputPath=path.resolve(process.argv[3]),outputPath=path.resolve(process.argv[4]);
const kuromoji=require('kuromoji');
const load=p=>JSON.parse(fs.readFileSync(p,'utf8')),norm=s=>s.normalize('NFKC').trim(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const input=load(inputPath),inventory=load(path.join(learning,'02-course-design/inventory.json')),chosen=load(path.join(learning,'01-materials/vocabulary-scope/selected.json'));
const table=new Set(inventory.words.map(w=>norm(w.form))),focus=new Set(chosen.flatMap(w=>[w.term,...w.variants.map(v=>v.term),...(w.orthographicNote?.otherForms??[])]).map(norm));
const run=load(path.join(__dirname,'run.json')),masks=load(path.join(__dirname,'masking-manifest.json'));
for(const [relative,expected] of Object.entries(run.files_before_evaluation)){
 if(relative.startsWith('01-materials/')||relative.startsWith('02-course-design/')||relative==='03-test-set/target-profile.json'){
  if(sha(fs.readFileSync(path.join(learning,relative)))!==expected)throw Error('Frozen curriculum/config changed: '+relative);
 }
}
if(input.included.length!==run.samples.length||new Set(input.included.map(s=>s.id)).size!==run.samples.length)throw Error('Sample membership changed');
for(const s of input.included){
 const saved=run.samples.find(x=>x.id===s.id),mask=masks.find(x=>x.id===s.id);
 if(!saved||!mask)throw Error('Unregistered sample: '+s.id);
 for(const key of ['source_id','group','genre','split','sha256'])if(s[key]!==saved[key])throw Error('Sample metadata changed: '+s.id+' '+key);
 if(sha(s.text)!==mask.original_sha256)throw Error('Original text changed: '+s.id);
 let analysis=s.text;
 for(const removal of mask.removals)for(let i=0;i<removal.count;i++){
  if(!analysis.includes(removal.text))throw Error('Annotation mask mismatch: '+s.id);
  analysis=analysis.replace(removal.text,' ');
 }
 if(sha(analysis)!==mask.analysis_sha256)throw Error('Analysis text changed: '+s.id);
 s.analysis_text=analysis;
}
const content=t=>['名詞','動詞','形容詞','副詞','連体詞','接続詞'].includes(t.pos)&&!(t.pos==='名詞'&&['固有名詞','数','非自立','代名詞','接尾'].includes(t.pos_detail_1))&&!(t.pos==='動詞'&&['非自立','接尾'].includes(t.pos_detail_1))&&/[ぁ-ヺ一-龯]/u.test(t.surface_form);
const base=t=>norm(t.basic_form==='*'?t.surface_form:t.basic_form),pct=(a,b)=>b?100*a/b:null;
kuromoji.builder({dicPath:path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict')}).build((err,tokenizer)=>{
 if(err)throw err;
 const examples=new Set(table);
 for(let d=1;d<=21;d++){
  const md=fs.readFileSync(path.join(learning,`02-course-design/lessons/${String(d).padStart(2,'0')}.md`),'utf8');
  for(const c of [...md.matchAll(/^> (.*)$/gm),...md.matchAll(/`([^`]+)`/g)].map(m=>m[1]))for(const t of tokenizer.tokenize(c))if(content(t)){examples.add(base(t));examples.add(norm(t.surface_form));}
 }
 const profiles={course_table:table,course_examples:examples,priority_605:focus,course_plus_priority:new Set([...examples,...focus])};
 const maxSpan=Object.fromEntries(Object.entries(profiles).map(([key,forms])=>[key,Math.max(...[...forms].map(f=>tokenizer.tokenize(f).length))]));
 function marks(tokens,forms,max){
  const direct=new Set(),spanned=new Set();
  tokens.forEach((t,i)=>{if(forms.has(base(t))||forms.has(norm(t.surface_form)))direct.add(i)});
  for(let i=0;i<tokens.length;i++){
   let prefix='';
   for(let j=i;j<Math.min(tokens.length,i+max);j++){
    // A compound must match a whole contiguous surface sequence; only its final
    // inflection may use a dictionary form. Never split a phrase into loose words.
    if(forms.has(norm(prefix+tokens[j].surface_form))||forms.has(norm(prefix+base(tokens[j]))))for(let k=i;k<=j;k++)spanned.add(k);
    prefix+=tokens[j].surface_form;
   }
  }
  for(const i of direct)spanned.add(i);
  return {direct,spanned};
 }
 const results=[],missing=new Map();
 for(const s of input.included){
  if(sha(s.text)!==s.sha256)throw Error('Original text hash mismatch: '+s.id);
  const txt=(s.analysis_text??s.text).replace(/(?:F|M)\d{3}：|Ｘ：|X：/g,'').replace(/＜(?:笑い|間|録音中断)＞|\[ﾏｲｸ\]|\[ｽﾋﾟｰｶ\]/g,'');
  const ts=tokenizer.tokenize(txt),eligible=ts.map((t,i)=>content(t)?i:-1).filter(i=>i>=0),r={id:s.id,split:s.split,genre:s.genre,group:s.group,source_text_sha256:s.sha256,analysis_text_sha256:sha(txt),tokens:eligible.length,profiles:{}};
  const ms=Object.fromEntries(Object.entries(profiles).map(([k,f])=>[k,marks(ts,f,maxSpan[k])]));
  for(const [k,m]of Object.entries(ms)){const direct=eligible.filter(i=>m.direct.has(i)).length,span=eligible.filter(i=>m.spanned.has(i)).length;r.profiles[k]={direct_matches:direct,span_matches:span,direct_percent:pct(direct,r.tokens),span_percent:pct(span,r.tokens)};}
  for(const i of eligible){if(ms.course_plus_priority.spanned.has(i))continue;const t=ts[i],key=base(t)+'\0'+t.pos;if(!missing.has(key))missing.set(key,{lemma:base(t),pos:t.pos,count:0,groups:new Set(),samples:new Set(),surfaces:new Set()});const m=missing.get(key);m.count++;m.groups.add(s.group);m.samples.add(s.id);m.surfaces.add(t.surface_form);}
  results.push(r);
 }
 const reportFor=rows=>{
  const byWork=[...new Set(rows.map(s=>s.group))].map(group=>{
   const ss=rows.filter(s=>s.group===group),scores={};
   for(const p of Object.keys(profiles))scores[p]=ss.reduce((n,s)=>n+s.profiles[p].span_percent,0)/ss.length;
   return {group,genre:ss[0].genre,samples:ss.length,scores};
  });
  const byGenre=[...new Set(rows.map(s=>s.genre))].map(genre=>{
   const ss=rows.filter(s=>s.genre===genre),ws=byWork.filter(w=>w.genre===genre),metrics={};
   for(const p of Object.keys(profiles)){const tokens=ss.reduce((n,s)=>n+s.tokens,0),direct=ss.reduce((n,s)=>n+s.profiles[p].direct_matches,0),span=ss.reduce((n,s)=>n+s.profiles[p].span_matches,0);metrics[p]={tokens,direct_matches:direct,span_matches:span,direct_pooled_percent:pct(direct,tokens),span_pooled_percent:pct(span,tokens),work_macro_percent:ws.reduce((n,w)=>n+w.scores[p],0)/ws.length};}
   return {genre,works:ws.length,samples:ss.length,metrics};
  });
  // Same grouping order as target-profile, but this remains a lexical proxy.
  const core={};
  const weights=load(path.join(learning,'03-test-set/target-profile.json')).core_weights;
  for(const p of Object.keys(profiles)){const pairs=Object.entries(weights).map(([genre,weight])=>[byGenre.find(x=>x.genre===genre),weight]);core[p]=pairs.every(([g])=>g)?pairs.reduce((sum,[g,w])=>sum+g.metrics[p].work_macro_percent*w,0):null;}
  return {by_work:byWork,by_genre:byGenre,lexical_proxy_50_50:core};
 };
 const output={audit_type:'frozen_curriculum_vs_selected_vocabulary',student_test_performed:false,comprehension_percent:null,input_manifest_sha256:sha(JSON.stringify(input.included.map(({text,analysis_text,...m})=>m))),method:{tokenizer:'kuromoji '+require('kuromoji/package.json').version,denominator:'与round-02相同的内容词筛选；不计助词/助动词/专名/数词等；本轮另按masking-manifest排除字幕说话人/音效/注音和经核对的专名；其余分词误差未全部消除。',matching:'direct=表层/辞书形精确匹配；span另识别已列词条的连续整体，末词可还原辞书形；只用清单明确列出的异写，不用同音匹配。',aggregation:'每段词形覆盖→作品平均→类别平均；50/50只作词汇诊断，不是理解率。',profiles:{course_table:'实际课程词表',course_examples:'课程词表+日文例句出现形式，不证明已明确教学',priority_605:'独立选词清单，尚未编入21天课程',course_plus_priority:'课程例句词形与605词清单的并集；假设未来全部纳入的词形覆盖，不是已交付课程或学习效果'}},sizes:{course_table:table.size,priority_groups:chosen.length,priority_forms:focus.size},samples:results,by_split:Object.fromEntries([...new Set(results.map(s=>s.split))].map(split=>[split,reportFor(results.filter(s=>s.split===split))])),unmatched_combined:[...missing.values()].map(m=>({...m,groups:[...m.groups],samples:[...m.samples],surfaces:[...m.surfaces]})).sort((a,b)=>b.groups.length-a.groups.length||b.count-a.count||a.lemma.localeCompare(b.lemma,'ja'))};
 fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({sizes:output.sizes,by_split:output.by_split},null,2));
});
