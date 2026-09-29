// Static analysis of Strudel code: what the deck shows is derived from the code itself.
//
//   // ─── SECTION ───            a comment made of a rule + a title starts a section
//   const NAME = slider(v, min, max, step)   // a · b · c    a named control; the trailing
//                                                            comment gives switch labels or help
//   name: <pattern>                a layer (Strudel's labelled pattern); _name: is off, Sname: solo
//
// Positions match @strudel/transpiler, which ids sliders as `slider_<start of first argument>`.
import { parse as acornParse } from 'acorn';
import * as walk from 'acorn-walk';

const RULE = '─━═=\\-#*~_';
const HEADER_RE = new RegExp(`^\\s*(?:[${RULE}]{2,}|#)\\s*(.*?)\\s*[${RULE}]*\\s*$`);

/** Title of a section header comment, or null. */
export function sectionTitle(commentText) {
  const m = HEADER_RE.exec(commentText);
  if (!m) return null;
  const title = m[1].trim();
  if (!title || !/[\p{L}\p{N}]/u.test(title)) return null;
  return title;
}

function num(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
    return -node.argument.value;
  }
  return null;
}

/** Split a trailing comment into switch labels (when it lists one per position) and help text. */
export function parseOptions(text, count) {
  const t = (text || '').trim();
  if (!t) return { labels: null, help: '' };
  const parts = t.split(/\s+[·|]\s+|\s*[·|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (count == null || parts.length < 2) return { labels: null, help: t };
  let help = '';
  // "drive flavour: 0 soft · 1 diode ..." -> help before the colon
  const colon = parts[0].match(/^(.*?):\s+(.+)$/);
  if (colon && !/^\d/.test(colon[1])) {
    help = colon[1].trim();
    parts[0] = colon[2].trim();
  }
  const numbered = parts.map((p) => p.match(/^(-?\d+)\s+(.+)$/));
  let labels = null;
  if (numbered.every(Boolean)) {
    const byIndex = new Map(numbered.map((m) => [Number(m[1]), m[2].trim()]));
    // numbers may be values (0 1 2) or offsets; accept when they cover the positions
    labels = Array.from({ length: count }, (_, i) => byIndex.get(i) ?? null);
    if (labels.every((l) => l == null)) labels = null;
  } else if (parts.length === count) {
    labels = parts;
  }
  if (!labels) return { labels: null, help: t };
  return { labels: labels.map((l, i) => l ?? String(i)), help };
}

/** Short text for a switch button (full label stays available as a tooltip). */
export function shortLabel(label) {
  const cut = label.indexOf(' (');
  return cut > 0 ? label.slice(0, cut) : label;
}

function identifiersIn(node) {
  const ids = new Set();
  const members = new Set();
  walk.full(node, (n) => {
    if (n.type === 'Identifier') ids.add(n.name);
    else if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') members.add(n.property.name);
  });
  // walk.full visits non-computed member properties as Identifiers too? (it does not: base.MemberExpression
  // only walks the property when computed). Keep both sets separate for clarity.
  return { ids, members };
}

function calleeNames(node) {
  const out = [];
  walk.full(node, (n) => {
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    if (c.type === 'Identifier') out.push({ name: c.name, at: c.start });
    else if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
      out.push({ name: c.property.name, at: c.property.start });
    }
  });
  out.sort((a, b) => a.at - b.at);
  const seen = new Set();
  return out.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true))).map((f) => f.name);
}

function layerInfo(label) {
  let name = label;
  let codeMuted = false;
  let codeSolo = false;
  if (label.startsWith('_') || label.endsWith('_')) {
    codeMuted = true;
    name = label.replace(/^_+|_+$/g, '') || label;
  }
  if (!codeMuted && label.length > 1 && label.startsWith('S')) {
    // Strudel treats any label starting with a capital S as soloed (Skick:)
    codeSolo = true;
    name = label.slice(1);
  }
  return { name, codeMuted, codeSolo };
}

/**
 * Analyse code. Returns { ok, error, sections, sliders, layers, defs, helpers, tempo, lines }.
 * Never throws.
 */
export function analyze(code) {
  const comments = [];
  let ast;
  try {
    ast = acornParse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, locations: true, onComment: comments });
  } catch (e) {
    return {
      ok: false,
      error: { message: e.message, pos: e.pos, line: e.loc?.line, column: e.loc?.column },
      sections: [],
      sliders: [],
      layers: [],
      defs: new Map(),
      helpers: new Map(),
      tempo: null,
      warnings: [],
    };
  }

  // --- sections -------------------------------------------------------------
  const lineStart = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStart.push(i + 1);
  const standalone = (c) => code.slice(lineStart[c.loc.start.line - 1], c.start).trim() === '';
  const sections = [];
  for (const c of comments) {
    if (c.type !== 'Line' || !standalone(c)) continue;
    const title = sectionTitle(c.value);
    if (title) sections.push({ index: sections.length, title, from: c.start, line: c.loc.start.line });
  }
  const sectionAt = (pos) => {
    let s = -1;
    for (const sec of sections) if (sec.from < pos) s = sec.index;
    return s;
  };
  const trailingComment = (line, after) =>
    comments.find((c) => c.type === 'Line' && c.loc.start.line === line && c.start >= after);

  // --- top-level definitions, helpers, layers, tempo ---------------------------
  const defs = new Map(); // name -> { name, kind, from, to, line, deps:Set, members:Set, slider? }
  const helpers = new Map(); // registered method name -> { name, from, to, deps, members }
  const layers = [];
  let tempo = null;
  let anon = 0;
  let anonOff = 0;

  const addDef = (name, kind, node, body) => {
    const { ids, members } = identifiersIn(body);
    const value = num(body);
    const literal = value == null ? null : { from: body.start, to: body.end, value };
    defs.set(name, { name, kind, from: node.start, to: node.end, line: node.loc.start.line, deps: ids, members, literal });
  };

  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        if (d.id.type !== 'Identifier' || !d.init) continue;
        addDef(d.id.name, st.kind, st.declarations.length === 1 ? st : d, d.init);
      }
    } else if (st.type === 'FunctionDeclaration' && st.id) {
      addDef(st.id.name, 'function', st, st.body);
    } else if (st.type === 'LabeledStatement') {
      const label = st.label.name;
      const info = layerInfo(label);
      let name = info.name;
      if (label.includes('$')) name = info.codeMuted ? `_$${anonOff++}` : `$${anon++}`;
      const body = st.body;
      const { ids, members } = identifiersIn(body);
      layers.push({
        name,
        label,
        codeMuted: info.codeMuted,
        codeSolo: info.codeSolo,
        anonymous: label.includes('$'),
        from: st.start,
        to: st.end,
        labelFrom: st.label.start,
        labelTo: st.label.end,
        exprFrom: body.type === 'ExpressionStatement' ? body.expression.start : body.start,
        exprTo: body.type === 'ExpressionStatement' ? body.expression.end : body.end,
        line: st.loc.start.line,
        endLine: st.loc.end.line,
        section: sectionAt(st.start),
        deps: ids,
        members,
        functions: calleeNames(body),
      });
    } else if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
      const call = st.expression;
      const fname = call.callee.type === 'Identifier' ? call.callee.name : null;
      if (fname === 'register' && call.arguments[0]?.type === 'Literal' && typeof call.arguments[0].value === 'string') {
        const hname = call.arguments[0].value;
        const fn = call.arguments[1];
        if (fn) {
          const { ids, members } = identifiersIn(fn);
          helpers.set(hname, { name: hname, from: st.start, to: st.end, line: st.loc.start.line, deps: ids, members });
        }
      }
      if (/^set(cpm|Cpm|cps|Cps)$/.test(fname || '') && call.arguments.length === 1) {
        tempo = findTempo(call, fname, defs);
      }
    }
  }

  // --- unique layer names ---------------------------------------------------------------
  // Strudel plays only the last of two live layers with the same label; the earlier one is
  // "shadowed". A switched-off layer that shares a live name keeps its full label (_kick).
  const warnings = [];
  const lastLive = new Map();
  layers.forEach((l, i) => !l.codeMuted && lastLive.set(l.name, i));
  const taken = new Set(layers.filter((l, i) => !l.codeMuted && lastLive.get(l.name) === i).map((l) => l.name));
  const unique = (base) => {
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base}#${i}`;
    taken.add(n);
    return n;
  };
  layers.forEach((l, i) => {
    if (!l.codeMuted && lastLive.get(l.name) !== i) {
      const winner = layers[lastLive.get(l.name)];
      warnings.push(`Two layers are called ${l.name} (lines ${l.line} and ${winner.line}); Strudel only plays the last one.`);
      l.shadowed = true;
      l.name = unique(l.name);
    } else if (l.codeMuted) {
      l.name = unique(taken.has(l.name) ? l.label : l.name);
    }
  });

  // --- sliders ------------------------------------------------------------------
  const sliders = [];
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'slider') return;
    const a0 = node.arguments[0];
    if (!a0) return;
    const parent = ancestors[ancestors.length - 2];
    const top = ancestors[1];
    let name = null;
    if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') name = parent.id.name;
    const layer = top?.type === 'LabeledStatement' ? layers.find((l) => l.from === top.start) : null;
    // a slider somewhere inside `const X = …` belongs to X
    let owner = null;
    if (top?.type === 'VariableDeclaration') {
      const d = top.declarations.find((x) => x.start <= node.start && node.end <= x.end);
      if (d?.id.type === 'Identifier') owner = d.id.name;
    } else if (top?.type === 'ExpressionStatement' && top.expression.type === 'CallExpression') {
      // …or inside register('name', …): the helper method it defines
      const call = top.expression;
      if (call.callee.type === 'Identifier' && call.callee.name === 'register' && typeof call.arguments[0]?.value === 'string') {
        owner = call.arguments[0].value;
      }
    }
    let method = null;
    if (parent?.type === 'CallExpression' && parent.arguments.includes(node)) {
      const c = parent.callee;
      if (c.type === 'MemberExpression' && !c.computed) method = c.property.name;
      else if (c.type === 'Identifier') method = c.name;
    }
    const value = num(a0);
    const min = node.arguments.length > 1 ? num(node.arguments[1]) : 0;
    const max = node.arguments.length > 2 ? num(node.arguments[2]) : 1;
    const step = node.arguments.length > 3 ? num(node.arguments[3]) : null;
    const endLine = node.loc.end.line;
    const tc = trailingComment(endLine, node.end);
    sliders.push({
      id: `slider_${a0.start}`,
      name,
      layer: layer ? layer.name : null,
      owner,
      method,
      from: a0.start,
      to: a0.end,
      line: node.loc.start.line,
      value,
      min,
      max,
      step,
      comment: tc ? tc.value.trim() : '',
      section: sectionAt(node.start),
      callFrom: node.start,
      callTo: node.end,
    });
  });
  sliders.sort((a, b) => a.from - b.from);

  // stable keys: const name, else layer.method or const.method (#n), else line
  const used = new Map();
  for (const s of sliders) {
    const home = s.layer || s.owner;
    let key = s.name || (home && s.method ? `${home}.${s.method}` : s.method ? `${s.method}@${s.line}` : `slider@${s.line}`);
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    s.key = key;
    s.label = s.name || (home && s.method ? `${home} · ${s.method}` : s.method ? `${s.method} (line ${s.line})` : `slider (line ${s.line})`);
    const count = s.step && s.min != null && s.max != null ? Math.floor(Math.abs(s.max - s.min) / Math.abs(s.step) + 1e-9) + 1 : null;
    const { labels, help } = parseOptions(s.comment, count);
    s.labels = labels;
    s.help = help;
  }

  // --- what each layer depends on ---------------------------------------------------
  const sliderByName = new Map(sliders.filter((s) => s.name).map((s) => [s.name, s]));
  const closure = (ids, members) => {
    const seenDefs = new Set();
    const seenHelpers = new Set();
    const stack = [...ids];
    const mstack = [...members];
    while (stack.length || mstack.length) {
      while (mstack.length) {
        const m = mstack.pop();
        if (seenHelpers.has(m) || !helpers.has(m)) continue;
        seenHelpers.add(m);
        const h = helpers.get(m);
        stack.push(...h.deps);
        mstack.push(...h.members);
      }
      const id = stack.pop();
      if (id == null || seenDefs.has(id) || !defs.has(id)) continue;
      seenDefs.add(id);
      const d = defs.get(id);
      stack.push(...d.deps);
      mstack.push(...d.members);
    }
    return { defs: seenDefs, helpers: seenHelpers };
  };
  for (const l of layers) {
    const { defs: ds, helpers: hs } = closure(l.deps, l.members);
    l.uses = [...ds].filter((n) => !sliderByName.has(n));
    l.helpersUsed = [...hs];
    const keys = new Set();
    for (const n of ds) if (sliderByName.has(n)) keys.add(sliderByName.get(n).key);
    for (const sl of sliders) if (sl.owner && !sl.name && (ds.has(sl.owner) || hs.has(sl.owner))) keys.add(sl.key);
    for (const s of sliders) if (s.layer === l.name && s.from >= l.from && s.to <= l.to) keys.add(s.key);
    l.controls = sliders.filter((s) => keys.has(s.key)).map((s) => s.key);
  }
  for (const s of sliders) {
    s.usedBy = layers.filter((l) => !l.codeMuted && !l.shadowed && l.controls.includes(s.key)).map((l) => l.name);
  }

  return { ok: true, error: null, sections, sliders, layers, defs, helpers, tempo, warnings };
}

function findTempo(call, fname, defs) {
  const kind = /cpm/i.test(fname) ? 'cpm' : 'cps';
  const arg = call.arguments[0];
  // the first number in the argument (the 150 in `150 / 4`), or the number a const holds (`BPM / 4`)
  let lit = null;
  walk.full(arg, (n) => {
    if (lit) return;
    if (n.type === 'Literal' && typeof n.value === 'number') lit = { from: n.start, to: n.end, value: n.value };
    else if (n.type === 'Identifier' && defs.get(n.name)?.literal) lit = { ...defs.get(n.name).literal, via: n.name };
  });
  return { kind, from: call.start, to: call.end, literal: lit };
}

// ---- code edits ------------------------------------------------------------------------

/** The single change turning `old` into `code`: common prefix and suffix kept, the middle replaced. */
export function minimalChange(old, code) {
  if (code === old) return null;
  const max = Math.min(old.length, code.length);
  let a = 0;
  while (a < max && old.charCodeAt(a) === code.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && old.charCodeAt(old.length - 1 - b) === code.charCodeAt(code.length - 1 - b)) b++;
  return { from: a, to: old.length - b, insert: code.slice(a, code.length - b) };
}

/** Replace [from, to) in code. */
export function splice(code, from, to, insert) {
  return code.slice(0, from) + insert + code.slice(to);
}

export function findLayer(model, name) {
  return model.layers.find((l) => l.name === name);
}

// Each edit comes as a *Change function returning {from, to, insert} (so the deck can dispatch
// exactly that edit and follow layers through it) plus a wrapper returning the new code.

/** Apply a {from, to, insert} change to code. */
export function applyChange(code, c) {
  return c ? code.slice(0, c.from) + c.insert + code.slice(c.to) : code;
}

/** Toggle Strudel's own mute (`_name:`) for a layer. */
export function codeMuteChange(code, name, muted) {
  const l = findLayer(analyze(code), name);
  if (!l || l.codeMuted === muted) return null;
  const label = muted ? `_${l.label}` : l.label.replace(/^_+|_+$/g, '');
  return { from: l.labelFrom, to: l.labelTo, insert: label };
}
export function setCodeMute(code, name, muted) {
  return applyChange(code, codeMuteChange(code, name, muted));
}

export function layerText(code, name) {
  const l = findLayer(analyze(code), name);
  return l ? code.slice(l.from, l.to) : null;
}

/** Replace a layer's whole statement (label included). */
export function replaceLayerChange(code, name, text) {
  const l = findLayer(analyze(code), name);
  return l ? { from: l.from, to: l.to, insert: text } : null;
}
export function replaceLayer(code, name, text) {
  const c = replaceLayerChange(code, name, text);
  return c ? applyChange(code, c) : null;
}

export function uniqueLayerName(model, base) {
  const taken = new Set(model.layers.flatMap((l) => [l.name, l.label.replace(/^_+|_+$/g, '')]));
  const stem = /^[$_]/.test(base) ? 'layer' : base.replace(/(#\d+|\d+)$/, '') || 'layer';
  let i = 2;
  while (taken.has(`${stem}${i}`)) i++;
  return `${stem}${i}`;
}

/** A copy of a layer under a new name, right after it. Returns { change, name }. */
export function duplicateLayerChange(code, name) {
  const model = analyze(code);
  const l = findLayer(model, name);
  if (!l) return null;
  const newName = uniqueLayerName(model, l.name);
  const prefix = l.codeMuted ? '_' : '';
  const colon = code.indexOf(':', l.labelTo);
  const copy = `${prefix}${newName}:${code.slice(colon + 1, l.to)}`;
  return { change: { from: l.to, to: l.to, insert: `\n${copy}` }, name: newName };
}
export function duplicateLayer(code, name) {
  const r = duplicateLayerChange(code, name);
  return r ? { code: applyChange(code, r.change), name: r.name } : null;
}

export function deleteLayerChange(code, name) {
  const l = findLayer(analyze(code), name);
  if (!l) return null;
  let from = l.from;
  let to = l.to;
  // take the rest of the line (trailing comment) and one newline with it
  const eol = code.indexOf('\n', to);
  const rest = code.slice(to, eol === -1 ? code.length : eol);
  if (/^\s*(\/\/.*)?$/.test(rest)) to = eol === -1 ? code.length : eol + 1;
  const sol = code.lastIndexOf('\n', from - 1) + 1;
  if (code.slice(sol, from).trim() === '') from = sol;
  return { from, to, insert: '' };
}
export function deleteLayer(code, name) {
  const c = deleteLayerChange(code, name);
  return c ? applyChange(code, c) : null;
}

export function renameLayerChange(code, name, newName) {
  const l = findLayer(analyze(code), name);
  if (!l || layerNameProblem(newName)) return null;
  const label = (l.codeMuted ? '_' : l.codeSolo ? 'S' : '') + newName;
  return { from: l.labelFrom, to: l.labelTo, insert: label };
}
export function renameLayer(code, name, newName) {
  const c = renameLayerChange(code, name, newName);
  return c ? applyChange(code, c) : null;
}

/** Add a tempo line when the code has none. */
export function insertTempoChange(code, bpm) {
  return { from: 0, to: 0, insert: `setcpm(${bpm}/4)\n` };
}
export function insertTempo(code, bpm) {
  return applyChange(code, insertTempoChange(code, bpm));
}

export function appendLayerChange(code, name, expr) {
  const sep = code.endsWith('\n') ? '\n' : '\n\n';
  return { from: code.length, to: code.length, insert: `${sep}${name}: ${expr}\n` };
}
export function appendLayer(code, name, expr) {
  return applyChange(code, appendLayerChange(code, name, expr));
}

/** Scale the tempo literal so the tempo becomes `bpm` (given the tempo it produces now). */
export function setTempoChange(code, currentBpm, bpm) {
  const m = analyze(code);
  const lit = m.tempo?.literal;
  if (!lit || !currentBpm) return null;
  const raw = (lit.value * bpm) / currentBpm;
  const digits = Number.isInteger(lit.value) && Math.abs(raw - Math.round(raw)) < 1e-6 ? 0 : 4;
  return { from: lit.from, to: lit.to, insert: String(Number(raw.toFixed(digits))) };
}
export function setTempo(code, currentBpm, bpm) {
  const c = setTempoChange(code, currentBpm, bpm);
  return c ? applyChange(code, c) : null;
}

/**
 * Bake deck state into plain Strudel code, so it sounds the same on strudel.cc:
 * deck-muted layers get Strudel's `_` mute, layer gains become `.mul(postgain(g))`,
 * and the master becomes one `all(...)` line.
 */
export function bakeDeck(code, { layers = {}, master = 1 } = {}) {
  const m = analyze(code);
  if (!m.ok) return code;
  const edits = [];
  for (const l of m.layers) {
    const st = layers[l.name];
    if (!st || l.codeMuted) continue;
    if (st.mute) {
      edits.push({ from: l.labelFrom, to: l.labelTo, insert: `_${l.label}` });
      continue;
    }
    const g = st.gain ?? 1;
    if (Math.abs(g - 1) > 1e-3) {
      const expr = code.slice(l.exprFrom, l.exprTo);
      const simple = /^(CallExpression|MemberExpression|Identifier)$/.test(exprType(expr));
      edits.push({ from: l.exprFrom, to: l.exprTo, insert: `${simple ? expr : `(${expr})`}.mul(postgain(${round3(g)}))` });
    }
  }
  edits.sort((a, b) => b.from - a.from);
  let out = code;
  for (const e of edits) out = splice(out, e.from, e.to, e.insert);
  if (Math.abs(master - 1) > 1e-3) out = `${out.replace(/\s*$/, '')}\n\nall(x => x.mul(postgain(${round3(master)})))\n`;
  return out;
}

function exprType(expr) {
  try {
    const ast = acornParse(`(${expr})`, { ecmaVersion: 2022 });
    return ast.body[0].expression.type;
  } catch {
    return 'Unknown';
  }
}

function round3(x) {
  return Number(x.toFixed(3));
}

const RESERVED = new Set(`break case catch class const continue debugger default delete do else enum export extends false
finally for function if implements import in instanceof interface let new null package private protected public return
static super switch this throw true try typeof var void while with yield await`.split(/\s+/));

/** Why a layer name can't be used, or null when it is fine. */
export function layerNameProblem(name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return 'Use letters, digits and _, starting with a letter.';
  if (name.includes('$')) return '$ makes an anonymous layer in Strudel; pick a name without it.';
  if (RESERVED.has(name)) return `"${name}" is a JavaScript keyword and can't be a label.`;
  if (name.length > 1 && name.startsWith('S')) return 'Strudel reads a capital S at the start as solo; start with another letter.';
  if (name.startsWith('_') || name.endsWith('_')) return 'A leading or trailing _ means "off" in Strudel.';
  return null;
}

/** Parse a single layer statement typed in the inspector. */
export function checkLayerText(text) {
  try {
    const ast = acornParse(text, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, locations: true });
    const labelled = ast.body.filter((s) => s.type === 'LabeledStatement');
    if (ast.body.length !== 1 || labelled.length !== 1) {
      return { ok: false, message: 'The layer must be one statement that starts with its label, like  kick: s("bd*4")' };
    }
    return { ok: true, label: labelled[0].label.name };
  } catch (e) {
    return { ok: false, message: e.message, line: e.loc?.line, column: e.loc?.column };
  }
}
