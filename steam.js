// Steam quick-launch — recently played installed games, read from Steam's local files (no login).
// Libraries come from steamapps/libraryfolders.vdf, last-played times from each appmanifest_*.acf,
// and covers from Steam's own art cache (appcache/librarycache/<appid>/...).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

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
function findCover(root, appId) {
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

async function recentGames({ count = 6, exclude = [] } = {}) {
  const root = await steamRoot();
  const skip = new Set(exclude.map(String));
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
      const cover = findCover(root, id);
      games.push({
        id,
        name,
        lastPlayed: Number(vdfValues(text, 'LastPlayed')[0]) || 0,
        cover: cover ? pathToFileURL(cover).href : null,
      });
    }
  }

  games.sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));
  const running = await regValue('HKCU\\Software\\Valve\\Steam', 'RunningAppID');
  // RunningAppID is a DWORD, printed by reg as hex ("0x2da"); 0 when nothing is running
  return { games: games.slice(0, count), running: String(Number(running) || 0) };
}

module.exports = { recentGames };
