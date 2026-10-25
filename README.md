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
