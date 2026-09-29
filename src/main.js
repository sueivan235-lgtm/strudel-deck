// Strudel Deck: a performance surface for Strudel code.
import './styles.css';
import { getDrawContext } from '@strudel/draw';
import { Engine } from './engine.js';
import { Deck } from './deck.js';
import { Input } from './input.js';
import { App, buildLayout } from './ui/app.js';
import { closeMenus } from './ui/dom.js';

const layout = buildLayout(document.getElementById('app'));
const engine = new Engine({ root: layout.editorRoot, initialCode: '// loading…' });
const deck = new Deck(engine);
let app;
const input = new Input(deck, {
  onSelectedNudge: (dir, opts) => app.nudgeSelected(dir, opts),
  onEscape: () => {
    closeMenus();
    if (app.mapui.pop) app.mapui.close();
    else if (app.guide.isOpen) app.guide.close();
    else app.select(null);
  },
});
app = new App({ layout, engine, deck, input });

// buttons keep focus after a click in Chrome; drop it so Space and Enter stay deck keys
document.addEventListener('pointerup', () => {
  const el = document.activeElement;
  if (el && el.tagName === 'BUTTON') setTimeout(() => el.blur());
});

// Strudel's visual functions (.pianoroll(), .scope()) draw on a canvas behind the page
try {
  engine.mirror.drawContext = getDrawContext();
} catch (e) {
  console.warn('[deck] no draw canvas', e);
}

deck.loadSong(deck.lib.current).then(() => {
  if (!deck.settings.seenGuide) {
    deck.settings.seenGuide = true;
    deck.saveSettings();
    app.guide.open('deck');
  }
});

// for debugging and tests
window.deckApp = { engine, deck, input, app };
