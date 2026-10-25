// Game quick-launch — recently played installed games for the dock's "Recently played" sheet.
//
// Steam games are read from Steam's local files (no login): libraries from steamapps/libraryfolders.vdf,
// last-played times from each appmanifest_*.acf, covers from Steam's art cache, and the running game
// from the RunningAppID registry value.
//
// Other games are listed in config.json (games.extra). Nothing on disk records when they were last
// played, so the panel keeps its own record in game-history.json, stamped whenever their process runs.
//
// The list is capped to whole rows. If installed games don't fill it, the rest is topped up with
// recently played Steam games that aren't installed (tapping one opens Steam's install prompt). Steam's
// play history (userdata/<id>/config/localconfig.vdf) has no names, so names and app types are looked
// up once on the Steam store and kept in game-cache.json; only real games with a cached cover are used.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

const HISTORY_PATH = path.join(__dirname, 'game-history.json');
const CACHE_PATH = path.join(__dirname, 'game-cache.json');
const COLUMNS = 3; // matches .games-grid in style.css
const STORE_TYPE_GAME = 0;
const RECHECK_UNKNOWN_SEC = 7 * 24 * 3600;

// Tools and runtimes that show up as "installed apps" but aren't games
const NOT_GAMES = /Redistributables|Proton|Steam Linux Runtime|SteamVR|Steamworks/i;

function regValue(key, name) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`).exec(String(stdout));
      resolve(m ? m[1].trim() : null);
    });
  });
}

// Lower-cased names of every running process
function runningProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(new Set());
      const names = String(stdout)
        .split(/\r?\n/)
        .map((line) => (/^"([^"]+)"/.exec(line) || [])[1])
        .filter(Boolean)
        .map((n) => n.toLowerCase());
      resolve(new Set(names));
    });
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

const readHistory = () => readJson(HISTORY_PATH);

// Text VDF (Steam's KeyValues format) -> nested objects
function parseVdf(text) {
  let i = 0;
  function token() {
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++;
      else if (c === '/' && text[i + 1] === '/') while (i < text.length && text[i] !== '\n') i++;
      else if (c === '{' || c === '}') return text[i++];
      else if (c === '"') {
        let s = '';
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i++;
          s += text[i++];
        }
        i++;
        return { s };
      } else i++;
    }
    return null;
  }
  function block() {
    const o = {};
    for (;;) {
      const k = token();
      if (k === null || k === '}') return o;
      if (typeof k !== 'object') continue;
      const v = token();
      o[k.s] = v === '{' ? block() : v && v.s;
    }
  }
  return block();
}

// Case-insensitive walk down nested VDF keys
function vdfPath(o, ...keys) {
  for (const k of keys) {
    if (!o || typeof o !== 'object') return undefined;
    o = o[Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase())];
  }
  return o;
}

// ---------- steam ----------

async function steamRoot() {
  const p = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  return p ? path.normalize(p) : 'C:\\Program Files (x86)\\Steam';
}

// Minimal reader for the flat "key" "value" pairs we need from .vdf / .acf files
function vdfValues(text, key) {
  const re = new RegExp(`"${key}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

function libraries(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    const paths = vdfValues(text, 'path');
    return paths.length ? paths : [root];
  } catch {
    return [root];
  }
}

// Portrait cover: older clients keep library_600x900.jpg, newer ones library_capsule.jpg, often in a hashed subfolder
function findSteamCover(root, appId) {
  const dir = path.join(root, 'appcache', 'librarycache', String(appId));
  const names = ['library_600x900.jpg', 'library_capsule.jpg'];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const name of names) {
    if (entries.some((e) => e.isFile() && e.name === name)) return path.join(dir, name);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// appid -> LastPlayed (unix seconds) for every game this Steam user has played, installed or not.
// Uses the most recently written localconfig.vdf if several Steam accounts have logged in here.
function steamPlayHistory(root) {
  const out = new Map();
  let newest = null;
  try {
    for (const user of fs.readdirSync(path.join(root, 'userdata'))) {
      const f = path.join(root, 'userdata', user, 'config', 'localconfig.vdf');
      try {
        const m = fs.statSync(f).mtimeMs;
        if (!newest || m > newest.m) newest = { f, m };
      } catch {}
    }
    if (!newest) return out;
    const apps = vdfPath(parseVdf(fs.readFileSync(newest.f, 'utf8')), 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') || {};
    for (const [id, v] of Object.entries(apps)) {
      const t = Number(v && v.LastPlayed) || 0;
      if (/^\d+$/.test(id) && t > 0) out.set(id, t);
    }
  } catch {}
  return out;
}

// Name + store type for app ids, looked up on the Steam store once and cached in game-cache.json.
// Ids the store doesn't know (test apps, delisted tools) are cached as unknown and rechecked weekly.
async function storeInfo(ids) {
  const cache = readJson(CACHE_PATH);
  const nowSec = Math.floor(Date.now() / 1000);
  const missing = ids.filter((id) => !cache[id] || (cache[id].type === undefined && nowSec - cache[id].checked > RECHECK_UNKNOWN_SEC));
  if (missing.length) {
    try {
      const input = {
        ids: missing.map((id) => ({ appid: Number(id) })),
        context: { language: 'english', country_code: 'US' },
        data_request: {},
      };
      const url = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=' + encodeURIComponent(JSON.stringify(input));
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const items = ((await res.json()).response || {}).store_items || [];
      for (const id of missing) cache[id] = { checked: nowSec };
      for (const it of items) if (it.appid) cache[String(it.appid)] = { name: it.name, type: it.type, checked: nowSec };
      writeJson(CACHE_PATH, cache);
    } catch {} // offline: try again next scan
  }
  return cache;
}

// Played-but-uninstalled Steam games, most recent first, to top up the list
async function steamFillers(root, history, skip, installedIds, want) {
  if (want <= 0) return [];
  const candidates = [...history.entries()]
    .filter(([id]) => !installedIds.has(id) && !skip.has(id) && findSteamCover(root, id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, want * 3); // a few spares in case some turn out not to be games
  const info = await storeInfo(candidates.map(([id]) => id));
  return candidates
    .filter(([id]) => info[id] && info[id].type === STORE_TYPE_GAME && !NOT_GAMES.test(info[id].name || ''))
    .slice(0, want)
    .map(([id, lastPlayed]) => ({
      key: `steam:${id}`,
      name: info[id].name,
      lastPlayed,
      cover: pathToFileURL(findSteamCover(root, id)).href,
      running: false,
      installed: false,
    }));
}

async function steamGames(exclude, history, root) {
  const skip = new Set(exclude.map(String));
  const runningId = String(Number(await regValue('HKCU\\Software\\Valve\\Steam', 'RunningAppID')) || 0); // DWORD, printed as hex
  const games = [];

  for (const lib of libraries(root)) {
    const appsDir = path.join(lib, 'steamapps');
    let files;
    try {
      files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      let text;
      try {
        text = fs.readFileSync(path.join(appsDir, f), 'utf8');
      } catch {
        continue;
      }
      const id = vdfValues(text, 'appid')[0];
      const name = vdfValues(text, 'name')[0];
      if (!id || !name || skip.has(id) || NOT_GAMES.test(name)) continue;
      const cover = findSteamCover(root, id);
      games.push({
        key: `steam:${id}`,
        name,
        // The manifest's LastPlayed can lag (or read 0); the per-user history is usually fresher
        lastPlayed: Math.max(Number(vdfValues(text, 'LastPlayed')[0]) || 0, history.get(id) || 0),
        cover: cover ? pathToFileURL(cover).href : null,
        running: id === runningId,
        installed: true,
      });
    }
  }
  return games;
}

// ---------- games listed in config.json ----------

function coverUrl(cover) {
  if (!cover) return null;
  const p = path.isAbsolute(cover) ? cover : path.join(__dirname, cover);
  return fs.existsSync(p) ? pathToFileURL(p).href : null;
}

function processName(g) {
  return (g.process || path.basename(g.exe || '')).toLowerCase();
}

function extraGames(extra, procs) {
  const history = readHistory();
  const nowSec = Math.floor(Date.now() / 1000);
  let changed = false;

  const games = extra
    .filter((g) => g.id && g.name && g.exe && fs.existsSync(g.exe)) // skip uninstalled ones
    .map((g) => {
      const running = procs.has(processName(g));
      if (running) {
        history[g.id] = nowSec;
        changed = true;
      }
      return {
        key: `extra:${g.id}`,
        name: g.name,
        lastPlayed: history[g.id] || 0,
        cover: coverUrl(g.cover),
        running,
        installed: true,
      };
    });

  if (changed) {
    try {
      fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
    } catch {}
  }
  return games;
}

// ---------- public ----------

async function recentGames({ count = 12, exclude = [], extra = [], fill = true } = {}) {
  const root = await steamRoot();
  const history = steamPlayHistory(root);
  const [steam, procs] = await Promise.all([steamGames(exclude, history, root), extra.length ? runningProcesses() : new Set()]);
  const games = [...steam, ...extraGames(extra, procs)];
  // Running first, then most recently played; never-played games last, alphabetically
  games.sort((a, b) => b.running - a.running || b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));

  // Whole rows only, so the grid never ends on a half-empty row
  const cap = Math.max(COLUMNS, Math.floor(count / COLUMNS) * COLUMNS);
  const shown = games.slice(0, cap);
  if (fill) {
    const installedIds = new Set(steam.map((g) => g.key.slice('steam:'.length)));
    shown.push(...(await steamFillers(root, history, new Set(exclude.map(String)), installedIds, cap - shown.length)));
  }
  return { games: shown };
}

// Command spec for run() in main.js, or null for an unknown key
function launchSpec(key, extra = []) {
  const steam = /^steam:(\d+)$/.exec(key);
  if (steam) return `start "" steam://rungameid/${steam[1]}`;

  const id = (/^extra:(.+)$/.exec(key) || [])[1];
  const g = extra.find((x) => x.id === id);
  if (!g || !g.exe) return null;
  // Start from the game's own folder: many games look for their data relative to the working directory
  return { cmd: `start "" "${g.exe}"${g.args ? ' ' + g.args : ''}`, cwd: path.dirname(g.exe) };
}

module.exports = { recentGames, launchSpec };
