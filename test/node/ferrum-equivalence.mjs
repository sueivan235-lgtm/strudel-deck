// The deck version of FERRUM must produce exactly the events of the original set:
// same onsets and values, with the original fader × MASTER becoming the deck's
// layer gain × master (applied as postgain by the engine).
import { readFileSync } from 'node:fs';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import { transpiler } from '@strudel/transpiler';

const { evalScope, evaluate, Pattern, silence, ref } = core;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const OLD = read('../data/ferrum-original.js');
const NEW = read('../../src/songs/ferrum.strudel');

let current; // the evaluation being collected
Pattern.prototype.p = function (id) {
  if (typeof id === 'string' && (id.startsWith('_') || id.endsWith('_'))) return silence;
  current.pats[id] = this;
  return this;
};
await evalScope(core, mini, {
  samples: async () => {},
  setcpm: (x) => { current.cpm = x; },
  setcps: () => {},
  sliderWithID: (id, value) => {
    const ev = current; // each evaluation keeps its own values
    ev.vals[id] = value;
    return ref(() => ev.vals[id]);
  },
});

async function load(code) {
  const ev = { pats: {}, vals: {}, names: {}, cpm: null };
  current = ev;
  const { widgets } = transpiler(code, { emitWidgets: true });
  for (const w of widgets.filter((w) => w.type === 'slider')) {
    const m = code.slice(0, w.from).match(/const\s+([A-Z_0-9]+)\s*=\s*slider\($/);
    ev.names[m[1]] = 'slider_' + w.from;
  }
  await evaluate(code, transpiler);
  ev.set = (name, v) => { if (ev.names[name]) ev.vals[ev.names[name]] = v; };
  ev.get = (name) => ev.vals[ev.names[name]];
  return ev;
}

const oldEv = await load(OLD);
const newEv = await load(NEW);
const cps = oldEv.cpm / 60;
const problems = [];
if (oldEv.cpm !== newEv.cpm) problems.push(`tempo differs: ${oldEv.cpm} vs ${newEv.cpm}`);

const FADERS = ['KICK', 'RUMBLE', 'ROLLING', 'NOISE', 'DRONE', 'HATS', 'OPENHAT', 'RIDE', 'CRASH', 'BREAKS',
  'CLAP', 'PERC', 'TOMS', 'ACID', 'STAB', 'HOOVER', 'VOX', 'RISER', 'SNROLL'];
const layers = Object.keys(oldEv.pats);
const newLayers = Object.keys(newEv.pats);
if (layers.join() !== newLayers.join()) problems.push(`layers differ:\n  ${layers.join(' ')}\n  ${newLayers.join(' ')}`);
const shared = Object.keys(newEv.names);
const missing = shared.filter((n) => !oldEv.names[n]);
if (missing.length) problems.push(`controls not in the original: ${missing}`);
const removed = Object.keys(oldEv.names).filter((n) => !newEv.names[n]);
console.log('controls removed (now deck faders):', removed.join(' '));

// original: every fader at 1 and MASTER 1 -> postgain 1; deck: no postgain
for (const f of FADERS) oldEv.set(f, 1);
oldEv.set('MASTER', 1);

function norm(v, fromOld) {
  const o = { ...v };
  if (fromOld && 'delaytime' in o) {
    // the original set delaytime to 0.75 beat in seconds; the deck version relies on delaysync's default (3/16 cycle)
    if (Math.abs(o.delaytime - 3 / 16 / cps) > 1e-9) problems.push(`unexpected delaytime ${o.delaytime}`);
    delete o.delaytime;
  }
  o.postgain = o.postgain ?? 1;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, typeof o[k] === 'number' ? Number(o[k].toPrecision(12)) : o[k]]));
}
function compare(tag, from = 0, to = 16) {
  let n = 0;
  for (const l of layers) {
    const a = oldEv.pats[l].queryArc(from, to).filter((h) => h.hasOnset());
    const b = newEv.pats[l].queryArc(from, to).filter((h) => h.hasOnset());
    if (a.length !== b.length) { problems.push(`${tag} ${l}: ${a.length} vs ${b.length} events`); continue; }
    const key = (h) => h.whole.begin.toFraction() + ' ' + h.whole.end.toFraction();
    const sa = a.map((h) => key(h) + ' ' + norm(h.value, true)).sort();
    const sb = b.map((h) => key(h) + ' ' + norm(h.value, false)).sort();
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) { problems.push(`${tag} ${l}: event differs\n    old ${sa[i].slice(0, 400)}\n    new ${sb[i].slice(0, 400)}`); break; }
    }
    n += a.length;
  }
  return n;
}

const set = (name, v) => { oldEv.set(name, v); newEv.set(name, v); };
set('BUILD', 1);
let total = compare('defaults+BUILD1');
// every position of every stepped control
for (const name of shared) {
  const id = newEv.names[name];
  const code = NEW.slice(Number(id.slice(7)));
  const m = code.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*1\)/);
  if (!m) continue;
  const [lo, hi] = [Number(m[2]), Number(m[3])];
  const orig = newEv.get(name);
  const positions = hi - lo > 8 ? [lo, lo + 1, 7, hi] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  for (const v of positions) {
    set(name, v);
    total += compare(`${name}=${v}`, 0, 8);
  }
  set(name, orig);
}
// continuous macros at their extremes
for (const [name, vals] of Object.entries({ HARD: [0, 1], FILTER: [0, 1], LOWCUT: [20, 800], PUMP: [0, 0.02, 1],
  SPACE: [0, 1], ECHO: [0, 1], BUILD: [0, 0.03, 0.3, 0.6], ACID_ENV: [0, 8], ACID_LP: [100, 4000], RUMBLE_LP: [60, 500] })) {
  const orig = newEv.get(name);
  for (const v of vals) {
    set(name, v);
    total += compare(`${name}=${v}`, 0, 8);
  }
  set(name, orig);
}
console.log('compared events:', total);

// original fader at 0 must silence the layer; the deck does that with mute (checked in the browser tests)
console.log(problems.length ? `PROBLEMS (${problems.length}):\n` + [...new Set(problems)].slice(0, 30).join('\n') : 'EQUIVALENT: every event matches the original');
process.exit(problems.length ? 1 : 0);
