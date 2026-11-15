/* Course-specific lexical diagnostics, never a learner comprehension score. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const kuromoji = require('kuromoji');
const learning = path.resolve(__dirname, '../..');
const course = path.join(learning, '02-course-design');
const [devPath, reservedPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node audit_course.cjs <development-input> <reserved-input> <result>');
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const normalize = s => s.normalize('NFKC').trim();
const table = new Set(load(path.join(course, 'inventory.json')).words.map(w => normalize(w.form)));
const snapshot = load(path.join(__dirname, 'course-snapshot.json'));
for (const [rel, digest] of Object.entries(snapshot.sha256)) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(learning, rel))).digest('hex') !== digest)
    throw new Error('Frozen course changed: ' + rel);
}
const included = [...load(devPath).included, ...load(reservedPath).included];
if (new Set(included.map(s=>s.id)).size !== included.length) throw new Error('Duplicate sample');
const content = t => ['名詞','動詞','形容詞','副詞','連体詞','接続詞'].includes(t.pos)
  && !(t.pos === '名詞' && ['固有名詞','数','非自立','代名詞','接尾'].includes(t.pos_detail_1))
  && !(t.pos === '動詞' && ['非自立','接尾'].includes(t.pos_detail_1))
  && /[ぁ-ヺ一-龯]/u.test(t.surface_form);
const base = t => normalize(t.basic_form === '*' ? t.surface_form : t.basic_form);
const dicPath = path.resolve(path.dirname(require.resolve('kuromoji')), '../dict');
kuromoji.builder({dicPath}).build((error, tokenizer) => {
  if (error) throw error;
  const examples = new Set(table), evidence = new Map();
  for (let d=1; d<=21; d++) {
    const rel = `02-course-design/lessons/${String(d).padStart(2,'0')}.md`;
    const md = fs.readFileSync(path.join(learning,rel),'utf8');
    const chunks = [...md.matchAll(/^> (.*)$/gm), ...md.matchAll(/`([^`]+)`/g)].map(m=>m[1]);
    for (const chunk of chunks) for (const token of tokenizer.tokenize(chunk)) {
      if (!content(token)) continue;
      for (const term of [base(token), normalize(token.surface_form)]) {
        examples.add(term);
        if (!evidence.has(term)) evidence.set(term, new Set());
        evidence.get(term).add(d);
      }
    }
  }
  const samples=[], missing=new Map();
  const pct=(a,b)=>b?+(100*a/b).toFixed(2):null;
  for (const sample of included) {
    const text=sample.text.replace(/(?:F|M)\d{3}：|Ｘ：|X：/g,'')
      .replace(/＜(?:笑い|間|録音中断)＞|\[ﾏｲｸ\]|\[ｽﾋﾟｰｶ\]/g,'');
    let tokens=0,tableMatches=0,exampleMatches=0;
    for (const t of tokenizer.tokenize(text)) {
      if (!content(t)) continue;
      tokens++;
      const b=base(t), s=normalize(t.surface_form);
      if (table.has(b)||table.has(s)) tableMatches++;
      if (examples.has(b)||examples.has(s)) exampleMatches++;
      else {
        const key=b+'\u0000'+t.pos;
        if (!missing.has(key)) missing.set(key,{lemma:b,pos:t.pos,count:0,samples:new Set(),groups:new Set()});
        const row=missing.get(key);row.count++;row.samples.add(sample.id);row.groups.add(sample.group);
      }
    }
    samples.push({id:sample.id,split:sample.split,genre:sample.genre,group:sample.group,
      source_text_sha256:sample.sha256,tokens,table_matches:tableMatches,
      lesson_example_matches:exampleMatches,lesson_example_form_percent:pct(exampleMatches,tokens)});
  }
  const buckets=new Map();
  for(const row of samples){
    const key=row.split+'/'+row.genre;
    if(!buckets.has(key))buckets.set(key,{split:row.split,genre:row.genre,passages:0,groups:new Set(),tokens:0,table_matches:0,lesson_example_matches:0});
    const group=buckets.get(key);group.passages++;group.groups.add(row.group);
    for(const field of ['tokens','table_matches','lesson_example_matches'])group[field]+=row[field];
  }
  const result={test_type:'frozen_course_lexical_presence',learner_test:false,comprehension_percent:null,
    method:{tokenizer:'kuromoji '+require('kuromoji/package.json').version,
      denominator:'Same filtered content-token definition as round 1',
      table:'Exact normalized term or dictionary form in course vocabulary tables',
      lesson_examples:'Table forms plus content lemmas/surfaces from Japanese blockquotes and inline-code examples in all 21 lessons',
      limits:'Presence is not correct sense, understanding, fluency or mastery; tokenizer ambiguity remains. Late-course occurrence counts as presence even if not mastered.'},
    development_passages:samples.filter(x=>x.split==='development').length,
    reserved_passages:samples.filter(x=>x.split==='holdout').length,
    samples,by_split_and_genre:[...buckets.values()].map(g=>({...g,groups:[...g.groups],lesson_example_form_percent:pct(g.lesson_example_matches,g.tokens)})),
    unmatched_candidates:[...missing.values()].map(m=>({...m,samples:[...m.samples],groups:[...m.groups]})).sort((a,b)=>b.groups.length-a.groups.length||b.count-a.count||a.lemma.localeCompare(b.lemma,'ja')),
    example_form_evidence:[...evidence].map(([form,days])=>({form,days:[...days]}))};
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({development:result.development_passages,reserved:result.reserved_passages,by_split_and_genre:result.by_split_and_genre},null,2));
});
