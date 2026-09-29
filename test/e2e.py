"""End-to-end test of the built deck in headless Chromium (samples served from local fixtures)."""
import sys, json, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pwutil import serve, route_samples, LAUNCH_ARGS
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent / 'docs'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp')
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

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
    page.wait_for_function('window.deckApp && window.deckApp.deck.model && window.deckApp.deck.model.live', timeout=15000)
    page.evaluate('deckApp.app.guide.close()')
    E = lambda js: page.evaluate(js)

    # --- initial state
    st = E('''() => ({ strips: document.querySelectorAll('.strip').length, ctls: document.querySelectorAll('.cards .ctl').length,
        muted: deckApp.engine.layers.filter(n => deckApp.engine.isMuted(n)).length, master: deckApp.engine.masterGain() })''')
    check('20 strips, 37 controls', st['strips'] == 20 and st['ctls'] == 37, json.dumps(st))
    check('preset: 15 layers muted, master 0.6', st['muted'] == 15 and abs(st['master'] - 0.6) < 1e-9)
    page.screenshot(path=str(OUT / 'deck-stopped.png'))

    # --- play with the Space key (focus on the page body)
    page.mouse.click(1000, 880)
    page.keyboard.press('Space')
    page.wait_for_timeout(3500)
    st = E('''() => ({ started: deckApp.engine.started, pos: document.querySelector('.pos').textContent,
        hits: [...deckApp.app.lastHit.keys()], peak: deckApp.engine.peak() })''')
    check('Space starts playback', st['started'], st['pos'])
    check('kick and rumble trigger (LED activity)', 'kick' in st['hits'] and 'rumble' in st['hits'], ','.join(st['hits']))
    sound = E("document.querySelector('.strip[data-layer=kick] .strip-sound').textContent")
    check('kick strip shows last sound', 'bd' in sound, sound)
    peak = max(E('deckApp.engine.peak()') for _ in range(5) if not page.wait_for_timeout(120))
    check('audio reaches the output (meter)', peak > 0.01, f'peak {peak:.3f}')
    g = E("deckApp.engine.meter && deckApp.engine.meter.node.gain.value")
    check('master 0.6 acts on the output node', g is not None and abs(g - 0.6) < 0.01, str(g))
    E("deckApp.engine.setMaster(0.3)")
    page.wait_for_timeout(200)
    g = E("deckApp.engine.meter.node.gain.value")
    check('master moves the output gain at once', abs(g - 0.3) < 0.01, str(g))
    E("deckApp.engine.setMaster(0.6)")

    # --- key mapping: 4 = rolling (muted) -> unmute ; 1 = kick mute
    page.keyboard.press('Digit4')
    page.wait_for_timeout(50)
    check('key 4 unmutes rolling', not E("deckApp.engine.isMuted('rolling')"))
    page.keyboard.press('Digit1')
    page.wait_for_timeout(50)
    check('key 1 mutes kick', E("deckApp.engine.isMuted('kick')"))
    page.wait_for_timeout(400)  # notes scheduled before the mute still sound
    E("deckApp.app.lastHit.delete('kick')")
    page.wait_for_timeout(1500)
    check('muted kick stops triggering', not E("deckApp.app.lastHit.has('kick')"))
    page.keyboard.press('Digit1')
    page.keyboard.press('Shift+Digit3')
    page.wait_for_timeout(50)
    check('Shift+3 solos rumble', E("deckApp.engine.isSolo('rumble')"))
    page.wait_for_timeout(400)  # events already scheduled before the solo still sound
    E("deckApp.app.lastHit.clear()")
    page.wait_for_timeout(1500)
    hits = E("[...deckApp.app.lastHit.keys()].sort()")
    check('solo: only rumble and the solo-safe pump play', set(hits) <= {'rumble', 'pump'} and 'rumble' in hits, ','.join(hits))
    page.keyboard.press('Shift+Digit3')

    # --- controls write back into the code
    E("deckApp.deck.setControl('HARD', 0.85)")
    code = E('deckApp.engine.code')
    check('slider value written into the code', 'const HARD      = slider(0.85, 0, 1)' in code)
    page.click('.ctl[data-key=KICK_SND] .sw-btn:nth-child(3)')
    check('switch click sets KICK_SND=2', E("deckApp.deck.value('KICK_SND')") == 2 and 'slider(2, 0, 3, 1)' in E('deckApp.engine.code'))
    E("deckApp.deck.setControl('KICK_SND', 0)")

    # --- scene recall lands on the next bar
    before = E("deckApp.engine.now()")
    page.keyboard.press('KeyS')   # scene 2 Groove
    page.wait_for_timeout(30)
    st = E('''() => ({ hatsFinal: deckApp.engine.isMuted('hats'), pending: deckApp.engine.pending('mute:hats'), t0: deckApp.app.pendingScene && deckApp.app.pendingScene.t0 })''')
    check('scene Groove scheduled on a bar line ahead', st['t0'] is not None and st['t0'] == int(st['t0']) and 0 < st['t0'] - before <= 2 and st['pending'], json.dumps(st) + f' before={before:.2f}')
    page.wait_for_function('deckApp.engine.now() > deckApp.app.pendingScene.t0 + 0.3', timeout=5000)
    E("deckApp.app.lastHit.delete('hats')")
    page.wait_for_timeout(800)
    check('after landing, hats play', E("deckApp.app.lastHit.has('hats')") and not E("deckApp.engine.isMuted('hats')"))
    page.screenshot(path=str(OUT / 'deck-playing.png'))

    # --- scene fade: Break with a 2-bar fade ramps BUILD
    E("deckApp.deck.setSceneOpts({ fade: 2 })")
    page.keyboard.press('KeyG')   # scene 5 Break
    page.wait_for_function('deckApp.engine.now() > deckApp.app.pendingScene.t0 + 1', timeout=6000)
    mid = E("(() => { const c = deckApp.deck.control('BUILD'); return deckApp.engine.valueNow(c.id) })()")
    check('Break fades BUILD in over 2 bars (midway value)', 0.2 < mid < 0.95, f'{mid:.2f}')
    check('Break mutes kick on the landing bar', E("deckApp.engine.isMuted('kick')"))
    page.wait_for_function('deckApp.engine.now() > deckApp.app.pendingScene.t1 + 0.1', timeout=6000)
    check('BUILD reaches 1 at the end of the fade', abs(E("deckApp.deck.value('BUILD')") - 1) < 1e-9 and 'const BUILD     = slider(1, 0, 1)' in E('deckApp.engine.code'))
    E("deckApp.deck.setSceneOpts({ fade: 0, at: 'now' })")
    page.keyboard.press('KeyH')   # Drop
    page.wait_for_timeout(300)
    check('Drop snaps BUILD back to 0', E("deckApp.deck.value('BUILD')") == 0)

    # --- inspector: edit a layer and apply
    page.click('.strip[data-layer=acid] .strip-name')
    page.wait_for_timeout(200)
    vis = E("!document.querySelector('.inspector-host').hidden")
    check('clicking a strip name opens the layer view', vis)
    txt = E("deckApp.app.inspector.view.state.doc.toString()")
    check('layer view holds the acid statement', txt.startswith('acid: note(ACID_PAT.pick(['), txt[:60])
    ctl_count = E("document.querySelectorAll('.insp .ctl').length")
    check('layer view lists acid controls', ctl_count >= 8, str(ctl_count))
    E('''(() => { const v = deckApp.app.inspector.view; const d = v.state.doc.toString();
        v.dispatch({ changes: { from: 0, to: d.length, insert: d.replace('.decay(0.13)', '.decay(0.2)') } }); })()''')
    page.click('.insp-actions .btn.primary')
    page.wait_for_timeout(600)
    check('Apply puts the edit into the code', '.s("sawtooth").decay(0.2).sustain(0)' in E('deckApp.engine.code'))
    check('no evaluation error after apply', not E("deckApp.app.error"), str(E("String(deckApp.app.error||'')")))
    page.screenshot(path=str(OUT / 'deck-inspector.png'))
    # a broken edit is refused before it reaches the code
    E('''(() => { const v = deckApp.app.inspector.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'acid: note("c2".' } }); })()''')
    page.click('.insp-actions .btn.primary')
    page.wait_for_timeout(200)
    msg = E("document.querySelector('.insp-msg').textContent")
    check('syntax error shown, code untouched', 'Unexpected' in msg and '.decay(0.2).sustain(0)' in E('deckApp.engine.code'), msg)
    page.click('.insp-actions .btn:nth-child(2)')  # Revert

    # --- map mode: learn a key for FILTER up
    page.click('.top-tools .btn:has-text("Map")')
    page.click('.ctl[data-key=FILTER] .ctl-name')
    page.wait_for_timeout(100)
    check('map popover opens', E("!!document.querySelector('.popover')"))
    page.click('.popover .pop-row:nth-of-type(2) .btn')   # first row: Up -> Learn
    page.keyboard.press('KeyZ')
    page.wait_for_timeout(100)
    m = E("deckApp.deck.mappings().find(m => m.src.code === 'KeyZ')")
    check('learned Z → FILTER up', m and m['target'] == {'kind': 'control', 'key': 'FILTER', 'action': 'up'}, json.dumps(m))
    page.keyboard.press('Escape')
    page.click('.top-tools .btn:has-text("Map")')
    v0 = E("deckApp.deck.value('FILTER')")
    page.keyboard.press('KeyZ')
    page.wait_for_timeout(50)
    v1 = E("deckApp.deck.value('FILTER')")
    check('Z raises FILTER by 5%', abs(v1 - v0 - 0.05) < 1e-6, f'{v0} -> {v1}')

    # --- tempo edit rewrites the code
    page.fill('.bpm-input', '146')
    page.keyboard.press('Enter')
    page.wait_for_timeout(700)
    check('tempo field rewrites const BPM', 'const BPM  = 146' in E('deckApp.engine.code') and abs(E('deckApp.engine.bpm') - 146) < 0.01, str(E('deckApp.engine.bpm')))

    # --- code edit marks dirty, Update applies
    E('''(() => { const v = deckApp.engine.view; const d = v.state.doc.toString(); const i = d.indexOf('ride: s("cr*8")');
        v.dispatch({ changes: { from: i, to: i + 4, insert: '_ride' } }); })()''')
    page.wait_for_timeout(100)
    check('editing code marks Update', E("deckApp.deck.dirty") and E("document.querySelector('.update-btn').classList.contains('dirty')"))
    page.click('.update-btn')
    page.wait_for_timeout(700)
    check('Update applies; ride shows as off in code', E("document.querySelector('.strip.off[data-layer=ride]') !== null") and not E("deckApp.deck.dirty"))
    page.click('.strip.off[data-layer=ride] .btn')
    page.wait_for_timeout(700)
    check('Turn on removes the _ again', 'ride: s("cr*8")' in E('deckApp.engine.code') and E("document.querySelector('.strip.off') === null"))

    # --- guide reference and Try
    E("deckApp.app.guide.showRef('lpf')")
    page.wait_for_timeout(200)
    check('reference entry for lpf', 'lpf' in E("document.querySelector('.ref-entry h2').textContent"))
    page.screenshot(path=str(OUT / 'deck-guide.png'))
    tries = E("document.querySelectorAll('.ref-entry .ex-bar .btn.primary').length")
    check('reference examples have Try', tries >= 1, str(tries))
    page.click('.ref-entry .ex-bar .btn.primary')
    page.wait_for_timeout(900)
    check('Try adds a soloed tryout layer', 'tryout' in E('deckApp.engine.layers') and E("deckApp.engine.isSolo('tryout')"), str(E("String(deckApp.app.error||'')")))
    E("deckApp.deck.deleteLayer('tryout')")
    page.wait_for_timeout(700)
    check('tryout layer removed', 'tryout' not in E('deckApp.engine.layers') and not E("deckApp.engine.anySolo()"))
    E("deckApp.app.guide.close()")

    # --- lock
    page.click('.top-tools .btn:has-text("Lock")')
    ro = E("deckApp.engine.view.state.readOnly")
    check('Lock makes the code read-only', ro)
    page.keyboard.press('Digit2')
    check('keys still work when locked', E("deckApp.engine.isMuted('pump')"))
    page.keyboard.press('Digit2')
    page.click('.top-tools .btn:has-text("Lock")')

    # --- MIDI (simulated messages): learn a CC for ACID_LP, then turn the knob
    E("deckApp.input.midi = { inputs: new Map() }")  # pretend access was granted
    page.click('.top-tools .btn:has-text("Map")')
    page.click('.cards .ctl[data-key=ACID_LP] .ctl-name')
    page.wait_for_timeout(100)
    page.click('.popover .pop-row:nth-of-type(5) .btn')   # MIDI knob or fader -> Learn
    E("deckApp.input.midiMessage({ data: [0xB0, 21, 10] }, { name: 'fake' })")
    m = E("deckApp.deck.mappings().find(m => m.src.type === 'midi')")
    check('MIDI learn: CC21 → ACID_LP knob', m and m['src']['num'] == 21 and m['target']['key'] == 'ACID_LP' and m['target']['action'] == 'set', json.dumps(m))
    page.keyboard.press('Escape')
    page.click('.top-tools .btn:has-text("Map")')
    E("deckApp.input.midiMessage({ data: [0xB0, 21, 127] }, { name: 'fake' })")
    check('CC 127 sets ACID_LP to its maximum', E("deckApp.deck.value('ACID_LP')") == 4000)
    E("deckApp.input.midiMessage({ data: [0xB0, 21, 0] }, { name: 'fake' })")
    check('CC 0 sets ACID_LP to its minimum', E("deckApp.deck.value('ACID_LP')") == 100)
    # a note mapped to a scene
    E("deckApp.deck.addMapping({ type: 'midi', kind: 'note', ch: 10, num: 36 }, { kind: 'scene', index: 0, action: 'recall' })")
    E("deckApp.deck.setSceneOpts({ at: 'now', fade: 0 })")
    E("deckApp.input.midiMessage({ data: [0x99, 36, 100] }, { name: 'fake' })")
    check('MIDI note recalls a scene', E("deckApp.deck.lastScene") == 0)

    # --- hold key: momentary value on a control
    E("deckApp.deck.addMapping({ type: 'key', code: 'KeyX', shift: false, alt: false }, { kind: 'control', key: 'FILTER', action: 'hold' }, { value: 0.1 })")
    before = E("deckApp.deck.value('FILTER')")
    page.keyboard.down('KeyX')
    page.wait_for_timeout(60)
    held = E("deckApp.deck.value('FILTER')")
    page.keyboard.up('KeyX')
    page.wait_for_timeout(60)
    after = E("deckApp.deck.value('FILTER')")
    check('hold key: FILTER 0.1 while held, back on release', abs(held - 0.1) < 1e-9 and abs(after - before) < 1e-9, f'{before} {held} {after}')
    # hold-mode mute
    mm = E("deckApp.deck.mappingsFor({ kind: 'layer', name: 'hats', action: 'mute' })[0]")
    E(f"deckApp.deck.updateMapping('{mm['id']}', {{ mode: 'hold' }})")
    was = E("deckApp.engine.isMuted('hats')")
    page.keyboard.down('Digit7')
    page.wait_for_timeout(40)
    mid = E("deckApp.engine.isMuted('hats')")
    page.keyboard.up('Digit7')
    page.wait_for_timeout(40)
    check('hold-mode mute flips only while held', mid != was and E("deckApp.engine.isMuted('hats')") == was)

    # --- an evaluation error keeps the old pattern and shows the message
    E('''(() => { const v = deckApp.engine.view; const d = v.state.doc.toString(); const i = d.indexOf('hoover: s(');
        v.dispatch({ changes: { from: i, to: i + 10, insert: 'hoover: sx(' } }); })()''')
    page.click('.update-btn')
    page.wait_for_timeout(600)
    st = E("({ status: document.querySelector('.status').textContent, started: deckApp.engine.started, layers: deckApp.engine.layers.length })")
    check('runtime error shown, music keeps playing', 'sx' in st['status'] and st['started'] and st['layers'] == 20, json.dumps(st))
    page.screenshot(path=str(OUT / 'deck-error.png'))
    E('''(() => { const v = deckApp.engine.view; const d = v.state.doc.toString(); const i = d.indexOf('hoover: sx(');
        v.dispatch({ changes: { from: i, to: i + 11, insert: 'hoover: s(' } }); })()''')
    page.click('.update-btn')
    page.wait_for_timeout(600)
    check('fixing the code clears the error', 'Error' not in E("document.querySelector('.status').textContent"))

    # --- persistence: reload keeps the edits
    E("deckApp.deck.lib.save(true)")
    E("deckApp.engine.stop()")
    page.wait_for_timeout(300)
    page.reload(wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function('window.deckApp && window.deckApp.deck.model && window.deckApp.deck.model.live', timeout=15000)
    check('reload keeps code edits and mappings', 'const BPM  = 146' in E('deckApp.engine.code') and E("!!deckApp.deck.mappings().find(m => m.src.code === 'KeyZ')"))

    # --- other songs
    E("deckApp.deck.loadSong('starter')")
    page.wait_for_function("deckApp.deck.song.id === 'starter' && deckApp.deck.model && deckApp.deck.model.live", timeout=10000)
    st = E("({ strips: document.querySelectorAll('.strip').length, ctls: document.querySelectorAll('.cards .ctl').length, sw: document.querySelectorAll('.ctl.k-switch').length })")
    check('Starter: 6 strips, 5 controls', st['strips'] == 6 and st['ctls'] == 5, json.dumps(st))
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'starter-1280.png'))
    E("deckApp.deck.loadSong('ferrum')")
    page.wait_for_timeout(1500)
    E("deckApp.app.setCodeVisible(false)")
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'ferrum-nocode-1280.png'))
    b.close()
httpd.shutdown()

# console errors we cause on purpose (the broken hoover edit) or that come from missing test samples
expected = ('Failed to load resource', 'sx is not defined')
errors = [l for l in logs if l.startswith('PAGEERROR') or (l.startswith('error') and not any(x in l for x in expected))]
check('no page errors', not errors, '\n'.join(errors[:10]))
print('missing sample URLs:', len(missing), missing[:5])
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
