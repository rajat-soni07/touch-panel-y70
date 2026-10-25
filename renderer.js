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

function makeButton(b, className, html, onClick) {
  const el = document.createElement('button');
  el.className = className;
  el.dataset.id = b.id;
  el.title = b.label || b.id;
  el.innerHTML = html;

  el.addEventListener('pointerdown', () => el.classList.add('pressed'));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, () => el.classList.remove('pressed'));
  }
  el.addEventListener('click', onClick || (() => press(b, el)));
  return el;
}

function render() {
  applyTheme();

  const dock = $('dock');
  dock.innerHTML = '';
  for (const b of cfg.buttons) {
    if (!b.id) continue;
    // "popup": "steam" opens the Recently played sheet instead of running the button's command
    const onClick = b.popup === 'steam' ? () => toggleGames(b) : undefined;
    dock.appendChild(makeButton(b, 'app', iconHTML(b.icon), onClick));
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

// ---------- steam quick-launch ----------

let steamState = null;
let steamButton = null; // the dock button that opened the sheet; "Open Steam" runs its command

function setGamesOpen(open) {
  $('games').classList.toggle('open', open);
  $('games-scrim').classList.toggle('open', open);
}

function toggleGames(b) {
  steamButton = b;
  const games = (steamState && steamState.games) || [];
  // Nothing to show (widget off, or no installed games): behave like a normal Steam button
  if ((cfg.steam && cfg.steam.enabled === false) || games.length === 0) {
    return press(b, document.querySelector(`.app[data-id="${CSS.escape(b.id)}"]`));
  }
  setGamesOpen(!$('games').classList.contains('open'));
}

$('games-scrim').addEventListener('click', () => setGamesOpen(false));

const openSteam = $('games-open');
openSteam.addEventListener('pointerdown', () => openSteam.classList.add('pressed'));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
  openSteam.addEventListener(ev, () => openSteam.classList.remove('pressed'));
}
openSteam.addEventListener('click', async () => {
  setGamesOpen(false);
  if (!steamButton) return;
  const r = await window.panel.press(steamButton.id);
  if (!r.ok) toast(`Steam: ${(r.err || 'failed').split('\n')[0]}`);
});

function renderGames(s) {
  steamState = s;
  const games = (s && s.games) || [];
  if (games.length === 0) setGamesOpen(false);

  const grid = $('games-grid');
  grid.innerHTML = '';
  for (const g of games) {
    const el = document.createElement('button');
    el.className = 'game' + (g.id === s.running ? ' running' : '');
    el.title = g.name;
    if (g.cover) {
      const img = document.createElement('img');
      img.src = g.cover;
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
    } else {
      const name = document.createElement('div');
      name.className = 'game-name';
      name.textContent = g.name;
      el.appendChild(name);
    }
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Playing';
    el.appendChild(badge);

    el.addEventListener('pointerdown', () => el.classList.add('pressed'));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(ev, () => el.classList.remove('pressed'));
    }
    el.addEventListener('click', async () => {
      if (el.classList.contains('launching')) return;
      el.classList.add('launching');
      const r = await window.panel.launchGame(g.id);
      // Steam takes a while to start the game; don't let repeat taps queue launches
      setTimeout(() => el.classList.remove('launching'), r.ok ? 8000 : 0);
      if (r.ok) setGamesOpen(false);
      else toast(`${g.name}: ${(r.err || 'failed').split('\n')[0]}`);
    });
    grid.appendChild(el);
  }
}

window.panel.on('steam', renderGames);

// ---------- discord ----------

const svgIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const DC_ICONS = {
  mic: ICONS.mic,
  micOff: ICONS.mic + '<path d="M4 4l16 16"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0116 0v3"/><path d="M4 15h3v5H4z"/><path d="M17 15h3v5h-3z"/>',
  headphonesOff: '<path d="M4 15v-3a8 8 0 0116 0v3"/><path d="M4 15h3v5H4z"/><path d="M17 15h3v5h-3z"/><path d="M3 3l18 18"/>',
};
const DC_STATUS = {
  setup: ['Discord', 'Add your app to discord-auth.json (see README)'],
  closed: ['Discord', 'Not running'],
  connecting: ['Discord', 'Connecting…'],
  auth: ['Discord', 'Approve the touch panel in Discord'],
};
let dcState = null;
let dcOpening = false; // tapped "open" and waiting for Discord to come up

function renderDiscord(s) {
  dcState = s;
  const box = $('discord');
  box.classList.toggle('hidden', !!(cfg.discord && cfg.discord.enabled === false) || !s);
  if (!s) return;

  const ready = s.status === 'ready';
  box.classList.toggle('openable', s.status === 'closed');
  let [title, subtitle] = DC_STATUS[s.status] || ['Discord', s.message || 'Something went wrong'];
  if (s.status === 'closed' && dcOpening) subtitle = 'Starting Discord…';
  if (s.status !== 'closed') dcOpening = false;
  if (ready) {
    title = s.channel ? s.channel.name : 'Not in a voice channel';
    subtitle = s.channel ? s.channel.guild : 'Join a channel in Discord';
  }
  setText('dc-title', title);
  setText('dc-subtitle', subtitle);

  const list = $('dc-members');
  list.innerHTML = '';
  if (ready && s.channel) {
    const max = (cfg.discord && cfg.discord.maxMembers) || 5;
    // Speakers first, then alphabetical
    const members = [...s.members].sort((a, b) => b.speaking - a.speaking || a.name.localeCompare(b.name));
    for (const m of members.slice(0, max)) {
      const row = document.createElement('div');
      row.className = 'dc-member' + (m.speaking ? ' speaking' : '');
      const img = document.createElement('img');
      img.src = m.avatar;
      img.alt = '';
      img.draggable = false;
      const name = document.createElement('div');
      name.className = 'dc-name';
      name.textContent = m.name;
      const flags = document.createElement('div');
      flags.className = 'dc-flags';
      // Deafened also means muted, so it gets both icons
      flags.innerHTML = (m.muted || m.deaf ? svgIcon(DC_ICONS.micOff) : '') + (m.deaf ? svgIcon(DC_ICONS.headphonesOff) : '');
      row.append(img, name, flags);
      list.appendChild(row);
    }
    if (members.length > max) {
      const more = document.createElement('div');
      more.className = 'dc-more';
      more.textContent = `+${members.length - max} more`;
      list.appendChild(more);
    }
  }

  document.querySelector('.dc-actions').classList.toggle('hidden', !ready);
  const mute = $('dc-mute');
  const deaf = $('dc-deaf');
  mute.classList.toggle('on', s.self.mute);
  deaf.classList.toggle('on', s.self.deaf);
  mute.innerHTML = svgIcon(s.self.mute ? DC_ICONS.micOff : DC_ICONS.mic) + `<span>${s.self.mute ? 'Unmute' : 'Mute'}</span>`;
  deaf.innerHTML = svgIcon(s.self.deaf ? DC_ICONS.headphonesOff : DC_ICONS.headphones) + `<span>${s.self.deaf ? 'Undeafen' : 'Deafen'}</span>`;
}

for (const btn of document.querySelectorAll('.dc-btn')) {
  btn.addEventListener('pointerdown', () => btn.classList.add('pressed'));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    btn.addEventListener(ev, () => btn.classList.remove('pressed'));
  }
  btn.addEventListener('click', async () => {
    const r = await window.panel.discord(btn.dataset.action);
    if (!r.ok) toast(`Discord: ${r.err || 'failed'}`);
  });
}

// While Discord is closed the whole widget is a button that launches it
const dcBox = $('discord');
dcBox.addEventListener('pointerdown', () => dcBox.classList.contains('openable') && dcBox.classList.add('pressed'));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
  dcBox.addEventListener(ev, () => dcBox.classList.remove('pressed'));
}
dcBox.addEventListener('click', async () => {
  if (!dcBox.classList.contains('openable') || dcOpening) return;
  const r = await window.panel.discord('open');
  if (!r.ok) return toast(`Discord: ${r.err || 'failed'}`);
  dcOpening = true;
  renderDiscord(dcState);
  setTimeout(() => {
    // Discord never came up — let the tap work again
    dcOpening = false;
    renderDiscord(dcState);
  }, 60000);
});

window.panel.on('discord', renderDiscord);

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
  renderDiscord(dcState);
  renderGames(steamState);
});

document.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press

(async () => {
  const data = await window.panel.getConfig();
  cfg = data.config;
  states = data.states || {};
  render();
  renderDiscord(data.discord);
  renderGames(data.steam);
})();
