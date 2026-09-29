// Layer inspector: edit one layer's code on its own, listen to it alone, see what it uses.
import { initEditor } from '@strudel/codemirror';
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import { h, clear, toast, ask, confirmBox } from './dom.js';
import { checkLayerText, layerText, layerNameProblem } from '../parse.js';

export class Inspector {
  constructor(app) {
    this.app = app;
    this.name = null;
    this.dirty = false;
    this.setting = false;
    this.locked = false;
    this.readOnly = new Compartment();
    const host = app.L.inspectorHost;

    this.title = h('h2', { class: 'insp-name' });
    this.state = h('span', { class: 'insp-state' });
    this.btnListen = h('button', { class: 'btn', type: 'button', title: 'Solo this layer (only soloed layers play)', onClick: () => this.app.deck.toggleSolo(this.name) }, 'Listen alone');
    this.btnMute = h('button', { class: 'btn', type: 'button', title: 'Mute on the deck', onClick: () => this.app.deck.toggleMute(this.name) }, 'Mute');
    this.btnCode = h('button', { class: 'btn', type: 'button', title: "Strudel's own switch: _name: stops the pattern (saves CPU)", onClick: () => this.toggleCodeMute() }, 'Off in code');
    this.btnSafe = h('button', { class: 'btn', type: 'button', title: 'Keep this layer playing while other layers are soloed (useful for a sidechain trigger)', onClick: () => this.app.engine.setSoloSafe(this.name, !this.app.engine.soloSafe.has(this.name)) }, 'Solo-safe');
    this.btnDup = h('button', { class: 'btn', type: 'button', title: 'Copy this layer under a new name', onClick: () => this.duplicate() }, 'Duplicate');
    this.btnRename = h('button', { class: 'btn', type: 'button', title: 'Rename the layer (its label)', onClick: () => this.rename() }, 'Rename');
    this.btnDelete = h('button', { class: 'btn danger', type: 'button', title: 'Remove this layer from the code', onClick: () => this.remove() }, 'Delete');
    this.editorRoot = h('div', { class: 'insp-editor' });
    this.btnApply = h('button', { class: 'btn primary', type: 'button', title: 'Put this layer back into the code and update (Ctrl/Cmd+Enter)', onClick: () => this.apply() }, 'Apply');
    this.btnRevert = h('button', { class: 'btn', type: 'button', title: 'Throw away edits in this box', onClick: () => this.load() }, 'Revert');
    this.msg = h('span', { class: 'insp-msg' });
    this.meta = h('div', { class: 'insp-meta' });

    host.append(
      h(
        'div',
        { class: 'insp' },
        h('div', { class: 'insp-head' }, h('div', { class: 'insp-titlebar' }, this.title, this.state), h('div', { class: 'insp-buttons' }, this.btnListen, this.btnMute, this.btnSafe, this.btnCode, this.btnDup, this.btnRename, this.btnDelete)),
        h('div', { class: 'insp-hint' }, 'This is the layer as it stands in the code. Change it here, then Apply: the deck swaps it in on the next cycle.'),
        this.editorRoot,
        h('div', { class: 'insp-actions' }, this.btnApply, this.btnRevert, this.msg),
        this.meta,
      ),
    );

    this.view = initEditor({
      root: this.editorRoot,
      initialCode: '',
      onChange: (v) => {
        if (!v.docChanged || this.setting) return;
        this.setDirty(true);
      },
      onEvaluate: () => this.apply(),
      onStop: () => this.app.engine.stop(),
    });
    this.editorRoot.style.fontSize = '14px';
    this.view.dispatch({ effects: StateEffect.appendConfig.of(this.readOnly.of(EditorState.readOnly.of(false))) });

    app.engine.addEventListener('layer', (e) => {
      if (!e.detail.name || e.detail.name === this.name) this.renderState();
    });
    app.engine.addEventListener('code-edited', (e) => {
      // values written back by the deck: keep this box in step unless the user is typing here
      if (e.detail.fromDeck && this.name && !this.dirty) this.load(true);
    });
  }

  get open_() {
    return !!this.name;
  }

  open(name) {
    const same = name === this.name;
    if (!same && this.dirty && this.name) {
      // keep it simple: switching layers drops unapplied edits, but say so
      toast(`Edits to ${this.name} were not applied`);
    }
    this.name = name;
    const tab = this.app.L.tabLayer;
    tab.hidden = false;
    tab.textContent = `Layer: ${name}`;
    this.app.showTab('layer');
    if (!same || !this.dirty) this.load();
    this.refresh();
  }

  close() {
    this.name = null;
    this.setDirty(false);
    this.app.L.tabLayer.hidden = true;
    this.app.showTab('code');
  }

  setDirty(on) {
    this.dirty = on;
    this.btnApply.classList.toggle('dirty', on);
    if (on) this.msg.textContent = 'not applied yet';
    else if (this.msg.textContent === 'not applied yet') this.msg.textContent = '';
  }

  setText(text) {
    this.setting = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    this.setting = false;
  }

  load(quiet = false) {
    if (!this.name) return;
    const text = layerText(this.app.engine.code, this.name);
    if (text == null) {
      if (!quiet) this.msg.textContent = 'This layer is not in the code (it may be created by a function).';
      this.setText('');
      return;
    }
    this.setText(text);
    this.setDirty(false);
    if (!quiet) this.msg.textContent = '';
  }

  async apply() {
    if (!this.name || this.locked) return true;
    const text = this.view.state.doc.toString();
    const check = checkLayerText(text);
    if (!check.ok) {
      this.msg.textContent = check.line ? `Line ${check.line}: ${check.message}` : check.message;
      this.msg.className = 'insp-msg error';
      return true;
    }
    this.msg.className = 'insp-msg';
    // a new label must not take another layer's name (Strudel would play only one of them)
    const label = check.label;
    if (!label.includes('$')) {
      const wanted = label.replace(/^_+|_+$/g, '').replace(/^S(?=.)/, '');
      const current = this.app.deck.analysis?.layers?.find((l) => l.name === this.name);
      const clash = (this.app.deck.analysis?.layers || []).some((l) => l !== current && (l.name === wanted || l.label.replace(/^_+|_+$/g, '') === wanted));
      const problem = wanted !== this.name && (clash ? `A layer called ${wanted} already exists.` : layerNameProblem(wanted));
      if (problem) {
        this.msg.textContent = problem;
        this.msg.className = 'insp-msg error';
        return true;
      }
    }
    try {
      // a changed label renames the layer; the deck carries its fader, mutes, scenes and keys over
      await this.app.deck.replaceLayer(this.name, text);
    } catch (e) {
      this.msg.textContent = e.message;
      this.msg.className = 'insp-msg error';
      return true;
    }
    this.setDirty(false);
    this.msg.textContent = this.app.error ? '' : 'applied';
    this.open(this.name);
    return true;
  }

  /** The deck renamed layers (label edits, $: renumbering): keep showing the same layer. */
  followRename(map) {
    if (!this.name || !map.has(this.name)) return;
    this.name = map.get(this.name);
    this.app.L.tabLayer.textContent = `Layer: ${this.name}`;
    this.title.textContent = this.name;
  }

  async toggleCodeMute() {
    const l = this.app.deck.layer(this.name);
    if (!l) return;
    try {
      await this.app.deck.setCodeMute(this.name, !l.codeMuted);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  duplicate() {
    const n = this.app.deck.duplicateLayer(this.name);
    if (n) setTimeout(() => this.app.inspect(n), 250);
  }
  async rename() {
    const n = await ask(`Rename ${this.name}`, this.name.startsWith('$') ? '' : this.name);
    if (!n || n === this.name) return;
    try {
      await this.app.deck.renameLayer(this.name, n);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async remove() {
    if (!(await confirmBox(`Delete ${this.name}?`, 'The layer is removed from the code. Undo with Cmd+Z in the code.', { okLabel: 'Delete', danger: true }))) return;
    await this.app.deck.deleteLayer(this.name);
    this.close();
  }

  setLocked(on) {
    this.locked = on;
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(on)) });
    for (const b of [this.btnCode, this.btnDup, this.btnRename, this.btnDelete, this.btnApply, this.btnRevert]) b.disabled = on;
  }

  renderState() {
    if (!this.name) return;
    const { engine, deck } = this.app;
    const l = deck.layer(this.name);
    const muted = engine.isMuted(this.name);
    const soloed = engine.isSolo(this.name);
    let state = 'playing';
    if (!l) state = 'not in the code';
    else if (l.codeMuted) state = 'off in code';
    else if (!engine.started) state = 'stopped';
    else if (muted) state = 'muted';
    else if (engine.anySolo() && !soloed) state = 'silent (another layer is soloed)';
    this.state.textContent = state;
    this.state.className = `insp-state ${state.split(' ')[0]}`;
    this.btnListen.classList.toggle('on', soloed);
    this.btnListen.textContent = soloed ? 'Listening alone' : 'Listen alone';
    this.btnMute.classList.toggle('on', muted);
    this.btnCode.textContent = l?.codeMuted ? 'Turn on in code' : 'Off in code';
    this.btnMute.disabled = !!l?.codeMuted;
    this.btnListen.disabled = !!l?.codeMuted;
    const safe = engine.soloSafe.has(this.name);
    this.btnSafe.classList.toggle('on-safe', safe);
    this.btnSafe.textContent = safe ? 'Solo-safe ✓' : 'Solo-safe';
  }

  refresh() {
    if (!this.name) return;
    if (!this.dirty) this.load(true);
    this.title.textContent = this.name;
    this.renderState();
    const { deck } = this.app;
    const l = deck.layer(this.name);
    clear(this.meta);
    this.app.inspectorCtls = new Map();
    if (!l) return;
    const controls = (l.controls || []).map((k) => deck.control(k)).filter(Boolean);
    // this layer's own controls first, shared ones after
    controls.sort((a, b) => (a.usedBy.length > 1) - (b.usedBy.length > 1));
    const own = controls.filter((c) => c.usedBy.length <= 1);
    const shared = controls.filter((c) => c.usedBy.length > 1);
    if (own.length) this.meta.append(section('Controls of this layer', own.map((c) => this.app.renderControl(c, { compact: true }))));
    if (shared.length) this.meta.append(section('Shared controls it follows', shared.map((c) => this.app.renderControl(c, { compact: true }))));
    if (!controls.length) this.meta.append(section('Controls', h('p', { class: 'muted' }, 'This layer uses no slider(). Add one, e.g. ', h('code', {}, '.lpf(slider(800, 100, 5000))'), ', to get a control.')));

    const ref = this.app.guide;
    const fnChips = (l.functions || []).map((f) => {
      const known = ref.hasRef(f);
      const custom = (l.helpersUsed || []).includes(f);
      return h(
        'button',
        {
          class: `chip fn${known ? '' : ' unknown'}${custom ? ' custom' : ''}`,
          type: 'button',
          title: custom ? `${f}: defined in this song (register)` : known ? `What does ${f} do?` : `${f}: not in the Strudel reference`,
          onClick: () => (custom ? this.jumpTo(f) : ref.showRef(f)),
        },
        f,
      );
    });
    if (fnChips.length) this.meta.append(section('Functions (click for the reference)', h('div', { class: 'chips' }, fnChips)));
    const uses = [...(l.uses || []), ...(l.helpersUsed || [])];
    if (uses.length) {
      this.meta.append(
        section(
          'Also uses (click to find it in the code)',
          h('div', { class: 'chips' }, uses.map((u) => h('button', { class: 'chip def', type: 'button', onClick: () => this.jumpTo(u) }, u))),
        ),
      );
    }
  }

  /** Show a definition in the full code. */
  jumpTo(name) {
    const a = this.app.deck.analysis;
    const d = a?.defs?.get(name) || a?.helpers?.get(name);
    if (!d) return toast(`${name} is not defined at the top level`);
    this.app.showTab('code');
    const view = this.app.engine.view;
    view.dispatch({ selection: { anchor: d.from, head: d.to }, scrollIntoView: true });
    view.focus();
  }
}

function section(title, content) {
  return h('div', { class: 'insp-sec' }, h('div', { class: 'insp-sec-title' }, title), content);
}
