/**
 * Wind bench: WHERE A CROP IS, and which crop of a frame goes to which run. One module for the page (page/map-entry.js: the
 * screen's crop and the trail buffer's must be the same pixels) and the runner (motion-run.js: several crops of one frame, each a
 * run of its own), so both are tested by what they do (src/components/map/windBenchTruth.test.js).
 */

/** A crop's first pixel along one axis: centred at fraction `f` of `full`, kept inside it. */
function cropEdge(f, full, part) { return Math.max(0, Math.min(full - part, Math.round(full * f - part / 2))); }

/**
 * A crop's rectangle in a `W` x `H` image whose rows run from the TOP (a canvas): { x, y, w, h }, and `glY`, the first row of the
 * SAME rectangle counted from the BOTTOM, as gl.readPixels counts them.
 */
function cropRect(W, H, size, centre) {
  const w = Math.min(size[0], W), h = Math.min(size[1], H), [fx, fy] = centre || [0.5, 0.5];
  const x = cropEdge(fx, W, w), y = cropEdge(fy, H, h);
  return { x, y, w, h, glY: H - y - h };
}

/**
 * RGBA bytes as gl.readPixels returns them (rows from the bottom) turned to run from the top, the alpha written opaque: the trail
 * buffer's crop as an image the screen's crop can be laid beside, pixel for pixel.
 */
function rowsFromTop(px, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 4;
    for (let i = 0; i < w * 4; i += 4) { out[dst + i] = px[src + i]; out[dst + i + 1] = px[src + i + 1]; out[dst + i + 2] = px[src + i + 2]; out[dst + i + 3] = 255; }
  }
  return out;
}

/** The runs one capture writes: itself, or one a crop centre (`<name>@<fx>_<fy>`), in the order the page crops them. */
function partsOf(name, centres) {
  return centres && centres.length > 1 ? centres.map((a) => ({ name: `${name}@${a[0]}_${a[1]}`, at: a })) : [{ name, at: centres && centres.length ? centres[0] : null }];
}

/** Part `k`'s own value of a frame's `shot` or `trail`: the k-th of a list when the capture took several crops, the value itself when it took one. */
function partOf(value, k, many) { return many ? value[k] : value; }

/**
 * Is a saved result THIS run? The same wind, the same page behind the map, the same levers and forced uniforms, the same crop, and
 * the trail buffer saved if it is asked for now. A run of the same name under another lever is not this run.
 */
function sameRun(saved, want) {
  const j = (v) => JSON.stringify(v || {});
  return !!(saved && saved.ok && saved.fixture === want.fixture && saved.page === want.page && j(saved.levers) === j(want.levers) && j(saved.force) === j(want.force)
    && JSON.stringify(saved.crop || null) === JSON.stringify(want.crop || null) && (!want.trail || saved.trail === true));
}

module.exports = { cropEdge, cropRect, rowsFromTop, partsOf, partOf, sameRun };
