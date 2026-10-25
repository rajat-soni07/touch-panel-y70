// Touch panel — main process.
// Owns the window, runs the commands behind each button, and reports toggle state + stats.
// The page never sends commands itself; it only sends a button id, and the command is
// looked up here from config.json.

const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const { exec, execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

let config = { buttons: [], pageButtons: [] };
let win = null;

const states = {};      // button id -> 'on' | 'off' | 'busy'
const lastActual = {};  // button id -> boolean (last real status reading)
const pending = {};     // button id -> { target: 'on' | 'off', until: ms timestamp }

// ---------- config ----------

// Dock buttons + the swipe page's buttons
const allButtons = () => [...config.buttons, ...config.pageButtons];

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    parsed.buttons = Array.isArray(parsed.buttons) ? parsed.buttons : [];
    parsed.pageButtons = Array.isArray(parsed.pageButtons) ? parsed.pageButtons : [];
    config = parsed;
  } catch (e) {
    console.error('[panel] could not read config.json — keeping previous config:', e.message);
  }
  return config;
}

// ---------- running commands ----------
// A command spec is either a string (run through cmd.exe) or
// { cmd, shell: "cmd" | "powershell", cwd, timeoutMs, ignoreErrors }

function run(spec) {
  if (!spec) return Promise.resolve({ ok: true, out: '' });
  if (typeof spec === 'string') spec = { cmd: spec };

  return new Promise((resolve) => {
    const opts = {
      windowsHide: true,
      cwd: spec.cwd || undefined,
      timeout: spec.timeoutMs || 30000,
    };
    const done = (err, stdout = '', stderr = '') => {
      const out = String(stdout).trim();
      const errText = String(stderr).trim() || (err && err.message) || '';
      resolve({ ok: !err || !!spec.ignoreErrors, out, err: err ? errText : '' });
    };

    if (spec.shell === 'powershell') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', spec.cmd],
        opts,
        done
      );
    } else {
      exec(spec.cmd, opts, done);
    }
  });
}

// ---------- toggle status ----------

function interfaceUp(match) {
  const re = new RegExp(match, 'i');
  const ifaces = os.networkInterfaces();
  return Object.entries(ifaces).some(
    ([name, addrs]) =>
      re.test(name) &&
      (addrs || []).some((a) => !a.internal && (a.family === 'IPv4' || a.family === 4))
  );
}

async function readStatus(btn) {
  const s = btn.status;
  if (!s) return lastActual[btn.id] === true;
  if (s.type === 'interface') return interfaceUp(s.match || '.');
  const r = await run(s);
  return s.match ? new RegExp(s.match, 'i').test(r.out) : r.ok;
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function setState(id, state) {
  if (states[id] !== state) {
    states[id] = state;
    send('status', { id, state });
  }
}

function resolveState(btn, isOn) {
  const actual = isOn ? 'on' : 'off';
  const p = pending[btn.id];
  if (p) {
    if (actual === p.target || Date.now() > p.until) delete pending[btn.id];
    else return 'busy';
  }
  return actual;
}

function markBusy(btn, target) {
  pending[btn.id] = { target, until: Date.now() + (btn.busyTimeoutMs || 20000) };
  setState(btn.id, 'busy');
}

let polling = false;
async function pollStatus() {
  if (polling) return;
  polling = true;
  try {
    for (const b of allButtons()) {
      if (b.type !== 'toggle' || !b.status) continue;
      try {
        const isOn = await readStatus(b);
        lastActual[b.id] = isOn;
        setState(b.id, resolveState(b, isOn));
      } catch (e) {
        console.error(`[panel] status check failed for ${b.id}:`, e.message);
      }
    }
  } finally {
    polling = false;
  }
}

function statusLoop() {
  pollStatus().finally(() => {
    const fast = Object.keys(pending).length > 0;
    setTimeout(statusLoop, fast ? 1000 : config.statusIntervalMs || 3000);
  });
}

// ---------- button presses ----------

ipcMain.handle('config', () => ({ config, states }));

ipcMain.handle('press', async (_e, id) => {
  const b = allButtons().find((x) => x.id === id);
  if (!b) return { ok: false, err: 'Unknown button' };

  if (b.type === 'toggle') {
    if (states[id] === 'busy') return { ok: true };
    const current = states[id] || (lastActual[id] ? 'on' : 'off');
    const target = current === 'on' ? 'off' : 'on';

    if (b.status) markBusy(b, target);
    const r = await run(b[target]);

    if (b.status) {
      if (!r.ok) delete pending[id];
      setTimeout(pollStatus, 400);
    } else if (r.ok) {
      lastActual[id] = target === 'on';
      setState(id, target);
    }
    return r;
  }

  // Plain action. "busy": "<toggle id>" shows that toggle as connecting while this runs.
  if (b.busy) {
    const t = allButtons().find((x) => x.id === b.busy && x.type === 'toggle');
    if (t && t.status) markBusy(t, 'on');
  }
  const r = await run(b.cmd);
  if (b.busy) setTimeout(pollStatus, 400);
  return r;
});

// ---------- stats ----------

function cpuTimes() {
  return os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 }
  );
}

let prevCpu = cpuTimes();
let gpuAvailable = true;

// "AMD Ryzen 9 9950X3D 16-Core Processor" -> "AMD Ryzen 9 9950X3D"
const CPU_NAME = (os.cpus()[0] ? os.cpus()[0].model : 'CPU')
  .replace(/\s+\d+-Core Processor\s*$/i, '')
  .replace(/\((R|TM)\)/gi, '')
  .trim();

function readGpu() {
  if (!gpuAvailable) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err) {
          gpuAvailable = false; // no NVIDIA GPU / driver tools — stop asking
          return resolve(null);
        }
        const [name, util, temp] = String(stdout).split('\n')[0].split(',').map((s) => s.trim());
        resolve({ name, util: parseFloat(util), temp: parseFloat(temp) });
      }
    );
  });
}

// CPU temperature and FPS come from HWiNFO's "Gadget" registry feed (HKCU\Software\HWiNFO64\VSB),
// which only lists the sensors you tick "Report value in Gadget" for.
function readHwinfo() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\HWiNFO64\\VSB'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([]);
      const byIndex = {};
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^\s+(Sensor|Label|ValueRaw)(\d+)\s+REG_SZ\s+(.*)$/.exec(line);
        if (m) (byIndex[m[2]] = byIndex[m[2]] || {})[m[1]] = m[3].trim();
      }
      resolve(Object.values(byIndex).filter((s) => s.Label));
    });
  });
}

// Combines every sensor whose label matches (e.g. CCD1 + CCD2): mode "avg" (default) or "max".
// `ignore` skips readings by sensor name, e.g. PresentMon measuring this panel itself.
function sensorValue(sensors, pattern, ignore, mode) {
  if (!pattern) return null;
  const re = new RegExp(pattern, 'i');
  const skip = ignore ? new RegExp(ignore, 'i') : null;
  const values = sensors
    .filter((x) => re.test(x.Label) && !(skip && skip.test(x.Sensor || '')))
    .map((x) => parseFloat(x.ValueRaw))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return mode === 'max' ? Math.max(...values) : values.reduce((a, b) => a + b, 0) / values.length;
}

// Disk activity: one long-running typeperf instead of a new process every tick.
let diskBusy = null;
let diskProc = null;
function startDiskMonitor() {
  diskProc = spawn('typeperf', ['\\PhysicalDisk(_Total)\\% Idle Time', '-si', '2'], { windowsHide: true });
  diskProc.stdout.on('data', (chunk) => {
    const lines = String(chunk).trim().split(/\r?\n/);
    const m = /,"([\d.]+)"\s*$/.exec(lines[lines.length - 1]);
    if (m) diskBusy = Math.max(0, 100 - parseFloat(m[1]));
  });
  diskProc.on('exit', () => {
    diskProc = null;
    if (!app.isQuitting) setTimeout(startDiskMonitor, 10000);
  });
}

async function statsLoop() {
  const now = cpuTimes();
  const dTotal = now.total - prevCpu.total;
  const cpu = dTotal > 0 ? Math.round(100 * (1 - (now.idle - prevCpu.idle) / dTotal)) : 0;
  prevCpu = now;

  const total = os.totalmem();
  const used = total - os.freemem();
  const [gpu, sensors] = await Promise.all([readGpu(), readHwinfo()]);
  const sensorCfg = config.sensors || {};

  send('stats', {
    cpu,
    cpuName: CPU_NAME,
    cpuTemp: sensorValue(sensors, sensorCfg.cpuTemp, null, sensorCfg.cpuTempMode),
    fps: sensorValue(sensors, sensorCfg.fps, sensorCfg.fpsIgnore, 'max'),
    ram: { used, total },
    gpu,
    disk: diskBusy,
    diskName: (config.ui && config.ui.diskLabel) || 'All disks',
  });
  setTimeout(statsLoop, 2000);
}

// ---------- window ----------

function pickDisplay() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const want = config.display === undefined ? 'auto' : config.display;

  if (typeof want === 'number' && all[want]) return all[want];
  if (typeof want === 'string' && want !== 'auto') {
    const byLabel = all.find((d) => (d.label || '').toLowerCase().includes(want.toLowerCase()));
    if (byLabel) return byLabel;
  }
  return (
    all.find((d) => d.touchSupport === 'available' && d.id !== primary.id) ||
    all.find((d) => d.id !== primary.id) ||
    primary
  );
}

function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const d = pickDisplay();
  win.setBounds(d.bounds);
  applyOnTop();
}

// Other topmost windows on the panel (e.g. HYTE Nexus Touch) swallow taps if they sit above us,
// so use the highest level and keep re-asserting it.
function applyOnTop() {
  if (!win || win.isDestroyed()) return;
  if (config.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  } else {
    win.setAlwaysOnTop(false);
  }
}

function createWindow() {
  const d = pickDisplay();
  win = new BrowserWindow({
    ...d.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Not focusable = tapping the panel won't pull focus away from your game.
    focusable: config.noFocus === false,
    alwaysOnTop: !!config.alwaysOnTop,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setVisualZoomLevelLimits(1, 1); // no pinch-zoom
  win.once('ready-to-show', () => {
    win.showInactive();
    placeWindow(); // re-apply: fixes sizing when the panel uses a different Windows scale %
  });
}

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    statusLoop();
    startDiskMonitor();
    statsLoop();
    setInterval(applyOnTop, 2000);

    // Edit config.json and the panel updates by itself.
    let reloadTimer = null;
    fs.watch(CONFIG_PATH, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        loadConfig();
        send('config', { config, states });
        placeWindow();
        pollStatus();
      }, 300);
    });

    // The Y70 panel can come up late at boot or after sleep — follow it.
    screen.on('display-added', placeWindow);
    screen.on('display-removed', placeWindow);
    screen.on('display-metrics-changed', placeWindow);

    globalShortcut.register('Control+Alt+Shift+Q', () => app.quit());
    globalShortcut.register('Control+Alt+Shift+R', () => {
      loadConfig();
      placeWindow();
      win && win.reload();
    });
    globalShortcut.register('Control+Alt+Shift+D', () => {
      win && win.webContents.openDevTools({ mode: 'detach' });
    });
  });

  app.on('will-quit', () => {
    app.isQuitting = true;
    if (diskProc) diskProc.kill();
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => app.quit());
}
