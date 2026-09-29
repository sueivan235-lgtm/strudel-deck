"""Browser checks for the review findings (audio unlock, undo, scene fades, races, keys under dialogs...)."""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pwutil import serve, route_samples, LAUNCH_ARGS
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent / 'docs'
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

READY = 'window.deckApp && window.deckApp.deck.model && window.deckApp.deck.model.live'
httpd, base = serve(ROOT)
logs = []
with sync_playwright() as p:
    # 1. real autoplay policy: nothing may start before a gesture, the first key press must start everything
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    route_samples(ctx)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'[:300]))
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'[:400]))
    page.goto(base)
    page.wait_for_function(READY, timeout=20000)
    page.evaluate('deckApp.app.guide.close()')
    E = page.evaluate
    check('no audio unlocked before a gesture', not E('deckApp.engine.audioUnlocked'))
    page.keyboard.press('Space')   # first gesture is a key, not a click
    page.wait_for_function('deckApp.engine.started', timeout=10000)
    page.wait_for_timeout(2500)
    st = E("({ unlocked: deckApp.engine.audioUnlocked, hits: [...deckApp.app.lastHit.keys()], peak: deckApp.engine.peak() })")
    check('Space as first gesture unlocks audio', st['unlocked'], json.dumps(st))
    check('rumble (needs audio worklets) plays after a keyboard start', 'rumble' in st['hits'])
    worklet_errors = [l for l in logs if 'AudioWorkletNode' in l or 'non-finite' in l]
    check('no worklet or non-finite errors', not worklet_errors, ' | '.join(worklet_errors[:3]))
    page.keyboard.press('Space')
    b.close()

    b = p.chromium.launch(args=LAUNCH_ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    route_samples(ctx)
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'[:300]))
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'[:400]))
    page.goto(base)
    page.wait_for_function(READY, timeout=20000)
    E = page.evaluate
    E('deckApp.app.guide.close()')

    # 2. undo right after loading must not reach "// loading…" or another song
    code0 = E('deckApp.engine.code')
    page.click('.editor .cm-content')
    page.keyboard.press('Control+z')
    page.keyboard.press('Meta+z')
    page.wait_for_timeout(100)
    check('undo after load keeps the song', E('deckApp.engine.code') == code0)
    E("deckApp.deck.loadSong('starter')")
    page.wait_for_function("deckApp.deck.song.id === 'starter' && deckApp.deck.model && deckApp.deck.model.live", timeout=10000)
    starter = E('deckApp.engine.code')
    page.click('.editor .cm-content')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(100)
    check('undo after switching songs keeps the new song', E('deckApp.engine.code') == starter)
    page.keyboard.press('Escape')

    # 3. scene fades on a new song (never-set gains) keep layers audible
    E("deckApp.deck.loadSong(deckApp.deck.newSong('Fresh').id)")
    page.wait_for_function("deckApp.deck.song.name === 'Fresh' && deckApp.deck.model && deckApp.deck.model.live", timeout=10000)
    page.mouse.click(1000, 880)
    page.keyboard.press('Space')
    page.wait_for_function('deckApp.engine.started', timeout=10000)
    page.wait_for_timeout(600)
    E("deckApp.deck.captureScene(0)")
    E("deckApp.deck.setSceneOpts({ at: 'now', fade: 2, layerFade: true })")
    E("deckApp.deck.recallScene(0)")
    E("deckApp.app.lastHit.clear()")
    page.wait_for_timeout(1500)
    hits = E("[...deckApp.app.lastHit.keys()].sort()")
    g = E("deckApp.engine.layerGainNow('kick')")
    check('fading scene keeps new layers playing (no NaN gain)', 'kick' in hits and g == g and g > 0.5, f'{hits} gain {g}')
    # a layer fading out comes back smoothly when another scene brings it in
    E("deckApp.deck.captureScene(1)")
    E("deckApp.engine.setMute('hats', true)")
    E("deckApp.deck.captureScene(2)")  # scene 3: hats muted
    E("deckApp.engine.setMute('hats', false)")
    E("deckApp.deck.setSceneOpts({ at: 'now', fade: 4, layerFade: true })")
    E("deckApp.deck.recallScene(2)")   # hats starts fading out over 4 bars
    page.wait_for_timeout(1200)
    before = E("deckApp.engine.layerGainNow('hats')")
    E("deckApp.deck.recallScene(1)")   # bring hats back mid-fade
    page.wait_for_timeout(300)
    after = E("deckApp.engine.layerGainNow('hats')")
    check('scene bringing back a fading layer does not drop it to silence', after >= before - 0.05, f'{before:.2f} -> {after:.2f}')
    page.keyboard.press('Space')
    page.wait_for_timeout(200)

    # 4. two quick updates don't double anonymous layers
    E('''(() => { const v = deckApp.engine.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'setcpm(120/4)\\n$: s("bd*4")\\n$: s("hh*8")\\n' } }); })()''')
    E("Promise.all([deckApp.deck.update(), deckApp.deck.update(), deckApp.engine.evaluate()])")
    page.wait_for_timeout(1200)
    check('overlapping evaluations keep $0 and $1 only', E('deckApp.engine.layers') == ['$0', '$1'], str(E('deckApp.engine.layers')))
    E("deckApp.engine.stop()")

    # 5. keys don't act behind a confirm dialog
    E("deckApp.deck.loadSong('ferrum')")
    page.wait_for_function("deckApp.deck.song.id === 'ferrum' && deckApp.deck.model && deckApp.deck.model.live", timeout=10000)
    E('deckApp.app.guide.close()')
    page.click('.strip[data-layer=hats] .strip-name')
    page.wait_for_timeout(150)
    page.click('.insp-buttons .btn.danger')      # Delete -> confirm dialog
    page.wait_for_timeout(150)
    muted = E("deckApp.engine.isMuted('kick')")
    page.keyboard.press('Digit1')
    check('number keys do nothing while a dialog is open', E("deckApp.engine.isMuted('kick')") == muted)
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)
    check('Esc closes the dialog, hats still there', not E("!!document.querySelector('.modal-back')") and 'hats: s(' in E('deckApp.engine.code'))

    # 6. learning a MIDI-only slot: Esc cancels, other keys still work
    E("deckApp.input.midi = { inputs: new Map() }")
    page.click('.top-tools .btn:has-text("Map")')
    page.click('.strip[data-layer=kick] .strip-name')
    page.wait_for_timeout(100)
    page.click('.popover .pop-row:nth-of-type(4) .btn')   # Level (MIDI fader) -> Learn
    check('learning a MIDI slot', E('!!deckApp.input.learning'))
    page.keyboard.press('Escape')
    check('Esc cancels MIDI learn', not E('!!deckApp.input.learning'))
    # 7. popover keeps its place after learning
    page.click('.popover .pop-row:nth-of-type(2) .btn')   # Mute -> Learn
    page.keyboard.press('KeyV')
    page.wait_for_timeout(150)
    box = E("(() => { const r = document.querySelector('.popover').getBoundingClientRect(); return [r.left, r.top]; })()")
    check('popover stays next to its strip after learning', box[0] > 20 and box[1] > 60, str(box))
    page.keyboard.press('Escape')
    page.click('.top-tools .btn:has-text("Map")')

    # 8. lock disables code-changing buttons
    E('''(() => { const v = deckApp.engine.view; const d = v.state.doc.toString(); const i = d.indexOf('ride: s('); v.dispatch({ changes: { from: i, to: i, insert: '_' } }); })()''')
    E('deckApp.deck.update()')
    page.wait_for_timeout(600)
    page.click('.top-tools .btn:has-text("Lock")')
    dis = E("({ add: document.querySelector('.mixer .panel-head .btn:last-child').disabled, turnOn: document.querySelector('.strip.off .btn').disabled })")
    check('Lock disables + Layer and Turn on', dis['add'] and dis['turnOn'], json.dumps(dis))
    page.click('.top-tools .btn:has-text("Lock")')

    # 9. pending scene marker clears on stop
    page.mouse.click(1000, 880)
    page.keyboard.press('Space')
    page.wait_for_function('deckApp.engine.started', timeout=10000)
    E("deckApp.deck.setSceneOpts({ at: 'bar', fade: 0 })")
    E("deckApp.deck.recallScene(3)")
    E("deckApp.engine.stop()")
    page.wait_for_timeout(200)
    check('stop clears the pending scene', E('deckApp.app.pendingScene') is None)

    # 10. an empty tempo field changes nothing
    bpm = E('deckApp.engine.bpm')
    page.fill('.bpm-input', '')
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    check('blank tempo leaves the tempo alone', abs(E('deckApp.engine.bpm') - bpm) < 0.01 and 'const BPM  = 150' in E('deckApp.engine.code'))

    # 11. relabelling in the layer view carries the mute over
    E("deckApp.engine.setMute('toms', false)")
    E("deckApp.engine.setLayerGain('toms', 0.33)")
    page.click('.strip[data-layer=toms] .strip-name')
    page.wait_for_timeout(150)
    E('''(() => { const v = deckApp.app.inspector.view; const d = v.state.doc.toString(); v.dispatch({ changes: { from: 0, to: 4, insert: 'tomtoms' } }); })()''')
    page.click('.insp-actions .btn.primary')
    page.wait_for_timeout(700)
    st = E("({ name: deckApp.app.inspector.name, g: deckApp.engine.layerGain('tomtoms'), layers: deckApp.engine.layers.includes('tomtoms') })")
    check('relabel keeps the fader level and the layer view follows', st['name'] == 'tomtoms' and abs(st['g'] - 0.33) < 1e-9 and st['layers'], json.dumps(st))
    b.close()
httpd.shutdown()
errors = [l for l in logs if l.startswith('PAGEERROR') or (l.startswith('error') and 'Failed to load resource' not in l)]
check('no page errors', not errors, '\n'.join(errors[:8]))
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
