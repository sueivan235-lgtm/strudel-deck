// Unit tests for the parser, code edits, presets and the value store (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, sectionTitle, parseOptions, setCodeMute, duplicateLayer, deleteLayer, renameLayer, setTempo,
  bakeDeck, checkLayerText, layerNameProblem, replaceLayer, layerText, appendLayer,
} from '../../src/parse.js';
import { ValueStore } from '../../src/store.js';
import { deckFromPreset, defaultMappings, sameSource } from '../../src/deck.js';
import { BUILTIN } from '../../src/songs/index.js';

test('section headers', () => {
  assert.equal(sectionTitle(' ─── KICK ─────'), 'KICK');
  assert.equal(sectionTitle(' == DRUMS =='), 'DRUMS');
  assert.equal(sectionTitle(' # Drums'), 'Drums');
  assert.equal(sectionTitle(' --- Low end · sidechained ---'), 'Low end · sidechained');
  assert.equal(sectionTitle(' ════════════'), null);
  assert.equal(sectionTitle(' ----'), null);
  assert.equal(sectionTitle('  FERRUM · hard industrial techno'), null);
  assert.equal(sectionTitle(' just a comment'), null);
});

test('switch labels from comments', () => {
  assert.deepEqual(parseOptions('909 · synth · hardkick · gabba', 4), { labels: ['909', 'synth', 'hardkick', 'gabba'], help: '' });
  assert.deepEqual(parseOptions('0 909 · 1 synth · 2 hard · 3 gabba', 4).labels, ['909', 'synth', 'hard', 'gabba']);
  assert.deepEqual(parseOptions('a | b | c', 3).labels, ['a', 'b', 'c']);
  const withHelp = parseOptions('drive flavour: soft · diode · hard', 3);
  assert.deepEqual(withHelp, { labels: ['soft', 'diode', 'hard'], help: 'drive flavour' });
  // wrong count: the text is help, not labels
  assert.deepEqual(parseOptions('a · b', 3), { labels: null, help: 'a · b' });
  assert.deepEqual(parseOptions('cutoff in Hz', null), { labels: null, help: 'cutoff in Hz' });
  // numbered subset fills the gaps with numbers
  assert.deepEqual(parseOptions('0 off · 2 max', 3).labels, ['off', '1', 'max']);
});

const CODE = `setcpm(140/4)
// ─── DRUMS ───
const CUT = slider(800, 100, 5000)      // cutoff in Hz
const PAT = slider(0, 0, 2, 1)          // straight · broken · half
const LOWS = slider(-3, -12, 12, 1)
const GRID = PAT.pick(["x*4", "x ~ x x", "x ~ ~ ~"])
register('dirty', (amt, pat) => pat.distort(amt).lpf(CUT))
kick: s("bd").struct(GRID).dirty(2)
_hats: s("hh*8")
Sclap: s("~ cp").lpf(slider(2000, 200, 8000))
$: note("c2").s("sawtooth").lpf(slider(500)).lpf(slider(600))
$: s("rim").gain(LOWS.add(20).div(20))
// ─── FX ───
fx_: s("white")
`;

test('analysis: layers, flags, names', () => {
  const m = analyze(CODE);
  assert.ok(m.ok);
  assert.deepEqual(m.layers.map((l) => l.name), ['kick', 'hats', 'clap', '$0', '$1', 'fx']);
  const by = Object.fromEntries(m.layers.map((l) => [l.name, l]));
  assert.equal(by.hats.codeMuted, true);
  assert.equal(by.fx.codeMuted, true);
  assert.equal(by.clap.codeSolo, true);
  assert.equal(by.kick.section, 0);
  assert.equal(by.fx.section, 1);
  assert.deepEqual(m.sections.map((s) => s.title), ['DRUMS', 'FX']);
});

test('analysis: sliders, keys, dependencies', () => {
  const m = analyze(CODE);
  const keys = m.sliders.map((s) => s.key);
  assert.deepEqual(keys, ['CUT', 'PAT', 'LOWS', 'clap.lpf', '$0.lpf', '$0.lpf#2']);
  const by = Object.fromEntries(m.sliders.map((s) => [s.key, s]));
  assert.equal(by.LOWS.min, -12);
  assert.equal(by.LOWS.value, -3);
  assert.deepEqual(by.PAT.labels, ['straight', 'broken', 'half']);
  assert.equal(by.CUT.help, 'cutoff in Hz');
  // the id matches the transpiler: slider_<start of first argument>
  assert.equal(by.CUT.id, `slider_${CODE.indexOf('800, 100, 5000')}`);
  // kick reaches CUT through the registered helper and PAT through GRID
  const kick = m.layers.find((l) => l.name === 'kick');
  assert.deepEqual(kick.controls.sort(), ['CUT', 'PAT']);
  assert.deepEqual(kick.helpersUsed, ['dirty']);
  assert.ok(kick.functions.includes('struct') && kick.functions.includes('dirty'));
  assert.deepEqual(by.CUT.usedBy, ['kick']);
  assert.deepEqual(by['$0.lpf'].usedBy, ['$0']);
});

test('analysis: tempo', () => {
  assert.equal(analyze('setcpm(140/4)').tempo.literal.value, 140);
  assert.equal(analyze('setcps(0.5)').tempo.literal.value, 0.5);
  const t = analyze('const BPM = 150\nsetcpm(BPM / 4)').tempo;
  assert.equal(t.literal.value, 150);
  assert.equal(t.literal.via, 'BPM');
  assert.equal(analyze('s("bd")').tempo, null);
});

test('analysis: syntax errors are reported, not thrown', () => {
  const m = analyze('kick: s("bd"');
  assert.equal(m.ok, false);
  assert.equal(m.error.line, 1);
});

test('code edits', () => {
  let c = setCodeMute(CODE, 'kick', true);
  assert.ok(c.includes('_kick: s("bd")'));
  c = setCodeMute(c, 'kick', false);
  assert.equal(c, CODE);
  assert.ok(setCodeMute(CODE, 'hats', false).includes('\nhats: s("hh*8")'));

  const d = duplicateLayer(CODE, 'kick');
  assert.equal(d.name, 'kick2');
  assert.ok(d.code.includes('kick: s("bd").struct(GRID).dirty(2)\nkick2: s("bd").struct(GRID).dirty(2)'));

  const del = deleteLayer(CODE, 'kick');
  assert.ok(!del.includes('kick:'));
  assert.ok(del.includes('register(\'dirty\', (amt, pat) => pat.distort(amt).lpf(CUT))\n_hats'));

  assert.ok(renameLayer(CODE, 'kick', 'bass').includes('\nbass: s("bd")'));
  assert.ok(renameLayer(CODE, 'hats', 'shaker').includes('_shaker: s("hh*8")'));
  assert.equal(renameLayer(CODE, 'kick', 'try'), null);

  assert.equal(layerText(CODE, 'kick'), 'kick: s("bd").struct(GRID).dirty(2)');
  assert.ok(replaceLayer(CODE, 'kick', 'kick: s("bd*2")').includes('\nkick: s("bd*2")\n'));
  assert.ok(appendLayer('a: s("bd")', 'demo', 's("hh")').endsWith('\n\ndemo: s("hh")\n'));
});

test('tempo rewrite', () => {
  assert.equal(setTempo('setcpm(140/4)', 140, 130), 'setcpm(130/4)');
  assert.equal(setTempo('const BPM = 150\nsetcpm(BPM / 4)', 150, 146), 'const BPM = 146\nsetcpm(BPM / 4)');
  assert.equal(setTempo('setcps(0.5)', 120, 132), 'setcps(0.55)');
  assert.equal(setTempo('s("bd")', 120, 130), null);
});

test('bake deck state for strudel.cc', () => {
  const baked = bakeDeck(CODE, { layers: { kick: { gain: 0.5, mute: false }, clap: { gain: 1, mute: true } }, master: 0.8 });
  assert.ok(baked.includes('kick: s("bd").struct(GRID).dirty(2).mul(postgain(0.5))'));
  assert.ok(baked.includes('_Sclap: s("~ cp")'));
  assert.ok(baked.trim().endsWith('all(x => x.mul(postgain(0.8)))'));
  assert.ok(analyze(baked).ok);
  // nothing to bake: unchanged
  assert.equal(bakeDeck(CODE, { layers: {}, master: 1 }), CODE);
});

test('layer text checks and names', () => {
  assert.deepEqual(checkLayerText('kick: s("bd*4")'), { ok: true, label: 'kick' });
  assert.equal(checkLayerText('s("bd*4")').ok, false);
  assert.equal(checkLayerText('a: s("bd")\nb: s("hh")').ok, false);
  const bad = checkLayerText('kick: s("bd"');
  assert.equal(bad.ok, false);
  assert.equal(bad.line, 1);
  assert.equal(layerNameProblem('bass2'), null);
  assert.match(layerNameProblem('try'), /keyword/);
  assert.match(layerNameProblem('Stab'), /capital S/);
  assert.match(layerNameProblem('2bass'), /letters/);
  assert.match(layerNameProblem('_x'), /off/);
});

test('value store: steps, ramps, cuts, lanes', () => {
  const s = new ValueStore();
  s.set('a', 0);
  s.schedule('a', 4, 8, 1);
  assert.equal(s.valueAt('a', 3), 0);
  assert.equal(s.valueAt('a', 6), 0.5);
  assert.equal(s.valueAt('a', 9), 1);
  assert.equal(s.get('a'), 1);
  assert.ok(s.pending('a', 7));
  assert.ok(!s.pending('a', 8.5));
  // a new plan mid-ramp cuts the old one where it starts
  s.schedule('a', 6, 6, 0.2);
  assert.equal(s.valueAt('a', 5), 0.25);
  assert.equal(s.valueAt('a', 7), 0.2);
  // fade out then reset (a scene taking a layer out)
  s.set('xf', 1);
  s.schedule('xf', 10, 12, 0);
  s.schedule('xf', 12, 12, 1);
  assert.equal(s.valueAt('xf', 11), 0.5);
  assert.equal(s.valueAt('xf', 12), 1);
  // booleans step
  s.set('m', false);
  s.schedule('m', 2, 2, true);
  assert.equal(s.valueAt('m', 1.99), false);
  assert.equal(s.valueAt('m', 2), true);
  s.prune(100);
  assert.equal(s.lanes.size, 0);
  assert.equal(s.valueAt('xf', 0), 1);
  s.schedule('a', 200, 201, 0.7);
  s.settle();
  assert.equal(s.valueAt('a', 0), 0.7);
});

test('FERRUM preset resolves to full scenes', () => {
  const b = BUILTIN.find((x) => x.id === 'ferrum');
  const deck = deckFromPreset(b.code, b.preset);
  assert.equal(Object.keys(deck.layers).length, 20);
  assert.equal(deck.master, 0.6);
  assert.equal(deck.layers.pump.soloSafe, true);
  assert.equal(deck.layers.kick.mute, false);
  assert.equal(deck.layers.hats.mute, true);
  assert.equal(deck.scenes.length, 8);
  assert.deepEqual(deck.scenes.map((s) => s.name), ['Intro', 'Groove', 'Acid', 'Peak', 'Break', 'Drop', 'Industrial', 'Gabber']);
  const brk = deck.scenes[4].snap;
  assert.equal(brk.controls.BUILD, 1);
  assert.equal(brk.controls.HARD, 0.6); // unlisted controls keep their value in the code
  assert.equal(brk.layers.kick.mute, true);
  assert.equal(brk.layers.drone.mute, false);
  assert.equal(Object.keys(brk.controls).length, 37);
  // every scene names only real controls and layers
  const m = analyze(b.code);
  const keys = new Set(m.sliders.map((s) => s.key));
  for (const sc of b.preset.scenes) {
    for (const k of Object.keys(sc.controls || {})) assert.ok(keys.has(k), `${sc.name}: unknown control ${k}`);
    for (const n of Object.keys(sc.layers || {})) assert.ok(deck.layers[n], `${sc.name}: unknown layer ${n}`);
  }
});

test('default keys', () => {
  const b = BUILTIN.find((x) => x.id === 'ferrum');
  const model = { layers: analyze(b.code).layers };
  const maps = defaultMappings(model);
  const find = (code, shift = false) => maps.filter((m) => sameSource(m.src, { type: 'key', code, shift, alt: false }));
  assert.deepEqual(find('Digit1')[0].target, { kind: 'layer', name: 'kick', action: 'mute' });
  assert.deepEqual(find('Digit1', true)[0].target, { kind: 'layer', name: 'kick', action: 'solo' });
  assert.deepEqual(find('KeyP')[0].target, { kind: 'layer', name: 'snroll', action: 'mute' });
  assert.deepEqual(find('KeyA')[0].target, { kind: 'scene', index: 0, action: 'recall' });
  assert.deepEqual(find('Space')[0].target, { kind: 'transport', action: 'toggle' });
  // no key does two jobs
  const seen = new Set();
  for (const m of maps) {
    const k = `${m.src.code}${m.src.shift ? '+shift' : ''}`;
    assert.ok(!seen.has(k), `duplicate ${k}`);
    seen.add(k);
  }
});

// ---- regression tests for the review findings ----------------------------------------------
import { minimalChange, applyChange as applyChangeTo } from '../../src/parse.js';
import { Deck } from '../../src/deck.js';

const mixerDefaults = (k) => (k.startsWith('gain:') || k.startsWith('xf:') ? 1 : k.startsWith('mute:') || k.startsWith('solo:') ? false : undefined);

test('a ramp on a key that was never set starts from its default, not NaN', () => {
  const s = new ValueStore(mixerDefaults);
  s.schedule('gain:new', 4, 8, 0.5);
  assert.equal(s.valueAt('gain:new', 2), 1);
  assert.equal(s.valueAt('gain:new', 6), 0.75);
  s.schedule('xf:new', 4, 8, 0);
  assert.equal(s.valueAt('xf:new', 6), 0.5);
  assert.equal(s.valueAt('mute:new', 0), false);
});

test('renameKeys moves values and lanes all at once', () => {
  const s = new ValueStore(mixerDefaults);
  s.set('gain:$0', 0.2); // the deleted layer's leftover
  s.set('gain:$1', 0.5);
  s.set('gain:$2', 0.9);
  s.schedule('gain:$2', 1, 3, 0.1);
  s.renameKeys([['gain:$1', 'gain:$0'], ['gain:$2', 'gain:$1']]);
  assert.equal(s.get('gain:$0'), 0.5);
  assert.equal(s.get('gain:$1'), 0.1);
  assert.equal(s.valueAt('gain:$1', 2), 0.5);
  assert.equal(s.has('gain:$2'), false);
});

test('duplicate and switched-off labels get distinct names', () => {
  const m = analyze('_kick: s("bd*2")\nkick: s("bd*4")\nhat: s("hh")\nhat: s("hh*8")\n_hat: s("oh")');
  assert.deepEqual(m.layers.map((l) => [l.name, !!l.shadowed, l.codeMuted]), [
    ['_kick', false, true], ['kick', false, false], ['hat#2', true, false], ['hat', false, false], ['_hat', false, true],
  ]);
  assert.equal(m.warnings.length, 1);
});

test('sliders inside a const are named after it; bake survives semicolons', () => {
  const m = analyze('const DRUMS = s("bd").lpf(slider(800, 100, 2000))\nkick: DRUMS;');
  assert.equal(m.sliders[0].key, 'DRUMS.lpf');
  assert.deepEqual(m.layers[0].controls, ['DRUMS.lpf']);
  const baked = bakeDeck('kick: s("bd*4");', { layers: { kick: { gain: 0.5 } } });
  assert.equal(baked, 'kick: s("bd*4").mul(postgain(0.5));');
  assert.ok(analyze(baked).ok);
});

test('names with $ are refused; copies of $ layers get a real name', () => {
  assert.match(layerNameProblem('a$b'), /\$/);
  const d = duplicateLayer('$: s("bd")\n$: s("hh")', '$0');
  assert.equal(d.name, 'layer2');
  assert.deepEqual(analyze(d.code).layers.map((l) => l.name), ['$0', 'layer2', '$1']);
});

test('minimal change keeps the common prefix and suffix', () => {
  assert.deepEqual(minimalChange('abcXYZdef', 'abcQdef'), { from: 3, to: 6, insert: 'Q' });
  assert.equal(minimalChange('same', 'same'), null);
});

// a deck on a stand-in engine: enough to exercise code edits and the state migration
class FakeEngine extends EventTarget {
  constructor(code) {
    super();
    this._code = code;
    this.store = new ValueStore(mixerDefaults);
    this.soloSafe = new Set();
    this.layers = [];
    this.layerNames = new Set();
    this.sliders = new Map();
    this.evaluatedCode = null;
    this.started = false;
  }
  get code() {
    return this._code;
  }
  applyChange(c) {
    this._code = applyChangeTo(this._code, c);
    return c;
  }
  prime() {
    return Promise.resolve();
  }
  evaluate() {
    return Promise.resolve();
  }
  layerGain(n) {
    return this.store.get(`gain:${n}`);
  }
  isMuted(n) {
    return !!this.store.get(`mute:${n}`);
  }
}
function deckOn(code, deckState) {
  const e = new FakeEngine(code);
  const d = new Deck(e);
  d.song = { id: 't', name: 't', code, deck: deckState };
  return { e, d };
}
const emptyScenes = () => Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, snap: null }));

test('deleting an anonymous layer carries the others’ state to their new numbers', async () => {
  const { e, d } = deckOn('$: s("bd*4")\n$: s("hh*8")\n$: s("cp")\n', {
    master: 1,
    layers: { $0: { gain: 1 }, $1: { gain: 0.5 }, $2: { gain: 1, mute: true } },
    scenes: [{ name: 'A', snap: { controls: {}, layers: { $1: { gain: 0.5, mute: false }, $2: { gain: 1, mute: true } } } }, ...emptyScenes().slice(1)],
    sceneOpts: { at: 'bar', fade: 0, layerFade: false },
    muteAt: 'now',
    mappings: [
      { id: 'a', src: { type: 'key', code: 'Digit1' }, target: { kind: 'layer', name: '$0', action: 'mute' } },
      { id: 'b', src: { type: 'key', code: 'Digit2' }, target: { kind: 'layer', name: '$1', action: 'mute' } },
    ],
  });
  e.store.set('gain:$1', 0.5);
  e.store.set('mute:$2', true);
  await d.deleteLayer('$0');
  assert.equal(e.code, '$: s("hh*8")\n$: s("cp")\n');
  assert.equal(e.store.get('gain:$0'), 0.5);
  assert.equal(e.store.get('mute:$1'), true);
  assert.equal(e.store.get('mute:$0'), false);
  assert.deepEqual(d.deck.layers.$0, { gain: 0.5 });
  assert.deepEqual(d.deck.scenes[0].snap.layers, { $0: { gain: 0.5, mute: false }, $1: { gain: 1, mute: true } });
  assert.deepEqual(d.mappings().map((m) => [m.id, m.target.name]), [['b', '$0']]);
});

test('relabelling a layer keeps its state and its controls’ bindings', async () => {
  const code = 'kick: s("bd*4").lpf(slider(800, 100, 2000))\nhats: s("hh*8")\n';
  const { e, d } = deckOn(code, {
    master: 1, layers: { kick: { gain: 0.7, mute: true } }, scenes: emptyScenes(), sceneOpts: {}, muteAt: 'now',
    mappings: [{ id: 'k', src: { type: 'midi', kind: 'cc', ch: 1, num: 21 }, target: { kind: 'control', key: 'kick.lpf', action: 'set' } }],
  });
  e.store.set('gain:kick', 0.7);
  e.store.set('mute:kick', true);
  await d.replaceLayer('kick', 'drum: s("bd*4").lpf(slider(800, 100, 2000))');
  assert.equal(e.store.get('gain:drum'), 0.7);
  assert.equal(e.store.get('mute:drum'), true);
  assert.deepEqual(d.deck.layers.drum, { gain: 0.7, mute: true });
  assert.equal(d.mappings()[0].target.key, 'drum.lpf');
});

test('renames and switch-ons that would clash are refused', async () => {
  const { d } = deckOn('_kick: s("bd*2")\nkick: s("bd*4")\nhats: s("hh")\n', {
    master: 1, layers: {}, scenes: emptyScenes(), sceneOpts: {}, muteAt: 'now', mappings: [],
  });
  assert.throws(() => d.renameLayer('hats', 'kick'), /already exists/);
  assert.throws(() => d.renameLayer('hats', 'try'), /keyword/);
  assert.throws(() => d.setCodeMute('_kick', false), /already called kick/);
});

test('captureScene waits for a model', () => {
  const { d } = deckOn('kick: s("bd")', { master: 1, layers: {}, scenes: emptyScenes(), sceneOpts: {}, muteAt: 'now', mappings: [] });
  assert.equal(d.captureScene(0), false);
});

test('a switch whose range runs backwards still has all its positions', () => {
  const { d } = deckOn('const X = slider(3, 5, 0, 1) // e · d · c · b · a · z\nkick: s("bd").n(X)', {
    master: 1, layers: {}, scenes: emptyScenes(), sceneOpts: {}, muteAt: 'now', mappings: [],
  });
  d.rebuild(true);
  const c = d.control('X');
  assert.equal(c.count, 6);
  assert.equal(c.dir, -1);
  assert.equal(c.kind, 'switch');
  assert.deepEqual(c.labels, ['e', 'd', 'c', 'b', 'a', 'z']);
});
