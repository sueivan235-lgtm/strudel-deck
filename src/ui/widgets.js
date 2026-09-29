// Controls: vertical fader, horizontal slider, switch, stepper. Each returns { el, set(value), setPending(bool) }.
import { h, clamp, fmt } from './dom.js';
import { faderGain, gainToPos, gainToDb } from '../input.js';

/** Pointer drag helper. onMove(dx, dy, e) gets the movement since pointerdown. */
function drag(el, { onStart, onMove, onEnd, onClick }) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    onStart?.(e);
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      onMove?.(dx, dy, ev);
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) onClick?.(ev);
      onEnd?.(ev, moved);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

/** Vertical fader for gains (0..1.5, unity marked). Relative drag, so grabbing it never jumps. */
export function createFader({ value = 1, onInput, onReset, title = '', size = 'md' } = {}) {
  let pos = gainToPos(value);
  let dragging = false;
  const cap = h('div', { class: 'fader-cap' });
  const fill = h('div', { class: 'fader-fill' });
  const track = h('div', { class: 'fader-track' }, fill, h('div', { class: 'fader-unity', title: 'unity (0 dB)' }), cap);
  const el = h('div', { class: `fader fader-${size}`, title, role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': 1.5 }, track);
  const render = () => {
    el.style.setProperty('--pos', pos.toFixed(4));
    el.setAttribute('aria-valuenow', faderGain(pos).toFixed(3));
  };
  let start = 0;
  drag(el, {
    onStart: () => {
      dragging = true;
      start = pos;
      el.classList.add('active');
    },
    onMove: (_dx, dy, e) => {
      const hgt = track.getBoundingClientRect().height || 100;
      pos = clamp(start - (dy / hgt) * (e.shiftKey ? 0.2 : 1), 0, 1);
      render();
      onInput?.(faderGain(pos));
    },
    onEnd: () => {
      dragging = false;
      el.classList.remove('active');
    },
  });
  el.addEventListener('dblclick', () => onReset?.());
  render();
  return {
    el,
    set(g) {
      if (dragging) return;
      pos = gainToPos(g);
      render();
    },
    setPending(on) {
      el.classList.toggle('pending', !!on);
    },
  };
}

/** Horizontal fader for the master: same taper as the strips. */
export function createHFader({ value = 1, onInput, onReset, title = '' } = {}) {
  let pos = gainToPos(value);
  let dragging = false;
  const fill = h('div', { class: 'hf-fill' });
  const thumb = h('div', { class: 'hf-thumb' });
  const track = h('div', { class: 'hf-track' }, fill, h('div', { class: 'hf-unity' }), thumb);
  const el = h('div', { class: 'hfader', title, role: 'slider' }, track);
  const render = () => el.style.setProperty('--pos', pos.toFixed(4));
  let start = 0;
  drag(el, {
    onStart: () => {
      dragging = true;
      start = pos;
    },
    onMove: (dx, _dy, e) => {
      const w = track.getBoundingClientRect().width || 100;
      pos = clamp(start + (dx / w) * (e.shiftKey ? 0.2 : 1), 0, 1);
      render();
      onInput?.(faderGain(pos));
    },
    onEnd: () => (dragging = false),
  });
  el.addEventListener('dblclick', () => onReset?.());
  render();
  return {
    el,
    set(g) {
      if (!dragging) {
        pos = gainToPos(g);
        render();
      }
    },
  };
}

/** Horizontal slider for continuous controls. Click jumps, drag follows, Shift = fine, double-click the number to type. */
export function createSlider({ min, max, value, step, onInput } = {}) {
  let v = value;
  let dragging = false;
  const fill = h('div', { class: 'hs-fill' });
  const thumb = h('div', { class: 'hs-thumb' });
  const track = h('div', { class: 'hs-track' }, fill, thumb);
  const num = h('span', { class: 'hs-value', title: 'double-click to type a value' });
  const el = h('div', { class: 'hslider', role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max }, track, num);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const frac = (x) => (hi === lo ? 0 : (x - lo) / (hi - lo));
  const render = () => {
    const f = clamp(frac(v), 0, 1);
    el.style.setProperty('--f', f.toFixed(4));
    num.textContent = fmt(v, { min, max, step });
    el.setAttribute('aria-valuenow', v);
  };
  const fromX = (clientX) => {
    const r = track.getBoundingClientRect();
    return lo + clamp((clientX - r.left) / r.width, 0, 1) * (hi - lo);
  };
  let startV = 0;
  let startX = 0;
  let fine = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    dragging = true;
    fine = e.shiftKey;
    startX = e.clientX;
    if (!fine) {
      v = fromX(e.clientX);
      onInput?.(v);
    }
    startV = v;
    render();
    const move = (ev) => {
      if (fine || ev.shiftKey) {
        const w = track.getBoundingClientRect().width || 100;
        v = clamp(startV + ((ev.clientX - startX) / w) * (hi - lo) * 0.15, lo, hi);
      } else v = fromX(ev.clientX);
      render();
      onInput?.(v);
    };
    const up = () => {
      dragging = false;
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });
  num.addEventListener('dblclick', () => {
    const inp = h('input', { class: 'hs-edit', type: 'number', step: 'any', value: fmt(v, { min, max, step }) });
    num.replaceWith(inp);
    inp.focus();
    inp.select();
    const done = (commit) => {
      if (!inp.isConnected) return;
      inp.replaceWith(num);
      const x = Number(inp.value);
      if (commit && inp.value !== '' && Number.isFinite(x)) {
        v = clamp(x, lo, hi);
        onInput?.(v);
      }
      render();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => done(true));
  });
  render();
  return {
    el,
    set(x) {
      if (dragging || x == null) return;
      v = x;
      render();
    },
    setPending(on) {
      el.classList.toggle('pending', !!on);
    },
  };
}

/** Segmented switch for stepped controls with few positions. */
export function createSwitch({ min, step, count, labels, value, onPick } = {}) {
  const values = Array.from({ length: count }, (_, i) => Number((min + i * step).toFixed(10)));
  const buttons = values.map((val, i) => {
    const full = labels ? labels[i] : String(val);
    const cut = full.indexOf(' (');
    const short = cut > 0 ? full.slice(0, cut) : full;
    return h('button', { class: 'sw-btn', type: 'button', title: labels ? `${val}: ${full}` : String(val), onClick: () => onPick?.(val) }, short);
  });
  const el = h('div', { class: `switch${count > 4 ? ' many' : ''}`, role: 'radiogroup' }, buttons);
  let current = value;
  const render = () => {
    values.forEach((val, i) => buttons[i].classList.toggle('on', Math.abs(val - current) < 1e-9));
  };
  render();
  return {
    el,
    set(x) {
      current = x;
      render();
    },
    setPending(on) {
      el.classList.toggle('pending', !!on);
    },
  };
}

/** Stepper for stepped controls with many positions (seeds, sample numbers, semitones). */
export function createStepper({ min, max, step, value, onInput, random = false } = {}) {
  let v = value;
  const num = h('span', { class: 'st-value' });
  const bar = h('div', { class: 'st-bar' }, h('div', { class: 'st-fill' }));
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clampStep = (x) => clamp(Math.round((x - lo) / step) * step + lo, lo, hi);
  const set = (x) => {
    v = clampStep(x);
    render();
    onInput?.(v);
  };
  const el = h(
    'div',
    { class: 'stepper' },
    h('button', { class: 'st-btn', type: 'button', title: 'down one step', onClick: () => set(v - step) }, '−'),
    h('div', { class: 'st-mid' }, num, bar),
    h('button', { class: 'st-btn', type: 'button', title: 'up one step', onClick: () => set(v + step) }, '+'),
    random
      ? h('button', {
          class: 'st-btn st-rand',
          type: 'button',
          title: 'random value',
          onClick: () => {
            const n = Math.round((hi - lo) / step);
            let next = v;
            for (let i = 0; i < 8 && next === v; i++) next = lo + Math.floor(Math.random() * (n + 1)) * step;
            set(next);
          },
        }, '⚄')
      : null,
  );
  const render = () => {
    num.textContent = String(Number(v.toFixed(6)));
    const f = hi === lo ? 0 : (v - lo) / (hi - lo);
    el.style.setProperty('--f', clamp(f, 0, 1).toFixed(4));
  };
  // drag the number sideways to scrub
  let startV = 0;
  drag(num.parentElement, {
    onStart: () => (startV = v),
    onMove: (dx) => {
      const steps = Math.round(dx / 8);
      const next = clampStep(startV + steps * step);
      if (next !== v) set(next);
    },
  });
  render();
  return {
    el,
    set(x) {
      v = x;
      render();
    },
    setPending(on) {
      el.classList.toggle('pending', !!on);
    },
  };
}

export { gainToDb };
