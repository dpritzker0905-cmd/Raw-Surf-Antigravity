/** Circular marine blends: cancellation is unavailable, not a measured bearing. */
const MIN_RESULTANT = Math.sqrt(Number.EPSILON);
const validHeight = h => Number.isFinite(h) && h >= 0;
const bearing = d => Number.isFinite(d) ? ((d % 360) + 360) % 360 : null;
const masked = v => !v || v.isOcean === false || v.is_valid === false;

export function blendDirection(heights, directions, weights) {
  let sumU = 0, sumV = 0, amplitude = 0, calmDirection = null;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i], w = weights[i], d = bearing(directions[i]);
    if (!Number.isFinite(w)) return null;
    if (w <= 0) continue;
    if (!validHeight(h)) return null;
    if (calmDirection == null && d != null) calmDirection = d;
    if (h === 0) continue;
    if (d == null) return null;
    const a = h * w, radians = d * Math.PI / 180;
    sumU -= a * Math.sin(radians);
    sumV -= a * Math.cos(radians);
    amplitude += a;
  }
  if (amplitude === 0) return calmDirection;
  if (!Number.isFinite(amplitude) || !Number.isFinite(sumU) || !Number.isFinite(sumV)
      || Math.hypot(sumU, sumV) / amplitude <= MIN_RESULTANT) return null;
  return bearing(Math.atan2(-sumU, -sumV) * 180 / Math.PI);
}

export function blendPeriod(periods, weights) {
  let total = 0, weightSum = 0;
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i], w = weights[i];
    if (Number.isFinite(p) && p > 0 && Number.isFinite(w) && w > 0) {
      total += p * w;
      weightSum += w;
    }
  }
  return weightSum > 0 ? total / weightSum : null;
}

export function unavailableMarineVector() {
  return { u: 0, v: 0, speed: 0, height: 0, period: 0, direction: null, isOcean: false, is_valid: false };
}

function vectorDirection(v) {
  if (v.speed > 0 && (v.u !== undefined || v.v !== undefined)
      && (!Number.isFinite(v.u) || !Number.isFinite(v.v)
          || Math.hypot(v.u, v.v) / v.speed <= MIN_RESULTANT)) return null;
  if (v.direction !== undefined) return bearing(v.direction);
  if (!Number.isFinite(v.u) || !Number.isFinite(v.v)) return null;
  return bearing(Math.atan2(-v.u, -v.v) * 180 / Math.PI);
}

function resolvedVector(height, direction, period) {
  if (!validHeight(height) || (height > 0 && direction == null)) return unavailableMarineVector();
  // A calm cell remains available; its zero vector does not assert a measured bearing.
  const d = direction ?? 0, radians = d * Math.PI / 180;
  return { u: height > 0 ? -height * Math.sin(radians) : 0,
    v: height > 0 ? -height * Math.cos(radians) : 0,
    speed: height, height, period, direction: d, isOcean: true, is_valid: true };
}

export function blendSubVector(v1, v2, w1, w2) {
  // Preserve the existing single-ocean-source fallback; masked cells cannot contribute.
  const a = masked(v1) ? null : v1, b = masked(v2) ? null : v2;
  if (!a && !b) return unavailableMarineVector();
  if (!a || !b) {
    const v = a || b;
    return resolvedVector(v.speed, vectorDirection(v), v.period || 0);
  }
  const height = (w1 > 0 ? a.speed * w1 : 0) + (w2 > 0 ? b.speed * w2 : 0);
  const direction = blendDirection([a.speed, b.speed], [vectorDirection(a), vectorDirection(b)], [w1, w2]);
  return resolvedVector(height, direction, blendPeriod([a.period, b.period], [w1, w2]) || 0);
}

export function extrapolateSubVector(iconAnchor, gfsAnchor, gfsTarget, weightPersist, weightGfs) {
  if ([iconAnchor, gfsAnchor, gfsTarget].some(v => masked(v) || !validHeight(v.speed))) {
    return unavailableMarineVector();
  }
  const hIcon = iconAnchor.speed, pIcon = iconAnchor.period || 0;
  const hTrend = Math.max(0, hIcon + gfsTarget.speed - gfsAnchor.speed);
  const pTrend = gfsAnchor.period > 0
    ? Math.max(2, pIcon + (gfsTarget.period || 0) - gfsAnchor.period) : pIcon;
  const height = Math.max(0, weightPersist * hIcon + weightGfs * hTrend);
  // The GFS anchor bearing is not part of this height-trend model.
  const direction = blendDirection([hIcon, hTrend],
    [vectorDirection(iconAnchor), vectorDirection(gfsTarget)], [weightPersist, weightGfs]);
  return resolvedVector(height, direction, blendPeriod([pIcon, pTrend], [weightPersist, weightGfs]) || 0);
}

export function requireMarineDirection(height, direction) {
  if (!validHeight(height) || (height > 0 && bearing(direction) == null)) {
    throw new Error('Marine estimate direction is unresolved for positive height');
  }
}
