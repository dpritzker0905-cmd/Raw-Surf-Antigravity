/**
 * Wind bench, SWITCH mode page half (bundled into map.js by ../build.js through map-entry.js; never part of the app).
 *
 * "After a THEME CHANGE with the wind on, is the new theme's map restyled?" Every other mode builds a fresh map a theme, so none
 * of them can see a theme change. The app does not build a fresh map: react-maplibre calls map.setStyle(url, { diff: true }), which
 * FETCHES the new style and then diffs it into the old one (or rebuilds the style when the diff cannot be done), while the wind
 * layer keeps the map repainting. An independent review (2026-10-12) read the code and found an order of events in which the
 * layer's re-sync runs on the OLD style under the NEW theme's name, the diff then writes the new style's own colours over it, and
 * the layer's stale check answers "nothing to do": the new theme is left unmuted and its borders un-inked, with both read-backs
 * saying applied. This replays the app's own sequence on the real library and the real styles and reports what happened.
 *
 * switchRun({ from, to, wiring, order }) -> one row. The sequence, as src/components/map/WebGLWindLayer.js does it:
 *   1. a map in `from`, the wind layer in its slot, the wind on, synced (muted, inked);
 *   2. the theme prop changes: setStyle(the `to` style's URL, { diff: true }), and the layer's theme effect registers
 *      once('idle', re-sync with the new theme); the map keeps repainting (the wind animates). order 'resync-first' forces the
 *      re-sync to run before the style arrives (what a style fetched over the network does; a cached one arrives first);
 *   3. every styledata and style.load runs the layer's handler: re-add the layer and sync when it is gone, else sync when the
 *      style has just loaded or the record is stale. wiring 'dev' is the handler before the repair: stale only.
 * Reported: diffed (the style object survived: a diff, not a rebuild), windKept (the custom layer survived it), idleFirst (the
 * re-sync ran before the new style arrived), and, once the map has settled in `to`: the border's and the water's paint as the
 * library holds them against what the theme should have (`inked`, `muted`), and what the read-backs claim.
 */
module.exports = function makeSwitchRun(h) {
  const { state, ensureMap, idle, clearLevers, WIND_ID, STYLES, addWind, addCoast, mute } = h;
  const COAST = 'wind-coastline';
  const BORDER = 'admin-0-boundary', WATER = 'water';
  const j = (v) => JSON.stringify(v);

  return async function switchRun(cfg) {
    // a fresh map every run: a run leaves the map in another theme than its `state.theme` says
    if (state.map) { state.map.remove(); state.map = null; state.theme = null; }
    const map = await ensureMap(cfg.from), win = window;
    state.active = false;
    clearLevers();
    mute.syncWindBasemapMute(map, cfg.from, true, WIND_ID);
    await idle(map);
    const start = { ink: win.__WIND_BORDER_INK__ && win.__WIND_BORDER_INK__.applied, mute: win.__WIND_BASEMAP_MUTE__ && win.__WIND_BASEMAP_MUTE__.layers };
    const style0 = map.style, t0 = performance.now(), events = [];
    let loads = 0, theme = cfg.from, spinning = true;
    const sync = (why) => { const r = mute.syncWindBasemapMute(map, theme, true, WIND_ID); events.push(`${Math.round(performance.now() - t0)} ms ${why}: mute ${r.layers}, ink ${r.ink ? (r.ink.applied ? r.ink.layers : r.ink.reason) : '-'}`); return r; };
    // WebGLWindLayer.js handleStyleData, bound to styledata AND style.load (pinned to its source by windBasemapMute.test.js).
    // wiring 'dev' is the layer before 2026-10-12: a loaded style synced only when the record looked stale.
    // wiring 'nocoast' is the layer before D-028's review (2026-10-12): the coastline was added only together with the wind layer, and a
    // diffed theme change keeps the custom wind layer and drops the coastline, a style layer the new style does not name.
    const handler = (ev) => {
      if (!map.style) return;
      if (cfg.wiring !== 'dev' && cfg.wiring !== 'nocoast' && addCoast && map.getLayer(WIND_ID) && !map.getLayer(COAST)) {
        try { if (addCoast(map, theme)) events.push(`${Math.round(performance.now() - t0)} ms ${ev.type}: coastline re-added`); } catch (e) { events.push(`coastline re-add failed: ${e.message}`); }
      }
      if (!map.getLayer(WIND_ID)) { try { addWind(map, theme); sync(`${ev.type}: layer re-added`); } catch (e) { events.push(`re-add failed: ${e.message}`); } } else if ((cfg.wiring !== 'dev' && ev.type === 'style.load') || mute.windBasemapMuteStale(map, theme, true, WIND_ID)) sync(`${ev.type}: sync`);
    };
    const onLoad = () => { loads++; events.push(`${Math.round(performance.now() - t0)} ms style.load #${loads}${map.style === style0 ? ' (same style object: a diff)' : ' (a NEW style object: a rebuild)'}`); };
    map.on('style.load', onLoad);
    map.on('styledata', handler); map.on('style.load', handler);
    const spin = () => { if (!spinning) return; try { map.triggerRepaint(); } catch (e) { /* removed */ } requestAnimationFrame(spin); };   // the wind's animation
    let idleFirst = null;
    try {
      // 2. the theme changes: the prop reaches the map (setStyle) and the layer (its theme ref, its once('idle') re-sync) in one commit
      theme = cfg.to;
      map.setStyle(`mapbox://styles/mapbox/${STYLES[cfg.to]}`, { diff: true });
      const resync = () => { idleFirst = loads === 0; sync(`idle re-sync (the new style has ${loads === 0 ? 'NOT ' : ''}arrived)`); };
      // order 'resync-first' runs the re-sync at once, on the old style: the order a style fetched over the network gives, forced
      // (a style in the browser's cache arrives before the first idle, and the two orders must both be read)
      if (cfg.order === 'resync-first') resync(); else map.once('idle', resync);
      spin();
      const deadline = performance.now() + 20000;
      while (loads === 0 && performance.now() < deadline) await new Promise((r) => setTimeout(r, 30));
      await new Promise((r) => setTimeout(r, 600));          // the handlers that follow the load
      spinning = false;
      await idle(map);
      const amount = mute.windBasemapMuteAmount(cfg.to, {}), ink = mute.windBorderInk ? mute.windBorderInk(cfg.to, {}) : null;
      const layers = map.getStyle().layers, own = (id, prop) => { const l = layers.find((x) => x.id === id); return l && l.paint ? l.paint[prop] : undefined; };
      const border = own(BORDER, 'line-color'), water = own(WATER, 'fill-color');
      const claimed = { ink: win.__WIND_BORDER_INK__ || null, mute: win.__WIND_BASEMAP_MUTE__ || null, coast: win.__WIND_COAST_INK__ || null };   // what the read-backs say now
      // the coastline stroke the wind lays above itself: is it still on the map, and in the ink the new theme's borders take (D-028)?
      const coastThere = !!map.getLayer(COAST), coastPaint = coastThere ? [map.getPaintProperty(COAST, 'line-color'), map.getPaintProperty(COAST, 'line-opacity')] : null;
      const coastWant = ink && mute.windCoastInk && mute.windCoastInk(cfg.to, {}) > 0 ? [ink, mute.windCoastInk(cfg.to, {})] : null;
      // what the library would hold if the theme's own colours were restyled: read them back by lifting our restyle
      mute.syncWindBasemapMute(map, cfg.to, false, WIND_ID);
      const ownBorder = map.getPaintProperty(BORDER, 'line-color'), ownWater = map.getPaintProperty(WATER, 'fill-color');
      const wantBorder = ink && mute.inkValue ? mute.inkValue(ownBorder, ink) : ownBorder, wantWater = amount > 0 ? mute.muteValue(ownWater, amount, mute.windBasemapWaterL(cfg.to, {})) : ownWater;
      return { from: cfg.from, to: cfg.to, wiring: cfg.wiring || 'app', start, loaded: loads > 0, diffed: map.style === style0, windKept: !!map.getLayer(WIND_ID), idleFirst,
        inked: ink ? j(border) === j(wantBorder) : null, muted: amount > 0 ? j(water) === j(wantWater) : null, border, wantBorder, water, wantWater,
        coast: { there: coastThere, paint: coastPaint, inked: coastWant ? coastThere && j(coastPaint) === j(coastWant) : null },
        readBack: claimed, events };
    } finally {
      spinning = false;
      map.off('style.load', onLoad); map.off('styledata', handler); map.off('style.load', handler);
      clearLevers();
      state.map.remove(); state.map = null; state.theme = null;   // the next mode starts from a fresh map
    }
  };
};
