// Shared pre-extrapolation field resolution. This body is extracted verbatim from the encoder.
// Callers own the buffers; no grid mutation, diagnostics or texture operations.
export function resolveMarineFields(vectors, activeLayer, N, fields) {
  const { uArr, vArr, hArr, pArr, oceanArr, confArr, motionArr, hPhys } = fields;
  confArr.fill(1.0);   // default: fully confident (products without dir_confidence are unchanged)

  const numGridToProcess = Math.min(vectors.length, N);
  let flatSpeedNonzeroCount = 0;

  for (let i = 0; i < numGridToProcess; i++) {
    const v = vectors[i];
    if (!v) {
      oceanArr[i] = 0;
      if (motionArr) motionArr[i] = 0;
      if (hPhys) hPhys[i] = 0;
      continue;
    }
    const hasSub = activeLayer !== 'waves' && v[activeLayer];
    const sub = hasSub ? v[activeLayer] : {};
    
    let uVal = hasSub && typeof sub.u === 'number' ? sub.u : (typeof v.u === 'number' ? v.u : 0);
    let vVal = hasSub && typeof sub.v === 'number' ? sub.v : (typeof v.v === 'number' ? v.v : 0);
    const speed = hasSub && typeof sub.speed === 'number' ? sub.speed : (typeof v.speed === 'number' ? v.speed : 0);
    const height = hasSub && typeof sub.height === 'number' ? sub.height : (typeof v.height === 'number' ? v.height : (hasSub ? sub.speed || 0 : v.speed || 0));
    const period = hasSub && typeof sub.period === 'number' ? sub.period : (typeof v.period === 'number' ? v.period : 0);
    
    const direction = hasSub && typeof sub.direction === 'number' ? sub.direction : (typeof v.direction === 'number' ? v.direction : undefined);

    // The waves layer reads TOP-LEVEL u/v/direction, but coarse products mirror those from a v.waves
    // sub-record whose is_valid:false does NOT survive the mirror — land cells arrive top-level as
    // {direction: 0, u: 0, v: 0} with no is_valid. Consult the sub-record so land is land (2026-07-03).
    const waveSub = activeLayer === 'waves' && v.waves && typeof v.waves === 'object' ? v.waves : null;

    // Honor the backend's explicit is_valid=false (land / no-data / surf-band open-ocean mask) so those cells
    // render transparent. Only falls through to it when isOcean isn't set, so existing isOcean logic is intact.
    const isOcean = hasSub && sub.isOcean !== undefined ? sub.isOcean
      : (v.isOcean !== undefined ? v.isOcean
         : (v.is_valid === false || (waveSub && waveSub.is_valid === false) ? false : true));

    // Conform direction directly to unit vectors in uArr/vArr if uVal/vVal are zero — OCEAN cells only
    // (2026-07-03): invalid cells carry direction 0 as a PLACEHOLDER, and synthesizing from it stamped a
    // phantom due-south unit vector on every landmass — a coastline-wide fake direction seam against any
    // northish sea (the land-blind fade's second costume, after the zero-vector one). Left at zero here,
    // such cells get a REAL neighbor direction from extrapolateOceanData / dilateDirectionField below.
    if (uVal === 0 && vVal === 0 && direction !== undefined && isOcean) {
      const dirRad = direction * (Math.PI / 180);
      uVal = -Math.sin(dirRad);
      vVal = -Math.cos(dirRad);
    }
    
    uArr[i] = uVal;
    vArr[i] = vVal;
    hArr[i] = height;
    pArr[i] = period;
    // §0e: the honest height — phys_speed when the backend carried it (rated/masked cells),
    // else `height` (untouched cells' speed IS honest). waveSub covers the conjoined mirror;
    // mappers/conform carry the top-level field.
    if (hPhys) {
      const _pv = typeof v.phys_speed === 'number' ? v.phys_speed
        : (typeof v.physSpeed === 'number' ? v.physSpeed
           : (waveSub && typeof waveSub.phys_speed === 'number' ? waveSub.phys_speed : null));
      hPhys[i] = _pv !== null ? _pv : height;
    }
    oceanArr[i] = isOcean ? 1 : 0;
    // Motion-water: color-water OR a masked cell that still carries real field data. True LAND
    // arrives as is_valid=false with all-zero u/v/height/period, so it stays 0 on both channels.
    if (motionArr) {
      motionArr[i] = (isOcean || uVal !== 0 || vVal !== 0 || height > 0 || period > 0) ? 1 : 0;
    }

    // §0B-a: per-cell direction confidence (coarse NOAA products only; null/absent = 1.0). Ocean
    // cells only — land/invalid texels keep 1.0 so dilated/extrapolated directions stay full-strength
    // (they're mask-culled for rendering; their job is stabilizing the bilinear direction field).
    // Read chain covers every vector shape that reaches the engine: mapper camelCase (top-level +
    // subs), the useMarineWindData conform (top-level + active-layer sub), raw backend snake_case
    // (series frames commit flat GridVector dicts), and the waves-mirror sub.
    const confVal = hasSub && typeof sub.dirConfidence === 'number' ? sub.dirConfidence
      : (hasSub && typeof sub.dir_confidence === 'number' ? sub.dir_confidence
         : (typeof v.dirConfidence === 'number' ? v.dirConfidence
            : (typeof v.dir_confidence === 'number' ? v.dir_confidence
               : (waveSub && typeof waveSub.dirConfidence === 'number' ? waveSub.dirConfidence
                  : (waveSub && typeof waveSub.dir_confidence === 'number' ? waveSub.dir_confidence : null)))));
    if (isOcean && confVal !== null) {
      confArr[i] = Math.max(0, Math.min(1, confVal));
    }

    if (speed > 0) {
      flatSpeedNonzeroCount++;
    }
  }

  // Clear any remaining elements in scratch buffers
  if (numGridToProcess < N) {
    uArr.fill(0, numGridToProcess, N);
    vArr.fill(0, numGridToProcess, N);
    hArr.fill(0, numGridToProcess, N);
    pArr.fill(0, numGridToProcess, N);
    oceanArr.fill(0, numGridToProcess, N);
    if (motionArr) motionArr.fill(0, numGridToProcess, N);
    if (hPhys) hPhys.fill(0, numGridToProcess, N);
  }

  return { numGridToProcess, flatSpeedNonzeroCount };
}
