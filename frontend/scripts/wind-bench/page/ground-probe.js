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
 *   wind        the served speed (kn) under the land and under the sea of the view: median and quartiles.
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
  const { state, ensureMap, idle, newEngine, disposeEngine, clearLevers, landMaskSettled, animate, settledWaterMask, WIND_ID, mute, speedAt } = h;

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
    state.active = false;
    clearLevers(); Object.assign(window, cfg.levers || {});
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
      state.active = false; disposeEngine();
      const pick = (which) => ({ own: surface(own.px, wet, W, H, which), muted: surface(muted.px, wet, W, H, which), field: surface(field.px, wet, W, H, which) });
      let sea = 0; for (let i = 0; i < wet.length; i++) sea += wet[i];
      return { theme: cfg.theme, z: cfg.z, dpr, mute: { amount, waterL: amount > 0 ? waterL : 1, layers: synced.layers }, ink: synced.ink || null, landMask, seaShare: +(sea / wet.length).toFixed(3),
        areas, areasAbove, land: pick(0), sea: pick(1), wind: { land: speeds(map, wet, W, H, dpr, 0), sea: speeds(map, wet, W, H, dpr, 1) }, glError: state.gl.getError() || 0 };
    } finally {
      state.active = false; disposeEngine(); clearLevers();
      mute.syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
    }
  };
};
