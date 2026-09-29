// Deck controller: the current song, its mixer state, scenes and mappings, persisted per song.
// The UI talks to this; this talks to the engine and rewrites code when asked to.
import {
  analyze, applyChange, minimalChange, codeMuteChange, replaceLayerChange, duplicateLayerChange, deleteLayerChange,
  renameLayerChange, setTempoChange, insertTempoChange, appendLayerChange, bakeDeck, uniqueLayerName, findLayer,
  layerNameProblem,
} from './parse.js';
import { BUILTIN, BLANK_CODE } from './songs/index.js';

const PREFIX = 'strudel-deck.v1';
const META_KEY = `${PREFIX}.meta`;
const SONG_KEY = (id) => `${PREFIX}.song.${id}`;
export const SCENE_SLOTS = 8;
export const FADES = [0, 1, 2, 4, 8, 16];

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const uid = () => Math.random().toString(36).slice(2, 10);
const bare = (label) => label.replace(/^_+|_+$/g, '');

function emptyDeck() {
  return {
    master: 0.8,
    layers: {},
    scenes: Array.from({ length: SCENE_SLOTS }, (_, i) => ({ name: `Scene ${i + 1}`, snap: null })),
    sceneOpts: { at: 'bar', fade: 0, layerFade: false },
    muteAt: 'now',
    mappings: null, // null = not set up yet: the deck fills in default keys
  };
}

/** Turn a preset (scenes written as differences) into a full deck state for the given code. */
export function deckFromPreset(code, preset) {
  const deck = emptyDeck();
  const m = analyze(code);
  deck.master = preset.master ?? 0.8;
  const names = m.layers.filter((l) => !l.codeMuted && !l.shadowed).map((l) => l.name);
  for (const n of names) {
    deck.layers[n] = {
      gain: preset.gains?.[n] ?? 1,
      mute: preset.playing ? !preset.playing.includes(n) : false,
      soloSafe: (preset.soloSafe || []).includes(n),
    };
  }
  const defaults = Object.fromEntries(m.sliders.filter((s) => s.value != null).map((s) => [s.key, s.value]));
  (preset.scenes || []).forEach((sc, i) => {
    if (i >= SCENE_SLOTS) return;
    const layers = {};
    for (const n of names) {
      const on = sc.layers && n in sc.layers;
      layers[n] = { gain: on ? sc.layers[n] : deck.layers[n].gain, mute: !on };
    }
    deck.scenes[i] = { name: sc.name, snap: { controls: { ...defaults, ...(sc.controls || {}) }, layers } };
  });
  return deck;
}

/**
 * Songs in localStorage, one key per song plus a small meta record, so two open tabs
 * can't wipe each other's songs. Another tab's change to the song playing here is
 * reported, never loaded over it.
 */
class Library extends EventTarget {
  constructor() {
    super();
    this.songs = {};
    this.meta = { current: null, settings: {} };
    this.pending = new Set();
    this.timer = null;
    const ls = storage();
    if (ls) {
      try {
        const old = ls.getItem(PREFIX); // first version kept everything in one record
        if (old) {
          const d = JSON.parse(old);
          for (const s of Object.values(d.songs || {})) if (s?.id) ls.setItem(SONG_KEY(s.id), JSON.stringify(s));
          ls.setItem(META_KEY, JSON.stringify({ current: d.current, settings: d.settings || {} }));
          ls.removeItem(PREFIX);
        }
        const meta = ls.getItem(META_KEY);
        if (meta) this.meta = { ...this.meta, ...JSON.parse(meta) };
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (!k || !k.startsWith(`${PREFIX}.song.`)) continue;
          try {
            const s = JSON.parse(ls.getItem(k));
            if (s?.id) this.songs[s.id] = s;
          } catch {
            /* skip a damaged record */
          }
        }
      } catch (e) {
        console.warn('[deck] could not read saved songs', e);
      }
    }
    this.meta.settings ||= {};
    for (const b of BUILTIN) {
      if (!this.songs[b.id]) {
        this.songs[b.id] = this.fromBuiltin(b);
        this.pending.add(b.id);
      }
    }
    if (!this.meta.current || !this.songs[this.meta.current]) this.meta.current = BUILTIN[0].id;
    if (typeof window !== 'undefined') window.addEventListener('storage', (e) => this.external(e));
  }
  fromBuiltin(b) {
    return { id: b.id, name: b.name, builtin: b.id, code: b.code, deck: deckFromPreset(b.code, b.preset), updated: Date.now() };
  }
  get current() {
    return this.meta.current;
  }
  set current(id) {
    this.meta.current = id;
  }
  get settings() {
    return this.meta.settings;
  }
  list() {
    return Object.values(this.songs).sort((a, b) => {
      const ba = a.builtin ? BUILTIN.findIndex((x) => x.id === a.builtin) : 99;
      const bb = b.builtin ? BUILTIN.findIndex((x) => x.id === b.builtin) : 99;
      return ba - bb || a.name.localeCompare(b.name);
    });
  }
  get(id) {
    return this.songs[id];
  }
  add(song) {
    this.songs[song.id] = song;
    this.pending.add(song.id);
    this.save();
    return song;
  }
  replace(song) {
    this.songs[song.id] = song;
    this.pending.add(song.id);
    this.save();
  }
  remove(id) {
    delete this.songs[id];
    this.pending.delete(id);
    try {
      storage()?.removeItem(SONG_KEY(id));
    } catch {
      /* ignore */
    }
    if (this.meta.current === id) this.meta.current = this.list()[0]?.id;
    this.save();
  }
  /** Save the current song and meta (debounced), plus any song marked pending. */
  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      const ls = storage();
      if (!ls) return;
      const ids = new Set(this.pending);
      if (this.meta.current) ids.add(this.meta.current);
      this.pending.clear();
      try {
        for (const id of ids) if (this.songs[id]) ls.setItem(SONG_KEY(id), JSON.stringify(this.songs[id]));
        ls.setItem(META_KEY, JSON.stringify(this.meta));
      } catch (e) {
        console.warn('[deck] could not save', e);
        this.dispatchEvent(new CustomEvent('save-failed', { detail: { error: e } }));
      }
    };
    if (now) write();
    else this.timer = setTimeout(write, 400);
  }
  external(e) {
    if (!e.key || !e.key.startsWith(`${PREFIX}.song.`)) return;
    const id = e.key.slice(`${PREFIX}.song.`.length);
    if (id === this.meta.current) {
      this.dispatchEvent(new CustomEvent('external-change', { detail: { id } }));
      return;
    }
    if (e.newValue == null) delete this.songs[id];
    else {
      try {
        this.songs[id] = JSON.parse(e.newValue);
      } catch {
        /* ignore */
      }
    }
    this.dispatchEvent(new CustomEvent('list-changed'));
  }
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class Deck extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.lib = new Library();
    this.song = null;
    this.model = null;
    this.analysis = null;
    this.dirty = false; // code edited since the last evaluation
    this.lastScene = null;

    engine.addEventListener('evaluated', () => this.rebuild());
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.lib.save(true));
    engine.addEventListener('code-edited', (e) => {
      if (!this.song) return;
      this.song.code = engine.code;
      this.song.updated = Date.now();
      this.lib.save();
      if (!e.detail.fromDeck && !this.dirty) {
        this.dirty = true;
        this.emit('dirty', { dirty: true });
      }
    });
    engine.addEventListener('layer', (e) => this.syncLayer(e.detail.name));
    engine.addEventListener('master', () => {
      if (!this.song) return;
      this.song.deck.master = engine.masterGain();
      this.lib.save();
    });
    engine.addEventListener('transport', (e) => {
      if (!e.detail.started) this.lastScene = null;
    });
    // Cmd/Ctrl+Enter in the editor: Strudel's convention, evaluate and play
    engine.addEventListener('update-request', () => engine.evaluate());
    this.lib.addEventListener('external-change', () => this.emit('external-change'));
    this.lib.addEventListener('list-changed', () => this.emit('list-changed'));
    this.lib.addEventListener('save-failed', () => this.emit('save-failed'));
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  get deck() {
    return this.song?.deck;
  }
  get settings() {
    return this.lib.settings;
  }
  saveSettings() {
    this.lib.save();
  }

  // ---- songs ------------------------------------------------------------------------
  songs() {
    return this.lib.list();
  }
  async loadSong(id) {
    const song = this.lib.get(id);
    if (!song) return;
    if (this.engine.started) this.engine.stop();
    this.song = song;
    song.deck = { ...emptyDeck(), ...song.deck };
    this.lib.current = id;
    this.lib.save();
    this.lastScene = null;
    // fresh mixer state for this song
    const e = this.engine;
    e.resetSong();
    e.setMaster(song.deck.master ?? 0.8);
    for (const [name, st] of Object.entries(song.deck.layers)) {
      e.store.set(`gain:${name}`, st.gain ?? 1);
      e.store.set(`mute:${name}`, !!st.mute);
      if (st.soloSafe) e.soloSafe.add(name);
    }
    e.loadCode(song.code);
    this.dirty = false;
    this.analysis = analyze(song.code);
    this.model = null;
    this.emit('song', { song });
    await this.prime();
  }
  /** Evaluate without playing so the surface can show everything. */
  async prime() {
    const song = this.song;
    try {
      await this.engine.prime();
    } catch (err) {
      console.warn('[deck] prime failed', err);
    }
    if (!this.model && this.song === song) this.rebuild(true);
  }
  /** Apply code changes: hot-swap while playing, re-read the code while stopped. */
  async update() {
    if (this.engine.started) await this.engine.evaluate();
    else await this.prime();
  }
  newSong(name = 'Untitled', code = BLANK_CODE, deck = null) {
    const song = { id: `song-${uid()}`, name, code, deck: deck || emptyDeck(), updated: Date.now() };
    this.lib.add(song);
    return song;
  }
  duplicateSong() {
    const s = this.song;
    return this.newSong(`${s.name} copy`, this.engine.code, clone(s.deck));
  }
  renameSong(name) {
    if (!name) return;
    this.song.name = name;
    this.lib.save();
    this.emit('song', { song: this.song });
  }
  deleteSong(id = this.song.id) {
    this.lib.remove(id);
  }
  resetBuiltin() {
    const b = BUILTIN.find((x) => x.id === this.song.builtin);
    if (!b) return null;
    const fresh = this.lib.fromBuiltin(b);
    fresh.deck.mappings = this.song.deck.mappings; // keep the performer's keys
    this.lib.replace(fresh);
    return fresh.id;
  }
  exportSong() {
    const s = this.song;
    return {
      format: 'strudel-deck',
      version: 1,
      name: s.name,
      code: this.engine.code,
      deck: s.deck,
      exported: new Date().toISOString(),
    };
  }
  importSong(text, filename = 'Imported') {
    const name = filename.replace(/\.(deck\.json|json|js|txt|strudel)$/i, '');
    try {
      const data = JSON.parse(text);
      if (data && data.format === 'strudel-deck' && typeof data.code === 'string') {
        return this.newSong(data.name || name, data.code, { ...emptyDeck(), ...(data.deck || {}) });
      }
    } catch {
      /* not JSON: plain code */
    }
    return this.newSong(name, text);
  }
  /** Code that sounds like the deck right now, for strudel.cc. */
  bakedCode() {
    const layers = {};
    for (const n of this.engine.layers) layers[n] = { gain: this.engine.layerGain(n), mute: this.engine.isMuted(n) };
    return bakeDeck(this.engine.code, { layers, master: this.engine.masterGain() });
  }
  shareLink() {
    return this.engine.shareLink(this.bakedCode());
  }

  // ---- model -----------------------------------------------------------------------
  /** Combine the static analysis of the evaluated code with what the engine registered. */
  rebuild(staticOnly = false) {
    if (!this.song) return;
    const e = this.engine;
    const code = staticOnly || e.evaluatedCode == null ? e.code : e.evaluatedCode;
    const a = analyze(code);
    this.analysis = a;
    const byId = new Map(a.ok ? a.sliders.map((s) => [s.id, s]) : []);
    const controls = [];
    const live = !staticOnly && e.evaluatedCode != null;
    const source = live
      ? [...e.sliders.values()]
      : a.ok
        ? a.sliders.map((s) => ({ id: s.id, value: s.value, min: s.min ?? 0, max: s.max ?? 1, step: s.step }))
        : [];
    for (const rs of source) {
      const st = byId.get(rs.id);
      const step = rs.step ? Math.abs(rs.step) : null;
      const dir = rs.max >= rs.min ? 1 : -1;
      const count = step ? Math.floor(Math.abs(rs.max - rs.min) / step + 1e-9) + 1 : null;
      const labels = st?.labels && st.labels.length === count ? st.labels : null;
      const kind = count && (labels || (count <= 8 && Number.isInteger(step))) ? 'switch' : step ? 'stepper' : 'continuous';
      controls.push({
        id: rs.id,
        key: st?.key || rs.id,
        name: st?.name || null,
        label: st?.label || rs.id,
        min: rs.min,
        max: rs.max,
        step,
        dir,
        count,
        labels,
        help: st?.help || '',
        kind,
        section: st ? st.section : -1,
        line: st?.line,
        layer: st?.layer || null,
        usedBy: st?.usedBy || [],
        live,
      });
    }
    const layers = [];
    const seen = new Set();
    for (const l of a.ok ? a.layers : []) {
      if (seen.has(l.name)) continue;
      seen.add(l.name);
      layers.push({
        name: l.name,
        label: l.label,
        section: l.section,
        codeMuted: l.codeMuted,
        codeSolo: l.codeSolo,
        shadowed: !!l.shadowed,
        playing: live ? e.layerNames.has(l.name) && !l.shadowed : !l.codeMuted && !l.shadowed,
        line: l.line,
        controls: l.controls,
        functions: l.functions,
        uses: l.uses,
        helpersUsed: l.helpersUsed,
        static: true,
      });
    }
    if (live) {
      for (const n of e.layers) {
        if (seen.has(n)) continue;
        seen.add(n);
        layers.push({ name: n, label: n, section: -1, codeMuted: false, codeSolo: false, shadowed: false, playing: true, controls: [], functions: [], uses: [], helpersUsed: [], static: false });
      }
    }
    const sections = a.ok ? a.sections : [];
    this.model = { controls, layers, sections, live, tempo: a.ok ? a.tempo : null, ok: a.ok, error: a.error, warnings: a.warnings || [] };
    this.controlsByKey = new Map(controls.map((c) => [c.key, c]));
    this.layersByName = new Map(layers.map((l) => [l.name, l]));
    for (const l of layers) {
      if (!l.codeMuted && !l.shadowed && !this.deck.layers[l.name]) {
        this.deck.layers[l.name] = { gain: e.layerGain(l.name), mute: e.isMuted(l.name), soloSafe: e.soloSafe.has(l.name) };
      }
    }
    if (this.deck.mappings == null && live) {
      this.deck.mappings = defaultMappings(this.model);
    }
    if (live && this.dirty && e.evaluatedCode === e.code) {
      this.dirty = false;
      this.emit('dirty', { dirty: false });
    }
    this.lib.save();
    this.emit('model', { model: this.model });
  }
  control(key) {
    return this.controlsByKey?.get(key);
  }
  layer(name) {
    return this.layersByName?.get(name);
  }

  // ---- controls ------------------------------------------------------------------------
  value(key) {
    const c = this.control(key);
    return c ? this.engine.getValue(c.id) : undefined;
  }
  setControl(key, value, opts) {
    const c = this.control(key);
    if (!c || !c.live) return;
    this.engine.setSlider(c.id, value, opts);
  }
  /** d = +1/-1. Switches move one position (wrapping), steppers one step, others `fraction` of their range. */
  nudgeControl(key, d, fraction = 0.05) {
    const c = this.control(key);
    if (!c || !c.live) return;
    const v = this.value(key);
    if (c.kind === 'switch') {
      const idx = Math.round((v - c.min) / (c.step * c.dir));
      this.setControl(key, c.min + (((idx + d) % c.count) + c.count) % c.count * c.step * c.dir);
    } else if (c.step) {
      this.setControl(key, v + d * c.step);
    } else {
      this.setControl(key, v + d * fraction * (c.max - c.min));
    }
  }
  /** Set from a 0..1 position (MIDI CC). */
  setControlNormalized(key, x) {
    const c = this.control(key);
    if (!c) return;
    if (c.step) this.setControl(key, c.min + Math.round(x * (c.count - 1)) * c.step * c.dir);
    else this.setControl(key, c.min + x * (c.max - c.min));
  }

  // ---- layers ---------------------------------------------------------------------------
  syncLayer(name) {
    if (!this.song) return;
    const e = this.engine;
    const names = name ? [name] : Object.keys(this.deck.layers);
    for (const n of names) {
      const st = (this.deck.layers[n] ||= {});
      st.gain = e.layerGain(n);
      st.mute = e.isMuted(n);
      st.soloSafe = e.soloSafe.has(n);
    }
    this.lib.save();
  }
  toggleMute(name, force) {
    const on = force ?? !this.engine.isMuted(name);
    this.engine.setMute(name, on, { at: this.deck.muteAt });
  }
  toggleSolo(name, force) {
    const on = force ?? !this.engine.isSolo(name);
    this.engine.setSolo(name, on, { at: this.deck.muteAt });
  }
  setLayerGain(name, g) {
    this.engine.setLayerGain(name, g);
  }

  // ---- code edits from the deck ---------------------------------------------------------------
  /**
   * Put one edit into the code (a normal undoable change) and update. Layers and controls whose
   * names change because of the edit (renames, $: renumbering, shifted lines) keep their fader,
   * mute, solo, scene values and key bindings.
   */
  applyChange(change) {
    if (!change) return Promise.resolve();
    const code = this.engine.code;
    const before = analyze(code);
    const after = analyze(applyChange(code, change));
    this.engine.applyChange(change);
    const renamed = this.migrate(before, after, change);
    const p = this.update();
    if (renamed.layers.size || renamed.controls.size) this.emit('renamed', renamed);
    return p;
  }
  /** Replace the whole code with a new version (the edit is worked out by diffing). */
  applyCode(code) {
    return this.applyChange(minimalChange(this.engine.code, code));
  }

  migrate(before, after, change) {
    const layers = new Map();
    const controls = new Map();
    if (!before.ok || !after.ok) return { layers, controls };
    const { from, to, insert } = change;
    const delta = insert.length - (to - from);
    // where a statement that started at p starts now: before the edit it stays, after it shifts;
    // a statement starting where a replacement starts is the edited one; inside a deletion it's gone
    const mapPos = (p) => (p < from ? p : p >= to && !(p === from && to > from) ? p + delta : p === from && insert ? p : null);
    const newLayerAt = new Map(after.layers.map((l) => [l.from, l]));
    for (const l of before.layers) {
      const p = mapPos(l.from);
      const nl = p == null ? null : newLayerAt.get(p);
      if (nl && nl.name !== l.name) layers.set(l.name, nl.name);
    }
    const newSliderAt = new Map(after.sliders.map((s) => [s.from, s]));
    const newKeys = new Set(after.sliders.map((s) => s.key));
    for (const s of before.sliders) {
      const p = s.from < from ? s.from : s.from >= to ? s.from + delta : null;
      const ns = p == null ? null : newSliderAt.get(p);
      if (ns) {
        if (ns.key !== s.key) controls.set(s.key, ns.key);
      } else if (s.layer && layers.has(s.layer)) {
        // inside the edited layer: follow the layer's new name
        const k = `${layers.get(s.layer)}${s.key.slice(s.layer.length)}`;
        if (newKeys.has(k) && k !== s.key) controls.set(s.key, k);
      }
    }
    if (!layers.size && !controls.size) return { layers, controls };

    const e = this.engine;
    const pairs = [];
    for (const [o, n] of layers) for (const k of ['gain', 'mute', 'solo', 'xf']) pairs.push([`${k}:${o}`, `${k}:${n}`]);
    e.store.renameKeys(pairs);
    const targets = new Set(layers.values());
    e.soloSafe = new Set([...e.soloSafe].filter((n) => layers.has(n) || !targets.has(n)).map((n) => layers.get(n) ?? n));
    this.deck.layers = renameEntries(this.deck.layers, layers);
    for (const sc of this.deck.scenes) {
      if (!sc.snap) continue;
      sc.snap.layers = renameEntries(sc.snap.layers || {}, layers);
      sc.snap.controls = renameEntries(sc.snap.controls || {}, controls);
    }
    for (const m of this.mappings()) {
      if (m.target.name != null && layers.has(m.target.name)) m.target.name = layers.get(m.target.name);
      if (m.target.key != null && controls.has(m.target.key)) m.target.key = controls.get(m.target.key);
    }
    this.lib.save();
    return { layers, controls };
  }

  setCodeMute(name, muted) {
    const a = analyze(this.engine.code);
    const l = findLayer(a, name);
    if (!l) return Promise.resolve();
    if (!muted) {
      const target = bare(l.label);
      if (a.layers.some((o) => o !== l && !o.codeMuted && o.name === target)) {
        throw new Error(`Another layer is already called ${target}. Rename one of them first.`);
      }
    }
    return this.applyChange(codeMuteChange(this.engine.code, name, muted));
  }
  replaceLayer(name, text) {
    const change = replaceLayerChange(this.engine.code, name, text);
    if (!change) throw new Error(`Layer ${name} is no longer in the code`);
    return this.applyChange(change);
  }
  duplicateLayer(name) {
    const r = duplicateLayerChange(this.engine.code, name);
    if (!r) return null;
    const st = this.deck.layers[name];
    if (st) {
      this.deck.layers[r.name] = { ...st, soloSafe: false };
      this.engine.store.set(`gain:${r.name}`, st.gain ?? 1);
      this.engine.store.set(`mute:${r.name}`, !!st.mute);
    }
    this.applyChange(r.change);
    return r.name;
  }
  deleteLayer(name) {
    const change = deleteLayerChange(this.engine.code, name);
    if (!change) return Promise.resolve();
    delete this.deck.layers[name];
    this.engine.store.set(`solo:${name}`, false);
    this.deck.mappings = this.mappings().filter((m) => m.target.name !== name);
    for (const sc of this.deck.scenes) if (sc.snap?.layers) delete sc.snap.layers[name];
    return this.applyChange(change);
  }
  /** Rename a layer's label. Throws with a reason when the name can't be used. */
  renameLayer(name, newName) {
    const problem = layerNameProblem(newName);
    if (problem) throw new Error(problem);
    const a = analyze(this.engine.code);
    if (a.layers.some((l) => l.name !== name && (l.name === newName || bare(l.label) === newName))) {
      throw new Error(`A layer called ${newName} already exists.`);
    }
    const change = renameLayerChange(this.engine.code, name, newName);
    if (!change) throw new Error(`Layer ${name} is no longer in the code`);
    return this.applyChange(change);
  }
  addLayer(name, expr, { solo = false } = {}) {
    const model = analyze(this.engine.code);
    const taken = new Set(model.ok ? model.layers.flatMap((l) => [l.name, bare(l.label)]) : []);
    const n = taken.has(name) ? uniqueLayerName(model, name) : name;
    if (solo) this.engine.store.set(`solo:${n}`, true);
    this.applyChange(appendLayerChange(this.engine.code, n, expr));
    return n;
  }
  async setTempo(bpm) {
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new Error('Tempo must be between 20 and 400 BPM');
    const code = this.engine.code;
    const change = setTempoChange(code, this.engine.bpm, bpm) || insertTempoChange(code, bpm);
    this.engine.scheduler.setCps(bpm / 240);
    await this.applyChange(change);
  }

  // ---- scenes -----------------------------------------------------------------------------
  captureScene(i) {
    if (!this.model) return false;
    const e = this.engine;
    const controls = {};
    for (const c of this.model.controls) if (c.live) controls[c.key] = e.getValue(c.id);
    const layers = {};
    for (const n of e.layers) layers[n] = { gain: e.layerGain(n), mute: e.isMuted(n) };
    const sc = this.deck.scenes[i];
    sc.snap = { controls, layers };
    this.lib.save();
    this.emit('scenes');
    return true;
  }
  recallScene(i, opts = {}) {
    const sc = this.deck.scenes[i];
    if (!sc?.snap || !this.model) return false;
    const { at, fade, layerFade } = { ...this.deck.sceneOpts, ...opts };
    const t0 = this.engine.landing(at);
    for (const [key, v] of Object.entries(sc.snap.controls || {})) {
      const c = this.control(key);
      if (!c || !c.live) continue;
      if (Math.abs(this.value(key) - v) < 1e-9 && !this.engine.pending(c.id)) continue;
      this.engine.setSlider(c.id, v, { at, fade });
    }
    for (const [name, st] of Object.entries(sc.snap.layers || {})) {
      if (!this.engine.layerNames.has(name)) continue;
      this.engine.setLayerState(name, st, { at, fade, layerFade });
    }
    this.lastScene = i;
    this.emit('scene-recalled', { index: i, t0, t1: t0 + (fade || 0) });
    return true;
  }
  renameScene(i, name) {
    this.deck.scenes[i].name = name || `Scene ${i + 1}`;
    this.lib.save();
    this.emit('scenes');
  }
  clearScene(i) {
    this.deck.scenes[i].snap = null;
    this.lib.save();
    this.emit('scenes');
  }
  setSceneOpts(o) {
    Object.assign(this.deck.sceneOpts, o);
    this.lib.save();
    this.emit('scenes');
  }
  setMuteAt(at) {
    this.deck.muteAt = at;
    this.lib.save();
    this.emit('scenes');
  }

  // ---- mappings -----------------------------------------------------------------------------
  mappings() {
    return this.deck?.mappings || [];
  }
  addMapping(src, target, extra = {}) {
    const list = (this.deck.mappings ||= []);
    // one binding per source: a key or MIDI control moves to its new job
    for (let i = list.length - 1; i >= 0; i--) if (sameSource(list[i].src, src)) list.splice(i, 1);
    // one source per slot
    for (let i = list.length - 1; i >= 0; i--) if (sameTarget(list[i].target, target) && list[i].src.type === src.type) list.splice(i, 1);
    const m = { id: uid(), src, target, ...extra };
    list.push(m);
    this.lib.save();
    this.emit('mappings');
    return m;
  }
  updateMapping(id, patch) {
    const m = this.mappings().find((x) => x.id === id);
    if (m) Object.assign(m, patch);
    this.lib.save();
    this.emit('mappings');
  }
  removeMapping(id) {
    this.deck.mappings = this.mappings().filter((m) => m.id !== id);
    this.lib.save();
    this.emit('mappings');
  }
  mappingsFor(target) {
    return this.mappings().filter((m) => sameTarget(m.target, target));
  }
  resetMappings() {
    this.deck.mappings = defaultMappings(this.model);
    this.lib.save();
    this.emit('mappings');
  }
  clearMappings() {
    this.deck.mappings = [];
    this.lib.save();
    this.emit('mappings');
  }
}

/** Rename object keys all at once; an entry whose key is taken over by a rename is dropped. */
function renameEntries(obj, map) {
  if (!map.size) return obj;
  const targets = new Set(map.values());
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (map.has(k) || targets.has(k)) continue;
    out[k] = v;
  }
  for (const [o, n] of map) if (o in obj) out[n] = obj[o];
  return out;
}

export function sameSource(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'key') return a.code === b.code && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
  return a.kind === b.kind && a.ch === b.ch && a.num === b.num;
}
export function sameTarget(a, b) {
  return a.kind === b.kind && a.action === b.action && (a.name ?? a.key ?? a.index) === (b.name ?? b.key ?? b.index);
}

const LAYER_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];
const SCENE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

/** Default keys: layer mutes on 1–0 and Q–P (Shift = solo), scenes on A–K (Shift = store), Space play/stop. */
export function defaultMappings(model) {
  const list = [];
  const add = (src, target, extra = {}) => list.push({ id: uid(), src: { type: 'key', ...src }, target, ...extra });
  add({ code: 'Space' }, { kind: 'transport', action: 'toggle' });
  add({ code: 'Enter', shift: true }, { kind: 'transport', action: 'update' });
  const layers = (model?.layers || []).filter((l) => !l.codeMuted && !l.shadowed);
  layers.slice(0, LAYER_KEYS.length).forEach((l, i) => {
    add({ code: LAYER_KEYS[i] }, { kind: 'layer', name: l.name, action: 'mute' }, { mode: 'toggle' });
    add({ code: LAYER_KEYS[i], shift: true }, { kind: 'layer', name: l.name, action: 'solo' }, { mode: 'toggle' });
  });
  SCENE_KEYS.forEach((code, i) => {
    add({ code }, { kind: 'scene', index: i, action: 'recall' });
    add({ code, shift: true }, { kind: 'scene', index: i, action: 'store' });
  });
  add({ code: 'Minus' }, { kind: 'master', action: 'down' });
  add({ code: 'Equal' }, { kind: 'master', action: 'up' });
  return list;
}
