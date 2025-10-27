# Audio Visualizer — Electron + WebAudio + Canvas

A fullscreen, performance-oriented audio visualizer that runs as a desktop app (Electron) and as a static web page (GitHub Pages).  
It listens to any audio input you select (microphone, virtual loopback devices like **VB-CABLE** on Windows or **BlackHole** on macOS) and renders multiple, modern visual styles on an HTML5 Canvas.

> **Privacy:** Audio never leaves your machine. There are no network calls; the visualization uses the browser/Electron **Web Audio API** in real time.

---

## Highlights

- **Desktop app (Electron)** with proper fullscreen (panel auto-hides and reappears on mouse move).
- **Web build** (same UI, no Electron required): deployable on GitHub Pages over HTTPS.
- **Multiple presets**, grouped by *Classic*, *Pro*, and *Wow*:
  - Bars, **Mirror Bars (v5 style)**, Radial, Wave, Particles
  - **Rounded Bars (neon, springy)**, Radial-Filled, Dual Wave
  - Orbits, Tunnel, Spiral, Mountains, Grid Laser
- **Smarter spectrum mapping**:
  - Logarithmic frequency binning + high-frequency tilt so the **right side isn’t “dead”**.
  - Dynamic floor that activates only when there’s actual audio energy (no “idle carpet” on the right).
- **Polished UI**: color palettes (Neon, Fire, Ice, Rainbow, Mono), tips panel, device selector, persistence for last used device and preset.
- **Icons** included (no default Electron icon).

---

## How it works (architecture)

- **Electron shell:** `main.js` creates a `BrowserWindow` and exposes `toggle-fullscreen` via IPC.
- **Preload:** `preload.js` exposes `window.electronAPI.toggleFullscreen()` safely.
- **Renderer (web code):**
  - `getUserMedia` to capture the selected audio input.
  - `AudioContext → AnalyserNode` to get frequency/time data.
  - **Canvas 2D** rendering at the display pixel ratio (DPR aware).
  - **Device persistence** with `localStorage`.
- **Fullscreen panel logic:** panel hides after ~2s when fullscreen; reappears on mouse move.

---

## Project structure (key parts)

```
audio-visualizer/
  build/
    icon.png
    icon.ico
  renderer/
    index.html
    style.css
    renderer.js
  main.js
  preload.js
  package.json
  win-sign-dummy.js   # no-op signer for Windows builds
  docs/               # optional: static web version for GitHub Pages
```

---

## Getting started (desktop app)

### Requirements
- **Node.js 18+**
- Windows / macOS / Linux
- Optional for system audio:
  - **Windows:** VB-CABLE / VoiceMeeter (virtual input)
  - **macOS:** BlackHole (2ch) + “Multi-Output Device” to hear and visualize at once

### Install & run (development)

```bash
npm install
npm start
```

- Click **Start** → grant microphone permission.
- Open **Source** selector and choose your device:
  - e.g., **CABLE Output (VB-Audio Virtual Cable)** on Windows
  - e.g., **BlackHole 2ch** on macOS
- Click **Fullscreen** (panel will auto-hide; move mouse to show it again).

### Build (packaged app)

```bash
# Windows — portable folder (no code signing required)
npm run build:win:dir

# Windows — NSIS installer (you can keep it unsigned for local use)
npm run build:win

# macOS — universal (dmg for x64 and arm64)
npm run build:mac

# Linux — AppImage and deb
npm run build:linux
```

> **Note (Windows):** the project uses `win-sign-dummy.js` to disable signing by default, avoiding codesign errors during local builds.

---

## Using system audio (loopback)

You can visualize Spotify, YouTube, or any system audio using a **virtual audio cable** and (optionally) a multi-output so you can still hear it:

### Windows
- Install **VB-CABLE** (or **VoiceMeeter**).
- In Windows Sound:
  - **Playback** (speaker icon): set your headphones/speakers as default (so you keep hearing).
  - **Recording**: set **CABLE Output** as *Default device* (or just select it inside the app).
- In the visualizer UI, choose **CABLE Output** in *Source*.

### macOS
- Install **BlackHole (2ch)**.
- Open **Audio MIDI Setup**:
  - Create a **Multi-Output Device** = (Headphones/Scarlett) + BlackHole.
  - Set **Multi-Output Device** as the system **Output** (so you hear audio).
- In the visualizer, select **BlackHole 2ch** as the *Source*.

---

## Web version (GitHub Pages)

The renderer code also runs in a browser (no Electron required). Deploy it as static files over HTTPS:

1. Create a **`docs/`** folder and copy:
   ```
   docs/index.html
   docs/style.css
   docs/renderer.js
   ```
2. Commit and push to `main`.
3. In GitHub → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/docs**
4. Your site:  
   `https://<your-username>.github.io/<your-repo>/`

> **Browser permission:** Pages runs on HTTPS, so `getUserMedia` works. Click **Start** to grant mic access and select your virtual input (VB-CABLE / BlackHole).

---

## Controls & presets

- **Source**: audio input device (mic, USB interface, VB-CABLE, BlackHole, etc.).
- **Visual Style**:
  - *Classic*: Bars, **Mirror Bars (v5)**, Radial, Wave, Particles
  - *Pro*: **Rounded Bars**, Radial-Filled, Dual Wave, Orbits, Tunnel
  - *Wow*: Spiral, Mountains, Grid Laser
- **Palette**: Neon (default), Fire, Ice, Rainbow, Mono.
- **Start / Stop**: start or stop the audio graph.
- **Fullscreen**: toggles fullscreen; panel auto-hides and reappears on mouse move.

---

## Performance tips

- **Rounded Bars** use glow and rounded caps—beautiful but heavier. If your device stutters, try:
  - Reduce `barCount` in `renderer.js` for bars-based presets.
  - Reduce `shadowBlur` values.
- Use a **wired** audio device if you notice OS-level latency.
- Keep the browser tab focused (for the web version) to ensure consistent animation timing.

---

## Audio mapping (for better highs)

`renderer.js` uses:

- **Logarithmic binning** so lows don’t dominate.
- **High-frequency tilt** so the right side of the spectrum stays alive.
- **Dynamic floor for highs** that only activates when overall energy is present (no idle “carpet”).

If you want even more high-end motion, tweak inside `computeBandValue(...)`:
```js
const hfStart = 0.6;           // where high-boost begins (0..1 across the screen)
const highTiltMax = 1.0 + 2.0; // raise to 3.0 for brighter highs
```

---

## Troubleshooting

**No inputs in the dropdown**
- Ensure the script runs (open DevTools Console to check for errors).
- HTTPS is required on the web; Electron works locally.
- Grant microphone permission when pressing **Start**.
- On macOS, you may need to grant mic access in **System Settings → Privacy & Security → Microphone**.

**Silent or flat bars**
- Make sure the correct device is selected (VB-CABLE / BlackHole).
- Confirm audio is actually routed to the virtual device (Windows Sound / Audio MIDI Setup on macOS).

**Can’t hear audio after selecting the virtual device**
- Windows: use your normal **Playback** device for speakers/headphones and select **CABLE Output** only inside the app.
- macOS: create **Multi-Output Device** (Headphones + BlackHole) so you hear and the visualizer receives signal.

**Fullscreen doesn’t show controls**
- Move the mouse—panel reappears on motion.
- Press **Esc** to exit fullscreen.

**Build issues on Windows**
- Keep `win-sign-dummy.js` and the provided `package.json` scripts; don’t set `WIN_CSC_LINK` unless you have a real code-signing cert.

---

## Commands (package.json)

```json
{
  "scripts": {
    "start": "electron .",
    "build:win": "cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win nsis --x64",
    "build:win:dir": "cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win dir --x64",
    "build:mac": "electron-builder --mac dmg --x64 --arm64",
    "build:linux": "electron-builder --linux AppImage deb --x64"
  }
}
```

---

## Contributing / customizing

- Add new styles in `renderer.js` and register them in `STYLE_MAP`.
- Add color palettes in `getPaletteColors(...)`.
- You can tweak the spectrum shape (lows vs highs) in `computeBandValue(...)`.

Pull requests are welcome!

---

## License

MIT (see `LICENSE` if included, otherwise treat as MIT by default).
