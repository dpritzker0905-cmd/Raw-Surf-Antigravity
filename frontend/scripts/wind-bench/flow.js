/**
 * Wind bench: do the wind's streaks run ALONG the wind? Pure, no DOM, no GL.
 *
 * A trail is drawn along the air's path, so the wind's ink should vary ACROSS the wind and hardly along it. When the
 * trail buffer does not follow the map, a pan smears every trail along the drag and a zoom along rays from the focal
 * point, and the streaks stop pointing where the wind blows. This measures that directly on the picture.
 *
 * ink   = (map + wind) - (map alone), in L*, at CSS-pixel scale (rows as read back: row 0 is the screen's bottom, so
 *         +row is north and a wind (u, v) points along (+col, +row));
 * flow  = share of the ink's gradient energy that lies ACROSS the served wind direction, over blocks of the screen:
 *         1 = every streak runs along the wind, 0.5 = no preferred direction, 0 = every streak runs across it.
 *         A short dash has two ends, so a field at rest reads below 1; the rest reading is each run's own baseline.
 * Blocks are left out where the map itself has line work (its residue under a tint would be read as ink), where the
 * wind is too light to have a direction worth scoring, or where there is almost no ink.
 */

const DEFAULTS = Object.freeze({ block: 16, mapEdgeMax: 4, minInk: 0.6, minSpeed: 5 });

/**
 * @param {{w:number,h:number,L:Float32Array}} comp  map + wind
 * @param {{w:number,h:number,L:Float32Array}} off   the map alone, same camera
 * @param {(x:number, y:number) => ([number, number]|null)} windAt  served [u, v] in knots at an image position (col, row)
 * @returns {{flow:number|null, blocks:number, ink:number}}  ink = mean gradient energy of the scored blocks
 */
function flowAlignment(comp, off, windAt, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, { w, h } = comp, B = o.block;
  let across = 0, total = 0, blocks = 0;
  for (let by = 1; by + B < h - 1; by += B) {
    for (let bx = 1; bx + B < w - 1; bx += B) {
      const uv = windAt(bx + B / 2, by + B / 2);
      if (!uv) continue;
      const sp = Math.hypot(uv[0], uv[1]);
      if (!(sp >= o.minSpeed)) continue;
      let jxx = 0, jyy = 0, jxy = 0, mapMax = 0;
      for (let y = by; y < by + B; y++) {
        for (let x = bx; x < bx + B; x++) {
          const i = y * w + x;
          const mx = (off.L[i + 1] - off.L[i - 1]) / 2, my = (off.L[i + w] - off.L[i - w]) / 2, m2 = mx * mx + my * my;
          if (m2 > mapMax) mapMax = m2;
          const gx = (comp.L[i + 1] - comp.L[i - 1]) / 2 - mx, gy = (comp.L[i + w] - comp.L[i - w]) / 2 - my;
          jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
        }
      }
      const energy = (jxx + jyy) / (B * B);
      if (mapMax > o.mapEdgeMax * o.mapEdgeMax || energy < o.minInk) continue;
      // unit normal to the wind: n = (-v, u) / |wind|; the energy across the wind is n' J n
      const nx = -uv[1] / sp, ny = uv[0] / sp;
      across += nx * nx * jxx + 2 * nx * ny * jxy + ny * ny * jyy;
      total += jxx + jyy;
      blocks++;
    }
  }
  return { flow: total > 0 ? across / total : null, blocks, ink: blocks ? total / (blocks * B * B) : 0 };
}

/**
 * Which samples of a path are at rest, moving, or settling (the trails of a camera that has just stopped are still
 * the moving camera's for about a second, so those samples belong to neither group).
 * @param {{lng:number,lat:number,z:number,bearing?:number}[]} frames  one camera per 60 Hz frame
 * @param {number[]} samples  frame indexes
 * @param {number} settle     frames after the last move that still count as settling
 * @returns {('rest'|'move'|'settle')[]}
 */
function motionOf(frames, samples, settle = 60) {
  const moved = frames.map((f, i) => i > 0 && (f.lng !== frames[i - 1].lng || f.lat !== frames[i - 1].lat || f.z !== frames[i - 1].z || (f.bearing || 0) !== (frames[i - 1].bearing || 0)));
  let last = -Infinity;
  const since = moved.map((m, i) => { if (m) last = i; return i - last; });
  return samples.map((i) => (moved[i] ? 'move' : since[i] <= settle ? 'settle' : 'rest'));
}

/**
 * A map turned to `bearing` degrees (the compass direction at the top of the screen), with +y UP the screen:
 * east points along (cos b, sin b) and north along (-sin b, cos b). b = 0 is the north-up map.
 *   toGround(dx, dy) -> [east, north]  a screen offset as a ground offset;
 *   toScreen(u, v)   -> [x, y]         a ground vector (u east, v north) as it lies on screen.
 */
function turned(bearing = 0) {
  const r = bearing * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { toGround: (dx, dy) => [dx * c + dy * s, dy * c - dx * s], toScreen: (u, v) => [u * c - v * s, u * s + v * c] };
}

module.exports = { flowAlignment, motionOf, turned, FLOW_DEFAULTS: DEFAULTS };
