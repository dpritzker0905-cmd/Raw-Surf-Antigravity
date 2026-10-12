/**
 * Wind bench, BORDER mode page half (bundled into map.js by ../build.js through map-entry.js; never part of the app).
 *
 * "Can the map's borders and place names be read under the wind?" (owner, 2026-10-12: "the labels and borders need to be more
 * visible. In dark mode they are white boarders and labels"). Map mode's line columns score EVERY edge of the bare basemap (roads,
 * coasts, rivers, label strokes), and the political borders are a few of them: this reads the borders alone.
 *
 * The border lines are found from the STYLE, not from the picture: every layer is hidden but the border line layers, painted white
 * on black, so each device pixel carries the line's own coverage (0-1, its antialiasing). The place labels are found the same way.
 * A RIDGE pixel is a land pixel on a line's centre (coverage >= RIDGE, no neighbour higher), away from any label. Its GROUND is the
 * ring of pixels 1.5 to 2.75 CSS px from it that no border covers: what the line sits on, the pale casing the styles draw under a
 * border included. The line's contrast is L*(ridge) - L*(ground), read on four pictures of the same camera:
 *   bare   the theme's own map, wind off (no mute, no ink);
 *   off    the map as the app shows it under the wind (its mute, and its border ink when the code under test has one), wind hidden;
 *   field  that map under the colour field alone (a 2x2 particle pool);
 *   full   under the field and the particles, at SAMPLES moments GAP frames apart.
 * Columns (borderRun's `border`), medians over the ridge pixels unless said:
 *   dL bare / off / field / full   |L* contrast| of the line against its ground (full: each pixel's median over the samples);
 *   sign                           +1 = the line is lighter than its ground under field + particles (dark's), -1 = darker (ink);
 *   retF / retP                    map mode's own columns over the border lines: mean share of each line's BARE contrast kept under
 *                                  the field / field + particles (above 1 = more contrast than the bare map had);
 *   lostP                          share of (pixel, sample) pairs under half their bare contrast (map mode's `lost`);
 *   weak                           share of (pixel, sample) pairs under 5 L*: about where a thin line stops being seen;
 *   3:1                            share of pairs at >= 3:1 against the ground (WCAG 1.4.11; a NEW line counts, unlike map mode's 3:1P,
 *                                  which only asks whether lines at 3:1 on the bare map keep it).
 * `labels`: the place names' glyph pixels that a glyph covers WHOLE. `moved` is the largest L* change of one of them between the map
 * alone and any sample under the wind: 0 means the names are drawn ABOVE the wind and no streak touches them. `solid` is the same
 * read on border pixels the line covers whole (none where the lines are under a device pixel wide).
 * An arm with `windOnTop` moves the wind layer above every style layer for that arm only: the control for the layer order (the
 * names and the solid pixels then move, and a streak cuts the lines). The arm's restyle is laid BEFORE the wind is moved, so it
 * reads an inked line under the wind; that is not the app under its under-labels kill, where nothing is inked.
 * Read the numbers as they are (an independent review, 2026-10-12): a ridge pixel is a local MAXIMUM of the line's coverage, so
 * `dL` is the line at its best-covered pixels, an upper estimate of a typical pixel of it (arms and themes compare fairly: the
 * styles draw these lines the same width); and only state, country and settlement names are masked, so a ridge pixel under a
 * road shield or a water name reads the label (the same in every arm).
 * `restore`: every paint value of every layer of the style (getStyle(), the real library's own record), read with the wind off
 * before the arms and again after each arm's wind goes off. `exact` = the two are the same JSON; `moved` = they were NOT the same
 * while the arm's wind was on (the control: an arm that restyles nothing has nothing to restore).
 */
const RIDGE = 0.3, WHOLE = 255, WEAK_L = 5, WCAG = 3;
const BORDER_ID = /^admin-/, CASING_ID = /-bg$/, PLACE_ID = /^(state|country|settlement)[a-z-]*-label$/;

const LIN = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
const lum = (px, i) => 0.2126729 * LIN[px[i * 4]] + 0.7151522 * LIN[px[i * 4 + 1]] + 0.072175 * LIN[px[i * 4 + 2]];
const lstar = (Y) => (Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y);
const median = (a) => { if (!a.length) return null; const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

const OPACITY = { fill: ['fill-opacity'], line: ['line-opacity'], symbol: ['text-opacity', 'icon-opacity'], 'fill-extrusion': ['fill-extrusion-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'], raster: ['raster-opacity'], heatmap: ['heatmap-opacity'], hillshade: ['hillshade-exaggeration'] };

/** The style's layer ids in DRAW order (custom layers included), split at the wind layer. */
function aboveWind(map, windId) {
  const order = map.style._order, at = order.indexOf(windId);
  return at < 0 ? [] : order.slice(at + 1);
}

/**
 * The lines and names this mode reads, from the style: line layers above the wind named admin-* (the casings, *-bg, apart), and the
 * symbol layers that name states, countries and settlements. Each with its paint, for the report.
 */
function inventory(map, windId) {
  const above = new Set(aboveWind(map, windId)), layers = map.getStyle().layers, pick = (l, props) => Object.fromEntries(props.filter((p) => (l.paint || {})[p] !== undefined).map((p) => [p, l.paint[p]]));
  const lines = layers.filter((l) => l.type === 'line' && BORDER_ID.test(l.id));
  const names = layers.filter((l) => l.type === 'symbol' && PLACE_ID.test(l.id));
  const row = (l, props) => ({ id: l.id, aboveWind: above.has(l.id), minzoom: l.minzoom, maxzoom: l.maxzoom, paint: pick(l, props) });
  return {
    borders: lines.filter((l) => !CASING_ID.test(l.id)).map((l) => row(l, ['line-color', 'line-opacity', 'line-width', 'line-dasharray'])),
    casings: lines.filter((l) => CASING_ID.test(l.id)).map((l) => row(l, ['line-color', 'line-opacity', 'line-width', 'line-blur'])),
    labels: names.map((l) => row(l, ['text-color', 'text-halo-color', 'text-halo-width', 'text-opacity'])),
    symbolsBelowWind: layers.filter((l) => l.type === 'symbol' && !above.has(l.id)).length,
  };
}

module.exports = function makeBorderRun(h) {
  const { state, ensureMap, idle, readCanvas, newEngine, disposeEngine, clearLevers, landMaskSettled, animate, settledWaterMask, sync, WIND_ID } = h;

  /** Coverage (0-255 a device pixel) of the layers in `ids`, by paint alone: they are drawn white, everything else black or clear. */
  async function coverage(map, ids, kind) {
    const want = new Set(ids), saved = [], set = (id, prop, v) => { saved.push([id, prop, map.getPaintProperty(id, prop)]); map.setPaintProperty(id, prop, v); };
    for (const l of map.getStyle().layers) {
      if (l.type === 'custom') continue;
      if (l.type === 'background') { set(l.id, 'background-color', '#000000'); set(l.id, 'background-opacity', 1); continue; }
      if (!want.has(l.id)) { for (const prop of OPACITY[l.type] || []) set(l.id, prop, 0); continue; }
      if (kind === 'line') { set(l.id, 'line-color', '#ffffff'); set(l.id, 'line-opacity', 1); } else { set(l.id, 'text-color', '#ffffff'); set(l.id, 'text-opacity', 1); set(l.id, 'text-halo-width', 0); set(l.id, 'icon-opacity', 0); }
    }
    await idle(map);
    const { px, W, H } = readCanvas(map), cov = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) cov[i] = px[i * 4];
    for (let k = saved.length - 1; k >= 0; k--) map.setPaintProperty(saved[k][0], saved[k][1], saved[k][2]);
    await idle(map);
    return cov;
  }

  /** The ridge pixels of the border lines on land, away from labels, each with the ring of ground pixels around it. */
  function ridges(border, label, wet, W, H, dpr) {
    const r1 = Math.max(2, Math.round(1.5 * dpr)), r2 = Math.max(r1 + 1, Math.round(2.75 * dpr)), keep = Math.round(4 * dpr), min = Math.round(RIDGE * 255);
    const near = new Uint8Array(W * H);                                  // a label (its halo too) within `keep` px
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (label[y * W + x] < 26) continue; for (let j = Math.max(0, y - keep); j <= Math.min(H - 1, y + keep); j++) near.fill(1, j * W + Math.max(0, x - keep), j * W + Math.min(W - 1, x + keep) + 1); }
    const idx = [], ring = [];
    for (let y = r2 + 1; y < H - r2 - 1; y++) {
      for (let x = r2 + 1; x < W - r2 - 1; x++) {
        const i = y * W + x, c = border[i];
        if (c < min || wet[i] || near[i]) continue;
        let top = true;
        for (let j = -1; j <= 1 && top; j++) for (let k = -1; k <= 1; k++) if (border[i + j * W + k] > c) { top = false; break; }
        if (!top) continue;
        const g = [];
        for (let j = -r2; j <= r2; j++) for (let k = -r2; k <= r2; k++) { if (Math.max(Math.abs(j), Math.abs(k)) < r1) continue; const q = i + j * W + k; if (border[q] < 6 && !near[q] && !wet[q]) g.push(q); }
        if (g.length < 6) continue;
        idx.push(i); ring.push(Int32Array.from(g));
      }
    }
    return { idx, ring, r1, r2 };
  }

  /** Per ridge pixel on one frame: signed L* contrast against its ground ring, and the WCAG ratio between the two. */
  function contrasts(px, rd) {
    const n = rd.idx.length, dL = new Float32Array(n), ratio = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const g = rd.ring[k]; let sum = 0;
      for (let q = 0; q < g.length; q++) sum += lum(px, g[q]);
      const Yg = sum / g.length, Yl = lum(px, rd.idx[k]);
      dL[k] = lstar(Yl) - lstar(Yg);
      ratio[k] = (Math.max(Yl, Yg) + 0.05) / (Math.min(Yl, Yg) + 0.05);
    }
    return { dL, ratio };
  }

  function borderStats(c, rd) {
    const n = rd.idx.length, abs = (a) => Array.from(a, Math.abs);
    if (!n) return { n: 0 };
    const perPx = [], signs = [];
    let pairs = 0, lost = 0, weak = 0, at3 = 0, retF = 0, retP = 0, kept = 0;
    for (let k = 0; k < n; k++) {
      const s = c.full.map((f) => f.dL[k]), b = c.bare.dL[k];
      perPx.push(median(s.map(Math.abs))); signs.push(Math.sign(median(s)));
      for (let m = 0; m < s.length; m++) { pairs++; if (Math.abs(s[m]) < 0.5 * Math.abs(b)) lost++; if (Math.abs(s[m]) < WEAK_L) weak++; if (c.full[m].ratio[k] >= WCAG) at3++; }
      if (Math.abs(b) >= 1) { kept++; retF += c.field.dL[k] / b; retP += median(s) / b; }   // map mode's `retain`: signed, against the BARE line
    }
    return { n, bare: r(median(abs(c.bare.dL))), off: r(median(abs(c.off.dL))), field: r(median(abs(c.field.dL))), full: r(median(perPx)), sign: r(signs.reduce((a, b) => a + b, 0) / n),
      p25: r(Float64Array.from(perPx).sort()[Math.floor(n / 4)]), retF: kept ? r(retF / kept, 3) : null, retP: kept ? r(retP / kept, 3) : null,
      lostP: r(lost / pairs, 3), weak: r(weak / pairs, 3), at3: r(at3 / pairs, 3), ratio: r(median(c.full.flatMap((f) => Array.from(f.ratio)))), ringPx: [rd.r1, rd.r2] };
  }

  /** Glyph (or solid border) pixels: their L* on the map alone and the largest change any wind sample makes to one of them. */
  function untouched(cov, min, off, fulls) {
    const at = []; for (let i = 0; i < cov.length; i++) if (cov[i] >= min) at.push(i);
    if (!at.length) return { n: 0 };
    let moved = 0; const L = [];
    for (const i of at) { const l0 = lstar(lum(off, i)); L.push(l0); for (const f of fulls) moved = Math.max(moved, Math.abs(lstar(lum(f, i)) - l0)); }
    return { n: at.length, L: r(median(L), 1), moved: r(moved) };
  }

  /**
   * cfg: { theme, z, lng, lat, frames, samples, gap, res, seed, crop: [w, h, fmt], cropAt: [fx, fy],
   *        arms: [{ name, levers, paint: [{ id, prop, value }], windOnTop }] }. `paint` is the bench's own override, laid AFTER the app's sync: a
   *        candidate can be measured before any product code draws it. Returns the style's inventory and one row an arm.
   */
  return async function borderRun(cfg) {
    const map = await ensureMap(cfg.theme), dpr = state.dpr;
    state.active = false; state.crop = Array.isArray(cfg.crop) ? cfg.crop : null; state.cropAt = cfg.cropAt || null;
    clearLevers();
    sync(map, cfg.theme, false, WIND_ID);
    map.jumpTo({ center: [cfg.lng, cfg.lat], zoom: cfg.z });
    await idle(map);
    const inv = inventory(map, WIND_ID);
    // Every paint value of every layer of the style, as the library holds it with the wind off: an arm that leaves one changed
    // has not restored the map (the real library's answer to "byte for byte", which a fake map can only assume).
    const stylePaint = () => JSON.stringify(map.getStyle().layers.map((l) => [l.id, l.paint || null])), paintStart = stylePaint();
    const bare = await animate(map, 0);
    const border = await coverage(map, inv.borders.map((b) => b.id), 'line'), label = await coverage(map, inv.labels.map((l) => l.id), 'symbol');
    const wet = await settledWaterMask(map), { W, H } = bare, rd = ridges(border, label, wet, W, H, dpr);
    const paint0 = stylePaint(), masksExact = paint0 === paintStart;   // the probe's own masks put every value back (its self-check)
    const rows = [];
    let undo = null;
    try {
      for (const arm of cfg.arms) {
        clearLevers(); Object.assign(window, arm.levers || {});
        const synced = sync(map, cfg.theme, true, WIND_ID), saved = [];
        for (const p of arm.paint || []) { if (!map.getLayer(p.id)) continue; saved.push([p.id, p.prop, map.getPaintProperty(p.id, p.prop)]); map.setPaintProperty(p.id, p.prop, p.value); }
        const home = arm.windOnTop ? map.style._order[map.style._order.indexOf(WIND_ID) + 1] : null;   // the layer the wind sits under
        if (home) map.moveLayer(WIND_ID);
        undo = () => { for (let k = saved.length - 1; k >= 0; k--) map.setPaintProperty(saved[k][0], saved[k][1], saved[k][2]); if (home) map.moveLayer(WIND_ID, home); };
        await idle(map);
        const off = await animate(map, 0);
        state.active = true;
        newEngine(2, cfg.seed);
        const field = await animate(map, cfg.frames), landMask = await landMaskSettled();
        newEngine(cfg.res, cfg.seed);
        const fulls = [await animate(map, cfg.frames)];
        for (let s = 1; s < (cfg.samples || 6); s++) fulls.push(await animate(map, cfg.gap || 12));
        state.active = false; disposeEngine();
        undo(); undo = null;                                  // the arm's own paint and the wind's place, put back before the app's restyle is lifted
        const c = { bare: contrasts(bare.px, rd), off: contrasts(off.px, rd), field: contrasts(field.px, rd), full: fulls.map((f) => contrasts(f.px, rd)) };
        rows.push({ arm: arm.name, theme: cfg.theme, z: cfg.z, synced, landMask, border: borderStats(c, rd),
          labels: untouched(label, WHOLE, off.px, fulls.map((f) => f.px)), solid: untouched(border, WHOLE, off.px, fulls.map((f) => f.px)),
          readBack: window.__WIND_BORDER_INK__ || null, glError: state.gl.getError() || 0,
          crops: state.crop ? { off: off.crop, field: field.crop, full: fulls[0].crop } : null });
        const inked = stylePaint() !== paint0;                // the positive control: with the wind on the style's paint HAD moved
        sync(map, cfg.theme, false, WIND_ID);
        await idle(map);
        rows[rows.length - 1].restore = { moved: inked, exact: stylePaint() === paint0 };
      }
      return { theme: cfg.theme, z: cfg.z, dpr, canvas: [W, H], inventory: inv, masksExact, bareCrop: bare.crop, rows };
    } finally {
      state.active = false; disposeEngine(); clearLevers();
      if (undo) { try { undo(); } catch (e) { /* an arm that threw: the map may be gone */ } }
      sync(map, cfg.theme, false, WIND_ID);
      state.crop = null; state.cropAt = null;
    }
  };
};
