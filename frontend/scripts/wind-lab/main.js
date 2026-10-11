// ═══════════════════════════════════════════════════════════════════════
// THE SKETCH — parameters, the frame loop, the instruments, the overlay.
// ═══════════════════════════════════════════════════════════════════════

let params = {
  seed: 1963,
  rules: 'dark',      // 'dark' = dark's rules on every ground, 'today' = each theme as it draws now
  ceil: 58,           // room: the everyday-wind ground over land sits at or under this L*
  stepScale: 1.0,     // the streak's step above its ground, as a share of dark's own step at the same speed
  cMin: 25,           // colour floor: no streak buys lightness below this CIELAB chroma
  olive: 76,          // name guard: orange and yellow grounds stay at or above this L* (a dim orange is brown, a dim yellow olive)
  ring: 0.25,         // the inner white ring, light and beach under dark's rules (dark keeps its own)
  density: 490,       // marks per 100 × 100 CSS px: the engine's own dose at zoom ≤ 6
  everyday: 14,       // median open-water wind, kn
  storm: 0.8,         // strength of the seeded low
  speed: 1.0,         // motion, × the engine's 0.0704 CSS px per knot per frame
  fade: 0.985,        // the trail's fade per frame at zoom ≤ 5.5
  cvd: 0,             // 0 normal · 1 protanopia · 2 deuteranopia · 3 tritanopia
};
let defaultParams = { ...params };

const DPR = 1.5, ZS = 0.62 + 0.38 * ss(3, 7, 5);       // the lab's zoom is 5
const MAX_P = 40000;
let E = null, T = null, U = null, vdata = new Float32Array(MAX_P * 6), px = new Float32Array(MAX_P), py = new Float32Array(MAX_P);
let nP = 0, vmax = 1, frame = 0, paused = false, lastMeasure = null, palette = null;

function setup() {
  const c = createCanvas(W, H);
  pixelDensity(1);
  c.parent('canvas-container');
  c.elt.setAttribute('role', 'img');
  c.elt.setAttribute('aria-label', 'Animated wind streaks over one coastline drawn three times: on dark, beach and light grounds.');
  try { E = makeEngine(W, H); } catch (err) { E = null; console.error(err); }
  document.querySelector('.loading').style.display = 'none';
  if (!E) { noLoop(); background(250, 249, 245); fill(20); textAlign(CENTER, CENTER); textSize(28); text('This view needs WebGL.', W / 2, H / 2); return; }
  textFont('Poppins');
  initializeSystem();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
}

function initializeSystem() {
  randomSeed(params.seed);
  noiseSeed(params.seed);
  buildGeo(params);
  uploadGeo();
  rebuildTables();
  nP = Math.min(MAX_P, Math.round(params.density * (W / DPR) * (H / DPR) / 1e4));
  for (let i = 0; i < nP; i++) { px[i] = random(W); py[i] = random(H); }
  E.clear();
  for (let k = 0; k < 150; k++) stepSystem();       // let the trail reach its steady look before the first frame shows
  frame = 0;
  render();
  measure();
}

function uploadGeo() {
  const rgba = new Uint8Array(MX * MY * 4);
  vmax = 1;
  for (let k = 0; k < GX * GY; k++) vmax = Math.max(vmax, geo.kn[k]);
  for (let j = 0; j < MY; j++) for (let i = 0; i < MX; i++) {
    const o = (j * MX + i) * 4, x = (i + 0.5) * W / MX, y = (j + 0.5) * H / MY, l = landMask[j * MX + i];
    const edge = (i > 0 && landMask[j * MX + i - 1] !== l) || (i < MX - 1 && landMask[j * MX + i + 1] !== l)
      || (j > 0 && landMask[(j - 1) * MX + i] !== l) || (j < MY - 1 && landMask[(j + 1) * MX + i] !== l);
    rgba[o] = Math.round(Math.min(1, sampleWind(x, y)[2] / KN_MAX) * 255);
    rgba[o + 1] = l * 255; rgba[o + 2] = edge ? 110 : 0; rgba[o + 3] = 255;
  }
  E.setGeo(MX, MY, rgba);
}

// The colour tables for the current rule set, packed into the LUT the composite reads.
function rebuildTables() {
  T = buildTables(params.rules, { ceil: params.ceil, stepScale: params.stepScale, cMin: params.cMin, olive: params.olive, ring: params.ring, strength: 1 });
  const rgba = new Uint8Array(256 * 8 * 4);
  // rows: 0 dark · 1 beach field · 2 beach streak (land) · 3 light field · 4 light streak (land) · 5 beach streak (water) ·
  // 6 unused · 7 light streak (water). The composite finds a theme's water row 3 below its land row.
  const rows = [T.dark.streak, T.beach.field, T.beach.streak, T.light.field, T.light.streak, T.beach.streakWater, T.light.field, T.light.streakWater];
  rows.forEach((row, r) => row.forEach((c, i) => { for (let k = 0; k < 4; k++) rgba[(r * 256 + i) * 4 + k] = Math.round(clamp01(c[k]) * 255); }));
  E.setLut(rgba);
  const v = (rgb) => rgb;
  U = { u_landD: v(GROUND.dark.land), u_waterD: v(GROUND.dark.water), u_landB: v(GROUND.beach.land), u_waterB: v(GROUND.beach.water),
    u_landL: v(GROUND.light.land), u_waterL: v(GROUND.light.water),
    u_opB: T.beach.op, u_opL: T.light.op, u_brightB: T.beach.bright ? 1 : 0, u_brightL: T.light.bright ? 1 : 0,
    u_solvedB: T.beach.solvedTint ? 1 : 0, u_solvedL: T.light.solvedTint ? 1 : 0 };
  palette = {};
  const T0 = buildTables('today');
  for (const t of ['dark', 'beach', 'light']) palette[t] = { cvdLand: cvdFloor(T, t, 'land'), cvdWater: cvdFloor(T, t, 'water'), chroma: weakestChroma(T, t),
    was: [cvdFloor(T0, t, 'land'), cvdFloor(T0, t, 'water'), weakestChroma(T0, t)] };
  if (frame > 0) { lastMeasure = null; }
  renderPalette();
}

const themeAt = (x) => (x < STRIP ? 'dark' : x < 2 * STRIP ? 'beach' : 'light');

// One frame of motion: the engine's advection, its respawn law, its marks.
function stepSystem() {
  const unit = 0.0704 * DPR * params.speed;
  for (let i = 0; i < nP; i++) {
    let x = px[i], y = py[i];
    let [u, v, kn] = sampleWind(x, y);
    const m = Math.hypot(u, v) || 1e-6, dx = u / m, dy = v / m;
    const move = unit * kn * Math.pow(Math.min(1, Math.max(0.02, kn / vmax)), 0.15);
    x += dx * move; y += dy * move;
    // drop: legacy floor, size-aware base, slow-band cap, the 6-frame motion floor
    const zs = ZS, sBase = kn < 0.5 ? 0 : 2.5 + 2.5 * ss(1, 30, kn);
    const sFloor = kn >= 1 && kn < 10 ? 3.073 * zs : kn >= 0.3 && kn < 1 ? 2.2 * zs : 0;
    const elong = 1.8 + 0.8 * ss(10, 0.5, kn), legacy = 0.002 + kn * 0.008;
    let drop = Math.max(legacy, Math.max(sBase, sFloor) ** 2 / elong / 130);
    if (kn < 4.75) drop = Math.max(legacy, Math.min(drop, 0.04));
    drop = Math.min(1 / 6, Math.max(0.002, drop));
    if (x < 0 || x >= W || y < 0 || y >= H || random() < drop) { x = random(W); y = random(H); [u, v, kn] = sampleWind(x, y); }
    px[i] = x; py[i] = y;
    const t = themeAt(x), o = i * 6;
    vdata[o] = x; vdata[o + 1] = y; vdata[o + 2] = kn; vdata[o + 3] = dx; vdata[o + 4] = dy;
    vdata[o + 5] = T[t].streak[texelOf(Math.min(KN_TOP, kn))][3];
  }
  E.step(vdata, nP, params.fade, DPR, ZS, [T.dark.ring, T.beach.ring, T.light.ring]);
}

function draw() {
  if (!E) return;
  if (!paused) { stepSystem(); frame++; }
  render();
  if (!paused && frame % 60 === 0) measure();
}

function render() {
  E.composite(U, { cvd: params.cvd });
  drawingContext.drawImage(E.canvas, 0, 0);
  drawOverlay();
}

// ── Overlay: names, seams, Beaufort chips (ground over land, the streak on it at full strength) ─────
const CHIP_KN = BEAUFORT;
function drawOverlay() {
  const kinds = [null, 'protan', 'deutan', 'tritan'];
  const sim = (rgb) => simulate(rgb, kinds[params.cvd]);
  const css = (rgb) => color(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255);
  noStroke();
  fill(250, 249, 245); for (let s = 1; s < 3; s++) rect(s * STRIP - 1.5, 0, 3, H);
  ['dark', 'beach', 'light'].forEach((t, s) => {
    const x0 = s * STRIP, onDark = t === 'dark';
    const ink = onDark ? color(236, 240, 246) : color(28, 34, 42), panel = onDark ? color(10, 12, 16, 200) : color(250, 249, 245, 215);
    fill(panel); rect(x0 + 14, 14, 186, 52, 8);
    fill(ink); textStyle(BOLD); textSize(19); textAlign(LEFT, TOP); text(t.toUpperCase(), x0 + 26, 20);
    textStyle(NORMAL); textSize(14); text(t === 'dark' || params.rules === 'dark' ? "dark's rules" : 'as drawn today', x0 + 26, 43);
    const cw = (STRIP - 40) / CHIP_KN.length, y0 = H - 76;
    fill(panel); rect(x0 + 12, y0 - 10, STRIP - 24, 68, 8);
    CHIP_KN.forEach((kn, i) => {
      const cx = x0 + 20 + i * cw;
      fill(css(sim(groundOf(T, t, 'land', kn)))); rect(cx, y0, cw - 2, 15);
      fill(css(sim(streakOn(T, t, 'land', kn)))); rect(cx, y0 + 15, cw - 2, 15);
      if (i % 2 === 0) { fill(ink); textSize(12); textAlign(CENTER, TOP); text(kn, cx + (cw - 2) / 2, y0 + 35); }
    });
  });
}

// ── Instruments: the wind bench's style columns, measured on this frame ─────
const LIN = Array.from({ length: 256 }, (_, i) => dec(i / 255));
const Lof = (r, g, b) => { const Y = 0.2126729 * LIN[r] + 0.7151522 * LIN[g] + 0.0721750 * LIN[b]; return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : Y * 24389 / 27; };
// APCA lightness contrast, the formula Color.js implements (0.0.98G constants); |Lc| 45 is its floor for fine detail.
function apca(txt, bg) {
  const Y = (c) => { let y = 0.2126729 * c[0] ** 2.4 + 0.7151522 * c[1] ** 2.4 + 0.0721750 * c[2] ** 2.4; return y < 0.022 ? y + (0.022 - y) ** 1.414 : y; };
  const yt = Y(txt), yb = Y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
}
const WASH_END = 71, WASH_DARKER = 0.15;
function measure() {
  E.composite(U, { groundOnly: 1, toMeasure: true }); const g = E.read('measure');
  E.composite(U, { toMeasure: true }); const o = E.read('measure');
  const b = E.read('body');
  const cells = {};
  for (const t of ['dark', 'beach', 'light']) for (const s of ['land', 'water'])
    cells[t + s] = { n: 0, streak: 0, lighter: 0, darker: 0, gH: new Uint32Array(201), dH: new Uint32Array(321), sum0: [0, 0, 0], sum1: [0, 0, 0], lc: [] };
  for (let y = 1; y < H; y += 3) for (let x = 1; x < W; x += 3) {
    if (x % STRIP < 4 || x % STRIP > STRIP - 4) continue;
    const k = ((H - 1 - y) * W + x) * 4, land = landMask[(y >> 1) * MX + (x >> 1)];
    const c = cells[themeAt(x) + (land ? 'land' : 'water')];
    const Lg = Lof(g[k], g[k + 1], g[k + 2]), Lo = Lof(o[k], o[k + 1], o[k + 2]);
    c.n++; c.gH[Math.min(200, Math.max(0, Math.round(Lg * 2)))]++;
    for (let ch = 0; ch < 3; ch++) { c.sum0[ch] += LIN[g[k + ch]]; c.sum1[ch] += LIN[o[k + ch]]; }
    if (b[k + 3] >= 38) {                              // a streak pixel: trail brightness ≥ 0.15
      const dL = Lo - Lg; c.streak++;
      if (dL > 0.5) c.lighter++; else if (dL < -0.5) c.darker++;
      c.dH[Math.min(320, Math.max(0, Math.round((dL + 40) * 4)))]++;
      if (b[k + 3] >= 128 && c.lc.length < 4000) c.lc.push(Math.abs(apca([o[k] / 255, o[k + 1] / 255, o[k + 2] / 255], [g[k] / 255, g[k + 1] / 255, g[k + 2] / 255])));
    }
  }
  const median = (H, n, scale, off) => { let acc = 0; for (let i = 0; i < H.length; i++) { acc += H[i]; if (acc >= n / 2) return i / scale - off; } return NaN; };
  lastMeasure = {};
  for (const key in cells) {
    const c = cells[key]; if (!c.n) continue;
    const Lfield = median(c.gH, c.n, 2, 0), step = c.streak ? median(c.dH, c.streak, 4, 40) : 0;
    const cover = c.streak / c.n, darker = c.streak ? c.darker / c.streak : 0, end = Lfield + cover * step;
    c.lc.sort((a, z) => a - z);
    const mean = (s) => toEnc(s.map((v) => v / c.n));
    lastMeasure[key] = { step, lighter: c.streak ? c.lighter / c.streak : 0, darker, cover, Lfield, end,
      washes: end > WASH_END && darker < WASH_DARKER, lc: c.lc.length ? c.lc[c.lc.length >> 1] : 0, shift: de2000(mean(c.sum0), mean(c.sum1)) };
  }
  renderReadout();
}

// ── Sidebar readouts ─────
const fmt = (v, d = 1, sign = false) => (Number.isFinite(v) ? (sign && v > 0 ? '+' : '') + v.toFixed(d) : '–');
function renderReadout() {
  const el = document.getElementById('readout'); if (!el || !lastMeasure) return;
  let html = '<table class="readout"><thead><tr><th scope="col">ground</th><th scope="col">step</th><th scope="col">lighter</th><th scope="col">end L*</th><th scope="col">APCA</th><th scope="col">shift</th></tr></thead><tbody>';
  for (const t of ['dark', 'beach', 'light']) for (const s of ['land', 'water']) {
    const m = lastMeasure[t + s]; if (!m) continue;
    const pill = m.washes ? '<span class="pill wash">washes</span>' : '';
    html += `<tr><th scope="row">${t} ${s}</th><td>${fmt(m.step, 1, true)}</td><td>${fmt(m.lighter * 100, 0)}%</td><td>${fmt(m.end)} ${pill}</td><td>${fmt(m.lc, 0)}</td><td>${fmt(m.shift)}</td></tr>`;
  }
  el.innerHTML = html + '</tbody></table>';
}
function renderPalette() {
  const el = document.getElementById('palette'); if (!el || !palette) return;
  const showing = params.rules === 'dark' ? "dark's rules" : 'today';
  let html = '<table class="readout"><thead><tr><th scope="col">theme</th><th scope="col">colour-blind land</th><th scope="col">water</th><th scope="col">weakest C*</th></tr></thead><tbody>';
  for (const t of ['dark', 'beach', 'light']) {
    const p = palette[t], was = (v, d) => (t !== 'dark' && params.rules === 'dark' ? ` <span class="was">(${fmt(v, d)})</span>` : '');
    html += `<tr><th scope="row">${t}</th><td>${fmt(p.cvdLand, 2)}${was(p.was[0], 2)}</td><td>${fmt(p.cvdWater, 2)}${was(p.was[1], 2)}</td><td>${fmt(p.chroma)}${was(p.was[2], 1)}</td></tr>`;
  }
  el.innerHTML = html + `</tbody><caption class="cap">Showing ${showing}${params.rules === 'dark' ? '; today in brackets' : ''}.</caption></table>`;
}

// ── UI handlers ─────
const REBUILD_GEO = new Set(['everyday', 'storm', 'density']);
const REBUILD_TABLES = new Set(['ceil', 'stepScale', 'cMin', 'olive', 'ring']);
function updateParam(name, value) {
  params[name] = name === 'cvd' ? parseInt(value, 10) : parseFloat(value);
  const out = document.getElementById(name + '-value'); if (out) out.textContent = value;
  if (REBUILD_GEO.has(name)) initializeSystem();
  else if (REBUILD_TABLES.has(name)) { rebuildTables(); render(); measure(); }
  else render();
}
function setRules(rules) {
  params.rules = rules;
  document.querySelectorAll('[data-rules]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rules === rules)));
  document.querySelectorAll('.dark-only').forEach((el) => { el.hidden = rules !== 'dark'; });
  rebuildTables(); render(); measure();
}
function setPaused(p) {
  paused = p;
  const b = document.getElementById('pause'); if (b) { b.textContent = p ? 'Play' : 'Pause'; b.setAttribute('aria-pressed', String(p)); }
}
function regenerate() { initializeSystem(); }
