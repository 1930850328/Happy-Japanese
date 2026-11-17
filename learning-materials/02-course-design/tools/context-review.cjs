/* Verify that selected vocabulary has an actual Japanese use in its first lesson.
 * This is an editorial check, not a measurement of understanding or retention.
 * Invoke after review.py --write. --write regenerates the derived evidence file.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const course = path.resolve(__dirname, '..');
const learning = path.dirname(course);
const kuromoji = require('kuromoji');
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const selected = load(path.join(learning, '01-materials/vocabulary-scope/selected.json'));
const inventory = load(path.join(course, 'inventory.json'));
const lessons = inventory.selected_group_to_course;
const extract = text => [...text.matchAll(/^\*\*\d+\.\*\* (.+)$/gm),
  ...text.matchAll(/^> (.+)$/gm), ...text.matchAll(/`([^`]+)`/g)].map(m => m[1]);
const files = Array.from({length: 21}, (_, i) => {
  const text = fs.readFileSync(path.join(course, `lessons/${String(i + 1).padStart(2, '0')}.md`), 'utf8');
  return {text, sha256: crypto.createHash('sha256').update(text).digest('hex'), contexts: extract(text)};
});
kuromoji.builder({dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict')}).build((error, tokenizer) => {
  if (error) throw error;
  // Do not match substrings: 女 inside 女の子 is not evidence for a separate use.
  // Only a contiguous sequence, optionally with its final verb inflected, counts.
  const contains = (text, forms) => {
    const ts = tokenizer.tokenize(text);
    const longest = Math.max(...[...forms].map(f => f.length));
    for (let i = 0; i < ts.length; i++) {
      let prefix = '';
      for (let j = i; j < Math.min(ts.length, i + longest); j++) {
        if (forms.has(prefix + ts[j].surface_form) || forms.has(prefix + ts[j].basic_form)) return true;
        prefix += ts[j].surface_form;
      }
    }
    return false;
  };
  const missing = [];
  const entries = selected.map(w => {
    const mapping = lessons.find(l => l.term === w.term && l.reading === w.reading);
    if (!mapping) throw Error(`Missing table teaching: ${w.term}/${w.reading}`);
    const forms = new Set([w.term, ...w.variants.map(v => v.term)]);
    const examples = files[mapping.first_day - 1].contexts.filter(c => contains(c, forms));
    if (!examples.length) missing.push(`${w.term}, day ${mapping.first_day}`);
    return {term: w.term, reading: w.reading, first_day: mapping.first_day, examples};
  });
  if (missing.length) throw Error(`Missing contextual uses:\n${missing.join('\n')}`);
  const output = {
    type: 'first_lesson_context_check', learner_test: false,
    method: 'Selected group must match a table form+reading, then a contiguous Japanese example; inflection allowed only at span end. This verifies occurrence, not every sense or teaching quality.',
    selected_groups: selected.length, with_table_and_context: entries.length,
    lesson_sha256: files.map((f, i) => ({day: i + 1, sha256: f.sha256})), entries
  };
  const target = path.join(course, 'context-review.json');
  const body = JSON.stringify(output, null, 2) + '\n';
  if (process.argv.includes('--write')) fs.writeFileSync(target, body);
  else if (fs.readFileSync(target, 'utf8') !== body) throw Error('Stale context-review.json');
  console.log(JSON.stringify({selected_groups: selected.length, with_table_and_context: entries.length}));
});
