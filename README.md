# Touch Panel

A stats + app-dock panel for the Y70 touch display, styled after the HYTE Nexus Touch layout: CPU/GPU temperature, CPU/GPU usage rings, memory / FPS / disk activity, and a dock of app shortcuts.

## Stats sources

- **CPU / GPU usage, GPU temp, memory, disk activity**: read directly (GPU via `nvidia-smi`).
- **CPU temperature and FPS** come from **HWiNFO64**. Run HWiNFO in sensors mode, right-click the CPU temperature sensor (e.g. *CPU (Tctl/Tdie)*) → **Report value in Gadget**, and do the same for a framerate sensor if you have one. The panel matches sensor labels with the regexes in `config.json` → `sensors`. Until then those tiles show `–`.
- Colours live in `config.json` → `ui` (`page card dock text name sub track accent`).
- Dock icons are PNGs in `assets/`. `buttons` is the dock; `pageButtons` is the second page (swipe left, or tap the dots). On that page `size` can be `"full"` (whole row) or `"wide"` (2 of 3 columns).

## Setup (once)

1. Install **Node.js LTS** from nodejs.org.
2. Put this folder somewhere permanent, e.g. `C:\Tools\touch-panel`.
3. Open a terminal in the folder and run:
   ```
   npm install
   npm start
   ```
4. Close **Hyte Nexus** (and disable it at startup) so it doesn't draw over the panel. Leave Wallpaper Engine running on that display.
5. **Autostart:** press Win+R, type `shell:startup`, and put a shortcut to `launch.vbs` there.

## Things to check on first run

- **Touch hits the wrong screen?** Open Control Panel → *Tablet PC Settings* → **Setup…** → *Touch input*, and tap the Y70 panel when asked.
- **Wallpaper Engine pauses or goes black?** In Wallpaper Engine → Settings → *Performance*, set "Other application focused / maximized / fullscreen" to **Keep running**. The panel covers the whole screen, so WE can mistake it for a fullscreen app.
- **Panel on the wrong monitor?** Set `"display"` in `config.json` to a number (`0`, `1`, `2`…) or part of the monitor's name.
- **VPN tile never lights up?** The status check looks for a network adapter with "nord" in its name. Run `ipconfig` while connected and put the right adapter name in `status.match`.

## Hotkeys

| Keys | Action |
|---|---|
| Ctrl+Alt+Shift+Q | Quit panel |
| Ctrl+Alt+Shift+R | Reload |
| Ctrl+Alt+Shift+D | DevTools (debugging) |

## Adding buttons

Edit `config.json`. The panel reloads by itself when you save.

**One-shot action:**
```json
{ "id": "discord", "label": "Discord", "icon": "dot",
  "cmd": "start \"\" \"%LOCALAPPDATA%\\Discord\\Update.exe\" --processStart Discord.exe" }
```

**PowerShell action:**
```json
{ "id": "sleep", "label": "Sleep", "icon": "moon",
  "cmd": { "shell": "powershell", "cmd": "Add-Type -A System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)" } }
```

**Toggle with live state** (on/off commands plus a status check):
```json
{ "id": "x", "type": "toggle", "label": "…",
  "on": "…", "off": "…",
  "status": { "shell": "powershell", "cmd": "…prints something…", "match": "regex that means ON" } }
```
`status` can also be `{ "type": "interface", "match": "adapter-name-regex" }`, which costs nothing to check.

**Options**
- `size`: `"wide"` (2×1), `"tall"` (1×2), or `"big"` (2×2).
- `icon`: a built-in name (`shield globe play next prev mute volup voldown lock activity capture gamepad folder power mic moon terminal dot`) or a path to a `.png`/`.svg` file, for app logos.
- `busy`: on an action, shows the named toggle as "connecting" while the action runs. The country buttons use this for the VPN tile.
- `ignoreErrors`: put this inside a command object to suppress error toasts if a program returns odd exit codes.
- `ui.showStats`: any of `clock cpu gpu ram`. Use `[]` for buttons only.
- `noFocus: true`: tapping the panel doesn't take focus away from your game.

## Discord voice widget

The bottom of page 2 shows your current Discord voice channel, who's in it (speakers get a green ring), and Mute / Deafen buttons that reflect and change your real state. It talks to the Discord desktop app over its local RPC pipe.

**One-time setup**
1. Go to <https://discord.com/developers/applications> → **New Application** (any name, e.g. "Touch Panel").
2. In **OAuth2**: copy the **Client ID**, click **Reset Secret** and copy the **Client Secret**, and under **Redirects** add `http://localhost` → **Save Changes**.
3. Create `discord-auth.json` next to `config.json`:
   ```json
   { "clientId": "YOUR_CLIENT_ID", "clientSecret": "YOUR_CLIENT_SECRET" }
   ```
4. Discord pops up an **Authorize** dialog the first time — approve it. The panel stores the login tokens in the same file and refreshes them on its own.

`discord-auth.json` is git-ignored; never commit it. Set `"discord": { "enabled": false }` in `config.json` to turn the widget off, and `maxMembers` to change how many people are listed.

## Game quick-launch

Tapping the **Steam icon in the dock** opens a *Recently played* sheet with your installed games as covers, most recently played first; tap one to launch it (the sheet closes), or use **Open Steam** for the Steam window. Tap outside the sheet or the Steam icon again to close it. A running game gets an orange outline and a "Playing" badge and moves to the front.

**Steam games** are found automatically from Steam's local files (no login or API key): libraries from `steamapps/libraryfolders.vdf`, last-played times from each `appmanifest_*.acf`, covers from `appcache/librarycache`, and the running game from the `RunningAppID` registry value.

**Other games** are listed in `config.json` → `games.extra`:
```json
{ "id": "valorant", "name": "VALORANT",
  "exe": "D:\Games\Riot Games\Riot Client\RiotClientServices.exe",
  "args": "--launch-product=valorant --launch-patchline=live",
  "process": "VALORANT-Win64-Shipping.exe",
  "cover": "assets/covers/valorant.png" }
```
- `exe` is started from its own folder, with `args` if given. Entries whose `exe` no longer exists are hidden.
- `process` is the process to watch for "Playing" / last played (defaults to the `exe` file name). Set it when a launcher or `.bat` starts a differently named game process.
- `cover` is a portrait image (600×900 looks best). Without one the tile shows the name.
- Nothing on disk records when these were last played, so the panel stamps `game-history.json` (git-ignored) whenever their process is running. Until then they sort after games that have been played.

**Always full rows.** The list is capped at `count`, rounded down to whole rows of three. If your installed games don't fill it, the remaining slots go to your most recently played Steam games that **aren't installed** (dimmed, with a download badge; tapping one opens Steam's install prompt). Their names and app types come from the Steam store, looked up once and cached in `game-cache.json` (git-ignored); only real games with a cached cover are used. Set `fillWithUninstalled: false` to turn this off.

`config.json` → `games`: `count` (how many covers, default 12), `exclude` (Steam app IDs to hide — Wallpaper Engine, 431960, is hidden by default; redistributables and runtimes are always hidden), `enabled: false` to turn the sheet off (the Steam icon then just opens Steam). The sheet is wired to the dock button through `"popup": "games"` on that button in `buttons`. The list refreshes every 15 seconds.
