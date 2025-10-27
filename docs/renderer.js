// renderer.js v11.1
(() => {
  const canvas = document.getElementById("visualizerCanvas");
  const ctx = canvas.getContext("2d");

  const inputSelect = document.getElementById("inputSelect");
  const styleSelect = document.getElementById("styleSelect");
  const colorSelect = document.getElementById("colorSelect");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnFs = document.getElementById("btnFullscreen");
  const panel = document.getElementById("controlPanel");

  let lastEnergy = 0;
  let audioCtx = null;
  let analyser = null;
  let mediaStream = null;
  let freqData = null;
  let timeData = null;
  let rafId = null;
  let running = false;
  let nyquist = 22050;

  let fullScreenPanelHideTimer = null;

  // viz state
  let t = 0;
  let orbitAngle = 0;
  let tunnelZ = 0;
  let spiralAngle = 0;

  // smoothing for rounded bars
  let smoothBars = [];

  let currentStyle = localStorage.getItem("vizStyle") || "bars";
  let currentPalette = localStorage.getItem("vizPalette") || "neon";
  styleSelect.value = currentStyle;
  colorSelect.value = currentPalette;

  // device persistence
  let savedDeviceId = localStorage.getItem("audioDeviceId") || "";

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  // ------ Colors ------
  function getPaletteColors(palette, energy, i, n) {
    switch (palette) {
      case "fire": {
        const base = Math.min(1, energy * 1.5);
        const r = 255,
          g = Math.floor(80 + 140 * base),
          b = 40;
        return {
          fill: `rgb(${r},${g},${b})`,
          stroke: `rgb(${r},${g},${b})`,
          glow: `rgba(${r},${g},${b},0.4)`,
        };
      }
      case "ice": {
        const base = Math.min(1, energy * 1.5);
        const r = 0,
          g = Math.floor(160 + 80 * base),
          b = 255;
        return {
          fill: `rgb(${r},${g},${b})`,
          stroke: `rgb(${r},${g},${b})`,
          glow: `rgba(${r},${g},${b},0.4)`,
        };
      }
      case "rainbow": {
        const hue = Math.floor(((i / (n || 1)) * 360 + t * 20) % 360);
        return {
          fill: `hsl(${hue},90%,60%)`,
          stroke: `hsl(${hue},90%,60%)`,
          glow: `hsla(${hue},90%,60%,0.4)`,
        };
      }
      case "mono": {
        const base = Math.floor(180 + 60 * Math.min(1, energy * 2));
        return {
          fill: `rgb(${base},${base},${base})`,
          stroke: `rgb(${base},${base},${base})`,
          glow: `rgba(${base},${base},${base},0.4)`,
        };
      }
      case "neon":
      default: {
        const g = Math.floor(200 + 55 * Math.min(1, energy * 2));
        return {
          fill: `rgb(0,255,${g})`,
          stroke: `rgb(0,255,${g})`,
          glow: `rgba(0,255,180,0.4)`,
        };
      }
    }
  }

  // ------ Energy ------
  function computeEnergy() {
    if (!freqData) return 0;
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
    const avg = sum / (freqData.length * 255);
    return Math.pow(avg, 0.5) * 1.8;
  }

  // ------ Frequency helpers (log binning + EQ boost) ------
  function computeBandValue(b, barCount) {
    const len = freqData.length;

    // 1. Log-ish binning (mismo approach que antes, concentra más bins en graves)
    const p0 = b / barCount;
    const p1 = (b + 1) / barCount;
    const start = Math.floor(p0 * p0 * len);
    const end = Math.min(len, Math.floor(p1 * p1 * len) + 1);

    let sum = 0;
    let cnt = 0;
    for (let i = start; i < end; i++) {
      sum += freqData[i];
      cnt++;
    }
    let v = cnt ? sum / cnt : 0; // 0..255 promedio de esa “banda”

    // --- etapa 2: balance graves/agudos ---

    // Reducir graves levemente para que no aplanen todo.
    // b=0 (izq) => factor ~0.8
    // b=max (der)=> factor ~1.0
    const frac = b / (barCount - 1 || 1); // 0..1 izquierda->derecha
    const bassCut = 0.8 + 0.2 * frac;
    v *= bassCut;

    // Boostear agudos mucho más al final
    // A partir de ~60% de la pantalla hacia la derecha.
    const hfStart = 0.6;
    if (frac > hfStart) {
      const tNorm = (frac - hfStart) / (1 - hfStart); // 0..1 en la zona alta
      // escala 1 → ~3.0 en el extremo derecho
      const highTilt = 1.0 + 2.0 * Math.pow(tNorm, 1.2);
      v *= highTilt;
    }

    // --- etapa 3: piso dinámico SOLO si hay música ---
    // lastEnergy ~0 en silencio, ~0.4+ con música fuerte.
    // Sólo levantamos barras altas si realmente hay energía (>0.15 aprox).
    if (lastEnergy > 0.15 && frac > hfStart) {
      const minFloor = 4 + lastEnergy * 10;
      // ej: con música fuerte lastEnergy~0.4 => minFloor ~8
      // con música floja lastEnergy~0.1 => este bloque ni corre
      if (v < minFloor) {
        v = minFloor;
      }
    }

    // Clip final
    if (v > 255) v = 255;
    return v;
  }

  // ------ Styles ------
  function drawBars(w, h, energy) {
    const barCount = 120;
    const barW = w / barCount;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, w, h);
    for (let b = 0; b < barCount; b++) {
      const v = computeBandValue(b, barCount);
      const barH = (v / 255) * h * 0.62 * (1 + energy * 0.35);
      const x = b * barW;
      const y = h - barH;
      const col = getPaletteColors(currentPalette, energy, b, barCount);
      ctx.fillStyle = col.fill;
      ctx.fillRect(x, y, barW - 1, barH);
    }
  }

  function drawBarsRounded(w, h, energy) {
    const barCount = 96;
    const barW = w / barCount;
    if (smoothBars.length !== barCount)
      smoothBars = new Array(barCount).fill(0);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
    for (let b = 0; b < barCount; b++) {
      const v = computeBandValue(b, barCount);
      const targetH = (v / 255) * h * 0.68 * (1 + energy * 0.35);
      const cur = smoothBars[b];
      smoothBars[b] = cur + (targetH - cur) * 0.22;
      const barH = smoothBars[b];
      const x = b * barW;
      const y = h - barH;
      const col = getPaletteColors(currentPalette, energy, b, barCount);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(x, h - barH * 0.15, barW - 1, barH * 0.15);
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 25;
      ctx.fillStyle = col.fill;
      const radius = Math.min(12, barW * 0.6);
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, barW - 2, barH, radius);
        ctx.fill();
      } else {
        const r = radius,
          wRect = barW - 2,
          hRect = barH;
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.lineTo(x, y + hRect);
        ctx.lineTo(x + wRect, y + hRect);
        ctx.lineTo(x + wRect, y + r);
        ctx.quadraticCurveTo(x + wRect, y, x + wRect - r, y);
        ctx.lineTo(x + r, y);
        ctx.quadraticCurveTo(x, y, x, y + r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, w, 1);
  }

  // Mirror (v5-style)
  function drawMirrorV5(w, h, energy) {
    const barCount = 72;
    const halfW = w / 2;
    const barW = (w * 0.48) / barCount;
    const yMid = h * 0.5;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
    for (let b = 0; b < barCount; b++) {
      const v = computeBandValue(b, barCount);
      const barH = (v / 255) * h * 0.42 * (1 + energy * 0.35);
      const col = getPaletteColors(currentPalette, energy, b, barCount);
      const radius = Math.min(10, barW * 0.6);
      const xL = halfW - (b + 1) * barW;
      const xR = halfW + b * barW;
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 20;
      ctx.fillStyle = col.fill;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(xL, yMid - barH, barW - 1, barH, radius);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(xL, yMid, barW - 1, barH, radius);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(xR, yMid - barH, barW - 1, barH, radius);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(xR, yMid, barW - 1, barH, radius);
        ctx.fill();
      } else {
        ctx.fillRect(xL, yMid - barH, barW - 1, barH);
        ctx.fillRect(xL, yMid, barW - 1, barH);
        ctx.fillRect(xR, yMid - barH, barW - 1, barH);
        ctx.fillRect(xR, yMid, barW - 1, barH);
      }
      ctx.shadowBlur = 0;
    }
  }

  function drawWave(w, h, energy) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, w, h);
    const col = getPaletteColors(currentPalette, energy, 0, 1);
    ctx.beginPath();
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = 2;
    const len = timeData.length;
    for (let i = 0; i < len; i++) {
      const v = (timeData[i] - 128) / 128;
      const x = (i / len) * w;
      const y = h / 2 + v * h * 0.4 * (1 + energy * 0.4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawDualWave(w, h, energy) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);
    const len = timeData.length,
      amp = h * 0.28 * (1 + energy * 0.4),
      col = getPaletteColors(currentPalette, energy, 0, 1);
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.stroke;
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i] - 128) / 128;
      const x = (i / len) * w;
      const y = h * 0.35 + v * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i] - 128) / 128;
      const x = (i / len) * w;
      const y = h * 0.65 + v * amp * -1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawParticles(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);
    const bassBins = 32;
    for (let i = 0; i < bassBins; i++) {
      const v = freqData[i] || 0;
      const p = v / 255;
      if (p < 0.05) continue;
      const radius = 2 + 20 * p * (1 + energy * 0.8);
      const angle = (i / bassBins) * Math.PI * 2 + t * 0.5;
      const r = w * 0.15 + w * 0.25 * p;
      const cx = w / 2 + Math.cos(angle) * r,
        cy = h / 2 + Math.sin(angle) * r;
      const col = getPaletteColors(currentPalette, energy, i, bassBins);
      ctx.beginPath();
      ctx.fillStyle = col.fill;
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 30;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawRadial(w, h, energy) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2,
      count = 180;
    for (let i = 0; i < count; i++) {
      const v = computeBandValue(i, count);
      const len = 40 + (v / 255) * Math.min(w, h) * 0.4 * (1 + energy * 0.4);
      const ang = (i / count) * Math.PI * 2 + t * 0.02;
      const x2 = cx + Math.cos(ang) * len,
        y2 = cy + Math.sin(ang) * len;
      const col = getPaletteColors(currentPalette, energy, i, count);
      ctx.strokeStyle = col.stroke;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  function drawRadialFilled(w, h, energy) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2,
      count = 180;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const v = computeBandValue(i, count);
      const len = 20 + (v / 255) * Math.min(w, h) * 0.4 * (1 + energy * 0.4);
      const ang = (i / count) * Math.PI * 2 + t * 0.02;
      const x = cx + Math.cos(ang) * len;
      const y = cy + Math.sin(ang) * len;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const col = getPaletteColors(currentPalette, energy, 0, 1);
    ctx.fillStyle = col.fill;
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawOrbits(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2;
    orbitAngle += 0.01 + energy * 0.02;
    const rings = 5;
    for (let r = 1; r <= rings; r++) {
      const radius = r * (Math.min(w, h) * 0.08) + energy * 30;
      const col = getPaletteColors(currentPalette, energy, r, rings);
      ctx.beginPath();
      ctx.strokeStyle = col.stroke;
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 25;
      ctx.lineWidth = 1;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      const x = cx + Math.cos(orbitAngle * r) * radius,
        y = cy + Math.sin(orbitAngle * r) * radius;
      ctx.beginPath();
      ctx.fillStyle = col.fill;
      ctx.arc(x, y, 4 + energy * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawTunnel(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, w, h);
    tunnelZ += 0.05 + energy * 0.2;
    const cx = w / 2,
      cy = h * 0.6,
      depthLayers = 20;
    const col = getPaletteColors(currentPalette, energy, 0, 1);
    ctx.strokeStyle = col.stroke;
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 20;
    ctx.lineWidth = 1;
    for (let d = 0; d < depthLayers; d++) {
      const scale = 1 / (0.1 + d * 0.07 + ((tunnelZ * 0.03) % 1));
      const halfW = w * 0.15 * scale,
        halfH = h * 0.05 * scale,
        alpha = 1 - d / depthLayers;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawSpiral(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);
    spiralAngle += 0.02 + energy * 0.05;
    const cx = w / 2,
      cy = h / 2,
      turns = 200;
    for (let i = 0; i < turns; i++) {
      const v = freqData[i % freqData.length] || 0;
      const p = v / 255;
      const radius = i * 0.5 * (1 + energy * 0.3);
      const ang = spiralAngle + i * 0.1;
      const x = cx + Math.cos(ang) * radius,
        y = cy + Math.sin(ang) * radius;
      const col = getPaletteColors(currentPalette, energy, i, turns);
      ctx.fillStyle = col.fill;
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 20;
      ctx.fillRect(x, y, 2 + 4 * p, 2 + 4 * p);
    }
    ctx.shadowBlur = 0;
  }

  function drawMountains(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 3; layer++) {
      const offs = layer * 30 + t * 20 * (0.02 + layer * 0.01);
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.floor((x / w) * freqData.length);
        const v = freqData[idx] || 0;
        const p = v / 255;
        const baseY = h * 0.6 + layer * 40;
        const y = baseY - (p * 120 * (1 + energy * 0.4)) / (layer + 1);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y - Math.sin((x + offs) * 0.02) * 10);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const col = getPaletteColors(currentPalette, energy, layer, 3);
      ctx.fillStyle = col.fill;
      ctx.globalAlpha = 0.4 - layer * 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawGridBeam(w, h, energy) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.45;
    const lines = 20;
    const persp = 200 + energy * 80;
    const col = getPaletteColors(currentPalette, energy, 0, 1);
    ctx.strokeStyle = col.stroke;
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 15;
    ctx.lineWidth = 1;
    for (let i = 1; i < lines; i++) {
      const z = i * 20;
      const y = horizon + persp / (z + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const cols = 20;
    for (let c = 0; c < cols; c++) {
      const xNorm = (c / (cols - 1)) * 2 - 1;
      ctx.beginPath();
      ctx.moveTo(w / 2 + xNorm * w * 0.02, horizon);
      ctx.lineTo(w / 2 + xNorm * w, h);
      ctx.stroke();
    }
    const beamH = 60 + energy * 120;
    const beamW = 30 + energy * 40;
    const bx = w / 2 - beamW / 2;
    const by = horizon - beamH;
    ctx.fillStyle = col.fill;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(bx, by, beamW, beamH);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  const STYLE_MAP = {
    bars: drawBars,
    mirror: drawMirrorV5,
    radial: drawRadial,
    wave: drawWave,
    particles: drawParticles,
    barsRounded: drawBarsRounded,
    radialFilled: drawRadialFilled,
    dualWave: drawDualWave,
    orbits: drawOrbits,
    tunnel: drawTunnel,
    spiral: drawSpiral,
    mountains: drawMountains,
    gridBeam: drawGridBeam,
  };

  function renderLoop() {
    if (!running) return;
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const energy = computeEnergy();

    // guardamos energía global del frame para que computeBandValue la pueda usar
    lastEnergy = energy;

    const fn = STYLE_MAP[currentStyle] || drawBars;
    fn(w, h, energy);

    t += 0.016;
    rafId = requestAnimationFrame(renderLoop);
  }

  async function startAudio() {
    if (running) return;
    try {
      const deviceId = inputSelect.value || undefined;
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      nyquist = (audioCtx.sampleRate || 44100) / 2;
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
      running = true;
      btnStart.disabled = true;
      btnStop.disabled = false;
      renderLoop();
    } catch (err) {
      console.error("getUserMedia error", err);
    }
  }

  function stopAudio() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((tr) => tr.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  async function refreshInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");
    const current = inputSelect.value;
    inputSelect.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "(Micrófono / default)";
    inputSelect.appendChild(def);
    audioInputs.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Input ${d.deviceId}`;
      inputSelect.appendChild(opt);
    });
    if (savedDeviceId) {
      const found = [...inputSelect.options].find(
        (o) => o.value === savedDeviceId
      );
      if (found) inputSelect.value = savedDeviceId;
    } else if (current) {
      const found = [...inputSelect.options].find((o) => o.value === current);
      if (found) inputSelect.value = current;
    }
  }

  function showPanelTemp() {
    panel.classList.remove("hidden");
    if (fullScreenPanelHideTimer) clearTimeout(fullScreenPanelHideTimer);
    if (isActuallyFullscreen())
      fullScreenPanelHideTimer = setTimeout(
        () => panel.classList.add("hidden"),
        2000
      );
  }
  function isActuallyFullscreen() {
    return (
      window.innerHeight >= screen.height - 1 &&
      window.innerWidth >= screen.width - 1
    );
  }
  window.addEventListener("mousemove", () => {
    if (isActuallyFullscreen()) showPanelTemp();
  });

  btnStart.addEventListener("click", startAudio);
  btnStop.addEventListener("click", stopAudio);
  btnFs.addEventListener("click", async () => {
    if (window.electronAPI && window.electronAPI.toggleFullscreen) {
      const state = await window.electronAPI.toggleFullscreen();
      if (state) showPanelTemp();
      else panel.classList.remove("hidden");
    } else {
      const doc = document;
      if (!doc.fullscreenElement) {
        const el = doc.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        showPanelTemp();
      } else {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        panel.classList.remove("hidden");
      }
    }
  });
  styleSelect.addEventListener("change", (e) => {
    localStorage.setItem("vizStyle", e.target.value);
    currentStyle = e.target.value;
  });
  colorSelect.addEventListener("change", (e) => {
    localStorage.setItem("vizPalette", e.target.value);
    currentPalette = e.target.value;
  });
  inputSelect.addEventListener("change", (e) => {
    savedDeviceId = e.target.value;
    localStorage.setItem("audioDeviceId", savedDeviceId);
    if (running) {
      stopAudio();
      startAudio();
    }
  });

  refreshInputs();
  navigator.mediaDevices.addEventListener("devicechange", refreshInputs);
})();
