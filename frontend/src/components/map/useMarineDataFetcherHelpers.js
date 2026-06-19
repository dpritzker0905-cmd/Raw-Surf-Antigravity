export const DISPLAY_EURO_WAVES_MAX_HOURS = 240;
export const DISPLAY_EURO_COMPONENT_MAX_HOURS = 240;
export const DISPLAY_ICON_MAX_HOURS = 168;

export function getLongitudinalOverlap(w1, e1, w2, e2) {
  const vpWidth = (e1 < w1) ? (e1 + 360) - w1 : e1 - w1;
  if (vpWidth >= 360.0 - 1e-5) {
    return (e2 < w2) ? (e2 + 360) - w2 : e2 - w2;
  }
  const norm = lng => ((lng % 360) + 360) % 360;
  const nw1 = norm(w1), ne1 = norm(e1);
  const nw2 = norm(w2), ne2 = norm(e2);
  const getSegments = (s, e) => s <= e ? [[s, e]] : [[s, 360], [0, e]];
  const segs1 = getSegments(nw1, ne1);
  const segs2 = getSegments(nw2, ne2);
  let overlap = 0;
  for (const seg1 of segs1) {
    for (const seg2 of segs2) {
      const start = Math.max(seg1[0], seg2[0]);
      const end = Math.min(seg1[1], seg2[1]);
      if (start < end) overlap += (end - start);
    }
  }
  return overlap;
}

export function checkShouldClearRegionalGrid({ marineData, bounds, zoom, model, layer }) {
  if (!marineData || !marineData.grid || !marineData.grid.bounds) return false;
  const g = marineData.grid;
  const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
  const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
  
  const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
  const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
  const vpHeight = en - es;
  const gridHeight = gn - gs;

  const overlapWidth = getLongitudinalOverlap(ew, ee, gw, ge);
  const intSouth = Math.max(es, gs);
  const intNorth = Math.min(en, gn);
  
  let overlapRatio = 0;
  if (overlapWidth > 0 && intSouth < intNorth) {
    const intersectionArea = overlapWidth * (intNorth - intSouth);
    const viewportArea = vpWidth * (en - es);
    if (viewportArea > 0) {
      overlapRatio = intersectionArea / viewportArea;
    }
  }

  const isGlobalSupported = (model === 'GFS' || model === 'ICON');
  const isViewportZoomedOut = (zoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

  const isGridRegional = gridWidth < 340.0;
  let isContained = true;
  if (isGridRegional) {
    let vWest = ew;
    let vEast = ee;
    if (vEast < vWest) vEast += 360;

    let gWest = gw;
    let gEast = ge;
    if (gEast < gWest) gEast += 360;

    isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
  }

  let shouldClear = false;
  if (isGridRegional) {
    shouldClear = isGlobalSupported
      ? (isViewportZoomedOut ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15) : (overlapWidth <= 0 || intSouth >= intNorth))
      : (overlapWidth <= 0 || intSouth >= intNorth);

    const canBypassRegionalRejection = !isViewportZoomedOut || !isGlobalSupported;
    if (g && (g.__isAcceptableRegional || gridWidth < 340.0) && canBypassRegionalRejection) {
      shouldClear = isGlobalSupported
        ? (isViewportZoomedOut ? (!isContained || overlapWidth <= 0 || intSouth >= intNorth) : (overlapWidth <= 0 || intSouth >= intNorth))
        : (overlapWidth <= 0 || intSouth >= intNorth);
    }
  } else {
    shouldClear = (overlapWidth <= 0 || intSouth >= intNorth);
  }

  if (shouldClear) {
    console.log(`[Marine-Bounds-Clear] Bypassing clear stale grid (isGlobalSupported=${isGlobalSupported}, gridWidth=${gridWidth.toFixed(1)}x${gridHeight.toFixed(1)}) to prevent heatmap blanking during transitions.`);
  }
  return shouldClear;
}
