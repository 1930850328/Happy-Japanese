/* Compare two authored curricula on identical frozen new original texts.
 * Usage: node audit.cjs /absolute/learning-materials /absolute/inputs.json output.json
 * Originals stay outside the repository; hashes/locators make the run auditable.
 */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const args = process.argv.slice(2);
if (args.length < 3) throw Error('Usage: audit.cjs LEARNING INPUT OUTPUT [--features] [--current] [--export-features FILE]');
const [learning, inputPath, outputPath] = args.slice(0, 3).map(p => path.resolve(p));
const featureMode = args.includes('--features'), current = args.includes('--current');
const exportAt = args.indexOf('--export-features');
const exportPath = exportAt < 0 ? null : args[exportAt + 1];
if (exportAt >= 0 && !exportPath) throw Error('Missing feature export path');
if (path.resolve(outputPath) === path.join(__dirname, 'lexical-results.json')) throw Error('Write reruns outside the historical result file');
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const norm = s => s.normalize('NFKC').trim();
const run = load(path.join(__dirname, 'run.json'));
for (const [p, hash] of Object.entries(current ? {} : run.files_before_evaluation)) {
  if (sha(fs.readFileSync(path.join(learning, p))) !== hash) throw Error('Frozen file changed: ' + p);
}
const before = load(path.join(__dirname, 'before/manifest.json'));
// The baseline manifest predates all curriculum edits in this round.
for (const [p, hash] of Object.entries(before.files ?? before)) {
  if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) {
    if (sha(fs.readFileSync(path.join(__dirname, 'before', p))) !== hash) throw Error('Baseline changed: ' + p);
  }
}
const old = load(path.join(__dirname, 'before/02-course-design/inventory.json'));
const revised = load(path.join(learning, '02-course-design/inventory.json'));
const profiles = {
  old_authored_tables: new Set(old.words.map(w => norm(w.form))),
  revised_authored_tables: new Set(revised.words.map(w => norm(w.form)))
};
if (featureMode && sha(fs.readFileSync(inputPath)) !== load(path.join(__dirname, 'feature-manifest.json')).sha256) throw Error('Frozen feature file changed');
const input = load(inputPath);
const inputs = featureMode ? input.samples : input.included;
const {spawnSync} = require('node:child_process');
let allowedForms, vocabularyHash;
if (featureMode || exportPath) {
  const result = spawnSync(process.env.HJ_COURSE_PYTHON || 'python3', [path.join(learning, 'tools/coverage_vocabulary.py')], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  if (result.status !== 0) throw Error('Could not derive frozen vocabulary: ' + result.stderr);
  const forms = JSON.parse(result.stdout);
  allowedForms = new Set(forms); vocabularyHash = sha(JSON.stringify(forms));
  for (const forms of Object.values(profiles)) for (const form of forms) {
    if (!allowedForms.has(form)) throw Error('Form outside feature vocabulary; use original text audit: ' + form);
  }
  if (featureMode && (input.schema !== 'unordered-lexical-features-v1' || input.vocabulary_sha256 !== vocabularyHash || input.tokenizer !== 'kuromoji-0.1.2')) throw Error('Feature vocabulary/version mismatch');
}
const exported = [];
const masks = load(path.join(__dirname, 'masking-manifest.json'));
if (inputs.length !== run.samples.length || new Set(inputs.map(x => x.id)).size !== inputs.length) throw Error('Membership changed');
const tokenizer = require('kuromoji');
const base = t => norm(t.basic_form === '*' ? t.surface_form : t.basic_form);
const eligible = t => ['名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞'].includes(t.pos)
  && !(t.pos === '名詞' && ['固有名詞', '数', '非自立', '代名詞', '接尾'].includes(t.pos_detail_1))
  && !(t.pos === '動詞' && ['非自立', '接尾'].includes(t.pos_detail_1))
  && /[ぁ-ヺ一-龯]/u.test(t.surface_form);
const mean = ns => ns.reduce((a, b) => a + b, 0) / ns.length;
tokenizer.builder({dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict')}).build((error, tokenizer) => {
  if (error) throw error;
  function tokenForms(ts, forms) {
    const result = ts.map(() => new Set());
    // Character length is a safe upper bound on tokens. Standalone dictionary
    // tokenization can differ from contextual tokenization, so it is not a bound.
    const longest = [...forms].reduce((n, s) => Math.max(n, s.length), 0);
    for (let i = 0; i < ts.length; i++) {
      let prefix = '';
      for (let j = i; j < Math.min(ts.length, i + longest); j++) {
        for (const form of new Set([norm(prefix + ts[j].surface_form), norm(prefix + base(ts[j]))])) {
          if (forms.has(form)) for (let k = i; k <= j; k++) result[k].add(form);
        }
        prefix += ts[j].surface_form;
      }
    }
    return result;
  }
  const unknown = new Map(), results = [];
  for (const s of inputs) {
    const registered = run.samples.find(x => x.id === s.id), mask = masks.find(x => x.id === s.id);
    if (!registered || !mask) throw Error('Unregistered sample: ' + s.id);
    for (const field of ['group', 'genre', 'source_id', 'split', 'sha256']) {
      if (registered[field] !== s[field]) throw Error('Metadata changed: ' + s.id + '/' + field);
    }
    let rows;
    if (featureMode) {
      if (s.sha256 !== mask.original_sha256 || s.analysis_sha256 !== mask.analysis_sha256) throw Error('Feature source mismatch: ' + s.id);
      rows = s.features;
      if (!Array.isArray(rows) || rows.some(r => !Number.isSafeInteger(r.count) || r.count <= 0 || !Array.isArray(r.forms) || new Set(r.forms).size !== r.forms.length || r.forms.some(f => !allowedForms.has(f)))) throw Error('Invalid feature counts/forms');
    } else {
      if (sha(s.text) !== s.sha256 || s.sha256 !== mask.original_sha256) throw Error('Original changed: ' + s.id);
      let analysis = s.text;
      for (const removal of mask.removals) for (let n = 0; n < removal.count; n++) {
        if (!analysis.includes(removal.text)) throw Error('Mask mismatch: ' + s.id);
        analysis = analysis.replace(removal.text, ' ');
      }
      if (sha(analysis) !== mask.analysis_sha256) throw Error('Mask digest mismatch: ' + s.id);
      const ts = tokenizer.tokenize(analysis);
      const forms = allowedForms || new Set([...profiles.old_authored_tables, ...profiles.revised_authored_tables]);
      const matches = tokenForms(ts, forms), grouped = new Map();
      ts.forEach((t, i) => {
        if (!eligible(t)) return;
        const row = {lemma: base(t), pos: t.pos, surface: t.surface_form, forms: [...matches[i]].sort()};
        const key = JSON.stringify(row);
        if (!grouped.has(key)) grouped.set(key, {...row, count: 0});
        grouped.get(key).count++;
      });
      // No sentence order, token positions, dialogue or full transcripts are exported.
      rows = [...grouped.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
      if (exportPath) exported.push({...registered, analysis_sha256: sha(analysis), features: rows});
    }
    const tokens = rows.reduce((n, r) => n + r.count, 0);
    if (!tokens) throw Error('No denominator: ' + s.id);
    const scores = Object.fromEntries(Object.entries(profiles).map(([p, forms]) => {
      const count = rows.filter(r => r.forms.some(f => forms.has(f))).reduce((n, r) => n + r.count, 0);
      return [p, {matched: count, percent: 100 * count / tokens}];
    }));
    for (const r of rows) {
      if (r.forms.some(f => profiles.revised_authored_tables.has(f))) continue;
      const key = r.lemma + '|' + r.pos;
      if (!unknown.has(key)) unknown.set(key, {lemma: r.lemma, pos: r.pos, count: 0, groups: new Set(), samples: new Set(), surfaces: new Set()});
      const u = unknown.get(key); u.count += r.count; u.groups.add(s.group); u.samples.add(s.id); u.surfaces.add(r.surface);
    }
    results.push({id: s.id, group: s.group, genre: s.genre, source_id: s.source_id, split: s.split,
      sha256: s.sha256, analysis_sha256: mask.analysis_sha256, tokens, profiles: scores});
  }
  const works = [...new Set(results.map(s => s.group))].map(group => {
    const rows = results.filter(s => s.group === group);
    return {group, genre: rows[0].genre, samples: rows.length,
      scores: Object.fromEntries(Object.keys(profiles).map(p => [p, mean(rows.map(s => s.profiles[p].percent))]))};
  });
  const genres = [...new Set(works.map(w => w.genre))].map(genre => {
    const ws = works.filter(w => w.genre === genre), ss = results.filter(s => s.genre === genre);
    const tokens = ss.reduce((n, s) => n + s.tokens, 0);
    return {genre, works: ws.length, samples: ss.length, tokens,
      scores: Object.fromEntries(Object.keys(profiles).map(p => [p, {
        work_macro_percent: mean(ws.map(w => w.scores[p])),
        pooled_percent: 100 * ss.reduce((n, s) => n + s.profiles[p].matched, 0) / tokens
      }]))};
  });
  const weights = load(path.join(learning, '03-test-set/target-profile.json')).core_weights;
  if (Object.keys(weights).some(g => !genres.some(x => x.genre === g))) throw Error('Missing genre');
  const core = Object.fromEntries(Object.keys(profiles).map(p => [p,
    genres.reduce((n, g) => n + weights[g.genre] * g.scores[p].work_macro_percent, 0)]));
  const report = {
    type: 'same_new_text_authored_curriculum_lexical_audit', student_test_performed: false, comprehension_percent: null,
    method: {denominator: 'kuromoji0.1.2 content words; excludes particles, auxiliaries, proper-noun tags, numbers, non-independent forms and documented speaker/ruby/name masks',
      matching: 'same NFKC exact surface/lemma and contiguous-compound matching in both profiles; table forms only, no incidental example tokens, no undeclared synonyms or homophone aliases',
      limits: 'Matching is form-level. Same form does not prove correct sense, phrase comprehension or learner retention. Manual semantic audit is separate.',
      aggregation: 'segment -> work -> genre; anime/manga50/50; no claim of population inference'},
    sizes: {old_table_entries: old.words.length, revised_table_entries: revised.words.length},
    samples: results, works, genres, lexical_proxy_50_50: core,
    unmatched: [...unknown.values()].map(u => ({...u, groups: [...u.groups], samples: [...u.samples], surfaces: [...u.surfaces]}))
      .sort((a,b) => b.groups.length - a.groups.length || b.count - a.count || a.lemma.localeCompare(b.lemma, 'ja'))
  };
  if (exportPath) {
    const body = JSON.stringify({
      schema: 'unordered-lexical-features-v1', tokenizer: 'kuromoji-0.1.2', vocabulary_sha256: vocabularyHash,
      derived_from: 'round-05 original text, recorded masks and frozen source vocabulary',
      limits: 'Unordered lexical regression only; no sentences, reading comprehension, audio or visual context. Outside-vocabulary forms require originals. Exposed samples are regression, never new holdout.', samples: exported
    }, null, 2) + '\n';
    fs.writeFileSync(exportPath, body);
    fs.writeFileSync(path.join(path.dirname(path.resolve(exportPath)), 'feature-manifest.json'), JSON.stringify({
      file: path.basename(exportPath), sha256: sha(body), source_run: 'run.json', original_result: 'lexical-results.json',
      method: 'Unordered token feature counts derived from original masked texts and the frozen Jiten written-form vocabulary. No sentence order or full text.',
      purpose: 'Portable lexical regression, not a comprehension test.'
    }, null, 2) + '\n');
  }
  report.execution = {input: featureMode ? 'unordered_features' : 'original_text', course: current ? 'current_revision_on_old_regression' : 'frozen_round_05',
    inventory_sha256: sha(fs.readFileSync(path.join(learning, '02-course-design/inventory.json')))};
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({samples: results.length, works: works.length, genres, lexical_proxy_50_50: core}, null, 2));
});
