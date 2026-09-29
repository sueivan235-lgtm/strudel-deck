// Tiny DOM helpers.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (typeof v === 'string' || typeof v === 'number') el.setAttribute(k, String(v));
      else if (v === true) el.setAttribute(k, '');
      else el[k] = v;
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Number formatting for control values. */
export function fmt(value, { min = 0, max = 1, step } = {}) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (step && Number.isInteger(step)) return String(Math.round(value));
  const span = Math.abs(max - min);
  const digits = span <= 2 ? 2 : span <= 20 ? 1 : 0;
  return value.toFixed(digits);
}

let toastTimer;
export function toast(text, kind = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2600);
}

/** Download text as a file. */
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask for a file; resolves with { name, text } or null. */
export function pickFile(accept = '.json,.js,.txt,.strudel') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    });
    document.body.append(inp);
    inp.click();
  });
}

/** Small dropdown menu anchored to an element. items: [{ label, onClick, disabled, danger, sep, hint }] */
export function menu(anchor, items) {
  closeMenus();
  const el = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      it.sep
        ? h('div', { class: 'menu-sep' })
        : it.heading
          ? h('div', { class: 'menu-heading' }, it.heading)
          : h(
              'button',
              {
                class: `menu-item${it.danger ? ' danger' : ''}${it.active ? ' active' : ''}`,
                role: 'menuitem',
                disabled: !!it.disabled,
                onClick: (e) => {
                  e.stopPropagation();
                  closeMenus();
                  it.onClick?.();
                },
              },
              h('span', {}, it.label),
              it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
            ),
    ),
  );
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  el.style.top = `${r.bottom + 4}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function outside(e) {
    if (!el.contains(e.target)) closeMenus();
  }
  el._cleanup = () => document.removeEventListener('pointerdown', outside, true);
  return el;
}
export function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => {
    m._cleanup?.();
    m.remove();
  });
}

/** Modal prompt for a short text. Resolves with the text or null. */
export function ask(title, value = '', { okLabel = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'field', type: 'text', value, placeholder });
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    const back = h(
      'div',
      { class: 'modal-back', onPointerdown: (e) => e.target === back && done(null) },
      h(
        'form',
        {
          class: 'modal',
          onSubmit: (e) => {
            e.preventDefault();
            done(input.value.trim() || null);
          },
        },
        h('div', { class: 'modal-title' }, title),
        input,
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => done(null) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn primary' }, okLabel),
        ),
      ),
    );
    back.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
    document.body.append(back);
    input.focus();
    input.select();
  });
}

export function confirmBox(title, text, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => done(true) }, okLabel);
    const back = h(
      'div',
      { class: 'modal-back', onPointerdown: (e) => e.target === back && done(false) },
      h(
        'div',
        { class: 'modal' },
        h('div', { class: 'modal-title' }, title),
        text ? h('p', { class: 'modal-text' }, text) : null,
        h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => done(false) }, 'Cancel'), ok),
      ),
    );
    back.addEventListener('keydown', (e) => e.key === 'Escape' && done(false));
    document.body.append(back);
    ok.focus();
  });
}
