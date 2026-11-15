/* Exact-form inventory diagnostic. This does not estimate reading comprehension. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const kuromoji = require('kuromoji');
const learning = path.resolve(__dirname, '../..');
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node lexical_audit.cjs <temporary-input.json> <result.json>');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const load = name => JSON.parse(fs.readFileSync(path.join(learning, '01-materials/data', name), 'utf8'));
const normalize = text => text.normalize('NFKC').trim();
const kaishi = new Set(load('vocabulary-kaishi.json').map(x => normalize(x.term)));
const full = new Set([...kaishi, ...load('vocabulary-irodori.json').map(x => normalize(x.term))]);
const contentPos = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞']);
const excludedNounTypes = new Set(['固有名詞', '数', '非自立', '代名詞', '接尾']);
const dicPath = path.resolve(path.dirname(require.resolve('kuromoji')), '../dict');
const percentages = row => ({...row,
  kaishi_match_percent: row.tokens ? +(100 * row.kaishi_matches / row.tokens).toFixed(2) : null,
  combined_match_percent: row.tokens ? +(100 * row.combined_matches / row.tokens).toFixed(2) : null});
kuromoji.builder({dicPath}).build((error, tokenizer) => {
  if (error) throw error;
  const samples = [], missing = new Map();
  for (const sample of input.included) {
    if (sample.split !== 'development') throw new Error('Holdout text is forbidden in this audit');
    const text = sample.text.replace(/(?:F|M)\d{3}：|Ｘ：|X：/g, '')
      .replace(/＜(?:笑い|間|録音中断)＞|\[ﾏｲｸ\]|\[ｽﾋﾟｰｶ\]/g, '');
    let tokens = 0, kaishiMatches = 0, combinedMatches = 0;
    for (const t of tokenizer.tokenize(text)) {
      if (!contentPos.has(t.pos) || (t.pos === '名詞' && excludedNounTypes.has(t.pos_detail_1))) continue;
      if (t.pos === '動詞' && ['非自立', '接尾'].includes(t.pos_detail_1)) continue;
      if (!/[ぁ-ヺ一-龯]/u.test(t.surface_form)) continue;
      tokens++;
      const base = normalize(t.basic_form === '*' ? t.surface_form : t.basic_form);
      const surface = normalize(t.surface_form);
      const km = kaishi.has(base) || kaishi.has(surface);
      const cm = full.has(base) || full.has(surface);
      if (km) kaishiMatches++;
      if (cm) combinedMatches++;
      if (!cm) {
        const key = base + '\u0000' + t.pos;
        if (!missing.has(key)) missing.set(key, {lemma: base, pos: t.pos, count: 0, groups: new Set(), samples: new Set()});
        const entry = missing.get(key); entry.count++; entry.groups.add(sample.group); entry.samples.add(sample.id);
      }
    }
    samples.push(percentages({id: sample.id, source_id: sample.source_id, group: sample.group, genre: sample.genre,
      source_text_sha256: sample.sha256, tokens, kaishi_matches: kaishiMatches, combined_matches: combinedMatches}));
  }
  const grouped = field => Object.entries(Object.groupBy ? Object.groupBy(samples, s => s[field]) : samples.reduce((a,s) => ((a[s[field]] ??= []).push(s),a), {}))
    .map(([key, rows]) => percentages({[field]:key,samples:rows.length,
      tokens: rows.reduce((n,s)=>n+s.tokens,0),kaishi_matches:rows.reduce((n,s)=>n+s.kaishi_matches,0),combined_matches:rows.reduce((n,s)=>n+s.combined_matches,0)}));
  const result = {
    audit_type: 'development_exact_lemma_inventory', comprehension_percent: null, student_test_performed: false,
    method: {tokenizer: 'kuromoji', version:require('kuromoji/package.json').version,
      denominator:'名詞（固有名詞・数・非自立・代名詞・接尾を除く）、自立動詞、形容詞、副詞、連体詞、接続詞；記号・助詞・助動詞・非自立動詞・接尾動詞は対象外',
      match:'NFKC + trim; exact surface OR dictionary form in term field; no reading-based homophone matching',
      limits:'是词形检索，不是义项正确性、词汇熟练度或整句理解率。未命中可能是分词、异体字、复合词、词条格式、旧词形或真正缺项。'},
    inputs_sha256:crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
    holdout_bodies_loaded:input.holdout_bodies_loaded, skipped:input.skipped,
    samples, by_genre:grouped('genre'), by_group:grouped('group'),
    unmatched_candidates:[...missing.values()].map(v=>({...v,groups:[...v.groups].sort(),samples:[...v.samples].sort()}))
      .sort((a,b)=>b.groups.length-a.groups.length || b.count-a.count || a.lemma.localeCompare(b.lemma,'ja'))
  };
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passages:samples.length,groups:new Set(samples.map(s=>s.group)).size,by_genre:result.by_genre,
    unmatched_lemma_pos_pairs:result.unmatched_candidates.length,comprehension_percent:null},null,2));
});
