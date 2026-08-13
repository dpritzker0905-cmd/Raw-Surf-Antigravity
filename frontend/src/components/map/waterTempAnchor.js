/**
 * waterTempAnchor.js — the POST-CONDITION for the water_temp slot anchor.
 *
 * ⛔ WHY THIS EXISTS (2026-08-13, WS-CAN-0061; full forensics in
 * `audit/weather-simulation-12.1/evidence/test-results/LV-11_ws_can_0061_root_cause.md`).
 *
 * `0dcfc4ee` (2026-07-11) added an anchor re-assert to fix a real defect — water_temp
 * "intermittently displaying over land" — by moving any slot found ABOVE `ocean-mask-fill` to
 * immediately BELOW it, so the land fill covers the model's land skin temperatures.
 *
 * It moved the layer with **no check that the destination was above anything that would cover it**.
 * Measured live on `dev--rawsurf.netlify.app` at z2, model GFS held fixed, at an OCEAN pixel:
 *
 *     water_temp slots .... 3, 4, 5      (after the re-assert)
 *     ocean-mask-fill ..... 6
 *     water ............... 11   fill, opaque, basemap `composite`   ← covers the field
 *     water-shadow ........ 17   fill, opaque, basemap `composite`   ← covers the field
 *
 * The field decoded, painted, and was then painted over by the basemap ocean at every zoom. The
 * owner saw it happen in real time while zooming: `styledata` fires, slot rotation re-mounts a slot
 * ABOVE the fill (where it renders correctly), and the re-assert instantly pushes it back under.
 *
 * ★ THE CONSTRAINT IS UNSATISFIABLE AS ARRANGED. water_temp must be ABOVE `water` (or the basemap
 * ocean covers it) and BELOW `ocean-mask-fill` (or land skin temps show). `ocean-mask-fill` sits
 * below `water`, so no index satisfies both. There is no correct place to move to.
 *
 * ⇒ So this REFUSES the move and says so, instead of silently blanking the layer. A visible field
 * with land bleed is strictly more useful than an invisible one, and the refusal is what surfaces
 * the real problem — the stack order — rather than hiding it for another month. This is the FIFTH
 * occurrence of "an opaque fill covers a weather field"; the four before it were point fixes
 * (lakes, coast buffer, green landuse, the 07-17 inland-repaint ORDER PIN) and none held.
 *
 * ⚠️ SCOPED TO THE BASEMAP ON PURPOSE. `ocean-mask-*` layers are excluded: OceanMask.js positions
 * its own family deliberately (see its ORDER PIN, 2026-07-17), and treating them as occluders here
 * would make the guard refuse on every tick and reintroduce the land bleed `0dcfc4ee` fixed.
 *
 * Pure by construction — no `window`, no map instance — so the post-condition is unit-testable
 * without a rendered map, which is exactly what the five previous fixes lacked.
 */

// `water`, `water-shadow`, `…-water`. NOT `waterway` (no separator after "water") and NOT
// `water_temp-slot-*`, which is the field being protected.
const WATER_FILL_ID = /(^|[-_])water([-_]|$)/i;

/**
 * The highest-indexed opaque basemap water fill sitting ABOVE `fillIdx`.
 * Anything it finds occludes the field, because the slots must land BELOW `fillIdx`.
 *
 * @param {string[]} order      layer ids, bottom-first (map.style._order)
 * @param {number}   fillIdx    index of `ocean-mask-fill`
 * @param {(id:string)=>any} getLayer  resolves a layer id to `{ type, sourceLayer }`
 * @returns {string|null} the occluding layer id, or null when the anchor is safe
 */
export function findOccludingWaterFill(order, fillIdx, getLayer) {
  if (!Array.isArray(order) || typeof fillIdx !== 'number' || fillIdx < 0) return null;
  for (let i = order.length - 1; i > fillIdx; i--) {
    const id = order[i];
    if (typeof id !== 'string') continue;
    if (id.startsWith('water_temp-slot-') || id.startsWith('ocean-mask-')) continue;
    let layer = null;
    try { layer = getLayer(id); } catch (e) { continue; }
    if (!layer || layer.type !== 'fill') continue;
    if (layer.sourceLayer === 'water' || WATER_FILL_ID.test(id)) return id;
  }
  return null;
}

// A layer's vector source-layer, whichever shape it arrives in: `getStyle().layers` uses the
// kebab wire key, `map.getLayer()` returns the camelCase runtime property.
const srcLayerOf = (l) => (l && (l.sourceLayer || l['source-layer'])) || null;

// The structural bands the mask has always inserted before (landuse/parks/POIs/labels).
const STRUCTURAL = /landuse|park|landcover|national|land-structure|building|poi/;
const NEVER_ANCHOR = (id) => !id || id.startsWith('ocean-mask-') || id.endsWith('-layer')
  || id.endsWith('-source') || id === 'background' || id === 'water' || id === 'water-depth'
  || id === 'wetland';

/**
 * Where the OceanMask family should be inserted.
 *
 * ⛔ WS-CAN-0061 (2026-08-13). The original rule returned the first structural layer in the style.
 * In Mapbox Streets `landcover` precedes `water`, so the mask landed BELOW the basemap ocean --
 * measured live: ocean-mask-fill 6, water 11. Everything anchored "below the mask" (the water_temp
 * slots at 3/4/5, and the marine layer via mapUtils.findMarineInsertionLayer) was therefore also
 * below the basemap ocean.
 *
 * PROVEN ON FILM, not inferred: during a wheel zoom the basemap's vector tiles have not arrived, so
 * `water` draws nothing and the field is fully visible; ~6 s after the map settles the tiles land,
 * `water` paints its opaque fill, and the field vanishes. Two frames of one gesture, beach theme:
 * evidence/recordings/TR-12-z2.00.jpg (correct) vs TR-99-settled.jpg (erased).
 * The earlier `queryRenderedFeatures` "proof" was worthless -- that API never returns raster layers.
 *
 * So: anchor above the highest basemap water fill, keeping the original structural rule otherwise.
 * FALLS BACK to the pre-fix anchor when no structural layer exists above the water fills, so a
 * style this rule cannot parse behaves exactly as it did before rather than floating the mask to
 * the top of the stack (which would bury the labels).
 *
 * @param {Array<{id:string,type:string}>} layers  style layers, bottom-first
 * @returns {string|null} the layer id to insert BEFORE, or null to append
 */
export function findMaskInsertionPoint(layers) {
  if (!Array.isArray(layers)) return null;
  let waterIdx = -1;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i], id = (l && l.id) || '';
    if (!l || l.type !== 'fill' || id.startsWith('ocean-mask-')) continue;
    if (srcLayerOf(l) === 'water' || WATER_FILL_ID.test(id)) waterIdx = i;
  }
  const firstStructuralAfter = (start) => {
    for (let i = start; i < layers.length; i++) {
      const l = layers[i], id = (l && l.id) || '';
      if (NEVER_ANCHOR(id)) continue;
      if (STRUCTURAL.test(id) || (l && l.type === 'symbol')) return id;
    }
    return null;
  };
  return firstStructuralAfter(waterIdx + 1) || firstStructuralAfter(0);
}

/**
 * Decide what the re-assert should do. Returns the moves to perform, or a refusal.
 *
 * @returns {{refuse: boolean, occluder: string|null, moves: Array<{id: string, from: number}>}}
 */
export function planAnchorMoves(order, fillIdx, getLayer, options) {
  const guardDisabled = !!(options && options.guardDisabled);
  const occluder = guardDisabled ? null : findOccludingWaterFill(order, fillIdx, getLayer);
  if (occluder) return { refuse: true, occluder, moves: [] };

  const moves = [];
  if (!Array.isArray(order) || typeof fillIdx !== 'number' || fillIdx < 0) {
    return { refuse: false, occluder: null, moves };
  }
  for (let s = 0; s < 3; s++) {
    const id = `water_temp-slot-${s}-layer`;
    const from = order.indexOf(id);
    if (from > fillIdx) moves.push({ id, from });
  }
  return { refuse: false, occluder: null, moves };
}

export default planAnchorMoves;
