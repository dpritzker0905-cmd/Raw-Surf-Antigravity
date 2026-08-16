/**
 * shaderlab-gate.js — RUNTIME proof harness for the land-mask halo's prime suspect,
 * `u_dataMaskGate` (Audit 3.1 finding A3.1-03), plus the particle mask-bounds contract
 * (A3.1-06). Compiles the EXACT working-tree shader sources in a real WebGL context
 * (Playwright chromium + SwiftShader), asserts compile/link + active-uniform reality,
 * draws with the REAL vertex/fragment pair, and reads pixels at deterministic probes.
 *
 * Why this exists: every prior test of the gate asserted SOURCE STRINGS. WebGL silently
 * ignores uniform writes to a null location (Khronos spec), so "the setter ran" is not
 * "the linked program used the gate" — and no test had ever executed a draw. This harness
 * measures the gate's actual protective surface in pixels.
 *
 * The scenario geometry is the LIVE 2026-08-01 z8.03 measurement (deliveredCoverage test):
 *     view        -81.443 … -79.057
 *     _cachedMask -81.5501 … -79.1873   (east short 0.1304°)
 *
 * Usage:  node scripts/shaderlab-gate.js [outdir]
 * Output: shaderlab-report.json + per-scenario PNGs. One JSON row per scenario matching
 * the Audit 3.1 telemetry schema (artifact_sha, bounds, gate location/value, pixel probes).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test')));
}

const outdir = process.argv[2] || path.join(__dirname, 'shaderlab-out');
fs.mkdirSync(outdir, { recursive: true });

// ── Extract the EXACT shader strings from the working tree (never a paraphrase). The GLSL
// contains no backticks, so the template literal ends at the first backtick-semicolon.
function extractShader(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const marker = `export const ${name} = \``;
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`${name} not found in ${file}`);
  const j = src.indexOf('`;', i + marker.length);
  return src.slice(i + marker.length, j);
}
const mapDir = path.join(__dirname, '..', 'src', 'components', 'map');
const HEATMAP_VS = extractShader(path.join(mapDir, 'WebGLMarineShaders.js'), 'HEATMAP_VS');
const HEATMAP_FS = extractShader(path.join(mapDir, 'WebGLMarineShaders.js'), 'HEATMAP_FS');
const ADVECT_VS = extractShader(path.join(mapDir, 'WebGLMarineParticleShaders.js'), 'ADVECT_VS');
const ADVECT_FS = extractShader(path.join(mapDir, 'WebGLMarineParticleShaders.js'), 'ADVECT_FS');

// The live-measured geometry (see header).
const VIEW = { west: -81.443, south: 27.318, east: -79.057, north: 29.471 };
const SHORT = { west: -81.5501, south: 26.9252, east: -79.1873, north: 29.5986 };
const WIDE = { west: -83, south: 26, east: -78, north: 30 };       // a regional grid that covers the view
const WORLD = { west: -180, south: -70, east: 180, north: 70 };

function main() {
  return (async () => {
    const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const result = await page.evaluate(runLab, {
      HEATMAP_VS, HEATMAP_FS, ADVECT_VS, ADVECT_FS, VIEW, SHORT, WIDE, WORLD,
    });
    await browser.close();

    let sha = 'unknown';
    try { sha = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim(); } catch (e) {}
    result.artifact_sha = sha;
    result.generated_at = new Date().toISOString();
    for (const s of result.scenarios || []) {
      if (s.png) {
        const f = path.join(outdir, `${s.id}.png`);
        fs.writeFileSync(f, Buffer.from(s.png.split(',')[1], 'base64'));
        s.png = path.basename(f);
      }
    }
    fs.writeFileSync(path.join(outdir, 'shaderlab-report.json'), JSON.stringify(result, null, 2));
    // Human summary
    const lines = [];
    lines.push(`shaderlab-gate @ ${sha}  gpu=${result.gpu}`);
    lines.push(`heatmap: compiled=${result.heatmap.compiled} linked=${result.heatmap.linked} gateLocationActive=${result.heatmap.gateLocationActive} activeUniforms=${result.heatmap.activeUniformCount}`);
    for (const s of result.scenarios) {
      lines.push(`\n[${s.id}] ${s.title}`);
      for (const p of s.probes) {
        lines.push(`  ${p.label}: painted=${p.painted} alpha=${p.alpha}${p.expect !== undefined ? ` expect=${p.expect} ${p.painted === p.expect ? 'OK' : '*** VIOLATION ***'}` : ''}`);
      }
      if (s.diff) lines.push(`  gate on/off diff: ${s.diff.count} px changed (bbox ${JSON.stringify(s.diff.bbox)}) of ${s.diff.total}`);
    }
    for (const a of result.advect || []) {
      lines.push(`\n[advect ${a.id}] ${a.title}: survived=${a.survived}${a.expect !== undefined ? ` expect=${a.expect} ${a.survived === a.expect ? 'OK' : '*** VIOLATION ***'}` : ''} (next=${a.next}, predicted=${a.predicted})`);
    }
    const txt = lines.join('\n');
    fs.writeFileSync(path.join(outdir, 'shaderlab-summary.txt'), txt);
    console.log(txt);
  })();
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Everything below runs INSIDE the browser page.
function runLab(cfg) {
  const W = 512, H = 512;
  const out = { scenarios: [], advect: [] };

  const latToMercY = (lat) => {
    const c = Math.max(-85.051129, Math.min(85.051129, lat));
    const r = (c * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  const lngToMercX = (lng) => (lng + 180) / 360;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { error: 'no webgl context' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked';

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return { sh, ok: gl.getShaderParameter(sh, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(sh) };
  }
  function link(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fsr = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs.sh); gl.attachShader(prog, fsr.sh);
    gl.linkProgram(prog);
    const linked = gl.getProgramParameter(prog, gl.LINK_STATUS);
    return { prog, compiled: vs.ok && fsr.ok, linked, vsLog: vs.log, fsLog: fsr.log, linkLog: gl.getProgramInfoLog(prog) };
  }
  function solidTex(rgba) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const px = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) px.set(rgba, i * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ── HEATMAP program ─────────────────────────────────────────────────────────────────────
  const hp = link(cfg.HEATMAP_VS, cfg.HEATMAP_FS);
  const nU = hp.linked ? gl.getProgramParameter(hp.prog, gl.ACTIVE_UNIFORMS) : 0;
  const activeUniforms = [];
  for (let i = 0; i < nU; i++) activeUniforms.push(gl.getActiveUniform(hp.prog, i).name);
  const gateLoc = hp.linked ? gl.getUniformLocation(hp.prog, 'u_dataMaskGate') : null;
  const clipLoc = hp.linked ? gl.getUniformLocation(hp.prog, 'u_maskClipEnabled') : null;
  out.heatmap = {
    compiled: hp.compiled, linked: hp.linked, vsLog: hp.vsLog, fsLog: hp.fsLog,
    activeUniformCount: nU, gateLocationActive: gateLoc !== null,
    clipLocationActive: clipLoc !== null, activeUniforms,
  };
  if (!hp.linked) return out;

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);

  const waveTex = solidTex([217, 128, 128, 128]);   // dir≈(0.70,0), height 5.02 m — strong color
  const waterMask = solidTex([255, 255, 128, 255]);
  const landMask = solidTex([0, 0, 128, 255]);
  const bathTex = solidTex([200, 0, 0, 255]);
  const chlTex = solidTex([0, 0, 0, 255]);

  function u1f(p, n, v) { gl.uniform1f(gl.getUniformLocation(p, n), v); }
  function u2f(p, n, a, b) { gl.uniform2f(gl.getUniformLocation(p, n), a, b); }
  function u1i(p, n, v) { gl.uniform1i(gl.getUniformLocation(p, n), v); }

  // Draw the REAL heatmap pair over a mercator window; sc = one config.
  function drawHeatmap(sc) {
    const win = sc.window;
    const mx0 = lngToMercX(win.west), mx1 = lngToMercX(win.east);
    const my0 = latToMercY(win.north), my1 = latToMercY(win.south);   // north first (smaller mercY)
    const dx = mx1 - mx0, dy = my1 - my0;
    const mat = new Float32Array([2 / dx, 0, 0, 0, 0, -2 / dy, 0, 0, 0, 0, 1, 0, -(mx0 + mx1) / dx, (my0 + my1) / dy, 0, 1]);
    const p = hp.prog;
    gl.useProgram(p);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_matrix'), false, mat);
    u2f(p, 'u_dataBounds_min', sc.data.west, sc.data.south);
    u2f(p, 'u_dataBounds_max', sc.data.east, sc.data.north);
    u2f(p, 'u_maskBounds_min', sc.mask.west, sc.mask.south);
    u2f(p, 'u_maskBounds_max', sc.mask.east, sc.mask.north);
    u1f(p, 'u_dataMaskGate', sc.gate ? 1.0 : 0.0);
    if (clipLoc !== null) gl.uniform1f(clipLoc, sc.maskClip ? 1.0 : 0.0);
    u1f(p, 'u_lng_offset', 0);
    u1f(p, 'u_opacity', 0.8);
    u1f(p, 'u_maskEdgeSharp', 0);
    u1f(p, 'u_debug_mode', 0);
    u1f(p, 'u_theme', 0);
    u1f(p, 'u_edgeFeatherEnabled', sc.feather ? 1.0 : 0.0);
    u1f(p, 'u_edgeFeatherWidth', 0.18);
    u1f(p, 'u_is_estimated', 0);
    u1f(p, 'u_surfMode', 0);
    u1f(p, 'u_time', 0);
    u1f(p, 'u_heightAlphaEnabled', 0);
    u1f(p, 'u_heightAlphaLo', 0);
    u1f(p, 'u_heightAlphaHi', 1);
    u1f(p, 'u_ribbonRadiusDeg', 0);
    u1f(p, 'u_ribbonFloor', 0);
    u1f(p, 'u_bandInlandGate', 0);
    u1f(p, 'u_coastSDFEnabled', 0);
    u1f(p, 'u_overlaySDFEnabled', 0);
    u1f(p, 'u_coastErode', 0);
    u1f(p, 'u_coastAA', 0.02);
    const ov = sc.overlay || { on: false };
    u1f(p, 'u_overlayMaskEnabled', ov.on ? 1.0 : 0.0);
    u1f(p, 'u_overlayReplace', ov.replace ? 1.0 : 0.0);
    const ob = ov.bounds || { west: 0, south: 0, east: 0, north: 0 };
    u2f(p, 'u_overlayBounds_min', ob.west, ob.south);
    u2f(p, 'u_overlayBounds_max', ob.east, ob.north);
    // AV-01a truth rect (overlay-UV space); absent = legacy storage-bounds behavior. Against a
    // pre-gate shader these locations are null and gl silently ignores the writes (spec no-op).
    const tr = sc.truth || null;
    u1f(p, 'u_overlayTruthEnabled', tr ? 1.0 : 0.0);
    if (tr) { u2f(p, 'u_overlayTruth_min', tr.min[0], tr.min[1]); u2f(p, 'u_overlayTruth_max', tr.max[0], tr.max[1]); }
    u1i(p, 'u_waveTexture', 0);
    u1i(p, 'u_chlorophyllTexture', 1);
    u1i(p, 'u_bathymetryTexture', 2);
    u1i(p, 'u_oceanMaskTexture', 3);
    u1i(p, 'u_overlayMaskTexture', 4);
    const bind = (t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    bind(waveTex, 0); bind(chlTex, 1); bind(bathTex, 2);
    bind(sc.maskTex === 'land' ? landMask : waterMask, 3);
    bind(ov.tex === 'land' ? landMask : waterMask, 4);
    const loc = gl.getAttribLocation(p, 'a_grid_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.finish();
    return { mx0, my0, dx, dy };
  }

  function readAll() {
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
  function probePx(frame, lng, lat, label, expect) {
    // merc → pixel under the pure ortho matrix (exact; no vertex-density error: probes are
    // chosen in mercator space, the same space the varying interpolates linearly over).
    const mx = lngToMercX(lng), my = latToMercY(lat);
    const px = Math.round(((mx - frame.mx0) / frame.dx) * W - 0.5);
    const pyTop = Math.round(((my - frame.my0) / frame.dy) * H - 0.5);
    const py = H - 1 - pyTop;
    const b = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const r = { label, lng, lat, px, pyTop, rgba: Array.from(b), alpha: b[3], painted: b[3] > 12 };
    if (expect !== undefined) r.expect = expect;
    return r;
  }
  function diffFrames(a, b) {
    let count = 0; let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let i = 0; i < W * H; i++) {
      if (Math.abs(a[i * 4 + 3] - b[i * 4 + 3]) > 4) {
        count++;
        const x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { count, total: W * H, bbox: count ? [x0, y0, x1, y1] : null };
  }

  const V = cfg.VIEW, S = cfg.SHORT, WD = cfg.WIDE, WR = cfg.WORLD;
  const stripLng = (S.east + V.east) / 2;      // -79.122 — inside view+data, OUTSIDE the delivered mask
  const interiorLng = -80.5, midLat = 28.3;

  function scenario(id, title, sc, probes) {
    const frame = drawHeatmap(sc);
    const rows = probes.map((p) => probePx(frame, p.lng, p.lat, p.label, p.expect));
    const rec = {
      id, title,
      camera: { window: sc.window, dpr: 1, viewport: [W, H] },
      bounds: { wave: sc.data, mask: sc.mask, overlay: (sc.overlay && sc.overlay.bounds) || null },
      heatmap: { gate_location_active: gateLoc !== null, gate_value: sc.gate ? 1 : 0, mask_clip: sc.maskClip ? 1 : 0, pass: 'lab' },
      overlay: sc.overlay || { on: false },
      probes: rows,
      png: canvas.toDataURL('image/png'),
    };
    out.scenarios.push(rec);
    return { frame, rec };
  }

  const winView = { west: V.west - 0.35, south: V.south - 0.35, east: V.east + 0.35, north: V.north + 0.35 };

  // S1 — equal bounds: what surface does the gate actually protect?
  {
    const base = { window: winView, data: S, mask: S, gate: true };
    const r1 = scenario('S1_gate_on_equal_bounds', 'data==mask==delivered box; gate ON', base, [
      { lng: interiorLng, lat: midLat, label: 'interior control', expect: true },
      { lng: S.east - 0.02, lat: midLat, label: 'epsilon-inside east', expect: true },
      { lng: S.east + 0.02, lat: midLat, label: 'epsilon-outside east (beyond the quad)', expect: false },
      { lng: S.west - 0.02, lat: midLat, label: 'epsilon-outside west', expect: false },
      { lng: interiorLng, lat: S.north + 0.02, label: 'epsilon-outside north', expect: false },
      { lng: interiorLng, lat: S.south - 0.02, label: 'epsilon-outside south', expect: false },
    ]);
    const on = readAll();
    drawHeatmap({ ...base, gate: false });
    const off = readAll();
    r1.rec.diff = diffFrames(on, off);
  }

  // S2 — THE LIVE GEOMETRY: mask delivered short of the view while the DATA grid covers it.
  // The strip is inside the data quad → _outData false → the AND gate never fires there.
  {
    const base = { window: winView, data: WD, mask: S, gate: true };
    const r2 = scenario('S2_mask_short_strip', 'regional data covers view, mask short on east (live z8.03 geometry); gate ON', base, [
      { lng: interiorLng, lat: midLat, label: 'interior control (in mask)', expect: true },
      { lng: stripLng, lat: midLat, label: 'HALO STRIP (in data, out of mask) — gate cannot blank this', expect: true },
      { lng: stripLng, lat: V.north - 0.1, label: 'halo strip north', expect: true },
    ]);
    const on = readAll();
    drawHeatmap({ ...base, gate: false });
    const off = readAll();
    r2.rec.diff = diffFrames(on, off);
    // Post-fix probe: the SAFE_DEGRADED clip must blank the strip while leaving the interior.
    if (clipLoc !== null) {
      scenario('S2c_mask_short_strip_clip', 'same geometry with u_maskClipEnabled=1 (SAFE_DEGRADED terminal action)', { ...base, maskClip: true }, [
        { lng: interiorLng, lat: midLat, label: 'interior control (in mask)', expect: true },
        { lng: stripLng, lat: midLat, label: 'halo strip — clip blanks it', expect: false },
        { lng: stripLng, lat: V.north - 0.1, label: 'halo strip north — clip blanks it', expect: false },
      ]);
      // Overlay truth still wins over the clip inside overlay bounds (per-pixel valid intersection),
      // and the clip holds wherever the overlay is silent — the ordering proof S4 could not make.
      scenario('S2d_clip_vs_overlay_truth', 'clip ON + water overlay covering the strip: overlay truth renders, clip holds beyond it', {
        ...base, maskClip: true,
        overlay: { on: true, replace: true, tex: 'water', bounds: { west: S.east - 0.05, south: V.south, east: V.east + 0.2, north: V.north } },
      }, [
        { lng: stripLng, lat: midLat, label: 'strip under water overlay — overlay truth wins', expect: true },
        { lng: stripLng, lat: 29.7, label: 'out-of-mask beyond overlay north — clip holds', expect: false },
        { lng: interiorLng, lat: midLat, label: 'interior control', expect: true },
      ]);
    }
  }

  // S3 — WORLD-resident geometry (the coarse-base wash + world_grid REPLACE regime): the mask
  // clamp paints arbitrarily far past the delivered mask; only overlay content can stop it.
  {
    const base = { window: winView, data: WR, mask: S, gate: true };
    const r3 = scenario('S3_world_data_short_mask', 'world data grid + short mask: clamp paints beyond mask truth; gate inert', base, [
      { lng: stripLng, lat: midLat, label: 'strip beyond mask (world data) — paints from edge clamp', expect: true },
      { lng: V.east + 0.25, lat: midLat, label: 'far beyond mask — still paints', expect: true },
    ]);
    const on = readAll();
    drawHeatmap({ ...base, gate: false });
    const off = readAll();
    r3.rec.diff = diffFrames(on, off);
    scenario('S3b_overlay_land_carves', 'same + LAND overlay REPLACE inside its bounds: the only working defense here', {
      ...base,
      overlay: { on: true, replace: true, tex: 'land', bounds: { west: S.east, south: V.south, east: V.east + 0.3, north: V.north } },
    }, [
      { lng: stripLng, lat: midLat, label: 'strip under LAND overlay — discarded', expect: false },
      { lng: interiorLng, lat: midLat, label: 'interior (outside overlay) — unchanged', expect: true },
    ]);
  }

  // S5 — THE WASH FLOOD, measured (step-1 attribution repair): the wash's base mask says LAND at
  // the probe (a dense global mask carving a continent) while the padded overlay ring says WATER
  // (the live-probed Ohio flood). Under REPLACE the flood wins and the wash paints land; under
  // min-combine the base wins. Control: an overlay that says LAND always carves, either mode —
  // min() only ever REMOVES wash.
  {
    scenario('S5_wash_replace_flood', 'base mask LAND + water overlay REPLACE: the flood paints land', {
      window: winView, data: WR, mask: WR, gate: true, maskTex: 'land',
      overlay: { on: true, replace: true, tex: 'water', bounds: winView },
    }, [
      { lng: interiorLng, lat: midLat, label: 'land pixel under water-flooded overlay — REPLACE paints it', expect: true },
    ]);
    scenario('S5b_wash_min_combines', 'same geometry, min-combine: the base mask wins over the flood', {
      window: winView, data: WR, mask: WR, gate: true, maskTex: 'land',
      overlay: { on: true, replace: false, tex: 'water', bounds: winView },
    }, [
      { lng: interiorLng, lat: midLat, label: 'land pixel — min(base=land, overlay=water) discards', expect: false },
    ]);
    scenario('S5c_min_only_removes', 'water base + LAND overlay min-combine: crisp carve preserved', {
      window: winView, data: WR, mask: WR, gate: true, maskTex: 'water',
      overlay: { on: true, replace: false, tex: 'land', bounds: winView },
    }, [
      { lng: interiorLng, lat: midLat, label: 'overlay land truth carves under min-combine', expect: false },
    ]);
  }

  // (S4 retired 2026-08-15: it tried to demonstrate gate-vs-overlay ordering on the gate's own
  // blanked pixels — but the gate blanks NO rasterized pixel (S1/S7 diff=0), so no such geometry
  // exists; its first probe also sat sub-pixel from the quad edge (a placement artifact, not a
  // shader behavior). The ordering proof lives in S2d: clip defers to overlay truth per-pixel.)

  // S8 — AV-01a OVERLAY TRUTH GATE (Audit 4.0, 2026-08-16): S5's exact flood, but the overlay's
  // TRUTH box is the strict view V while its STORAGE box is the padded winView — production's
  // pair (_overlayMaskTruthBox vs _overlayMaskBounds). Gate ON: the ring (in storage, out of
  // truth) must fall back to the base (LAND discards) while the overlay still speaks inside
  // truth. S8b omits the truth rect (legacy A/B — on a pre-gate shader S8 goes VIOLATION and S8b
  // OK, the red leg). S8c flips ONLY overlay CONTENT with the gate on and requires the pixel
  // diff be CONTAINED in the truth box: outside truth, overlay texels are semantically inert.
  {
    const mYl = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const truthRect = (s, t) => ({
      min: [(t.west - s.west) / (s.east - s.west), (mYl(s.south) - mYl(t.south)) / (mYl(s.south) - mYl(s.north))],
      max: [(t.east - s.west) / (s.east - s.west), (mYl(s.south) - mYl(t.north)) / (mYl(s.south) - mYl(s.north))],
    });
    const TR = truthRect(winView, V);
    const ringLng = V.east + 0.15;
    const s8base = { window: winView, data: WR, mask: WR, gate: true, maskTex: 'land',
      overlay: { on: true, replace: true, tex: 'water', bounds: winView } };
    scenario('S8_truth_gate_ring_inert', 'AV-01a: flood ring outside the TRUTH box falls back to base (land discards)', { ...s8base, truth: TR }, [
      { lng: interiorLng, lat: midLat, label: 'inside truth — overlay still speaks (flood paints)', expect: true },
      { lng: ringLng, lat: midLat, label: 'RING (in storage, out of truth) — overlay silent, base LAND discards', expect: false },
      { lng: V.west - 0.15, lat: midLat, label: 'west ring — overlay silent there too', expect: false },
    ]);
    scenario('S8b_truth_gate_absent', 'no truth rect: legacy storage-bounds behavior preserved (ring floods)', s8base, [
      { lng: ringLng, lat: midLat, label: 'ring under legacy — REPLACE paints it', expect: true },
    ]);
    {
      const frame = drawHeatmap({ ...s8base, truth: TR });
      const a = readAll();
      drawHeatmap({ ...s8base, truth: TR, overlay: { ...s8base.overlay, tex: 'land' } });
      const b = readAll();
      const d = diffFrames(a, b);
      const px = (lng) => Math.round(((lngToMercX(lng) - frame.mx0) / frame.dx) * W - 0.5);
      const yb = (lat) => H - 1 - Math.round(((latToMercY(lat) - frame.my0) / frame.dy) * H - 0.5);
      const tpx = { x0: px(V.west) - 1, x1: px(V.east) + 1, y0: yb(V.south) - 1, y1: yb(V.north) + 1 };
      const contained = !!d.bbox && d.bbox[0] >= tpx.x0 && d.bbox[2] <= tpx.x1 && d.bbox[1] >= tpx.y0 && d.bbox[3] <= tpx.y1;
      out.scenarios.push({
        id: 'S8c_truth_perturbation_containment', title: 'overlay CONTENT flip moves pixels ONLY inside the truth box (gate ON)',
        diff: d, truthPx: tpx,
        probes: [
          { label: 'diff contained in truth box', painted: contained, alpha: d.count, rgba: [0, 0, 0, 0], expect: true },
          { label: 'non-vacuity: the content flip is visible inside truth', painted: d.count > 0, alpha: d.count, rgba: [0, 0, 0, 0], expect: true },
        ],
      });
    }
  }

  // S6 — antimeridian-crossing box (west>east wrap branch): continuity + gate no-fire.
  {
    const AM = { west: 170, south: -20, east: -170, north: 20 };
    const winAM = { west: 168, south: -22, east: -168 + 360, north: 22 }; // merc window spans past x=1
    // window in mercator terms must be monotonic: use raw mercX values
    const frame = drawHeatmap({
      window: { west: winAM.west, south: winAM.south, east: winAM.east - 360 + 360, north: winAM.north },
      data: AM, mask: AM, gate: true,
    });
    // NOTE: lngToMercX(192) = 1.033 — the drawn quad extends past mercX 1.0 by construction of
    // the VS wrap branch; probe the wrapped copy directly via lng>180 values.
    const rows = [
      probePx(frame, 175, 0, 'inside west of seam', true),
      probePx(frame, 185, 0, 'inside east of seam (lng -175, wrapped copy)', true),
      probePx(frame, 191, 0, 'epsilon-outside east (lng -169)', false),
    ];
    out.scenarios.push({
      id: 'S6_antimeridian', title: 'antimeridian-crossing data+mask box; gate ON',
      bounds: { wave: AM, mask: AM }, heatmap: { gate_location_active: gateLoc !== null, gate_value: 1, pass: 'lab' },
      probes: rows, png: canvas.toDataURL('image/png'),
    });
  }

  // S7 — exact-fit boundary semantics: <=0 / >=1 classifies the exact edge as OUTSIDE.
  {
    const base = { window: S, data: S, mask: S, gate: true };
    const r7 = scenario('S7_exact_fit_boundary', 'data==mask==window exactly; gate ON vs OFF (edge-row semantics)', base, [
      { lng: (S.west + S.east) / 2, lat: (S.south + S.north) / 2, label: 'center', expect: true },
    ]);
    const on = readAll();
    drawHeatmap({ ...base, gate: false });
    const off = readAll();
    r7.rec.diff = diffFrames(on, off);
  }

  // ── ADVECT lab (A3.1-06): the particle mask contract under a mask-only shortfall ──────────
  const ap = link(cfg.ADVECT_VS, cfg.ADVECT_FS);
  out.advectProgram = { compiled: ap.compiled, linked: ap.linked, vsLog: ap.vsLog, fsLog: ap.fsLog };
  if (ap.linked) {
    const fbo = gl.createFramebuffer();
    const stateOut = solidTex([0, 0, 0, 0]);
    gl.bindTexture(gl.TEXTURE_2D, stateOut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // particle state: encodePos(0.5, 0.5) — see ADVECT_FS encode/decode
    const stateTex = solidTex([127, 128, 127, 128]);
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([127, 128, 127, 128]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Tile: particle at pos (0.5,0.5) of a 0.05-wide camera tile centered on (stripLng, midLat).
    const pMercX = lngToMercX(stripLng), pMercY = latToMercY(midLat);
    const tileW = 0.05;
    const tileOrigin = [pMercX - tileW / 2, pMercY - tileW / 2];
    const pLng = stripLng, pLat = midLat;

    function runAdvect(id, title, o) {
      const p = ap.prog;
      gl.useProgram(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateOut, 0);
      gl.viewport(0, 0, 1, 1);
      gl.disable(gl.BLEND);
      u1i(p, 'u_particles', 0);
      u1i(p, 'u_waveTexture', 1);
      u1i(p, 'u_oceanMaskTexture', 2);
      u1i(p, 'u_overlayMaskTexture', 3);
      u1i(p, 'u_coarseWaveTexture', 4);
      u1i(p, 'u_coarseMaskTexture', 5);
      const bind = (t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
      bind(stateTex, 0); bind(waveTex, 1);
      bind(o.maskTex === 'land' ? landMask : waterMask, 2);
      bind(waterMask, 3); bind(waveTex, 4); bind(waterMask, 5);
      u1f(p, 'u_speed_scale', 0.0001);
      u1f(p, 'u_speedHeightCap', 3.0);
      u2f(p, 'u_dataBounds_min', o.data.west, o.data.south);
      u2f(p, 'u_dataBounds_max', o.data.east, o.data.north);
      u2f(p, 'u_maskBounds_min', o.mask.west, o.mask.south);
      u2f(p, 'u_maskBounds_max', o.mask.east, o.mask.north);
      u1f(p, 'u_overlayMaskEnabled', 0);
      u1f(p, 'u_overlayReplace', 0);
      u2f(p, 'u_overlayBounds_min', 0, 0);
      u2f(p, 'u_overlayBounds_max', 0, 0);
      u1f(p, 'u_rand_seed', 0.37);
      u1f(p, 'u_drop_rate', 0);
      u1f(p, 'u_zoom', 8);
      u1f(p, 'u_tileZoomMin', 5);
      u2f(p, 'u_tile_origin', tileOrigin[0], tileOrigin[1]);
      u1f(p, 'u_tile_width', tileW);
      u1f(p, 'u_dirCoherenceMin', 0);
      u1f(p, 'u_coarseNearestDir', 0);
      u2f(p, 'u_waveGridSize', 16, 16);
      u1f(p, 'u_particles_res', 1);
      u1f(p, 'u_stratifiedReseed', 0);
      u1f(p, 'u_motionUnlock', 0);
      u1f(p, 'u_ringFillEnabled', 0);
      u2f(p, 'u_coarseBounds_min', -180, -70);
      u2f(p, 'u_coarseBounds_max', 180, 70);
      u1f(p, 'u_wrapLng', 1);
      const loc = gl.getAttribLocation(p, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
      const b = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const next = [b[0] / 255 + b[1] / 255 / 255, b[2] / 255 + b[3] / 255 / 255];
      // Predict the KEPT next position (mirror of the ADVECT_FS math).
      const waveVec = [217 / 255 * 2 - 1, -(128 / 255 * 2 - 1)];
      const driftH = Math.min(128 / 255 * 10, 3.0);
      const mercScale = Math.max(0.1, Math.cos(pLat * Math.PI / 180));
      const energy = 1 + smooth(1, 5, 128 / 255 * 10) * 0.3;
      const offset = [waveVec[0] * driftH * 0.1 / mercScale * 0.0001 * energy,
                      waveVec[1] * driftH * 0.1 / mercScale * 0.0001 * energy];
      const predicted = [0.5 + offset[0] / tileW, 0.5 + offset[1] / tileW];
      const survived = Math.abs(next[0] - predicted[0]) < 2e-3 && Math.abs(next[1] - predicted[1]) < 2e-3;
      const row = { id, title, particle: { lng: pLng, lat: pLat }, bounds: { data: o.data, mask: o.mask },
        maskTex: o.maskTex || 'water', next: next.map((v) => +v.toFixed(5)), predicted: predicted.map((v) => +v.toFixed(5)), survived };
      if (o.expect !== undefined) row.expect = o.expect;
      out.advect.push(row);
      function smooth(a, bb, x) { const t = Math.max(0, Math.min(1, (x - a) / (bb - a))); return t * t * (3 - 2 * t); }
    }

    const maskShortOfParticle = { west: cfg.SHORT.west, south: cfg.SHORT.south, east: cfg.SHORT.east, north: cfg.SHORT.north }; // east -79.1873 < particle lng -79.122
    runAdvect('P1_control_in_bounds', 'particle inside data AND mask (water) — survives', {
      data: cfg.WIDE, mask: cfg.WIDE, maskTex: 'water', expect: true,
    });
    runAdvect('P2_mask_only_short_water_edge', 'MASK-ONLY SHORTFALL: in data, outside mask; edge texel water — the clamp keeps it alive', {
      data: cfg.WIDE, mask: maskShortOfParticle, maskTex: 'water', expect: true,
    });
    runAdvect('P3_mask_only_short_land_edge', 'same shortfall, edge texel LAND — the clamp kills it (content-dependent, i.e. untruthful)', {
      data: cfg.WIDE, mask: maskShortOfParticle, maskTex: 'land', expect: false,
    });
    runAdvect('P4_data_short_oob', 'particle outside DATA (ring-fill off) — isOob drops it', {
      data: maskShortOfParticle, mask: cfg.WIDE, maskTex: 'water', expect: false,
    });
  }

  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
