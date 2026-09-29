// Build the searchable function reference (src/guide/reference.json) from Strudel's
// JSDoc export (data/strudel-doc.json, generated from the Strudel sources, AGPL-3.0).
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(new URL('../data/strudel-doc.json', import.meta.url), 'utf8'));

// internals and plumbing that would only confuse
const SKIP = new Set(`Pattern withValue fmap appWhole appBoth appLeft appRight queryArc splitQueries withQuerySpan
withQueryTime withHapSpan withHapTime withHaps withHap setContext withContext stripContext withLoc filterHaps
filterValues removeUndefineds onsetsOnly discreteOnly defragmentHaps firstCycle firstCycleValues showFirstCycle
sortHapsByPart sequenceP slowcatPrime seqPLoop parray FX K worklet markcss onTriggerTime into reset restart gap
compileKabel _initialize`.split(/\s+/));
const SKIP_FILES = new Set(['ola-processor.js', 'worklets.mjs', 'reverbGen.mjs', 'dough.mjs', 'util.mjs', 'index.mjs', 'codemirror.mjs']);

const CATS = [
  ['Sound sources', 's sound n note bank freq source detune unison spread density wt wtenv wtattack wtdecay wtsustain wtrelease wtrate wtsync wtdepth wtshape wtdc wtskew wtphaserand warp warpattack warpdecay warpsustain warprelease warprate warpdepth warpshape warpdc warpskew warpmode warpenv warpsync fmh fmi fmenv fmattack fmwave fmdecay fmsustain fmrelease pw pwrate pwsweep noise vib vibmod byteBeatExpression byteBeatStartTime partials phases'],
  ['Samples', 'begin end loop loopBegin loopEnd speed accelerate cut chop striate slice splice fit loopAt loopAtCps unit clip legato scrub stretch transient'],
  ['Rhythm and time', 'fast slow hurry early late ply segment seg swingBy swing off iter iterBack rev revv palindrome linger zoom compress fastGap inside outside euclid euclidRot euclidLegato euclidLegatoRot euclidFull struct mask pace polymeter stepcat timecat cpm ribbon press pressBy brak beat run binary binaryN bite focus repeatCycles plyWith plyForEach take drop extend replicate expand contract shrink grow tour zip stepalt'],
  ['Structure and variation', 'every lastOf firstOf when within chunk chunkBack fastChunk chunkInto chunkBackInto sometimes sometimesBy often rarely almostNever almostAlways never always someCycles someCyclesBy degrade degradeBy undegradeBy pick pickRestart pickReset pickOut pickmod inhabit inhabitmod squeeze arrange cat seq sequence stack layer superimpose jux juxBy echo echoWith stut choose chooseCycles wchoose wchooseCycles randcat wrandcat filter filterWhen tag apply xfade morph silence'],
  ['Signals and randomness', 'sine cosine saw isaw tri itri square rand irand brand brandBy perlin range rangex range2 toBipolar fromBipolar mouseX mouseY'],
  ['Filters', 'lpf cutoff lp ctf hpf hcutoff hp bpf bandf bp lpq resonance hpq hresonance bpq bandq ftype vowel djf lpenv lpattack lpdecay lpsustain lprelease hpenv hpattack hpdecay hpsustain hprelease bpenv bpattack bpdecay bpsustain bprelease fanchor'],
  ['Envelopes', 'attack att decay dec sustain sus release rel adsr penv pattack pdecay prelease pcurve panchor'],
  ['Drive and grit', 'distort dist distortvol distorttype shape crush coarse soft hard cubic diode asym fold sinefold chebyshev drive squiz'],
  ['Space and buses', 'room roomsize size rsize roomfade rfade roomlp rlp roomdim rdim iresponse ir irbegin irspeed delay delaytime delayt dt delayfeedback delayfb dfb delaysync delayspeed orbit pan dry bus busgain'],
  ['Dynamics and sidechain', 'gain velocity postgain amp compressor duckorbit duck duckdepth duckattack duckonset'],
  ['Modulation', 'tremolo tremolosync tremolodepth tremoloskew tremolophase tremoloshape am phaser phasersweep phasercenter phaserdepth chorus lfo leslie lrate lsize bmod lpdc lpdepth lpdepthfrequency lprate lpshape lpskew lpsync hpdc hpdepth hpdepthfrequency hprate hpshape hpskew hpsync bpdc bpdepth bpdepthfrequency bprate bpshape bpskew bpsync'],
  ['Notes and harmony', 'scale scaleTranspose transpose voicing voicings chord rootNotes arp arpWith add sub mul div round floor ceil octave octaves dictionary anchor mode offset invert ratio'],
  ['Input, output, visuals', 'midi midin midiport midichan ccn ccv control midibend midicmd miditouch nrpnn nrpv progNum sysex sysexdata sysexid channel channels osc oschost oscport mqtt pianoroll punchcard scope spiral pitchwheel spectrum drawLine color label'],
];
const catOf = new Map();
for (const [cat, names] of CATS) for (const n of names.split(/\s+/)) catOf.set(n, cat);
const FILE_CAT = { 'signal.mjs': 'Signals and randomness', 'pick.mjs': 'Structure and variation', 'euclid.mjs': 'Rhythm and time',
  'midi.mjs': 'Input, output, visuals', 'osc.mjs': 'Input, output, visuals', 'pianoroll.mjs': 'Input, output, visuals', 'scope.mjs': 'Input, output, visuals',
  'spiral.mjs': 'Input, output, visuals', 'spectrum.mjs': 'Input, output, visuals', 'pitchwheel.mjs': 'Input, output, visuals', 'drawLine.mjs': 'Input, output, visuals',
  'tonal.mjs': 'Notes and harmony', 'voicings.mjs': 'Notes and harmony', 'motion.mjs': 'Input, output, visuals', 'sampler.mjs': 'Samples', 'wavetable.mjs': 'Sound sources',
  'repl.mjs': 'Rhythm and time', 'slider.mjs': 'Input, output, visuals' };

// keep a small, safe subset of HTML
function clean(html) {
  if (!html) return '';
  return html
    .replace(/<(\/?)(p|code|strong|em|ul|ol|li|pre|blockquote|br)\b[^>]*>/gi, '<$1$2>')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, (_, href) => {
      const url = /^https?:\/\//.test(href) ? href : href.startsWith('/') ? `https://strudel.cc${href}` : null;
      return url ? `<a href="${url}" target="_blank" rel="noopener">` : '<a>';
    })
    .replace(/<(?!\/?(p|code|strong|em|ul|ol|li|pre|blockquote|br|a)\b)[^>]*>/gi, '')
    .trim();
}

const byName = new Map();
for (const e of src) {
  const name = e.name;
  if (!name || SKIP.has(name) || e.access === 'private' || e.kind === 'class') continue;
  const file = e.meta?.filename;
  if (SKIP_FILES.has(file)) continue;
  if (!e.description && !e.examples?.length) continue;
  if (e.memberof && !['Pattern', null, undefined].includes(e.memberof)) continue;
  const entry = {
    name,
    syn: (e.synonyms || []).filter((s) => s !== name),
    cat: catOf.get(name) || FILE_CAT[file] || 'Other',
    desc: clean(e.description),
    params: (e.params || []).map((p) => ({ name: p.name, type: (p.type?.names || []).join(' | '), desc: clean(p.description) })),
    ex: (e.examples || []).map((x) => x.trim()),
  };
  if (e.deprecated) entry.dep = true;
  const prev = byName.get(name);
  // keep the richer duplicate
  if (!prev || (entry.desc.length + entry.ex.length * 50 > prev.desc.length + prev.ex.length * 50)) byName.set(name, entry);
}
const out = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL('../src/guide/reference.json', import.meta.url), JSON.stringify(out));
const cats = {};
for (const e of out) cats[e.cat] = (cats[e.cat] || 0) + 1;
console.log(`reference: ${out.length} entries`, cats);
