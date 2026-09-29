"""Screenshots of the main UI states for visual review."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pwutil import serve, route_samples, LAUNCH_ARGS
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent / 'docs'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp')
httpd, base = serve(ROOT)
with sync_playwright() as p:
    b = p.chromium.launch(args=LAUNCH_ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    route_samples(ctx)
    page = ctx.new_page()
    page.goto(base)
    page.wait_for_function('window.deckApp && window.deckApp.deck.model && window.deckApp.deck.model.live', timeout=15000)
    E = page.evaluate
    E("deckApp.app.guide.open('concepts')")
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'guide-concepts.png'))
    E("deckApp.app.guide.open('keys')")
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'guide-keys.png'))
    E("deckApp.app.guide.close()")
    page.click('.top-tools .btn:has-text("Map")')
    page.click('.strip[data-layer=hats] .strip-name')
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'map-strip.png'))
    page.keyboard.press('Escape')
    page.click('.cards .ctl[data-key=ACID_LP] .ctl-name')
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'map-control.png'))
    page.keyboard.press('Escape')
    page.click('.top-tools .btn:has-text("Map")')
    page.click('.song-btn')
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'song-menu.png'))
    page.keyboard.press('Escape')
    b.close()
httpd.shutdown()
