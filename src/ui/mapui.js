// Map mode: a popover per control to bind keys and MIDI, plus the MIDI panel.
import { h, clear, toast } from './dom.js';
import { describeSource } from '../input.js';

export class MapUI {
  constructor(app) {
    this.app = app;
    this.pop = null;
    this.spec = null;
    this.anchor = null;
    this.learningRow = null;
    app.deck.addEventListener('mappings', () => this.pop && this.render());
  }

  /** Rows of bindable actions for a target spec like 'layer:kick', 'control:HARD', 'scene:2', 'master'. */
  rowsFor(spec) {
    const [kind, arg] = spec.split(':');
    const { deck } = this.app;
    const KEYS = ['key', 'note'];
    if (kind === 'layer') {
      return {
        title: `Layer ${arg}`,
        rows: [
          { label: 'Mute', target: { kind: 'layer', name: arg, action: 'mute' }, accept: ['key', 'note', 'cc'], modes: true },
          { label: 'Solo', target: { kind: 'layer', name: arg, action: 'solo' }, accept: ['key', 'note', 'cc'], modes: true },
          { label: 'Level (MIDI fader)', target: { kind: 'layer', name: arg, action: 'gain' }, accept: ['cc'] },
        ],
      };
    }
    if (kind === 'control') {
      const c = deck.control(arg);
      if (!c) return null;
      if (c.step) {
        return {
          title: c.label,
          rows: [
            { label: c.kind === 'switch' ? 'Next position' : 'Step up', target: { kind: 'control', key: arg, action: 'next' }, accept: KEYS },
            { label: c.kind === 'switch' ? 'Previous position' : 'Step down', target: { kind: 'control', key: arg, action: 'prev' }, accept: KEYS },
            { label: 'Jump to a value', target: { kind: 'control', key: arg, action: 'jump' }, accept: KEYS, value: true },
            { label: 'MIDI knob or fader', target: { kind: 'control', key: arg, action: 'set' }, accept: ['cc'] },
          ],
        };
      }
      return {
        title: c.label,
        rows: [
          { label: 'Up', target: { kind: 'control', key: arg, action: 'up' }, accept: KEYS, amount: true },
          { label: 'Down', target: { kind: 'control', key: arg, action: 'down' }, accept: KEYS, amount: true },
          { label: 'Hold: go to a value while held', target: { kind: 'control', key: arg, action: 'hold' }, accept: KEYS, value: true },
          { label: 'MIDI knob or fader', target: { kind: 'control', key: arg, action: 'set' }, accept: ['cc'] },
        ],
      };
    }
    if (kind === 'scene') {
      const i = Number(arg);
      return {
        title: `Scene ${i + 1} · ${deck.deck.scenes[i].name}`,
        rows: [
          { label: 'Recall', target: { kind: 'scene', index: i, action: 'recall' }, accept: KEYS },
          { label: 'Store', target: { kind: 'scene', index: i, action: 'store' }, accept: KEYS },
        ],
      };
    }
    if (kind === 'master') {
      return {
        title: 'Master',
        rows: [
          { label: 'Up', target: { kind: 'master', action: 'up' }, accept: KEYS },
          { label: 'Down', target: { kind: 'master', action: 'down' }, accept: KEYS },
          { label: 'MIDI fader', target: { kind: 'master', action: 'set' }, accept: ['cc'] },
        ],
      };
    }
    if (kind === 'transport') {
      return {
        title: arg === 'update' ? 'Update' : 'Play / stop',
        rows: [{ label: arg === 'update' ? 'Update' : 'Play / stop', target: { kind: 'transport', action: arg }, accept: KEYS }],
      };
    }
    return null;
  }

  open(anchor, spec) {
    this.close();
    const def = this.rowsFor(spec);
    if (!def) return;
    this.spec = spec;
    this.anchor = anchor;
    this.pop = h('div', { class: 'popover', role: 'dialog' });
    document.body.append(this.pop);
    anchor.classList.add('mapping-target');
    this.render();
    this.onDoc = (e) => {
      if (this.pop && !this.pop.contains(e.target) && !this.anchorEl()?.contains(e.target) && !e.target.closest?.('[data-map]')) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this.onDoc, true));
  }

  close() {
    this.app.input.cancelLearn();
    this.learningRow = null;
    document.querySelectorAll('.mapping-target').forEach((el) => el.classList.remove('mapping-target'));
    this.pop?.remove();
    this.pop = null;
    if (this.onDoc) document.removeEventListener('pointerdown', this.onDoc, true);
  }

  render() {
    const def = this.rowsFor(this.spec);
    if (!def || !this.pop) return this.close();
    const { deck, input } = this.app;
    clear(this.pop);
    this.pop.append(
      h('div', { class: 'pop-head' }, h('span', { class: 'pop-title' }, def.title), h('button', { class: 'x', type: 'button', title: 'Close', onClick: () => this.close() }, '×')),
    );
    def.rows.forEach((row, ri) => {
      const maps = deck.mappingsFor(row.target);
      const learning = this.learningRow === ri;
      const wantsMidi = row.accept.some((a) => a !== 'key');
      const onlyMidi = !row.accept.includes('key');
      const binds = maps.map((m) =>
        h(
          'span',
          { class: `bind ${m.src.type}` },
          h('span', { class: 'kbd' }, describeSource(m.src)),
          row.modes && m.src.type !== 'midi' || (row.modes && m.src.kind === 'note')
            ? h(
                'button',
                { class: `mode${m.mode === 'hold' ? ' on' : ''}`, type: 'button', title: 'toggle: press to switch · hold: only while held', onClick: () => deck.updateMapping(m.id, { mode: m.mode === 'hold' ? 'toggle' : 'hold' }) },
                m.mode === 'hold' ? 'hold' : 'toggle',
              )
            : null,
          row.value
            ? h('input', {
                class: 'bind-value',
                type: 'number',
                step: 'any',
                title: 'value',
                value: String(m.value ?? deck.control(row.target.key)?.max ?? 1),
                onChange: (e) => deck.updateMapping(m.id, { value: Number(e.target.value) }),
                onKeydown: (e) => e.stopPropagation(),
              })
            : null,
          row.amount
            ? h(
                'select',
                { class: 'bind-amount', title: 'step per press', onChange: (e) => deck.updateMapping(m.id, { amount: Number(e.target.value) }) },
                [0.01, 0.02, 0.05, 0.1, 0.25].map((a) => h('option', { value: a, selected: (m.amount ?? 0.05) === a }, `${Math.round(a * 100)}%`)),
              )
            : null,
          h('button', { class: 'x', type: 'button', title: 'Remove', onClick: () => deck.removeMapping(m.id) }, '×'),
        ),
      );
      const learnBtn = h(
        'button',
        {
          class: `btn small${learning ? ' learning' : ''}`,
          type: 'button',
          onClick: async () => {
            if (learning) {
              input.cancelLearn();
              return;
            }
            if (wantsMidi && !input.midi && onlyMidi) {
              try {
                await input.enableMidi();
              } catch (e) {
                return toast(e.message, 'error');
              }
            }
            this.learningRow = ri;
            this.render();
            const src = await input.learn(row.accept);
            this.learningRow = null;
            if (src) {
              const extra = {};
              if (row.modes) extra.mode = 'toggle';
              if (row.value) extra.value = deck.control(row.target.key)?.max ?? 1;
              deck.addMapping(src, row.target, extra);
              toast(`${describeSource(src)} → ${def.title} · ${row.label}`);
            }
            if (this.pop) this.render();
          },
        },
        learning ? (onlyMidi ? 'Move a MIDI control…' : 'Press a key…') : 'Learn',
      );
      this.pop.append(
        h(
          'div',
          { class: `pop-row${learning ? ' learning' : ''}` },
          h('div', { class: 'pop-label' }, row.label, onlyMidi ? h('span', { class: 'muted' }, ' · MIDI') : null),
          h('div', { class: 'pop-binds' }, binds.length ? binds : h('span', { class: 'muted' }, 'not mapped'), learnBtn),
        ),
      );
    });
    const tips = [];
    if (def.rows.some((r) => r.accept.includes('key'))) tips.push('Keys: any key, optionally with Shift or Option. Esc cancels.');
    if (!input.midi) {
      tips.push(
        h('span', {}, 'MIDI: ', h('button', { class: 'linkish', type: 'button', onClick: async () => {
          try {
            await input.enableMidi();
            this.render();
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, 'turn on MIDI'), ' to learn knobs, faders and pads.'),
      );
    }
    this.pop.append(h('div', { class: 'pop-tips' }, tips.map((t) => h('div', {}, t))));
    this.place();
  }

  /** The element the popover belongs to; the deck may have re-rendered it since the popover opened. */
  anchorEl() {
    if (!this.anchor?.isConnected && this.spec) {
      const el = document.querySelector(`[data-map="${CSS.escape(this.spec)}"]`);
      if (el) {
        this.anchor = el;
        el.classList.add('mapping-target');
      }
    }
    return this.anchor;
  }

  place() {
    const anchor = this.anchorEl();
    if (!anchor?.isConnected) return this.close();
    const r = anchor.getBoundingClientRect();
    const p = this.pop;
    const w = p.offsetWidth;
    const hgt = p.offsetHeight;
    let top = r.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
    p.style.top = `${top}px`;
    p.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  }

  refreshLearning() {
    document.body.classList.toggle('learning', !!this.app.input.learning);
  }

  async midiPanel(anchor) {
    const { input } = this.app;
    if (!input.midiSupported) return toast('This browser has no Web MIDI. Chrome or Edge on a Mac works.', 'error');
    try {
      await input.enableMidi();
    } catch (e) {
      return toast(`MIDI was not allowed: ${e.message}`, 'error');
    }
    const names = input.midiInputs.map((i) => i.name);
    toast(names.length ? `MIDI on: ${names.join(', ')}. In Map mode, click a control and move a knob.` : 'MIDI on, but no controller found. Plug one in; it shows up here.');
    void anchor;
  }
}
