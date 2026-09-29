// Guide drawer: how the deck works, Strudel concepts, a searchable function reference, keys, links.
import { parse as acornParse } from 'acorn';
import { Pattern, code2hash } from '@strudel/core';
import { h, clear, toast, confirmBox } from './dom.js';
import { describeSource } from '../input.js';
import { analyze, appendLayer, replaceLayer } from '../parse.js';
import { DECK, CONCEPTS, KEYS_STATIC, LINKS } from '../guide/content.js';
import REF from '../guide/reference.json';

const TRY = 'tryout'; // the layer examples are added as

const TABS = [
  ['deck', 'Deck'],
  ['concepts', 'Concepts'],
  ['ref', 'Reference'],
  ['keys', 'Keys'],
  ['links', 'Links'],
];

export class Guide {
  constructor(app) {
    this.app = app;
    this.tab = 'deck';
    this.refIndex = new Map();
    for (const e of REF) {
      this.refIndex.set(e.name, e);
      for (const s of e.syn || []) if (!this.refIndex.has(s)) this.refIndex.set(s, e);
    }
    this.cats = [...new Set(REF.map((e) => e.cat))].sort();
    this.query = '';
    this.cat = '';
    this.current = null;

    this.tabBtns = TABS.map(([id, label]) => h('button', { class: 'tab', type: 'button', onClick: () => this.open(id) }, label));
    this.body = h('div', { class: 'guide-body' });
    this.el = h(
      'aside',
      { class: 'guide', hidden: true, 'aria-label': 'Guide' },
      h('div', { class: 'guide-head' }, h('div', { class: 'tabs' }, this.tabBtns), h('button', { class: 'x', type: 'button', title: 'Close (Esc)', onClick: () => this.close() }, '×')),
      this.body,
    );
    document.body.append(this.el);
    app.deck.addEventListener('mappings', () => this.tab === 'keys' && this.isOpen && this.render());
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && app.input.keysActive && !app.input.learning) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }
  toggle() {
    this.isOpen ? this.close() : this.open(this.tab);
  }
  open(tab = this.tab) {
    this.tab = tab;
    this.el.hidden = false;
    this.app.L.guideBtn.classList.add('on');
    this.tabBtns.forEach((b, i) => b.classList.toggle('on', TABS[i][0] === tab));
    this.render();
  }
  close() {
    this.el.hidden = true;
    this.app.L.guideBtn.classList.remove('on');
  }

  hasRef(name) {
    return this.refIndex.has(name);
  }
  showRef(name) {
    this.current = this.refIndex.get(name) || null;
    this.query = this.current ? '' : name;
    this.open('ref');
  }

  render() {
    const b = this.body;
    clear(b);
    b.scrollTop = 0;
    if (this.tab === 'deck') b.append(h('div', { class: 'prose', html: DECK }));
    if (this.tab === 'concepts') b.append(h('div', { class: 'prose', html: CONCEPTS }));
    if (this.tab === 'links') b.append(h('div', { class: 'prose', html: LINKS }));
    if (this.tab === 'keys') this.renderKeys();
    if (this.tab === 'ref') this.renderRef();
    this.decorate(b);
  }

  // ---- examples: Try / strudel.cc ------------------------------------------------------------
  decorate(root) {
    root.querySelectorAll('pre.ex').forEach((pre) => {
      if (pre.dataset.done) return;
      pre.dataset.done = '1';
      const src = pre.textContent;
      const bar = h(
        'div',
        { class: 'ex-bar' },
        tryable(src)
          ? h('button', { class: 'btn small primary', type: 'button', title: `Add as a soloed layer called ${TRY}, and play`, onClick: () => this.tryCode(src) }, 'Try')
          : null,
        h('a', { class: 'btn small', href: `https://strudel.cc/#${code2hash(src)}`, target: '_blank', rel: 'noopener', title: 'Open this example on strudel.cc' }, 'strudel.cc'),
      );
      pre.after(bar);
    });
  }

  async tryCode(src) {
    const { deck, engine } = this.app;
    if (this.app.locked) return toast('Locked: unlock to try examples');
    const expr = src.replace(/^\s*\/\/.*$/gm, '').trim();
    const code = engine.code;
    const m = analyze(code);
    if (!m.ok) return toast('Fix the error in the code first; examples are added to it', 'error');
    const exists = m.layers.some((l) => l.name === TRY);
    const next = exists ? replaceLayer(code, TRY, `${TRY}: ${expr}`) : appendLayer(code, TRY, expr);
    if (next == null) return;
    engine.store.set(`solo:${TRY}`, true);
    await deck.applyCode(next);
    if (!engine.started) await engine.evaluate();
    toast(`Playing the example alone as layer "${TRY}". Clear solo to hear it with the rest; delete it from its strip when done.`);
  }

  // ---- reference --------------------------------------------------------------------------
  renderRef() {
    const b = this.body;
    const search = h('input', {
      class: 'field',
      type: 'search',
      placeholder: 'Search functions (lpf, euclid, room…)',
      value: this.query,
      onInput: (e) => {
        this.query = e.target.value;
        this.current = null;
        this.fillList(list);
      },
      onKeydown: (e) => {
        if (e.key === 'Enter') {
          const first = list.querySelector('.ref-item');
          first?.click();
        }
        e.stopPropagation();
      },
    });
    const catSel = h(
      'select',
      {
        class: 'field',
        onChange: (e) => {
          this.cat = e.target.value;
          this.current = null;
          this.fillList(list);
        },
      },
      h('option', { value: '' }, 'All categories'),
      this.cats.map((c) => h('option', { value: c, selected: c === this.cat }, c)),
    );
    const list = h('div', { class: 'ref-list' });
    b.append(h('div', { class: 'ref-tools' }, search, catSel), list);
    this.fillList(list);
    if (!this.current) setTimeout(() => search.focus());
  }

  fillList(list) {
    clear(list);
    if (this.current) {
      list.append(this.entryView(this.current));
      this.decorate(list);
      return;
    }
    const q = this.query.trim().toLowerCase();
    let items = REF.filter((e) => !this.cat || e.cat === this.cat);
    if (q) {
      const score = (e) => {
        const n = e.name.toLowerCase();
        if (n === q || e.syn.some((s) => s.toLowerCase() === q)) return 0;
        if (n.startsWith(q)) return 1;
        if (n.includes(q) || e.syn.some((s) => s.toLowerCase().includes(q))) return 2;
        if (e.desc.toLowerCase().includes(q)) return 3;
        return 9;
      };
      items = items.map((e) => [score(e), e]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, e]) => e);
    }
    if (!items.length) {
      list.append(h('p', { class: 'muted' }, `Nothing found for "${this.query}".`));
      return;
    }
    let lastCat = null;
    for (const e of items.slice(0, 250)) {
      if (!q && e.cat !== lastCat) {
        lastCat = e.cat;
        list.append(h('div', { class: 'ref-cat' }, e.cat));
      }
      const first = e.desc.replace(/<[^>]+>/g, '').split(/(?<=[.!?])\s/)[0];
      list.append(
        h(
          'button',
          {
            class: 'ref-item',
            type: 'button',
            onClick: () => {
              this.current = e;
              this.fillList(list);
              this.body.scrollTop = 0;
            },
          },
          h('span', { class: 'ref-name' }, e.name),
          e.syn.length ? h('span', { class: 'ref-syn' }, e.syn.join(', ')) : null,
          h('span', { class: 'ref-first' }, first),
        ),
      );
    }
  }

  entryView(e) {
    const available = typeof globalThis[e.name] !== 'undefined' || typeof Pattern.prototype[e.name] === 'function';
    return h(
      'div',
      { class: 'ref-entry prose' },
      h('button', { class: 'linkish', type: 'button', onClick: () => { this.current = null; this.render(); } }, '← all functions'),
      h('h2', {}, e.name, e.dep ? h('span', { class: 'tag' }, 'deprecated') : null),
      h('div', { class: 'ref-meta' }, e.cat, e.syn.length ? ` · also: ${e.syn.join(', ')}` : ''),
      available ? null : h('p', { class: 'warn' }, 'Not in the Strudel version this deck runs; the example may only work on strudel.cc.'),
      h('div', { html: e.desc }),
      e.params.length
        ? h(
            'table',
            { class: 'conv' },
            e.params.map((p) => h('tr', {}, h('td', {}, h('code', {}, p.name), p.type ? h('div', { class: 'muted small' }, p.type) : null), h('td', { html: p.desc || '' }))),
          )
        : null,
      e.ex.length ? h('h3', {}, e.ex.length > 1 ? 'Examples' : 'Example') : null,
      e.ex.map((x) => h('pre', { class: 'ex' }, x)),
    );
  }

  // ---- keys ---------------------------------------------------------------------------------
  renderKeys() {
    const { deck } = this.app;
    const b = this.body;
    const maps = deck.mappings();
    const groups = [
      ['transport', 'Transport'],
      ['scene', 'Scenes'],
      ['layer', 'Layers'],
      ['control', 'Controls'],
      ['master', 'Master'],
    ];
    const describe = (m) => {
      const t = m.target;
      const mode = m.mode === 'hold' ? ' (while held)' : '';
      if (t.kind === 'transport') return t.action === 'toggle' ? 'Play / stop' : t.action === 'update' ? 'Update' : t.action;
      if (t.kind === 'scene') return `${t.action === 'store' ? 'Store' : 'Recall'} scene ${t.index + 1} · ${deck.deck.scenes[t.index]?.name ?? ''}`;
      if (t.kind === 'layer') return `${t.action === 'gain' ? 'Level' : t.action === 'mute' ? 'Mute' : 'Solo'} ${t.name}${mode}`;
      if (t.kind === 'master') return `Master ${t.action === 'set' ? 'level' : t.action}`;
      if (t.kind === 'control') {
        const verb = { up: 'up', down: 'down', next: 'next', prev: 'previous', set: 'knob', hold: `hold → ${m.value}`, jump: `jump → ${m.value}` }[t.action] || t.action;
        return `${t.key} ${verb}`;
      }
      return JSON.stringify(t);
    };
    b.append(
      h('div', { class: 'prose' },
        h('h2', {}, 'Keys and MIDI'),
        h('p', {}, 'Mappings for this song. Add or change them with Map: click any strip, control, scene or the master.'),
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn small', type: 'button', disabled: this.app.locked, onClick: async () => {
            if (await confirmBox('Reset to the default keys?', 'Every key and MIDI mapping of this song is replaced by the defaults.', { okLabel: 'Reset' })) {
              deck.resetMappings();
              toast('Default keys restored');
            }
          } }, 'Reset to default keys'),
          h('button', { class: 'btn small danger', type: 'button', disabled: this.app.locked, onClick: async () => {
            if (await confirmBox('Clear all mappings?', 'Every key and MIDI mapping of this song is removed.', { okLabel: 'Clear all', danger: true })) {
              deck.clearMappings();
              toast('All mappings cleared');
            }
          } }, 'Clear all'),
          h('button', { class: 'btn small', type: 'button', disabled: this.app.locked, onClick: () => { this.close(); this.app.setMapMode(true); } }, 'Open Map mode'),
        ),
      ),
    );
    for (const [kind, title] of groups) {
      const list = maps.filter((m) => m.target.kind === kind);
      if (!list.length) continue;
      b.append(
        h('div', { class: 'prose' }, h('h3', {}, title)),
        h(
          'div',
          { class: 'keys-list' },
          list.map((m) =>
            h(
              'div',
              { class: 'keys-row' },
              h('span', { class: `kbd ${m.src.type}` }, describeSource(m.src)),
              h('span', { class: 'keys-desc' }, describe(m)),
              h('button', { class: 'x', type: 'button', title: 'Remove', disabled: this.app.locked, onClick: () => deck.removeMapping(m.id) }, '×'),
            ),
          ),
        ),
      );
    }
    if (!maps.length) b.append(h('p', { class: 'muted prose' }, 'No mappings. Reset to default keys, or use Map.'));
    b.append(h('div', { class: 'prose', html: KEYS_STATIC }));
  }
}

/** Examples that can be dropped in as one layer: a single expression, no tempo or sample loading. */
export function tryable(src) {
  if (/\b(setcpm|setcps|setCpm|setCps|samples|hush|all|each)\s*\(/.test(src)) return false;
  try {
    const ast = acornParse(src, { ecmaVersion: 2022, allowAwaitOutsideFunction: true });
    return ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement';
  } catch {
    return false;
  }
}
