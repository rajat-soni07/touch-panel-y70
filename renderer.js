// Touch panel — page logic. Builds the dock from config.json and reflects stats + state from main.js.

const ICONS = {
  shield:   '<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  globe:    '<path d="M3 12a9 9 0 1018 0a9 9 0 10-18 0"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9"/><path d="M12 3c-2.5 2.6-3.6 5.6-3.6 9s1.1 6.4 3.6 9"/>',
  play:     '<path d="M5 5l7 7-7 7z"/><path d="M15 5v14"/><path d="M19 5v14"/>',
  next:     '<path d="M6 5l8 7-8 7z"/><path d="M18 5v14"/>',
  prev:     '<path d="M18 5l-8 7 8 7z"/><path d="M6 5v14"/>',
  mute:     '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6"/><path d="M21 9l-4 6"/>',
  volup:    '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7"/><path d="M19 6a8.5 8.5 0 010 12"/>',
  voldown:  '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 010 5"/>',
  lock:     '<path d="M6 11h12v9H6z"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  capture:  '<path d="M4 8V5h3"/><path d="M17 5h3v3"/><path d="M20 16v3h-3"/><path d="M7 19H4v-3"/><path d="M9 12a3 3 0 106 0a3 3 0 10-6 0"/>',
  gamepad:  '<path d="M7 8h10a4 4 0 014 4v1a3 3 0 01-5.2 2L14 13h-4l-1.8 2A3 3 0 013 13v-1a4 4 0 014-4z"/><path d="M8 10.5v3"/><path d="M6.5 12h3"/><path d="M15.5 11h.01"/><path d="M17.5 13h.01"/>',
  folder:   '<path d="M3 6h6l2 2h10v11H3z"/>',
  power:    '<path d="M12 3v8"/><path d="M7 6.5a7 7 0 1010 0"/>',
  mic:      '<path d="M9 5a3 3 0 016 0v6a3 3 0 01-6 0z"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>',
  moon:     '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  terminal: '<path d="M4 5h16v14H4z"/><path d="M8 10l2 2-2 2"/><path d="M12 15h4"/>',
  dot:      '<path d="M9 12a3 3 0 106 0a3 3 0 10-6 0"/>',
};

const $ = (id) => document.getElementById(id);
let cfg = { buttons: [], ui: {} };
let states = {};

function iconHTML(name) {
  if (name && /\.(png|svg|ico|jpe?g|webp|gif)$/i.test(name)) {
    let src = name;
    if (/^[a-z]:\\/i.test(src)) src = 'file:///' + src.replace(/\\/g, '/');
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    return img.outerHTML;
  }
  const paths = ICONS[name] || ICONS.dot;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// ui keys -> CSS variables, so colours can be tuned from config.json
const THEME_VARS = {
  page: '--page', card: '--card', dock: '--dock', text: '--text', name: '--name', sub: '--sub',
  track: '--track', accent: '--accent', tileText: '--tile-text', tileSub: '--tile-sub',
  ringWidth: '--ring-width', ringTrackOpacity: '--ring-track-opacity', dockOpacity: '--dock-opacity',
};

function applyTheme() {
  const ui = cfg.ui || {};
  const s = document.documentElement.style;
  for (const [key, cssVar] of Object.entries(THEME_VARS)) {
    if (ui[key] !== undefined && ui[key] !== '') s.setProperty(cssVar, String(ui[key]));
    else s.removeProperty(cssVar);
  }
}

function subText(b, state) {
  if (b.type !== 'toggle') return b.sub || '';
  if (state === 'busy') return b.busyText || 'Working…';
  if (state === 'on') return b.onText || 'On';
  return b.offText || 'Off';
}

function applyState(id) {
  const b = [...cfg.buttons, ...(cfg.pageButtons || [])].find((x) => x.id === id);
  const st = states[id];
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle('on', st === 'on');
    el.classList.toggle('busy', st === 'busy');
    const sub = el.querySelector('.sub');
    if (sub && b) sub.textContent = subText(b, st);
  });
}

function makeButton(b, className, html) {
  const el = document.createElement('button');
  el.className = className;
  el.dataset.id = b.id;
  el.title = b.label || b.id;
  el.innerHTML = html;

  el.addEventListener('pointerdown', () => el.classList.add('pressed'));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, () => el.classList.remove('pressed'));
  }
  el.addEventListener('click', () => press(b, el));
  return el;
}

function render() {
  applyTheme();

  const dock = $('dock');
  dock.innerHTML = '';
  for (const b of cfg.buttons) {
    if (!b.id) continue;
    dock.appendChild(makeButton(b, 'app', iconHTML(b.icon)));
    applyState(b.id);
  }

  const grid = $('grid');
  grid.innerHTML = '';
  for (const b of cfg.pageButtons || []) {
    if (!b.id) continue;
    const el = makeButton(
      b,
      'tile' + (b.size ? ' ' + b.size : '') + (b.type === 'toggle' ? ' toggle' : ''),
      `<span class="dot"></span>` +
        `<div class="icon">${iconHTML(b.icon)}</div>` +
        `<div class="text"><div class="label"></div><div class="sub"></div></div>`
    );
    el.querySelector('.label').textContent = b.label || b.id;
    grid.appendChild(el);
    applyState(b.id);
  }
}

// ---------- swipe pages ----------

const pager = $('pager');
const dots = [...document.querySelectorAll('#dots i')];

function updateDots() {
  const page = Math.round(pager.scrollLeft / pager.clientWidth);
  dots.forEach((d, i) => d.classList.toggle('active', i === page));
}
pager.addEventListener('scroll', updateDots, { passive: true });
dots.forEach((d) => d.addEventListener('click', () => {
  pager.scrollTo({ left: Number(d.dataset.page) * pager.clientWidth });
}));
updateDots();

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function flash(el, cls, ms) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

async function press(b, el) {
  if (el.classList.contains('running') || el.classList.contains('busy')) return;
  if (b.type !== 'toggle') el.classList.add('running');
  let r;
  try {
    r = await window.panel.press(b.id);
  } catch (e) {
    r = { ok: false, err: String(e) };
  }
  el.classList.remove('running');
  if (!r.ok) {
    flash(el, 'err', 1500);
    toast(`${b.label || b.id}: ${(r.err || 'failed').split('\n')[0]}`);
  }
}

// ---------- stats ----------

const show = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–');

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function setRing(id, pct) {
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  $(id).querySelector('.fill').style.strokeDasharray = `${p} 100`;
}

window.panel.on('stats', (s) => {
  setText('cpu-name', s.cpuName);
  setText('cpu-name2', s.cpuName);
  setText('cpu-temp', show(s.cpuTemp));
  setText('cpu-load', show(s.cpu));
  setRing('cpu-ring', s.cpu);

  const g = s.gpu || {};
  setText('gpu-name', g.name || 'GPU');
  setText('gpu-name2', g.name || 'GPU');
  setText('gpu-temp', show(g.temp));
  setText('gpu-load', show(g.util));
  setRing('gpu-ring', g.util);

  setText('ram', show((100 * s.ram.used) / s.ram.total));
  setText('fps', show(s.fps));
  setText('disk-name', s.diskName || 'Disk');
  setText('disk', show(s.disk));
});

window.panel.on('status', ({ id, state }) => {
  states[id] = state;
  applyState(id);
});

window.panel.on('config', (data) => {
  cfg = data.config;
  states = data.states || {};
  render();
});

document.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press

(async () => {
  const data = await window.panel.getConfig();
  cfg = data.config;
  states = data.states || {};
  render();
})();
