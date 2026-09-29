// The deck UI: top bar, code pane, scenes, mixer strips and control sections.
import { h, clear, toast, download, pickFile, menu, ask, confirmBox, clamp } from './dom.js';
import { createFader, createHFader, createSlider, createSwitch, createStepper } from './widgets.js';
import { describeSource, gainToDb, faderGain, gainToPos } from '../input.js';
import { FADES } from '../deck.js';
import { layerNameProblem } from '../parse.js';
import { Inspector } from './inspector.js';
import { MapUI } from './mapui.js';
import { Guide } from './guide.js';

const HUES = [24, 200, 145, 285, 48, 330, 172, 95, 240, 5, 62, 262];
export const sectionColor = (i) => (i == null || i < 0 ? 'hsl(220 12% 62%)' : `hsl(${HUES[i % HUES.length]} 82% 62%)`);

export function buildLayout(root) {
  const L = {};
  L.songBtn = h('button', { class: 'song-btn', type: 'button', title: 'Songs: switch, new, import, export, share' }, h('span', { class: 'song-name' }, '…'), h('span', { class: 'caret' }, '▾'));
  L.playBtn = h('button', { class: 'play-btn', type: 'button', title: 'Play / stop (Space)', 'data-map': 'transport:toggle' }, h('span', { class: 'play-icon' }), h('span', { class: 'play-label' }, 'Play'));
  L.updateBtn = h('button', { class: 'btn update-btn', type: 'button', title: 'Apply code changes (Cmd+Enter in the editor also plays)', 'data-map': 'transport:update' }, 'Update');
  L.bpmInput = h('input', { class: 'bpm-input', type: 'number', min: 20, max: 400, step: 0.5, title: 'Tempo (rewrites setcpm in the code)' });
  L.pos = h('div', { class: 'pos', title: 'bar . beat' }, h('span', { class: 'pos-bar' }, '1'), h('span', { class: 'pos-beat' }, '.1'));
  L.phrase = h('div', { class: 'phrase', title: '8-bar phrase' }, Array.from({ length: 8 }, () => h('i')));
  L.masterHost = h('div', { class: 'master-fader', 'data-map': 'master' });
  L.masterDb = h('span', { class: 'master-db' }, '0.0');
  L.meterFill = h('div', { class: 'meter-fill' });
  L.meterPeak = h('div', { class: 'meter-peak' });
  L.clip = h('span', { class: 'clip', title: 'Output hit 0 dBFS. Pull the master or layer faders down.' }, 'CLIP');
  L.keysBtn = h('button', { class: 'chip keys-chip', type: 'button', title: 'Keyboard shortcuts are active. While you type in the code they pause; Esc gives them back.' }, 'KEYS');
  L.midiChip = h('span', { class: 'chip midi-chip', title: 'MIDI' }, 'MIDI');
  L.mapBtn = h('button', { class: 'btn toggle', type: 'button', title: 'Map keys and MIDI: click any control, then press a key or move a knob' }, 'Map');
  L.lockBtn = h('button', { class: 'btn toggle', type: 'button', title: 'Perform lock: code, layer edits and songs are locked; faders, keys and scenes still work' }, 'Lock');
  L.codeBtn = h('button', { class: 'btn toggle on', type: 'button', title: 'Show or hide the code' }, 'Code');
  L.guideBtn = h('button', { class: 'btn toggle', type: 'button', title: 'Guide: how the deck works, Strudel concepts, function reference (?)' }, 'Guide');

  L.topbar = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('b', {}, 'STRUDEL'), ' DECK'),
    L.songBtn,
    h('div', { class: 'transport' }, L.playBtn, L.updateBtn, h('label', { class: 'bpm' }, L.bpmInput, h('span', {}, 'BPM')), L.pos, L.phrase),
    h('div', { class: 'spacer' }),
    h(
      'div',
      { class: 'master' },
      h('span', { class: 'label' }, 'Master'),
      L.masterHost,
      L.masterDb,
      h('div', { class: 'meter', title: 'Output peak level' }, L.meterFill, L.meterPeak),
      L.clip,
    ),
    h('div', { class: 'top-tools' }, L.keysBtn, L.midiChip, L.mapBtn, L.lockBtn, L.codeBtn, L.guideBtn),
  );

  L.tabCode = h('button', { class: 'tab on', type: 'button' }, 'Code');
  L.tabLayer = h('button', { class: 'tab', type: 'button', hidden: true }, 'Layer');
  L.editorRoot = h('div', { class: 'editor', id: 'editor' });
  L.inspectorHost = h('div', { class: 'inspector-host', hidden: true });
  L.status = h('div', { class: 'status' });
  L.left = h(
    'section',
    { class: 'pane-left' },
    h('div', { class: 'tabs' }, L.tabCode, L.tabLayer),
    h('div', { class: 'pane-body' }, L.editorRoot, L.inspectorHost),
    L.status,
  );
  L.splitter = h('div', { class: 'splitter', title: 'Drag to resize' });

  L.scenes = h('section', { class: 'scenes' });
  L.mixer = h('section', { class: 'mixer' });
  L.controls = h('section', { class: 'controls' });
  L.deck = h('section', { class: 'pane-deck' }, L.scenes, L.mixer, L.controls);
  L.main = h('main', { class: 'layout' }, L.left, L.splitter, L.deck);
  root.append(L.topbar, L.main);
  return L;
}

export class App {
  constructor({ layout, engine, deck, input }) {
    this.L = layout;
    this.engine = engine;
    this.deck = deck;
    this.input = input;
    this.strips = new Map(); // layer -> refs
    this.ctls = new Map(); // control key -> refs
    this.scenePads = [];
    this.selected = null;
    this.mapMode = false;
    this.locked = false;
    this.lastHit = new Map();
    this.pendingScene = null;
    this.logMsg = null;
    this.error = null;

    this.inspector = new Inspector(this);
    this.mapui = new MapUI(this);
    this.guide = new Guide(this);

    this.wireTopbar();
    this.wireLeftPane();
    this.wireEvents();
    this.applySettings();
    requestAnimationFrame(() => this.tick());
  }

  // ---- wiring --------------------------------------------------------------------------
  wireTopbar() {
    const { L, engine, deck } = this;
    L.playBtn.addEventListener('click', () => engine.toggle());
    L.updateBtn.addEventListener('click', () => deck.update());
    L.bpmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') L.bpmInput.blur();
      if (e.key === 'Escape') {
        this.bpmEditing = false;
        L.bpmInput.blur();
      }
    });
    L.bpmInput.addEventListener('focus', () => (this.bpmEditing = true));
    L.bpmInput.addEventListener('blur', () => {
      const was = this.bpmEditing;
      this.bpmEditing = false;
      this.bpmShown = 0; // show the real tempo again unless it changes below
      const raw = L.bpmInput.value.trim();
      const bpm = Number(raw);
      if (!was || raw === '' || !Number.isFinite(bpm) || Math.abs(bpm - engine.bpm) <= 0.05) return;
      if (this.locked) return toast('Locked: unlock to change the tempo');
      if (bpm < 20 || bpm > 400) return toast('Tempo must be between 20 and 400 BPM', 'error');
      deck.setTempo(bpm).catch((err) => toast(err.message, 'error'));
    });
    this.masterFader = createHFader({
      value: engine.masterGain(),
      title: 'Master level. Double-click: 0 dB. Keys - and = by default.',
      onInput: (g) => engine.setMaster(g),
      onReset: () => engine.setMaster(1),
    });
    L.masterHost.append(this.masterFader.el);
    L.masterHost.addEventListener('click', () => this.select({ kind: 'master' }));
    L.songBtn.addEventListener('click', () => this.songMenu());
    L.keysBtn.addEventListener('click', () => {
      document.activeElement?.blur?.();
      this.updateKeysChip();
    });
    L.midiChip.addEventListener('click', () => this.mapui.midiPanel(L.midiChip));
    L.mapBtn.addEventListener('click', () => this.setMapMode(!this.mapMode));
    L.lockBtn.addEventListener('click', () => this.setLocked(!this.locked));
    L.codeBtn.addEventListener('click', () => this.setCodeVisible(!this.codeVisible));
    L.guideBtn.addEventListener('click', () => this.guide.toggle());
  }

  wireLeftPane() {
    const { L } = this;
    L.tabCode.addEventListener('click', () => this.showTab('code'));
    L.tabLayer.addEventListener('click', () => this.showTab('layer'));
    // resizable split
    L.splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      L.splitter.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const w = clamp(ev.clientX, 260, window.innerWidth - 360);
        document.documentElement.style.setProperty('--code-w', `${w}px`);
        this.deck.settings.codeWidth = w;
      };
      const up = () => {
        L.splitter.removeEventListener('pointermove', move);
        L.splitter.removeEventListener('pointerup', up);
        this.deck.saveSettings();
      };
      L.splitter.addEventListener('pointermove', move);
      L.splitter.addEventListener('pointerup', up);
    });
  }

  wireEvents() {
    const { engine, deck, input } = this;
    deck.addEventListener('song', () => {
      this.L.songBtn.querySelector('.song-name').textContent = deck.song.name;
      document.title = `${deck.song.name} · Strudel Deck`;
      this.masterFader.set(engine.masterGain());
      this.inspector.close();
      this.pendingScene = null;
      this.error = null;
      this.renderStatus();
    });
    deck.addEventListener('renamed', (e) => {
      const { layers } = e.detail;
      if (this.selected?.kind === 'layer' && layers.has(this.selected.name)) this.selected = { kind: 'layer', name: layers.get(this.selected.name) };
      this.inspector.followRename(layers);
    });
    deck.addEventListener('external-change', () =>
      toast('This song was changed in another tab. Saving here will overwrite that change.', 'error'),
    );
    deck.addEventListener('save-failed', () => toast('Could not save in this browser (storage full or blocked). Export the song to keep it.', 'error'));
    deck.addEventListener('model', () => this.renderDeck());
    deck.addEventListener('dirty', () => {
      this.L.updateBtn.classList.toggle('dirty', deck.dirty);
      this.renderStatus();
    });
    deck.addEventListener('scenes', () => this.renderScenes());
    deck.addEventListener('mappings', () => this.renderDeck());
    deck.addEventListener('scene-recalled', (e) => {
      this.pendingScene = { ...e.detail };
      this.renderScenes();
    });
    engine.addEventListener('value', (e) => this.updateControlById(e.detail.id));
    engine.addEventListener('layer', (e) => (e.detail.name ? this.updateStrip(e.detail.name) : this.strips.forEach((_, n) => this.updateStrip(n))));
    engine.addEventListener('master', () => this.masterFader.set(engine.masterGain()));
    engine.addEventListener('transport', (e) => {
      if (!e.detail.started) this.pendingScene = null;
      this.updateTransport();
      this.renderScenes();
    });
    engine.addEventListener('error', (e) => {
      this.error = e.detail.error;
      this.renderStatus();
    });
    engine.addEventListener('evaluated', () => {
      this.error = null;
      this.bpmShown = 0; // refresh the tempo field now
      this.renderStatus();
    });
    engine.addEventListener('log', (e) => {
      const { message, type } = e.detail || {};
      // only problems reach the status line (sample loads and routine messages are skipped)
      if (!message || !(type === 'error' || type === 'warning' || /error|not found|failed|could not|unknown/i.test(message))) return;
      // harmless: a sidechain trigger can fire before its target bus has played a note
      if (/duck target orbit \d+ does not exist/.test(message)) return;
      this.logMsg = { message, type, at: performance.now() };
      this.renderStatus();
    });
    input.addEventListener('notice', (e) => toast(e.detail.text));
    input.addEventListener('learning', () => this.mapui.refreshLearning());
    input.addEventListener('focus-change', () => this.updateKeysChip());
    input.addEventListener('midi-ports', (e) => this.updateMidiChip(e.detail.inputs));
    input.addEventListener('midi-activity', () => {
      this.L.midiChip.classList.add('blink');
      clearTimeout(this.midiBlink);
      this.midiBlink = setTimeout(() => this.L.midiChip.classList.remove('blink'), 90);
    });
    document.addEventListener('focusin', () => this.updateKeysChip());
    document.addEventListener('focusout', () => setTimeout(() => this.updateKeysChip()));
    // map mode: clicks on mappable things open the mapping popover instead of acting
    const intercept = (e) => {
      if (!this.mapMode) return;
      const el = e.target.closest?.('[data-map]');
      if (!el || el.closest('.popover')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'click') this.mapui.open(el, el.dataset.map);
    };
    document.addEventListener('pointerdown', intercept, true);
    document.addEventListener('click', intercept, true);
    document.addEventListener('dblclick', intercept, true);
  }

  applySettings() {
    const s = this.deck.settings;
    if (s.codeWidth) document.documentElement.style.setProperty('--code-w', `${s.codeWidth}px`);
    this.setCodeVisible(s.codeVisible !== false, false);
  }

  // ---- top bar ---------------------------------------------------------------------------
  updateTransport() {
    const on = this.engine.started;
    this.L.playBtn.classList.toggle('on', on);
    this.L.playBtn.querySelector('.play-label').textContent = on ? 'Stop' : 'Play';
  }
  updateKeysChip() {
    const on = this.input.keysActive;
    this.L.keysBtn.classList.toggle('off', !on);
    this.L.keysBtn.textContent = on ? 'KEYS' : 'KEYS PAUSED';
  }
  updateMidiChip(inputs) {
    const chip = this.L.midiChip;
    chip.classList.add('ready');
    chip.title = inputs.length ? `MIDI inputs: ${inputs.join(', ')}` : 'MIDI is on, but no controller is connected';
    chip.textContent = inputs.length ? `MIDI ${inputs.length}` : 'MIDI 0';
  }
  setMapMode(on) {
    if (on && this.locked) return toast('Unlock first to change mappings');
    this.mapMode = on;
    document.body.classList.toggle('mapping', on);
    this.L.mapBtn.classList.toggle('on', on);
    if (!on) this.mapui.close();
    else toast('Map mode: click a strip, control, scene or the master, then press a key or move a MIDI control');
  }
  setLocked(on) {
    this.locked = on;
    if (on) this.setMapMode(false);
    document.body.classList.toggle('locked', on);
    this.L.lockBtn.classList.toggle('on', on);
    this.engine.setReadOnly(on);
    this.inspector.setLocked(on);
    this.renderMixer();
    if (this.guide.isOpen) this.guide.render();
    toast(on ? 'Locked: faders, keys and scenes work; code and songs are protected' : 'Unlocked');
  }
  setCodeVisible(on, save = true) {
    this.codeVisible = on;
    document.body.classList.toggle('nocode', !on);
    this.L.codeBtn.classList.toggle('on', on);
    if (save) {
      this.deck.settings.codeVisible = on;
      this.deck.saveSettings();
    }
  }
  showTab(tab) {
    const layer = tab === 'layer';
    this.L.tabCode.classList.toggle('on', !layer);
    this.L.tabLayer.classList.toggle('on', layer);
    this.L.editorRoot.hidden = layer;
    this.L.inspectorHost.hidden = !layer;
    if (!this.codeVisible) this.setCodeVisible(true);
    if (!layer) this.engine.view.requestMeasure();
  }

  songMenu() {
    const { deck } = this;
    const current = deck.song;
    const lock = this.locked;
    menu(this.L.songBtn, [
      { heading: 'Songs' },
      ...deck.songs().map((s) => ({
        label: s.name,
        active: s.id === current.id,
        hint: s.builtin ? 'built-in' : '',
        disabled: lock && s.id !== current.id,
        onClick: () => s.id !== current.id && deck.loadSong(s.id),
      })),
      { sep: true },
      { label: 'New song', disabled: lock, onClick: async () => {
        const name = await ask('Name for the new song', 'Untitled');
        if (name) deck.loadSong(deck.newSong(name).id);
      } },
      { label: 'Duplicate', disabled: lock, onClick: () => deck.loadSong(deck.duplicateSong().id) },
      { label: 'Rename…', disabled: lock, onClick: async () => {
        const name = await ask('Rename song', current.name);
        if (name) deck.renameSong(name);
      } },
      { sep: true },
      { label: 'Import file…', hint: '.json or code', disabled: lock, onClick: async () => {
        const f = await pickFile();
        if (!f) return;
        const song = deck.importSong(f.text, f.name);
        await deck.loadSong(song.id);
        toast(`Imported ${song.name}`);
      } },
      { label: 'Export file', hint: 'code + deck', onClick: () => {
        const data = deck.exportSong();
        download(`${slug(current.name)}.deck.json`, JSON.stringify(data, null, 2));
      } },
      { label: 'Export code only', hint: '.js', onClick: () => download(`${slug(current.name)}.js`, this.engine.code, 'text/javascript') },
      { label: 'Open in strudel.cc', hint: 'as it sounds now', onClick: () => window.open(deck.shareLink(), '_blank', 'noopener') },
      { label: 'Copy strudel.cc link', onClick: async () => {
        try {
          await navigator.clipboard.writeText(deck.shareLink());
          toast('Link copied: mutes and fader levels are written into the code');
        } catch {
          toast('Could not copy; use Open in strudel.cc instead', 'error');
        }
      } },
      { sep: true },
      current.builtin
        ? { label: `Reset ${current.name} to the original`, danger: true, disabled: lock, onClick: async () => {
            if (await confirmBox(`Reset ${current.name}?`, 'The code, mixer and scenes go back to the original. Your key mappings stay.', { okLabel: 'Reset', danger: true })) {
              deck.loadSong(deck.resetBuiltin());
            }
          } }
        : { label: 'Delete song', danger: true, disabled: lock, onClick: async () => {
            if (await confirmBox(`Delete ${current.name}?`, 'This removes the song from this browser. Export it first if you want to keep it.', { okLabel: 'Delete', danger: true })) {
              deck.deleteSong(current.id);
              deck.loadSong(deck.lib.current);
            }
          } },
    ]);
  }

  // ---- status line -------------------------------------------------------------------------
  renderStatus() {
    const el = this.L.status;
    clear(el);
    if (this.error) {
      el.className = 'status error';
      const msg = String(this.error.message || this.error).split('\n')[0];
      el.append(h('span', { class: 'status-tag' }, 'Error'), h('span', { class: 'status-text', title: msg }, msg), h('span', { class: 'status-hint' }, 'The last working version keeps playing.'));
      return;
    }
    if (this.deck.dirty) {
      el.className = 'status dirty';
      el.append(
        h('span', { class: 'status-text' }, 'Code changed.'),
        h('button', { class: 'btn small primary', type: 'button', onClick: () => this.deck.update() }, 'Update'),
        h('span', { class: 'status-hint' }, 'or Cmd+Enter in the code (starts playing)'),
      );
      return;
    }
    if (this.logMsg && performance.now() - this.logMsg.at < 8000) {
      const bad = /error|not found|failed|could not/i.test(this.logMsg.message);
      el.className = `status log${bad ? ' warn' : ''}`;
      el.append(h('span', { class: 'status-text', title: this.logMsg.message }, this.logMsg.message));
      return;
    }
    el.className = 'status';
    el.append(h('span', { class: 'status-hint' }, 'Edit the code, then Update. Faders, switches and scenes act instantly.'));
  }

  // ---- deck ----------------------------------------------------------------------------
  renderDeck() {
    this.renderScenes();
    this.renderMixer();
    this.renderControls();
    this.inspector.refresh();
    this.mapui.refreshBadges?.();
  }

  badges(target) {
    const list = this.deck.mappingsFor(target);
    return list.map((m) => h('span', { class: `kbd ${m.src.type}`, title: `${describeSource(m.src)}${m.mode === 'hold' ? ' (hold)' : ''}` }, describeSource(m.src)));
  }

  renderScenes() {
    const { deck } = this;
    const el = this.L.scenes;
    clear(el);
    if (!deck.deck) return;
    const opts = deck.deck.sceneOpts;
    this.scenePads = deck.deck.scenes.map((sc, i) => {
      const pad = h(
        'button',
        {
          class: `scene${sc.snap ? ' stored' : ' empty'}${deck.lastScene === i ? ' active' : ''}`,
          type: 'button',
          'data-map': `scene:${i}`,
          title: sc.snap ? `Recall ${sc.name}. Shift-click stores the current state here. Right-click for more.` : 'Empty: click to store the current state',
          onClick: (e) => {
            if (e.shiftKey || !sc.snap) {
              deck.captureScene(i);
              toast(`Stored ${sc.name}`);
            } else deck.recallScene(i);
          },
          onContextmenu: (e) => {
            e.preventDefault();
            menu(pad, [
              { label: 'Recall', disabled: !sc.snap, onClick: () => deck.recallScene(i) },
              { label: 'Store current state here', onClick: () => { deck.captureScene(i); toast(`Stored ${sc.name}`); } },
              { label: 'Rename…', onClick: async () => { const n = await ask('Scene name', sc.name); if (n) deck.renameScene(i, n); } },
              { label: 'Clear', danger: true, disabled: !sc.snap, onClick: () => deck.clearScene(i) },
            ]);
          },
          onDblclick: async (e) => {
            e.preventDefault();
            const n = await ask('Scene name', sc.name);
            if (n) deck.renameScene(i, n);
          },
        },
        h('span', { class: 'scene-num' }, i + 1),
        h('span', { class: 'scene-name' }, sc.name),
        h('span', { class: 'scene-keys' }, this.badges({ kind: 'scene', index: i, action: 'recall' })),
        h('span', { class: 'scene-bar' }),
      );
      return pad;
    });
    const seg = (values, current, onPick, fmtv = (v) => v) =>
      h('div', { class: 'seg' }, values.map((v) => h('button', { type: 'button', class: v === current ? 'on' : '', onClick: () => onPick(v) }, fmtv(v))));
    el.append(
      h('div', { class: 'scenes-head' }, h('span', { class: 'panel-title' }, 'Scenes'), h('span', { class: 'panel-hint' }, 'click recall · shift-click store')),
      h('div', { class: 'scene-pads' }, this.scenePads),
      h(
        'div',
        { class: 'scene-opts' },
        h('label', { title: 'Where a recalled scene lands' }, 'Land', seg(['now', 'beat', 'bar'], opts.at, (v) => deck.setSceneOpts({ at: v }))),
        h('label', { title: 'Faders and knobs glide to the scene over this many bars' }, 'Fade', seg(FADES, opts.fade, (v) => deck.setSceneOpts({ fade: v }), (v) => (v === 0 ? 'cut' : `${v}`))),
        h('label', { title: 'Layers switching on or off: cut at the landing point, or fade in and out over the fade' }, 'Layers', seg(['cut', 'fade'], opts.layerFade ? 'fade' : 'cut', (v) => deck.setSceneOpts({ layerFade: v === 'fade' }))),
      ),
    );
  }

  renderMixer() {
    const { deck, engine } = this;
    const el = this.L.mixer;
    clear(el);
    this.strips.clear();
    const model = deck.model;
    if (!model) return;
    if (!model.ok && model.error) {
      el.append(h('div', { class: 'empty-note error-note' }, `The code does not parse (line ${model.error.line ?? '?'}: ${model.error.message}). Fix it and press Update; nothing else changes until then.`));
    }
    for (const w of model.warnings || []) el.append(h('div', { class: 'empty-note warn-note' }, w));
    const seg = (values, current, onPick) =>
      h('div', { class: 'seg' }, values.map((v) => h('button', { type: 'button', class: v === current ? 'on' : '', onClick: () => onPick(v) }, v)));
    el.append(
      h(
        'div',
        { class: 'panel-head' },
        h('span', { class: 'panel-title' }, 'Mixer'),
        h('span', { class: 'panel-hint' }, 'click a name to edit that layer'),
        h('div', { class: 'spacer' }),
        h('label', { class: 'inline', title: 'Where mute and solo changes land' }, 'M/S land', seg(['now', 'beat', 'bar'], deck.deck.muteAt, (v) => deck.setMuteAt(v))),
        h('button', { class: 'btn small', type: 'button', onClick: () => engine.clearSolos(), title: 'Clear every solo' }, 'Clear solo'),
        h('button', { class: 'btn small', type: 'button', disabled: this.locked, onClick: () => this.addLayer(), title: 'Add a new layer to the code' }, '+ Layer'),
      ),
    );
    if (!model.layers.length) {
      el.append(h('div', { class: 'empty-note' }, 'No layers yet. Label a pattern in the code to get a channel strip, for example ', h('code', {}, 'kick: s("bd*4")'), '.'));
      return;
    }
    // group strips by section
    const groups = [];
    for (const l of model.layers) {
      let g = groups[groups.length - 1];
      if (!g || g.section !== l.section) groups.push((g = { section: l.section, layers: [] }));
      g.layers.push(l);
    }
    const row = h('div', { class: 'strips' });
    for (const g of groups) {
      const title = g.section >= 0 ? model.sections[g.section]?.title || '' : '';
      row.append(
        h(
          'div',
          { class: 'strip-group', style: { '--sec': sectionColor(g.section) } },
          h('div', { class: 'group-title', title }, shortTitle(title) || ' '),
          h('div', { class: 'group-strips' }, g.layers.map((l) => this.renderStrip(l))),
        ),
      );
    }
    el.append(row);
    for (const n of this.strips.keys()) this.updateStrip(n);
  }

  renderStrip(l) {
    const { deck, engine } = this;
    const name = l.name;
    if (l.codeMuted || l.shadowed) {
      return h(
        'div',
        { class: 'strip off', dataset: { layer: name }, title: l.shadowed ? `Another layer has the label ${l.label}; Strudel plays only the last one` : `${name} is switched off in the code (${l.label}:)` },
        h('button', { class: 'strip-name', type: 'button', onClick: () => this.inspect(name) }, name),
        h('div', { class: 'strip-off-note' }, l.shadowed ? 'duplicate name' : 'off in code'),
        l.codeMuted
          ? h('button', {
              class: 'btn small',
              type: 'button',
              disabled: this.locked,
              onClick: () => {
                try {
                  deck.setCodeMute(name, false);
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            }, 'Turn on')
          : null,
      );
    }
    const fader = createFader({
      value: engine.layerGain(name),
      title: `${name} level. Drag; Shift = fine; double-click = 0 dB`,
      onInput: (g) => deck.setLayerGain(name, g),
      onReset: () => deck.setLayerGain(name, 1),
    });
    const led = h('span', { class: 'led' });
    const sound = h('div', { class: 'strip-sound', title: 'last sound played' }, ' ');
    const db = h('div', { class: 'strip-db' });
    const mute = h('button', { class: 'ms mute', type: 'button', title: 'Mute', onClick: () => deck.toggleMute(name) }, 'M');
    const solo = h('button', { class: 'ms solo', type: 'button', title: 'Solo (only soloed layers play)', onClick: () => deck.toggleSolo(name) }, 'S');
    const keys = h(
      'div',
      { class: 'strip-keys' },
      h('span', { class: 'k-m' }, this.badges({ kind: 'layer', name, action: 'mute' })),
      h('span', { class: 'k-s' }, this.badges({ kind: 'layer', name, action: 'solo' })),
    );
    const gainKeys = this.badges({ kind: 'layer', name, action: 'gain' });
    const el = h(
      'div',
      {
        class: `strip${l.playing ? '' : ' idle'}${this.selected?.kind === 'layer' && this.selected.name === name ? ' selected' : ''}`,
        dataset: { layer: name, map: `layer:${name}` },
        onPointerenter: () => this.highlightLinks({ layer: name }),
        onPointerleave: () => this.highlightLinks(null),
      },
      h('button', { class: 'strip-name', type: 'button', title: `${name}: click to edit`, onClick: () => this.inspect(name) }, name),
      h('div', { class: 'strip-sub' }, led, sound),
      h('div', { class: 'strip-fader', onPointerdown: () => this.select({ kind: 'layer', name }) }, fader.el, gainKeys.length ? h('div', { class: 'gain-keys' }, gainKeys) : null),
      db,
      h('div', { class: 'ms-row' }, mute, solo),
      keys,
      l.codeSolo ? h('div', { class: 'strip-flag', title: `S${name}: is soloed in the code` }, 'solo in code') : null,
    );
    this.strips.set(name, { el, fader, led, sound, db, mute, solo });
    return el;
  }

  updateStrip(name) {
    const s = this.strips.get(name);
    if (!s) return;
    const { engine } = this;
    const g = engine.layerGain(name);
    s.fader.set(g);
    s.db.textContent = `${gainToDb(g)} dB`;
    const muted = engine.isMuted(name);
    const soloed = engine.isSolo(name);
    s.mute.classList.toggle('on', muted);
    s.solo.classList.toggle('on', soloed);
    const silent = muted || (engine.anySolo() && !soloed && !engine.soloSafe.has(name));
    s.el.classList.toggle('silent', silent);
    s.el.classList.toggle('solo-safe', engine.soloSafe.has(name));
  }

  renderControls() {
    const { deck } = this;
    const el = this.L.controls;
    clear(el);
    this.ctls.clear();
    const model = deck.model;
    if (!model) return;
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, 'Controls'), h('span', { class: 'panel-hint' }, model.live ? 'from the slider() calls in the code' : 'press Play or Update to activate')));
    if (!model.controls.length) {
      el.append(h('div', { class: 'empty-note' }, 'No controls. Add ', h('code', {}, 'const CUTOFF = slider(800, 100, 5000)'), ' and use CUTOFF in a pattern, for example ', h('code', {}, '.lpf(CUTOFF)'), '.'));
      return;
    }
    const bySection = new Map();
    for (const c of model.controls) {
      if (!bySection.has(c.section)) bySection.set(c.section, []);
      bySection.get(c.section).push(c);
    }
    const cards = h('div', { class: 'cards' });
    for (const [sec, list] of bySection) {
      const title = sec >= 0 ? model.sections[sec]?.title || 'Controls' : 'Controls';
      cards.append(
        h(
          'div',
          { class: 'card', style: { '--sec': sectionColor(sec) } },
          h('div', { class: 'card-title', title }, title),
          list.map((c) => this.renderControl(c)),
        ),
      );
    }
    el.append(cards);
  }

  /** One control row. Used by the deck and by the inspector. */
  renderControl(c, { compact = false } = {}) {
    const { deck, engine } = this;
    const value = c.live ? engine.getValue(c.id) : null;
    let widget;
    const disabled = !c.live;
    if (c.kind === 'switch') {
      widget = createSwitch({ min: c.min, step: c.step * c.dir, count: c.count, labels: c.labels, value, onPick: (v) => deck.setControl(c.key, v) });
    } else if (c.kind === 'stepper') {
      widget = createStepper({ min: c.min, max: c.max, step: c.step, value: value ?? c.min, random: c.count >= 16, onInput: (v) => deck.setControl(c.key, v) });
    } else {
      widget = createSlider({ min: c.min, max: c.max, step: c.step, value: value ?? c.min, onInput: (v) => deck.setControl(c.key, v) });
    }
    const usedBy = c.usedBy.length > 3 ? `${c.usedBy.length} layers` : c.usedBy.join(', ');
    const el = h(
      'div',
      {
        style: compact ? { '--sec': sectionColor(c.section) } : null,
        class: `ctl k-${c.kind}${disabled ? ' disabled' : ''}${this.selected?.kind === 'control' && this.selected.key === c.key ? ' selected' : ''}`,
        dataset: { key: c.key, map: `control:${c.key}` },
        onPointerdown: () => this.select({ kind: 'control', key: c.key }),
        onPointerenter: () => this.highlightLinks({ control: c.key }),
        onPointerleave: () => this.highlightLinks(null),
      },
      h(
        'div',
        { class: 'ctl-head' },
        h('span', { class: 'ctl-name', title: `${c.label}${c.line ? ` · line ${c.line}` : ''}${c.help ? `\n${c.help}` : ''}` }, c.label),
        usedBy && !compact ? h('span', { class: 'ctl-used', title: `affects: ${c.usedBy.join(', ')}` }, `→ ${usedBy}`) : null,
        h('span', { class: 'ctl-keys' }, this.badges({ kind: 'control', key: c.key, action: c.kind === 'switch' ? 'next' : 'up' }), this.badges({ kind: 'control', key: c.key, action: c.kind === 'switch' ? 'prev' : 'down' }), this.badges({ kind: 'control', key: c.key, action: 'set' }), this.badges({ kind: 'control', key: c.key, action: 'hold' }), this.badges({ kind: 'control', key: c.key, action: 'jump' })),
      ),
      c.help && !compact ? h('div', { class: 'ctl-help', title: c.help }, c.help) : null,
      widget.el,
    );
    const ref = { el, widget, c };
    if (!compact) this.ctls.set(c.key, ref);
    else {
      (this.inspectorCtls ||= new Map()).set(c.key, ref);
    }
    return el;
  }

  updateControlById(id) {
    const c = this.deck.model?.controls.find((x) => x.id === id);
    if (!c) return;
    const v = this.engine.getValue(id);
    this.ctls.get(c.key)?.widget.set(v);
    this.inspectorCtls?.get(c.key)?.widget.set(v);
  }

  highlightLinks(what) {
    const root = this.L.deck;
    root.querySelectorAll('.linked').forEach((e) => e.classList.remove('linked'));
    if (!what) return;
    const model = this.deck.model;
    if (what.layer) {
      const l = this.deck.layer(what.layer);
      for (const k of l?.controls || []) this.ctls.get(k)?.el.classList.add('linked');
    } else if (what.control) {
      const c = this.deck.control(what.control);
      for (const n of c?.usedBy || []) this.strips.get(n)?.el.classList.add('linked');
    }
    void model;
  }

  select(sel) {
    this.selected = sel;
    this.L.deck.querySelectorAll('.selected').forEach((e) => e.classList.remove('selected'));
    this.L.masterHost.classList.toggle('selected', sel?.kind === 'master');
    if (sel?.kind === 'control') this.ctls.get(sel.key)?.el.classList.add('selected');
    if (sel?.kind === 'layer') this.strips.get(sel.name)?.el.classList.add('selected');
  }

  /** Arrow keys move whatever is selected. Returns true when handled. */
  nudgeSelected(dir, { fine, horizontal }) {
    const sel = this.selected;
    if (!sel) return false;
    const { deck, engine } = this;
    if (sel.kind === 'control') {
      const c = deck.control(sel.key);
      if (!c) return false;
      if (c.step) deck.nudgeControl(sel.key, dir);
      else deck.nudgeControl(sel.key, dir, fine ? 0.01 : 0.05);
      return true;
    }
    const step = fine ? 0.01 : 0.03;
    if (sel.kind === 'layer') {
      if (horizontal) return false;
      deck.setLayerGain(sel.name, faderGain(clamp(gainToPos(engine.layerGain(sel.name)) + dir * step, 0, 1)));
      return true;
    }
    if (sel.kind === 'master') {
      engine.setMaster(faderGain(clamp(gainToPos(engine.masterGain()) + dir * step, 0, 1)));
      return true;
    }
    return false;
  }

  inspect(name) {
    if (this.mapMode) return;
    this.select({ kind: 'layer', name });
    this.inspector.open(name);
  }

  async addLayer() {
    if (this.locked) return toast('Locked: unlock to add layers');
    const name = await ask('Name for the new layer (letters and numbers)', 'layer');
    if (!name) return;
    const problem = layerNameProblem(name);
    if (problem) return toast(problem, 'error');
    const n = this.deck.addLayer(name, 's("hh*8").gain(0.5)');
    this.pendingInspect = n;
    setTimeout(() => this.inspect(n), 300);
  }

  // ---- animation ---------------------------------------------------------------------------
  tick() {
    requestAnimationFrame(() => this.tick());
    const { engine, L } = this;
    const nowMs = performance.now();
    // activity LEDs and last sounds
    const hits = engine.drainHits(engine.audioTime());
    for (const [name, hit] of hits) {
      this.lastHit.set(name, nowMs);
      const s = this.strips.get(name);
      if (s && hit.label && s.sound.textContent !== hit.label) s.sound.textContent = hit.label;
    }
    for (const [name, s] of this.strips) {
      const t = this.lastHit.get(name);
      const a = t ? Math.max(0, 1 - (nowMs - t) / 160) : 0;
      s.led.style.opacity = (0.15 + 0.85 * a).toFixed(2);
    }
    // position
    if (engine.started) {
      const now = engine.now();
      const bar = Math.floor(now);
      const beat = Math.floor((now - bar) * 4) + 1;
      L.pos.firstChild.textContent = String(bar + 1);
      L.pos.lastChild.textContent = `.${beat}`;
      const cells = L.phrase.children;
      for (let i = 0; i < 8; i++) cells[i].className = i === bar % 8 ? 'on' : i < bar % 8 ? 'past' : '';
    }
    if (!this.bpmEditing && nowMs - (this.bpmShown || 0) > 500) {
      this.bpmShown = nowMs;
      const bpm = Math.round(engine.bpm * 10) / 10;
      if (String(bpm) !== L.bpmInput.value) L.bpmInput.value = String(bpm);
    }
    // meter
    if (engine.started) {
      const p = engine.peak();
      const db = p > 0 ? 20 * Math.log10(p) : -96;
      const f = clamp((db + 48) / 48, 0, 1);
      L.meterFill.style.width = `${(f * 100).toFixed(1)}%`;
      L.meterFill.classList.toggle('hot', db > -3);
      if (f > (this.peakHold || 0) || nowMs - (this.peakAt || 0) > 1200) {
        this.peakHold = f;
        this.peakAt = nowMs;
      }
      L.meterPeak.style.left = `${(this.peakHold * 100).toFixed(1)}%`;
      if (p >= 0.995) this.clipAt = nowMs;
    } else {
      L.meterFill.style.width = '0%';
    }
    L.clip.classList.toggle('on', nowMs - (this.clipAt || -1e9) < 1500);
    L.masterDb.textContent = gainToDb(engine.masterGain());
    // pending and gliding values (scene fades, quantized changes)
    if (nowMs - (this.pendingShown || 0) > 60) {
      this.pendingShown = nowMs;
      const now = engine.now();
      const pend = new Set(engine.started ? engine.store.pendingKeys(now) : []);
      for (const ref of this.ctls.values()) {
        const p = pend.has(ref.c.id);
        ref.widget.setPending(p);
        if (p || ref.wasPending) ref.widget.set(p ? engine.valueNow(ref.c.id) : engine.getValue(ref.c.id));
        ref.wasPending = p;
      }
      for (const [name, s] of this.strips) {
        const p = pend.has(`gain:${name}`) || pend.has(`mute:${name}`) || pend.has(`solo:${name}`) || pend.has(`xf:${name}`);
        s.el.classList.toggle('pending', p);
        if (p || s.wasPending) {
          s.fader.set(p ? engine.layerGainNow(name) : engine.layerGain(name));
          if (!p) this.updateStrip(name);
        }
        s.wasPending = p;
      }
      // scene pad progress
      const ps = this.pendingScene;
      this.scenePads.forEach((pad, i) => {
        const active = ps && ps.index === i;
        pad.classList.toggle('active', !!active && now >= ps.t0);
        pad.classList.toggle('pending', !!active && now < ps.t0 && engine.started);
        const prog = active && ps.t1 > ps.t0 ? clamp((now - ps.t0) / (ps.t1 - ps.t0), 0, 1) : active ? 1 : 0;
        pad.style.setProperty('--prog', prog.toFixed(3));
      });
      if (this.logMsg && nowMs - this.logMsg.at > 8000 && !this.error && !this.deck.dirty && this.L.status.classList.contains('log')) this.renderStatus();
      if (nowMs - (this.pruned || 0) > 2000) {
        this.pruned = nowMs;
        if (engine.started) engine.store.prune(now);
      }
    }
  }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
}
function shortTitle(t) {
  return t.split('·')[0].trim();
}
