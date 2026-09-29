// Keyboard and MIDI: triggers mappings, and captures the next key or MIDI message when learning.
import { sameSource } from './deck.js';

const KEY_LABELS = {
  Space: 'Space', Enter: '⏎', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '§',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
let layoutMap = null;
if (typeof navigator !== 'undefined' && navigator.keyboard?.getLayoutMap) {
  navigator.keyboard.getLayoutMap().then((m) => (layoutMap = m)).catch(() => {});
}

export function keyLabel(code) {
  const fromLayout = layoutMap?.get(code);
  if (fromLayout && fromLayout.trim() && !KEY_LABELS[code]) return fromLayout.toUpperCase();
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

export function describeSource(src) {
  if (!src) return '';
  if (src.type === 'key') return `${src.alt ? '⌥' : ''}${src.shift ? '⇧' : ''}${keyLabel(src.code)}`;
  if (src.kind === 'cc') return `CC${src.num}${src.ch !== 1 ? `/${src.ch}` : ''}`;
  return `N${src.num}${src.ch !== 1 ? `/${src.ch}` : ''}`;
}

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor';
const BLOCKED = new Set(['MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'CapsLock', 'Fn']);

export class Input extends EventTarget {
  constructor(deck, { onSelectedNudge, onEscape } = {}) {
    super();
    this.deck = deck;
    this.learning = null; // { accept: ['key','midi'], resolve }
    this.holds = new Map(); // key code -> [release functions]
    this.noteHolds = new Map();
    this.midi = null;
    this.midiInputs = [];
    this.onSelectedNudge = onSelectedNudge;
    this.onEscape = onEscape;
    window.addEventListener('keydown', (e) => this.keydown(e), true);
    window.addEventListener('keyup', (e) => this.keyup(e), true);
    window.addEventListener('blur', () => this.releaseAll());
  }
  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** True when keys should go to the page, not to the deck. */
  typing(e) {
    const el = e.target;
    return !!(el && el.closest && el.closest(TYPING));
  }
  get keysActive() {
    const el = document.activeElement;
    return !(el && el.closest && el.closest(TYPING));
  }

  /** Capture the next key press or MIDI message. Resolves with a source, or null when cancelled. */
  learn(accept = ['key', 'midi']) {
    this.cancelLearn();
    return new Promise((resolve) => {
      this.learning = { accept, resolve };
      this.emit('learning', { on: true, accept });
    });
  }
  cancelLearn() {
    if (!this.learning) return;
    const { resolve } = this.learning;
    this.learning = null;
    this.emit('learning', { on: false });
    resolve(null);
  }
  finishLearn(src) {
    const { resolve } = this.learning;
    this.learning = null;
    this.emit('learning', { on: false });
    resolve(src);
  }

  keydown(e) {
    if (this.learning) {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancelLearn();
        return;
      }
      // learning a MIDI-only slot: keys keep working as usual
      if (this.learning.accept.includes('key')) {
        if (BLOCKED.has(e.code) || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.finishLearn({ type: 'key', code: e.code, shift: e.shiftKey, alt: e.altKey });
        return;
      }
    }
    // a dialog is open: its buttons and fields get the keys
    if (document.querySelector('.modal-back')) return;
    if (this.typing(e)) {
      if (e.code === 'Escape' && document.activeElement) {
        document.activeElement.blur();
        this.emit('focus-change');
      }
      return;
    }
    if (e.metaKey || e.ctrlKey) return; // browser and editor shortcuts
    const src = { type: 'key', code: e.code, shift: e.shiftKey, alt: e.altKey };
    const maps = this.deck.mappings().filter((m) => sameSource(m.src, src));
    if (maps.length) {
      e.preventDefault();
      for (const m of maps) {
        const release = this.trigger(m, { phase: 'down', repeat: e.repeat });
        if (release) {
          const list = this.holds.get(e.code) || [];
          list.push(release);
          this.holds.set(e.code, list);
        }
      }
      this.emit('triggered', { src, maps });
      return;
    }
    // built-in keys
    if (e.code === 'Escape') {
      this.onEscape?.();
      return;
    }
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.code];
    if (dir && this.onSelectedNudge) {
      if (this.onSelectedNudge(dir, { fine: e.shiftKey, horizontal: e.code === 'ArrowLeft' || e.code === 'ArrowRight' })) e.preventDefault();
    }
  }

  keyup(e) {
    const list = this.holds.get(e.code);
    if (list) {
      this.holds.delete(e.code);
      for (const release of list) release();
    }
  }
  releaseAll() {
    for (const list of this.holds.values()) for (const release of list) release();
    this.holds.clear();
    for (const list of this.noteHolds.values()) for (const release of list) release();
    this.noteHolds.clear();
  }

  /**
   * Run one mapping. phase: 'down' | 'up' | 'value' (MIDI CC, with x in 0..1).
   * Returns a release function for hold-style mappings.
   */
  trigger(m, { phase = 'down', repeat = false, x = null } = {}) {
    const d = this.deck;
    const e = d.engine;
    const t = m.target;
    if (t.kind === 'transport') {
      if (phase !== 'down' || repeat) return;
      if (t.action === 'toggle') e.toggle();
      else if (t.action === 'update') d.update();
      else if (t.action === 'stop') e.stop();
      return;
    }
    if (t.kind === 'scene') {
      if (phase !== 'down' || repeat) return;
      if (t.action === 'recall') {
        if (!d.recallScene(t.index)) this.emit('notice', { text: `Scene ${t.index + 1} is empty: store it first` });
      } else if (t.action === 'store') {
        d.captureScene(t.index);
        this.emit('notice', { text: `Stored ${d.deck.scenes[t.index].name}` });
      }
      return;
    }
    if (t.kind === 'master') {
      if (phase === 'value') return e.setMaster(faderGain(x));
      if (phase !== 'down') return;
      const pos = gainToPos(e.masterGain()) + (t.action === 'up' ? 0.03 : -0.03);
      e.setMaster(faderGain(Math.max(0, Math.min(1, pos))));
      return;
    }
    if (t.kind === 'layer') {
      if (!e.layerNames.has(t.name) && !d.layer(t.name)) return;
      if (t.action === 'gain') {
        if (phase === 'value') d.setLayerGain(t.name, faderGain(x));
        return;
      }
      const isOn = () => (t.action === 'mute' ? e.isMuted(t.name) : e.isSolo(t.name));
      const set = (on) => (t.action === 'mute' ? d.toggleMute(t.name, on) : d.toggleSolo(t.name, on));
      if (phase === 'value') {
        // a CC button: 127 on, 0 off
        set(x >= 0.5);
        return;
      }
      if (m.mode === 'hold') {
        if (phase !== 'down' || repeat) return;
        const before = isOn();
        set(!before);
        return () => set(before);
      }
      if (phase === 'down' && !repeat) set(!isOn());
      return;
    }
    if (t.kind === 'control') {
      const c = d.control(t.key);
      if (!c) return;
      if (phase === 'value') {
        d.setControlNormalized(t.key, x);
        return;
      }
      if (phase !== 'down') return;
      if (t.action === 'up' || t.action === 'next') d.nudgeControl(t.key, +1, m.amount ?? 0.05);
      else if (t.action === 'down' || t.action === 'prev') d.nudgeControl(t.key, -1, m.amount ?? 0.05);
      else if (t.action === 'hold') {
        if (repeat) return;
        const before = d.value(t.key);
        d.setControl(t.key, m.value ?? c.max);
        return () => d.setControl(t.key, before);
      } else if (t.action === 'jump') {
        if (!repeat) d.setControl(t.key, m.value ?? c.max);
      }
    }
  }

  // ---- MIDI ----------------------------------------------------------------------
  get midiSupported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }
  async enableMidi() {
    if (!this.midiSupported) throw new Error('This browser has no Web MIDI. Use Chrome or Edge.');
    if (this.midi) return this.midi;
    this.midi = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => {
      this.midiInputs = [];
      this.midi.inputs.forEach((inp) => {
        inp.onmidimessage = (ev) => this.midiMessage(ev, inp);
        this.midiInputs.push(inp);
      });
      this.emit('midi-ports', { inputs: this.midiInputs.map((i) => i.name) });
    };
    this.midi.onstatechange = bind;
    bind();
    return this.midi;
  }
  midiMessage(ev, inp) {
    const [status, d1, d2 = 0] = ev.data;
    const type = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    let src = null;
    let phase = 'down';
    let x = null;
    if (type === 0xb0) {
      src = { type: 'midi', kind: 'cc', ch, num: d1 };
      phase = 'value';
      x = d2 / 127;
    } else if (type === 0x90 && d2 > 0) {
      src = { type: 'midi', kind: 'note', ch, num: d1 };
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      src = { type: 'midi', kind: 'note', ch, num: d1 };
      phase = 'up';
    }
    if (!src) return;
    this.emit('midi-activity', { src, port: inp.name, x });
    if (this.learning) {
      const acc = this.learning.accept;
      if (phase === 'up' || !(acc.includes('midi') || acc.includes(src.kind))) return;
      this.finishLearn(src);
      return;
    }
    const maps = this.deck.mappings().filter((m) => sameSource(m.src, src));
    const key = `${ch}:${d1}`;
    if (phase === 'up') {
      const list = this.noteHolds.get(key);
      if (list) {
        this.noteHolds.delete(key);
        for (const release of list) release();
      }
      return;
    }
    for (const m of maps) {
      const release = this.trigger(m, { phase, x });
      if (release) {
        const list = this.noteHolds.get(key) || [];
        list.push(release);
        this.noteHolds.set(key, list);
      }
    }
    if (maps.length) this.emit('triggered', { src, maps });
  }
}

/** Fader taper shared by strips, master and MIDI: position 0..1 -> gain 0..1.5 (unity at ~0.82). */
export function faderGain(pos) {
  return 1.5 * pos * pos;
}
export function gainToPos(g) {
  return Math.sqrt(Math.max(0, g) / 1.5);
}
export function gainToDb(g) {
  if (g <= 0.0001) return '−∞';
  const db = 20 * Math.log10(g);
  return `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`;
}
