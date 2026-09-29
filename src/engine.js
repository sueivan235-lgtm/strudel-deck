// Engine: runs Strudel's own REPL (StrudelMirror) and adds per-layer control.
// Every labelled pattern (`kick: ...`) is wrapped so its gain, mute and solo can
// change at query time, without re-evaluating the code. Every slider() in the
// code reads its value from a time-aware store, so changes can land on the next
// beat or bar and scenes can crossfade.
import { StrudelMirror, initEditor, updateSliderWidgets } from '@strudel/codemirror';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as webaudio from '@strudel/webaudio';
import * as draw from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import { EditorView, keymap } from '@codemirror/view';
import { StateEffect, Transaction, Compartment, EditorState, Prec } from '@codemirror/state';
import { ValueStore } from './store.js';
import { minimalChange } from './parse.js';

export { ValueStore };

const { Pattern, Hap, evalScope, code2hash } = core;
const {
  webaudioOutput,
  getAudioContext,
  samples,
  aliasBank,
  registerSynthSounds,
  registerZZFXSounds,
  initAudio,
  getSuperdoughAudioController,
} = webaudio;

const DOUGH = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';
const ALIAS = 'https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json';
export const DEFAULT_SAMPLE_MAPS = ['tidal-drum-machines', 'piano', 'Dirt-Samples', 'EmuSP12', 'vcsl', 'mridangam'];

/** Values of mixer keys that were never set. */
const mixerDefaults = (key) =>
  key.startsWith('gain:') || key.startsWith('xf:') ? 1 : key.startsWith('mute:') || key.startsWith('solo:') ? false : undefined;

/** Like Strudel's ref(): one value per cycle, read from the store at the queried time. */
function timeRef(store, key) {
  return new Pattern(
    (state) =>
      state.span.spanCycles.map((sub) => new Hap(sub.begin.wholeCycle(), sub, store.valueAt(key, sub.begin.valueOf()))),
    1,
  );
}

export class Engine extends EventTarget {
  constructor({ root, initialCode, sampleMaps = DEFAULT_SAMPLE_MAPS }) {
    super();
    this.store = new ValueStore(mixerDefaults);
    this.sliders = new Map(); // id -> { id, value, min, max, step, from, to }
    this.layers = []; // layer names from the last evaluation, in code order
    this.layerNames = new Set();
    this.soloSafe = new Set();
    this.hits = new Map(); // layer -> [{ t, label }] waiting to be shown
    this.lastError = null;
    this.evaluatedCode = null;
    this.meter = null;
    this.started = false;
    this.locked = false;
    this.audioUnlocked = false;
    this.sampleMaps = sampleMaps;
    this.readOnly = new Compartment();
    this.evalChain = Promise.resolve();
    this.store.set('master', 0.8);

    const engine = this;
    let evalLayers = [];
    let evalSliders = new Map();

    // Browsers only let audio start after a click or key press. The AudioContext may already
    // exist by then (suspended), so resume it on every early gesture until it runs.
    const unlock = () => {
      engine.ensureAudio().catch(() => {});
      if (engine.audioUnlocked && getAudioContext().state === 'running') {
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
      }
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);

    this.mirror = new StrudelMirror({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      root,
      initialCode,
      drawTime: [-2, 2],
      autodraw: false,
      bgFill: false,
      solo: false,
      prebake: () => engine.prebake(),
      beforeStart: () => engine.ensureAudio(),
      beforeEval: () => {
        // The REPL has just installed its own Pattern.prototype.p for this evaluation.
        // Wrap it so each labelled pattern goes through the deck's gain / mute / solo stage.
        const replP = Pattern.prototype.p;
        let anon = 0;
        evalLayers = [];
        evalSliders = new Map();
        engine._collect = evalSliders;
        Pattern.prototype.p = function (id) {
          if (typeof id === 'string' && (id.startsWith('_') || id.endsWith('_'))) return replP.call(this, id);
          let name = typeof id === 'number' ? `d${id}` : id;
          if (typeof id === 'string') {
            if (id.includes('$')) name = `$${anon++}`;
            else if (id.length > 1 && id.startsWith('S')) name = id.slice(1); // Strudel's solo prefix
          }
          if (!evalLayers.includes(name)) evalLayers.push(name);
          return replP.call(engine.wrapLayer(name, this), id);
        };
      },
      afterEval: ({ code, meta }) => {
        // The deck shows the sliders in its own panel, so drop Strudel's inline ones.
        updateSliderWidgets(engine.view, []);
        for (const w of meta?.widgets || []) {
          if (w.type !== 'slider') continue;
          const s = evalSliders.get(`slider_${w.from}`);
          if (s) Object.assign(s, { from: w.from, to: w.to });
        }
        engine.sliders = evalSliders;
        engine.evaluatedCode = code;
        engine.layers = evalLayers;
        engine.layerNames = new Set(evalLayers);
        engine.lastError = null;
        engine.emit('evaluated', { code });
      },
      onUpdateState: (state) => {
        const err = state.evalError || state.schedulerError;
        if (err && err !== engine.lastError) {
          engine.lastError = err;
          engine.emit('error', { error: err });
        }
        if (state.started !== engine.started) {
          engine.started = state.started;
          if (!state.started) engine.store.settle();
          else engine.ensureMeter();
          engine.emit('transport', { started: state.started });
        }
      },
    });
    this.view = this.mirror.editor;
    this.mirror.setFontSize(14);
    this.mirror.setFontFamily('"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace');
    this.installExtensions();
    // Strudel reports sample loading problems and scheduler errors through its logger
    document.addEventListener(core.logger.key, (e) => this.emit('log', e.detail));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** The deck's additions to the code editor: read-only lock, Cmd+Enter, slider tracking, edit events. */
  installExtensions() {
    this.view.dispatch({
      effects: StateEffect.appendConfig.of([
        this.readOnly.of(EditorState.readOnly.of(this.locked)),
        // Cmd+Enter on a Mac, Ctrl+Enter elsewhere (Strudel already binds Ctrl/Alt+Enter)
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (this.emit('update-request', {}), true) }])),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          // keep slider positions in step with edits, so values can still be written back
          for (const s of this.sliders.values()) {
            if (s.from == null) continue;
            s.from = u.changes.mapPos(s.from, -1);
            s.to = u.changes.mapPos(s.to, 1);
          }
          const fromDeck = u.transactions.some((tr) => tr.annotation(Transaction.userEvent) === 'deck.value');
          this.emit('code-edited', { fromDeck });
        }),
      ]),
    });
  }

  async prebake() {
    const engine = this;
    await evalScope(core, mini, tonal, webaudio, draw, {
      // slider(value, min, max, step) is rewritten by the transpiler into sliderWithID(id, ...)
      sliderWithID(id, value, min = 0, max = 1, step) {
        const map = engine._collect || engine.sliders;
        const s = { id, value, min, max, step };
        map.set(id, s);
        // A fade or quantized change in flight already wrote its target into the code:
        // keep it running instead of jumping to the target.
        const st = engine.store;
        const inFlight = st.lanes.has(id) && typeof st.get(id) === 'number' && engine.formatValue(s, st.get(id)) === engine.formatValue(s, value);
        if (!inFlight) st.set(id, value);
        return timeRef(st, id);
      },
    });
    const loads = [
      registerSynthSounds(),
      registerZZFXSounds(),
      ...this.sampleMaps.map((n) =>
        samples(`${DOUGH}${n}.json`).catch((e) => console.warn('[deck] sample map failed', n, e)),
      ),
    ];
    await Promise.all(loads);
    aliasBank(ALIAS).catch((e) => console.warn('[deck] bank aliases failed', e));
  }

  /** Resume the AudioContext and load Strudel's audio worklets (once). Needs a user gesture before it. */
  async ensureAudio() {
    const ac = getAudioContext();
    if (ac.state === 'suspended') {
      try {
        await ac.resume();
      } catch {
        /* not allowed yet: the next click or key press tries again */
      }
    }
    this.audioInit ||= initAudio().catch((e) => console.warn('[deck] audio init', e));
    await this.audioInit;
    if (!this.audioUnlocked && ac.state === 'running') {
      this.audioUnlocked = true;
      this.applyMaster();
    }
  }

  // ---- layers ---------------------------------------------------------------
  wrapLayer(name, pat) {
    const store = this.store;
    const engine = this;
    const wrapped = new Pattern((state) => {
      const haps = pat.query(state);
      if (!haps.length) return haps;
      const out = [];
      for (const h of haps) {
        const t = (h.whole || h.part).begin.valueOf();
        if (!engine.audibleAt(name, t)) continue;
        const g = store.valueAt(`gain:${name}`, t) * store.valueAt(`xf:${name}`, t);
        if (!(g > 0.0001)) continue; // also drops NaN
        out.push(
          g === 1
            ? h
            : h.withValue((v) => (v && typeof v === 'object' ? { ...v, postgain: (v.postgain ?? 1) * g } : v)),
        );
      }
      return out;
    }, pat._steps);
    return wrapped.onTrigger((hap, _now, _cps, t) => engine.hit(name, hap, t), false);
  }

  audibleAt(name, t) {
    if (this.store.valueAt(`mute:${name}`, t)) return false;
    if (this.soloSafe.has(name)) return true;
    let anySolo = false;
    for (const n of this.layerNames) {
      if (this.store.valueAt(`solo:${n}`, t)) {
        anySolo = true;
        if (n === name) return true;
      }
    }
    return !anySolo;
  }

  hit(name, hap, t) {
    const v = hap.value || {};
    const label = v.s
      ? `${v.s}${v.n != null && typeof v.n !== 'object' ? ':' + v.n : ''}`
      : v.note != null
        ? `note ${typeof v.note === 'number' ? Math.round(v.note * 100) / 100 : v.note}`
        : '';
    let q = this.hits.get(name);
    if (!q) this.hits.set(name, (q = []));
    q.push({ t, label });
    if (q.length > 64) q.splice(0, q.length - 64);
  }

  /** Hits that have become audible by audio time `now`: Map layer -> { t, label } (latest). */
  drainHits(now) {
    const out = new Map();
    for (const [name, q] of this.hits) {
      let i = 0;
      while (i < q.length && q[i].t <= now) i++;
      if (i) {
        out.set(name, q[i - 1]);
        q.splice(0, i);
      }
    }
    return out;
  }

  /** Audio clock; 0 until audio has been unlocked (so the page never creates a context early). */
  audioTime() {
    if (!this.audioUnlocked) return 0;
    try {
      return getAudioContext().currentTime;
    } catch {
      return 0;
    }
  }

  // ---- time -------------------------------------------------------------------
  get scheduler() {
    return this.mirror.repl.scheduler;
  }
  /** Cycle position being heard now. */
  now() {
    return this.started ? this.scheduler.now() : 0;
  }
  get cps() {
    return this.scheduler.cps;
  }
  get bpm() {
    return this.cps * 240; // Strudel convention: one cycle = one 4/4 bar
  }
  /** Cycle position where a change should land. mode: 'now' | 'beat' | 'bar'. */
  landing(mode) {
    if (!this.started) return 0;
    // the scheduler has already queried up to lastEnd; nothing earlier can change any more
    const edge = Math.max(this.now(), this.scheduler.lastEnd || 0) + 0.002;
    if (mode === 'now') return edge;
    const grid = mode === 'beat' ? 0.25 : 1;
    return Math.ceil(edge / grid - 1e-9) * grid;
  }
  pending(key) {
    return this.store.pending(key, this.now());
  }

  // ---- sliders -------------------------------------------------------------------
  getValue(id) {
    return this.store.get(id);
  }
  /** Value heard right now (differs from getValue while a change is pending or fading). */
  valueNow(id) {
    return this.store.valueAt(id, this.now(), this.store.get(id));
  }
  clampSlider(s, value) {
    const lo = Math.min(s.min, s.max);
    const hi = Math.max(s.min, s.max);
    value = Math.min(hi, Math.max(lo, value));
    if (s.step) value = Math.round((value - s.min) / s.step) * s.step + s.min;
    return Number(value.toFixed(10));
  }
  /** Change a slider (immediately, or landing/fading per options) and write the value back into the code. */
  setSlider(id, value, { at = 'now', fade = 0 } = {}) {
    const s = this.sliders.get(id);
    if (!s || !Number.isFinite(value)) return;
    value = this.clampSlider(s, value);
    if ((at === 'now' && !fade) || !this.started) {
      this.store.set(id, value);
    } else {
      const t0 = this.landing(at);
      const t1 = s.step ? t0 : t0 + fade;
      this.store.schedule(id, t0, t1, value);
    }
    this.writeSliderText(id, value);
    this.emit('value', { id, value });
  }

  formatValue(s, value) {
    if (s.step && Number.isInteger(s.step)) return String(Math.round(value));
    const span = Math.abs(s.max - s.min);
    const digits = span <= 2 ? 3 : span <= 20 ? 2 : span <= 200 ? 1 : 0;
    return String(Number(value.toFixed(digits)));
  }

  writeSliderText(id, value) {
    const s = this.sliders.get(id);
    if (!s || s.from == null) return;
    const doc = this.view.state.doc;
    if (s.to > doc.length || s.from < 0 || s.to <= s.from) return;
    const current = doc.sliceString(s.from, s.to);
    if (!/^-?\s*[\d.]+$/.test(current.trim())) return; // the text moved under us; the next evaluation re-syncs
    const insert = this.formatValue(s, value);
    if (insert === current) return;
    this.view.dispatch({
      changes: { from: s.from, to: s.to, insert },
      annotations: [Transaction.addToHistory.of(false), Transaction.userEvent.of('deck.value')],
    });
  }

  // ---- layer state ------------------------------------------------------------
  layerGain(name) {
    return this.store.get(`gain:${name}`);
  }
  layerGainNow(name) {
    const t = this.now();
    return this.store.valueAt(`gain:${name}`, t) * this.store.valueAt(`xf:${name}`, t);
  }
  isMuted(name) {
    return !!this.store.get(`mute:${name}`);
  }
  isSolo(name) {
    return !!this.store.get(`solo:${name}`);
  }
  anySolo() {
    for (const n of this.layerNames) if (this.isSolo(n)) return true;
    return false;
  }
  setLayerGain(name, g, { at = 'now', fade = 0 } = {}) {
    g = Math.max(0, Math.min(1.5, g));
    if ((at === 'now' && !fade) || !this.started) this.store.set(`gain:${name}`, g);
    else {
      const t0 = this.landing(at);
      this.store.schedule(`gain:${name}`, t0, t0 + fade, g);
    }
    this.emit('layer', { name });
  }
  setMute(name, on, { at = 'now' } = {}) {
    const s = this.store;
    if (at === 'now' || !this.started) {
      s.set(`mute:${name}`, !!on);
      s.set(`xf:${name}`, 1);
    } else {
      // a scene fade on this layer carries on until the mute lands
      const t0 = this.landing(at);
      s.schedule(`mute:${name}`, t0, t0, !!on);
      s.schedule(`xf:${name}`, t0, t0, 1);
    }
    this.emit('layer', { name });
  }
  setSolo(name, on, { at = 'now' } = {}) {
    if (at === 'now' || !this.started) this.store.set(`solo:${name}`, !!on);
    else {
      const t0 = this.landing(at);
      this.store.schedule(`solo:${name}`, t0, t0, !!on);
    }
    this.emit('layer', { name });
  }
  clearSolos() {
    for (const n of this.layerNames) if (this.isSolo(n)) this.store.set(`solo:${n}`, false);
    this.emit('layer', { name: null });
  }
  /**
   * Move a layer to { gain, mute } for a scene. Gains of layers that keep playing glide over
   * `fade` cycles. Layers switching on or off cut where the scene lands, or with `layerFade`
   * fade in from silence / fade out and then mute.
   */
  setLayerState(name, { gain, mute }, { at = 'bar', fade = 0, layerFade = false } = {}) {
    const s = this.store;
    if (gain === undefined) gain = this.layerGain(name);
    if (mute === undefined) mute = this.isMuted(name);
    gain = Math.max(0, Math.min(1.5, gain));
    const G = `gain:${name}`;
    const M = `mute:${name}`;
    const X = `xf:${name}`;
    if (!this.started || (at === 'now' && !fade)) {
      s.set(G, gain);
      s.set(M, !!mute);
      s.set(X, 1);
      this.emit('layer', { name });
      return;
    }
    const t0 = this.landing(at);
    const t1 = t0 + fade;
    // what is heard where the scene lands (a previous scene may still be fading this layer)
    const heardMuted = !!s.valueAt(M, t0);
    const xfAt = s.valueAt(X, t0);
    if (!mute) {
      s.schedule(M, t0, t0, false);
      if (heardMuted) {
        s.schedule(G, t0, t0, gain);
        if (layerFade && fade > 0) s.schedule(X, t0, t1, 1, 0);
        else s.schedule(X, t0, t0, 1);
      } else {
        s.schedule(G, t0, t1, gain);
        s.schedule(X, t0, fade > 0 ? t1 : t0, 1, xfAt);
      }
    } else if (heardMuted) {
      s.schedule(M, t0, t0, true);
      s.schedule(G, t0, t0, gain);
      s.schedule(X, t0, t0, 1);
    } else if (layerFade && fade > 0) {
      s.schedule(X, t0, t1, 0, xfAt);
      s.schedule(M, t1, t1, true);
      s.schedule(X, t1, t1, 1);
      s.schedule(G, t1, t1, gain);
    } else {
      s.schedule(M, t0, t0, true);
      s.schedule(G, t0, t0, gain);
      s.schedule(X, t0, t0, 1);
    }
    this.emit('layer', { name });
  }
  setSoloSafe(name, on) {
    if (on) this.soloSafe.add(name);
    else this.soloSafe.delete(name);
    this.emit('layer', { name });
  }
  masterGain() {
    return this.store.get('master', 0.8);
  }
  /** The master acts on the output node, so it changes sustained sounds too, immediately. */
  setMaster(g) {
    g = Math.max(0, Math.min(1.5, g));
    this.store.set('master', g);
    this.applyMaster();
    this.emit('master', { value: g });
  }
  applyMaster() {
    if (!this.audioUnlocked) return; // applied once audio starts
    const out = getSuperdoughAudioController?.()?.output?.destinationGain;
    if (!out) return;
    try {
      const ac = getAudioContext();
      out.gain.cancelScheduledValues(ac.currentTime);
      out.gain.setTargetAtTime(this.masterGain(), ac.currentTime, 0.015);
    } catch (e) {
      console.warn('[deck] master', e);
    }
  }

  /** Forget everything about the previous song (mixer state, sliders, layers). */
  resetSong() {
    this.store.values.clear();
    this.store.lanes.clear();
    this.soloSafe.clear();
    this.hits.clear();
    this.sliders = new Map();
    this.layers = [];
    this.layerNames = new Set();
    this.evaluatedCode = null;
    this.lastError = null;
  }

  // ---- transport ----------------------------------------------------------------
  /** Run evaluations one after another, so two quick Updates never interleave. */
  queue(fn) {
    const prev = this.evalChain;
    const stuck = new Promise((r) => setTimeout(r, 15000)); // never wait forever on a hung sample load
    const run = () => fn();
    const next = Promise.race([prev, stuck]).then(run, run);
    this.evalChain = next.catch(() => {});
    return next;
  }
  /** Evaluate the code and start playing. */
  evaluate() {
    return this.queue(async () => {
      await this.ensureAudio();
      await this.mirror.evaluate();
    });
  }
  /** Evaluate without starting, so the deck can show the layers and controls. */
  prime() {
    return this.queue(() => this.mirror.repl.evaluate(this.code, false));
  }
  stop() {
    this.mirror.stop();
  }
  async toggle() {
    if (this.started) this.stop();
    else await this.evaluate();
  }
  get code() {
    return this.view.state.doc.toString();
  }
  /** Load a song: fresh editor state, so undo can never reach the previous song. */
  loadCode(code) {
    const mirror = this.mirror;
    const tmp = initEditor({
      root: document.createElement('div'),
      initialCode: code,
      onChange: (v) => {
        if (v.docChanged) {
          mirror.code = v.state.doc.toString();
          mirror.repl.setCode?.(mirror.code);
        }
      },
      onEvaluate: () => this.emit('update-request', {}),
      onStop: () => mirror.stop(),
    });
    const state = tmp.state;
    tmp.destroy();
    this.view.setState(state);
    this.installExtensions();
    mirror.code = code;
    mirror.repl.setCode?.(code);
  }
  /** Put one {from, to, insert} edit into the code as a normal undoable change. */
  applyChange(change) {
    if (change) this.view.dispatch({ changes: change, userEvent: 'deck.edit' });
    return change;
  }
  /** Replace the code with an edited version, as one undoable change covering only what differs. */
  applyText(code) {
    return this.applyChange(minimalChange(this.code, code));
  }
  setReadOnly(on) {
    this.locked = !!on;
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(this.locked)) });
  }
  shareLink(code = this.code) {
    return `https://strudel.cc/#${code2hash(code)}`;
  }

  // ---- metering -------------------------------------------------------------
  ensureMeter() {
    if (!this.audioUnlocked) return null;
    const ctl = getSuperdoughAudioController?.();
    const out = ctl?.output?.destinationGain;
    if (!out) return null;
    if (this.meter?.node === out) return this.meter;
    this.applyMaster(); // a new output node (first start, device change) starts at gain 1
    try {
      const an = getAudioContext().createAnalyser();
      an.fftSize = 2048;
      out.connect(an);
      this.meter = { an, buf: new Float32Array(an.fftSize), node: out };
    } catch (e) {
      console.warn('[deck] meter unavailable', e);
      this.meter = null;
    }
    return this.meter;
  }
  /** Peak level of the output over the last ~40 ms (1 = 0 dBFS). */
  peak() {
    const m = this.ensureMeter();
    if (!m) return 0;
    m.an.getFloatTimeDomainData(m.buf);
    let p = 0;
    for (let i = 0; i < m.buf.length; i++) {
      const a = Math.abs(m.buf[i]);
      if (a > p) p = a;
    }
    return p;
  }
}
