// Guide texts. Examples marked with ex() get "Try" and "strudel.cc" buttons.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ex = (code) => `<pre class="ex">${esc(code.trim())}</pre>`;
const code = (s) => `<code>${esc(s)}</code>`;

export const DECK = `
<h2>Strudel Deck</h2>
<p>The deck reads your Strudel code and turns it into a mixing desk: every layer gets a channel strip, every
<code>slider()</code> becomes a control, and sections in the code become sections on the deck. Change the code
and press Update: the deck follows. Nothing here is specific to one song.</p>

<h3>Quick start</h3>
<ol>
<li><b>Play</b> (Space). Browsers only allow sound after a click or key press, so the first press starts the audio. The first run downloads samples; give it a few bars.</li>
<li>Bring layers in and out with <b>M</b> (mute) and <b>S</b> (solo), or keys <kbd>1</kbd>–<kbd>0</kbd> and <kbd>Q</kbd>–<kbd>P</kbd> (Shift = solo).</li>
<li>Ride the faders and controls. Switches change patterns and sounds instantly.</li>
<li>Recall a <b>scene</b> (<kbd>A</kbd>–<kbd>K</kbd>). It lands on the next bar; pick a fade to glide into it.</li>
<li>Click a strip's name to open that layer: edit it, listen to it alone, apply.</li>
<li>Turn on <b>Lock</b> before a gig: the code and songs are protected, the controls still work.</li>
</ol>

<h3>How the deck reads code</h3>
<table class="conv">
<tr><td>${code('kick: s("bd*4")')}</td><td>A <b>layer</b>. The label becomes a channel strip.</td></tr>
<tr><td>${code('_kick: …')}</td><td>Strudel's own off switch. The strip shows "off in code".</td></tr>
<tr><td>${code('Skick: …')}</td><td>Strudel's solo in code. Avoid layer names that start with a capital S, and JavaScript keywords (try, new, if…).</td></tr>
<tr><td>${code('const CUT = slider(800, 100, 5000)')}</td><td>A <b>control</b> named CUT. Use CUT anywhere: ${code('.lpf(CUT)')}.</td></tr>
<tr><td>${code('slider(0, 0, 3, 1) // a · b · c · d')}</td><td>A step of 1 makes a <b>switch</b>. The comment names the positions (separate them with · or |).</td></tr>
<tr><td>${code('slider(0.5, 0, 1) // what it does')}</td><td>Any other comment after a slider is shown as its help text.</td></tr>
<tr><td>${code('// ─── DRUMS ───')}</td><td>A comment made of a rule and a title starts a <b>section</b>. Also works: ${code('// == DRUMS ==')}, ${code('// # Drums')}.</td></tr>
</table>
<p>The deck also works out which controls each layer uses, through constants and helpers, so hovering a strip lights up its controls, and the layer view lists them.</p>
<p>Keep controls as <code>const</code> at the top level. Sliders inside a layer work too; they are named after the layer and function (for example <code>kick · lpf</code>).</p>

<h3>Mixer</h3>
<ul>
<li><b>Faders</b> scale each layer after its effects (a multiplier on ${code('postgain')}), so a layer's reverb and delay sends follow it. The line on the fader is 0 dB. Drag; Shift = fine; double-click = 0 dB.</li>
<li>Faders, mutes and solos act on the <b>next note</b> of a layer: a long pad keeps ringing until it retriggers. The <b>master</b> works on the output directly and changes everything at once.</li>
<li><b>Mute</b> drops the layer's events on the deck; the code keeps running. <b>Off in code</b> (the ${code('_')} prefix) stops the pattern entirely, which saves the most CPU, but needs an Update to come back.</li>
<li><b>Solo</b>: only soloed layers play. A layer marked solo-safe (like FERRUM's <code>pump</code>, which drives the sidechain) keeps playing during solos.</li>
<li><b>M/S land</b> sets whether mutes and solos act now, on the next beat or on the next bar.</li>
<li>The LED blinks when the layer triggers; the text under the name is its last sound.</li>
</ul>

<h3>Controls</h3>
<ul>
<li>Sliders: click to jump, drag to move, Shift for fine moves, double-click the number to type a value.</li>
<li>Steppers (many positions, like seeds): − and +, drag the number sideways, ⚄ picks a random value.</li>
<li>Click a control to select it, then use the arrow keys (Shift = fine).</li>
<li>Every change is written back into the code, so the code always shows the current state.</li>
</ul>

<h3>Scenes</h3>
<p>A scene stores every control value, fader and mute. Click an empty pad (or Shift-click any pad) to store; click to recall. Right-click to rename or clear.</p>
<ul>
<li><b>Land</b>: now, next beat or next bar. The pad blinks until it lands.</li>
<li><b>Fade</b>: sliders and faders glide to the scene over that many bars. Switch positions change where the scene lands.</li>
<li><b>Layers</b>: <i>cut</i> switches layers on and off where the scene lands; <i>fade</i> fades them in and out over the fade.</li>
</ul>
<p>In FERRUM, recalling <b>Break</b> with an 8-bar fade is a whole build: the kick drops on the bar while BUILD, LOWCUT and FILTER ramp for eight bars. Then recall <b>Drop</b> with no fade.</p>

<h3>Keys and MIDI</h3>
<p>Press <b>Map</b>, click any strip, control, scene pad or the master, then press <b>Learn</b> and a key (Shift and Option combinations work) or move a MIDI control. Mute and solo keys can <i>toggle</i> or work while <i>held</i>. Continuous controls get up/down keys with a step size, a hold key (jump to a value while held, back on release: good for filter throws), and a MIDI knob. The Keys tab lists everything.</p>
<p>MIDI needs Chrome or Edge. Click the MIDI chip (or "turn on MIDI" in a mapping popup) and allow access. Knobs and faders are absolute; buttons sending CC 127/0 work for mute and solo.</p>
<p>While the cursor is in the code, keys type code. Press Esc to hand them back to the deck (the KEYS chip shows which).</p>

<h3>Editing a layer</h3>
<p>Click a strip's name. The layer's own code opens on the left. Change it and press Apply (Ctrl/Cmd+Enter): the deck puts it back into the full code and updates without stopping. <b>Listen alone</b> solos it; <b>Solo-safe</b> keeps it playing while other layers are soloed. The chips show which Strudel functions it uses (click one for its reference) and which constants and helpers it depends on (click to find them in the code). Duplicate, Rename and Delete work on the code too.</p>
<p>Code that fails keeps the last working version playing and shows the error under the editor.</p>
<p>Edits made from the deck (Apply with a new label, Rename, Delete, Off in code, Duplicate) take the layer's fader, mute, scene values and key bindings along, also when <code>$:</code> layers get renumbered. Edits you type straight into the code can't be followed that way: give layers names and controls <code>const</code> names if you want mappings that survive any edit.</p>
<p>Two layers with the same label: Strudel plays only the last one. The deck shows the first as "duplicate name" and warns above the mixer.</p>

<h3>Songs, saving, sharing</h3>
<ul>
<li>Everything saves automatically in this browser, per song: code, faders, mutes, scenes and mappings.</li>
<li>Export file saves code and deck together (.deck.json); Import reads that or plain Strudel code.</li>
<li>Open in strudel.cc sends the code as it sounds right now: deck mutes become ${code('_')} labels and fader levels become ${code('.mul(postgain(…))')}.</li>
<li>Built-in songs can be reset to the original from the song menu.</li>
</ul>

<h3>On stage</h3>
<ul>
<li>Keep the meter out of the red. The browser clips hard at 0 dBFS; pull the master down rather than individual layers.</li>
<li>If the audio crackles, mute or switch off (in code) the layers you are not using, and close other tabs.</li>
<li>Use wired headphones or an audio interface. Bluetooth adds a delay you will hear when you press keys.</li>
<li>Store your own scenes during rehearsal; the built-in ones are a starting point.</li>
</ul>
`;

export const CONCEPTS = `
<h2>Strudel concepts</h2>
<p>A short tour of what the code does, with the parts that matter for hard, loop-based music. Each example has <b>Try</b> (adds it as a soloed layer called <code>tryout</code>; delete it from its strip when done) and <b>strudel.cc</b> (opens it there). The official workshop goes deeper: see Links.</p>

<h3>Cycles and tempo</h3>
<p>Strudel counts time in <b>cycles</b>. A pattern fills one cycle, however many events it has: ${code('"bd sd"')} is two halves, ${code('"bd sd hh cp"')} four quarters. With ${code('setcpm(150/4)')} one cycle is one 4/4 bar at 150 BPM, which is what the deck assumes when it shows bars and beats.</p>
${ex('s("bd*4, [~ hh]*4, ~ cp ~ cp")')}

<h3>Mini-notation</h3>
<p>The text in double quotes is mini-notation, a compact rhythm language from TidalCycles.</p>
<table class="conv">
<tr><td>${code('"bd sd"')}</td><td>sequence: equal slices of the cycle</td></tr>
<tr><td>${code('"bd [sd sd]"')}</td><td>brackets subdivide a slice</td></tr>
<tr><td>${code('"bd*4"')} ${code('"bd/2"')}</td><td>repeat faster; stretch over more cycles</td></tr>
<tr><td>${code('"<bd sd cp>"')}</td><td>one per cycle, in turn</td></tr>
<tr><td>${code('"bd ~ ~ bd"')}</td><td>~ (or -) is a rest</td></tr>
<tr><td>${code('"bd, hh*8"')}</td><td>comma: play at the same time</td></tr>
<tr><td>${code('"bd!3 sd"')} ${code('"bd@3 sd"')}</td><td>! repeats a step; @ makes it longer</td></tr>
<tr><td>${code('"hh*16?"')}</td><td>? drops events at random (half of them)</td></tr>
<tr><td>${code('"bd(3,8)"')} ${code('"bd(3,8,2)"')}</td><td>Euclidean rhythm: 3 hits spread over 8 steps, rotated by 2</td></tr>
<tr><td>${code('"bd:3"')}</td><td>sample number 3 of the bd folder</td></tr>
<tr><td>${code('"bd | cp"')}</td><td>random choice, per cycle</td></tr>
<tr><td>${code('"{bd sd hh}%4"')}</td><td>polymeter: 4 steps per cycle through a 3-step list</td></tr>
</table>
${ex('s("bd(3,8), hh*16?, <~ cp>")')}

<h3>Sounds</h3>
<ul>
<li><b>Samples</b>: ${code('s("bd")')}; pick one with ${code('.n(3)')} or ${code('"bd:3"')}; drum machines with ${code('.bank("RolandTR909")')}. Load more with ${code("samples('github:user/repo')")} (the repo needs a strudel.json).</li>
<li><b>Synths</b>: ${code('sine')}, ${code('sawtooth')}, ${code('square')}, ${code('triangle')}, ${code('supersaw')}, and the noises ${code('white')}, ${code('pink')}, ${code('brown')}. Give them notes: ${code('note("c2 eb2").s("sawtooth")')}.</li>
<li><b>Notes</b> are names (${code('c2')}, ${code('eb3')}) or MIDI numbers (29 = F1). ${code('.add(12)')} moves up an octave; that is how a key-shift control like TRANS works.</li>
</ul>
${ex('note("<[c1 ~ c2 ~]*2 [eb1 ~ eb2 ~]*2>").s("sawtooth").lpf(500).decay(0.2).sustain(0)')}

<h3>Rhythm and structure</h3>
<ul>
<li>${code('.struct("x ~ x x")')} plays the sound on the x's; ${code('.mask("1 1 1 0")')} silences parts of a pattern.</li>
<li>${code('.fast(2)')}, ${code('.slow(2)')}, ${code('.ply(2)')} (repeat each event), ${code('.off(1/8, x => x.add(12))')} (a shifted copy).</li>
<li>${code('.lastOf(8, x => x.mask("1 1 1 0"))')}: change the last bar of every 8. That is how FERRUM's kick fills work.</li>
<li>${code('.sometimesBy(.3, x => x.speed(2))')}, ${code('.degradeBy(.2)')}: controlled randomness.</li>
<li>${code('SWITCH.pick([a, b, c])')}: choose between whole patterns with a control. Most switches in FERRUM are a pick.</li>
<li>${code('.ribbon(seed, 2)')}: loop a 2-cycle slice of a random pattern; a new seed is a new groove.</li>
</ul>
${ex('s("hh*16").gain("[.4 .7]*8").sometimesBy(.25, x => x.speed(1.5)).ribbon(7, 2)')}

<h3>Filters and envelopes</h3>
<ul>
<li>${code('.lpf(800)')} low-pass, ${code('.hpf(300)')} high-pass, ${code('.bpf(1200)')} band-pass, in Hz. ${code('.lpq(10)')} adds resonance; ${code('.ftype("ladder")')} gives the Moog-style filter used for acid.</li>
<li>Amplitude envelope: ${code('.attack(.01).decay(.2).sustain(0).release(.1)')}. Short decay with sustain 0 makes plucks and hits.</li>
<li>Filter envelope: ${code('.lpenv(4).lpdecay(.12)')} opens the filter on each note: the acid squelch.</li>
<li>Pitch envelope: ${code('.penv(36).pdecay(.08)')} drops the pitch fast: a synthetic kick.</li>
</ul>
${ex('note("f1*8").s("sawtooth").lpf(300).lpq(18).lpenv(5).lpdecay(.12).ftype("ladder").decay(.13).sustain(0)')}
${ex('note("f1*4").s("sine").penv(36).pdecay(.08).decay(.38).distort(4).distortvol(.4)')}

<h3>Drive and gain</h3>
<ul>
<li>${code('.distort(3)')} is wave-shaping drive (0–10 is the useful range). ${code('.distorttype(4)')} picks the curve: 0 scurve, 1 soft, 2 hard, 3 cubic, 4 diode, 5 asym, 6 fold, 7 sinefold, 8 chebyshev. ${code('.distortvol(.5)')} trims the output.</li>
<li>${code('.crush(6)')} reduces bit depth (lower = dirtier), ${code('.coarse(8)')} reduces the sample rate, ${code('.shape(.5)')} is a gentler shaper.</li>
<li>${code('.gain()')} acts before the effects (so it drives the distortion harder), ${code('.velocity()')} scales it, ${code('.postgain()')} acts after the effects. The deck's faders multiply ${code('postgain')}.</li>
<li>Fold and chebyshev shaping add harmonics but thin out the sub; on kicks and bass, soft, cubic and diode keep the low end. FERRUM's <code>.gritlow()</code> does that switch for you.</li>
</ul>

<h3>Space and buses (orbits)</h3>
<ul>
<li>${code('.room(.4)')} sends to the reverb (${code('.roomsize(3)')}, ${code('.roomlp(500)')} darkens it). ${code('.delay(.3)')} sends to the delay; ${code('.delaytime()')} in seconds or ${code('.delaysync(3/16)')} in cycles (3/16 = dotted 8th, the default), ${code('.delayfeedback(.45)')}.</li>
<li>An <b>orbit</b> is an effects bus with one reverb and one delay. Layers on the same orbit share them, so their reverb and delay settings should match. Separate buses with ${code('.orbit(2)')}. FERRUM uses 1 kick, 2 low end, 3 effects, 4 dry tops.</li>
<li>${code('.dry(0)')} removes the direct sound and keeps only the sends: the rumble trick, where the kick is heard only through a dark reverb.</li>
</ul>

<h3>Sidechain and DJ filter</h3>
<ul>
<li>${code('.duckorbit(2).duckdepth(.9).duckattack(.25)')} on a trigger ducks everything on orbit 2 each time the trigger plays; duckattack is the recovery time in seconds. Put it on a silent copy of the kick (${code('.postgain(0)')}) and the pumping keeps going when you mute the kick.</li>
<li>${code('.djf(.3)')} is a one-knob DJ filter per orbit: below .5 low-pass, above .5 high-pass, .5 off.</li>
</ul>
${ex('note("f2*16").s("supersaw").lpf(900).orbit(2).room(.3)')}

<h3>Signals and randomness</h3>
<ul>
<li>Continuous signals: ${code('sine')}, ${code('saw')}, ${code('tri')}, ${code('square')}, ${code('rand')}, ${code('perlin')}. Scale with ${code('.range(200, 2000)')}, slow down with ${code('.slow(8)')}: ${code('.lpf(sine.range(200, 2000).slow(8))')}.</li>
<li>${code('irand(8)')} random integers, ${code('.segment(16)')} samples a signal 16 times per cycle.</li>
<li>Randomness is tied to time, not to the moment you press play: the same cycle always gives the same result. That is why ${code('.ribbon()')} can loop it.</li>
</ul>
${ex('s("metal*16").n(irand(12)).speed(rand.range(.8, 1.4)).hpf(400).gain(.5).ribbon(3, 1)')}

<h3>Hard techno moves</h3>
<ul>
<li><b>Rumble</b>: a low-passed, driven sine on the kick grid, sent only to a big dark reverb, ducked by the kick.</li>
<li><b>Build</b>: raise a high-pass on the low end, bring in a noise riser with a rising filter, double the snare roll density, then cut all of it on the drop. One control (BUILD) can drive all three.</li>
<li><b>Phrases</b>: change something every 8 or 16 bars. Land scenes and mutes on the bar.</li>
<li><b>Variation without new code</b>: seeds (${code('.ribbon(SEED, n)')}), pattern switches (${code('.pick()')}), drive flavour, key shift.</li>
<li><b>Tension</b>: pull the DJ filter down over a phrase, drop the kick for 4–8 bars, and let the sidechained low end keep pumping.</li>
</ul>
`;

export const KEYS_STATIC = `
<h3>Always there</h3>
<table class="conv">
<tr><td><kbd>Esc</kbd></td><td>leave the code editor (keys go back to the deck), close popups</td></tr>
<tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>move the selected control, fader or master (Shift = fine)</td></tr>
<tr><td><kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd></td><td>in the code: evaluate and play (Strudel's own shortcut); in a layer: Apply</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>.</kbd></td><td>in the code: stop</td></tr>
</table>
`;

export const LINKS = `
<h2>Links</h2>
<h3>Strudel workshop (start here)</h3>
<ul>
<li><a href="https://strudel.cc/workshop/getting-started/" target="_blank" rel="noopener">Getting started</a></li>
<li><a href="https://strudel.cc/workshop/first-sounds/" target="_blank" rel="noopener">First sounds</a> · samples, mini-notation basics</li>
<li><a href="https://strudel.cc/workshop/first-notes/" target="_blank" rel="noopener">First notes</a> · notes, synths, scales</li>
<li><a href="https://strudel.cc/workshop/first-effects/" target="_blank" rel="noopener">First effects</a> · filters, envelopes, reverb, delay</li>
<li><a href="https://strudel.cc/workshop/pattern-effects/" target="_blank" rel="noopener">Pattern effects</a> · rev, jux, off, ply</li>
<li><a href="https://strudel.cc/workshop/recap/" target="_blank" rel="noopener">Workshop recap</a> · one-page summary</li>
</ul>
<h3>Reference</h3>
<ul>
<li><a href="https://strudel.cc/learn/mini-notation/" target="_blank" rel="noopener">Mini-notation</a></li>
<li><a href="https://strudel.cc/understand/cycles/" target="_blank" rel="noopener">Understanding cycles</a> and <a href="https://strudel.cc/understand/pitch/" target="_blank" rel="noopener">pitch</a></li>
<li><a href="https://strudel.cc/learn/samples/" target="_blank" rel="noopener">Samples</a> · loading your own, banks, GitHub packs</li>
<li><a href="https://strudel.cc/learn/synths/" target="_blank" rel="noopener">Synths</a></li>
<li><a href="https://strudel.cc/learn/effects/" target="_blank" rel="noopener">Audio effects</a> · filters, envelopes, drive, orbits, reverb, delay, ducking</li>
<li><a href="https://strudel.cc/learn/signals/" target="_blank" rel="noopener">Continuous signals</a>, <a href="https://strudel.cc/learn/random-modifiers/" target="_blank" rel="noopener">random modifiers</a>, <a href="https://strudel.cc/learn/conditional-modifiers/" target="_blank" rel="noopener">conditional modifiers</a>, <a href="https://strudel.cc/learn/accumulation/" target="_blank" rel="noopener">accumulation</a></li>
<li><a href="https://strudel.cc/learn/time-modifiers/" target="_blank" rel="noopener">Time modifiers</a> · fast, slow, early, late, ribbon</li>
<li><a href="https://strudel.cc/learn/tonal/" target="_blank" rel="noopener">Tonal functions</a> · scales, chords, voicings</li>
<li><a href="https://strudel.cc/learn/stepwise/" target="_blank" rel="noopener">Stepwise patterning</a></li>
<li><a href="https://strudel.cc/learn/code/" target="_blank" rel="noopener">Coding syntax</a> · labels, $:, _ and S prefixes</li>
<li><a href="https://strudel.cc/learn/input-output/" target="_blank" rel="noopener">MIDI, OSC and MQTT</a> · sending MIDI out of Strudel</li>
</ul>
<h3>Code</h3>
<ul>
<li><a href="https://strudel.cc/" target="_blank" rel="noopener">strudel.cc</a> · the Strudel REPL</li>
<li><a href="https://codeberg.org/uzu/strudel" target="_blank" rel="noopener">Strudel source</a> · AGPL-3.0; this deck is built on its packages</li>
</ul>
`;
