// Print what the deck would show for a code file.
import { readFileSync } from 'node:fs';
import { analyze } from '../../src/parse.js';
const code = readFileSync(process.argv[2], 'utf8');
const m = analyze(code);
if (!m.ok) { console.log('PARSE ERROR', m.error); process.exit(1); }
console.log('tempo', JSON.stringify(m.tempo));
console.log('sections', m.sections.map((s) => `${s.index}:${s.title}`).join(' | '));
for (const s of m.sliders) {
  console.log(`  [${s.section}] ${s.key.padEnd(12)} ${String(s.value).padStart(6)} ${s.min}..${s.max}${s.step ? ' step ' + s.step : ''}  ${s.labels ? 'LABELS ' + s.labels.join(' / ') : ''}${s.help ? '  help: ' + s.help : ''}  usedBy: ${s.usedBy.join(',')}`);
}
for (const l of m.layers) {
  console.log(`  layer [${l.section}] ${l.name}${l.codeMuted ? ' (muted in code)' : ''}${l.codeSolo ? ' (solo in code)' : ''} lines ${l.line}-${l.endLine}`);
  console.log(`      controls: ${l.controls.join(' ')}`);
  console.log(`      uses: ${l.uses.join(' ')}  helpers: ${l.helpersUsed.join(' ')}`);
  console.log(`      functions: ${l.functions.join(' ')}`);
}
