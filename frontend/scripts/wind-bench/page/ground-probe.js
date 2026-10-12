/**
 * Wind bench, GROUND mode page half (bundled into map.js by ../build.js through map-entry.js; never part of the app).
 *
 * "What IS the map the wind is laid on?" Every lane's arithmetic starts from a land colour and a water colour a theme, and the
 * instruments held three different sets of them (2026-10-12: check.mjs and mirror-model.mjs, windDarkRules.js BASE, the bench's
 * offline style). This reads them from the two sources that cannot disagree with the app: the style document as the library
 * loaded it (the layers, in draw order, that colour an AREA under the wind, with the paint the style gives them and the paint the
 * basemap mute would give them) and the pixels the library then draws (medians over the land and over the sea of one camera).
 *
 * groundRun({ theme, z, lng, lat, frames, seed, levers }) -> {
 *   areas       every background / fill / fill-extrusion / hillshade layer BELOW the wind, in draw order: id, type, zoom range,
 *               visibility, opacity, and for each colour property the style's value and the muted one (null where the mute leaves
 *               it: the ocean mask's own layers, a hidden raster). In dark the mute is off: `muted` is null there and
 *               `wouldMute` says what a mute would touch;
 *   areasAbove  the same kinds of layer drawn ABOVE the wind (a fill there would cover the wind);
 *   land, sea   medians over the land and over the sea of the picture: [r, g, b], L*, C* and hue, for
 *               own    the style's own map, wind off;
 *               muted  the map as the app restyles it under the wind (the mute, the border ink), wind hidden;
 *               field  that map under the wind's colour field alone (a 2x2 particle pool): the GROUND a streak is laid on;
 *               full   (cfg.full) the same under the field AND the streaks: the MEAN picture over cfg.full frames at 60 Hz, in linear
 *                      light (what the eye integrates); full minus field is the light the streaks ADD to that ground (LESSONS L-V73);
 *   wind        the served speed (kn) under the land and under the sea of the view: median and quartiles;
 *   strips      (cfg.strips = n) the picture cut into n column bands, west to east: each band's served speed and, for every picture
 *               above, the land's and the sea's median luminance in it. On a speed ramp (ramp-fixture.js) a column is ONE speed over
 *               land and over sea, so a band's land against its sea is the MAP's own step with the wind's colour held equal: how much
 *               of the map comes through (the hurricane fixture cannot say: its sea is windier than its land).
 * }
 */
const AREA = { background: ['background-color'], fill: ['fill-color', 'fill-outline-color'], 'fill-extrusion': ['fill-extrusion-color'],
  hillshade: ['hillshade-shadow-color', 'hillshade-highlight-color', 'hillshade-accent-color'] };
const OPACITY = { background: 'background-opacity', fill: 'fill-opacity', 'fill-extrusion': 'fill-extrusion-opacity', hillshade: 'hillshade-exaggeration' };
const LIN = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b], X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B,
    Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const mid = (a) => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

module.exports = function makeGroundRun(h) {
  const { state, ensureMap, idle, newEngine, disposeEngine, clearLevers, landMaskSettled, animate, animateEach, readCanvas, coastSync, settledWaterMask, WIND_ID, mute, speedAt } = h;
  const lumAt = (px, p) => 0.2126729 * LIN[px[p]] + 0.7151522 * LIN[px[p + 1]] + 0.072175 * LIN[px[p + 2]];
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

  /** Per column band (west to east): [the land's, the sea's] median luminance, null where a band holds under 200 samples of one. */
  function bands(px, wet, W, H, n) {
    const out = [];
    for (let b = 0; b < n; b++) {
      const x0 = Math.floor(W * b / n), x1 = Math.floor(W * (b + 1) / n), Y = [[], []];
      for (let y = 2; y < H - 2; y += 3) for (let x = x0 + 1; x < x1 - 1; x += 3) { const i = y * W + x; Y[wet[i] ? 1 : 0].push(lumAt(px, i * 4)); }
      out.push(Y.map((v) => (v.length >= 200 ? +mid(v).toFixed(5) : null)));
    }
    return out;
  }
  /** The served speed down the middle of each band (kn): the median over its rows. */
  function bandSpeeds(map, W, H, dpr, n) {
    if (!speedAt) return null;
    return Array.from({ length: n }, (_, b) => {
      const x = W * (b + 0.5) / n, v = [];
      for (let y = 8; y < H - 8; y += 24) { const ll = map.unproject([x / dpr, (H - 1 - y) / dpr]), s = speedAt(ll.lng, ll.lat); if (s != null && Number.isFinite(s)) v.push(s); }
      return v.length ? r1(mid(v)) : null;
    });
  }

  /** Medians over one surface (wet = 0 land, 1 sea), every third pixel a row and a column. */
  function surface(px, wet, W, H, which) {
    const R = [], G = [], B = [], L = [], a = [], b = [];
    for (let y = 2; y < H - 2; y += 3) for (let x = 2; x < W - 2; x += 3) {
      const i = y * W + x;
      if (wet[i] !== which) continue;
      const p = i * 4, q = lab(px[p], px[p + 1], px[p + 2]);
      R.push(px[p]); G.push(px[p + 1]); B.push(px[p + 2]); L.push(q[0]); a.push(q[1]); b.push(q[2]);
    }
    if (!L.length) return null;
    const am = mid(a), bm = mid(b);
    return { rgb: [mid(R), mid(G), mid(B)], L: r1(mid(L)), C: r1(Math.hypot(am, bm)), h: Math.round((Math.atan2(bm, am) * 180 / Math.PI + 360) % 360), n: L.length };
  }

  function speeds(map, wet, W, H, dpr, which) {
    if (!speedAt) return null;
    const v = [];
    for (let y = 8; y < H - 8; y += 16) for (let x = 8; x < W - 8; x += 16) {
      if (wet[y * W + x] !== which) continue;
      const ll = map.unproject([x / dpr, (H - 1 - y) / dpr]), s = speedAt(ll.lng, ll.lat);   // readPixels rows run from the screen's bottom
      if (s != null && Number.isFinite(s)) v.push(s);
    }
    if (!v.length) return null;
    const s = Float64Array.from(v).sort();
    return { med: r1(s[s.length >> 1]), q25: r1(s[Math.floor(s.length / 4)]), q75: r1(s[Math.floor(s.length * 3 / 4)]), n: s.length };
  }

  return async function groundRun(cfg) {
    const map = await ensureMap(cfg.theme), dpr = state.dpr;
    state.active = false; state.crop = Array.isArray(cfg.crop) ? cfg.crop : null; state.cropAt = cfg.cropAt || null;
    clearLevers(); Object.assign(window, cfg.levers || {});
    if (coastSync) coastSync(map, cfg.theme);
    mute.syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
    map.jumpTo({ center: [cfg.lng, cfg.lat], zoom: cfg.z });
    await idle(map);
    try {
      const layers = map.getStyle().layers, order = map.style._order, at = order.indexOf(WIND_ID), byId = new Map(layers.map((l) => [l.id, l]));
      const ordered = order.map((id) => byId.get(id) || { id, type: 'custom' });
      const amount = mute.windBasemapMuteAmount(cfg.theme, window), waterL = mute.windBasemapWaterL(cfg.theme, window);
      const plan = mute.windBasemapMutePlan(ordered, WIND_ID, amount > 0 ? amount : 0.85, amount > 0 ? waterL : 1, amount > 0 ? mute.windBasemapLandL(cfg.theme, window) : 1);   // dark: what a mute WOULD touch; the land at its depth (D-026)
      const planned = new Map(plan.map((p) => [`${p.id}|${p.prop}`, p.to]));
      const row = (l) => ({ id: l.id, type: l.type, minzoom: l.minzoom, maxzoom: l.maxzoom, visibility: (l.layout || {}).visibility || 'visible', opacity: (l.paint || {})[OPACITY[l.type]],
        colours: (AREA[l.type] || []).filter((p) => (l.paint || {})[p] !== undefined).map((p) => ({ prop: p, own: l.paint[p], [amount > 0 ? 'muted' : 'wouldMute']: planned.has(`${l.id}|${p}`) ? planned.get(`${l.id}|${p}`) : null })) });
      const areas = ordered.slice(0, at).filter((l) => AREA[l.type]).map(row), areasAbove = ordered.slice(at + 1).filter((l) => AREA[l.type]).map(row);
      const own = await animate(map, 0), wet = await settledWaterMask(map), { W, H } = own;
      const synced = mute.syncWindBasemapMute(map, cfg.theme, true, WIND_ID);
      await idle(map);
      const muted = await animate(map, 0);
      state.active = true;
      newEngine(2, cfg.seed);
      const field = await animate(map, cfg.frames || 120), landMask = await landMaskSettled();
      let full = null, alpha = null;
      if (cfg.full > 0 && animateEach) {   // the streaks on: 180 frames to lay the trails, then the mean of cfg.full frames in linear light
        newEngine(cfg.res || 384, cfg.seed);
        const acc = new Float32Array(W * H * 3), warm = cfg.warm || 180;
        await animateEach(map, warm + cfg.full, (i) => {
          if (i < warm) return;
          const f = readCanvas(map), d = f.px; alpha = f.alpha;
          for (let k = 0, p = 0; k < W * H; k++, p += 4) { acc[k * 3] += LIN[d[p]]; acc[k * 3 + 1] += LIN[d[p + 1]]; acc[k * 3 + 2] += LIN[d[p + 2]]; }
        });
        const px = new Uint8Array(W * H * 4);
        for (let k = 0, p = 0; k < W * H; k++, p += 4) { px[p] = enc(acc[k * 3] / cfg.full); px[p + 1] = enc(acc[k * 3 + 1] / cfg.full); px[p + 2] = enc(acc[k * 3 + 2] / cfg.full); px[p + 3] = 255; }
        full = { px, shot: (await animate(map, 0)).crop };
      }
      const fieldCrop = field.crop;
      state.active = false; disposeEngine();
      const pick = (which) => ({ own: surface(own.px, wet, W, H, which), muted: surface(muted.px, wet, W, H, which), field: surface(field.px, wet, W, H, which), full: full ? surface(full.px, wet, W, H, which) : null });
      const n = cfg.strips > 0 ? cfg.strips : 0;
      const strips = n ? { n, speed: bandSpeeds(map, W, H, dpr, n), own: bands(own.px, wet, W, H, n), muted: bands(muted.px, wet, W, H, n), field: bands(field.px, wet, W, H, n), full: full ? bands(full.px, wet, W, H, n) : null } : null;
      let sea = 0; for (let i = 0; i < wet.length; i++) sea += wet[i];
      return { theme: cfg.theme, z: cfg.z, dpr, mute: { amount, waterL: amount > 0 ? waterL : 1, landL: synced.landL == null ? 1 : synced.landL, layers: synced.layers }, ink: synced.ink || null, landMask, seaShare: +(sea / wet.length).toFixed(3),
        strips, canvasAlpha: alpha, crops: state.crop ? { own: own.crop, muted: muted.crop, field: fieldCrop, full: full ? full.shot : null } : null,
        areas, areasAbove, land: pick(0), sea: pick(1), wind: { land: speeds(map, wet, W, H, dpr, 0), sea: speeds(map, wet, W, H, dpr, 1) }, glError: state.gl.getError() || 0 };
    } finally {
      state.active = false; disposeEngine(); clearLevers();
      if (coastSync) coastSync(map, cfg.theme);
      mute.syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
      state.crop = null; state.cropAt = null;
    }
  };
};
