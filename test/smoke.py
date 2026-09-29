"""Load the built deck in headless Chromium, report errors, take a screenshot."""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pwutil import serve, route_samples, LAUNCH_ARGS
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent / 'docs'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp')
httpd, base = serve(ROOT)
logs, missing = [], []
with sync_playwright() as p:
    b = p.chromium.launch(args=LAUNCH_ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    route_samples(ctx, missing)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'[:400]))
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'[:600]))
    page.goto(base)
    page.wait_for_timeout(2500)
    info = page.evaluate('''() => {
      const d = window.deckApp;
      if (!d) return 'no deckApp';
      return { song: d.deck.song?.name, layers: d.engine.layers.length, sliders: d.engine.sliders.size,
        strips: document.querySelectorAll('.strip').length, ctls: document.querySelectorAll('.ctl').length,
        cards: document.querySelectorAll('.card').length, scenes: document.querySelectorAll('.scene.stored').length,
        model: d.deck.model && { live: d.deck.model.live, controls: d.deck.model.controls.length, layers: d.deck.model.layers.length },
        mappings: d.deck.mappings().length, error: String(d.app.error || '') };
    }''')
    print('INFO', json.dumps(info))
    page.screenshot(path=str(OUT / 'deck-1440.png'))
    b.close()
httpd.shutdown()
print('missing', missing[:8])
print('\n'.join(l for l in logs if not l.startswith('log:'))[:4000])
