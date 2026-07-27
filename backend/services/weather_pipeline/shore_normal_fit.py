"""
shore_normal_fit.py — PURE geometry for deriving a shore normal from a fine elevation raster.

WHY THIS EXISTS
---------------
`bathymetry.shore_normal_at()` derives the seaward bearing from the bundled 0.25° grid using a 7×7
window. That window is **194.6 km across** (7 × 0.25° × 111 km) — it decides which way a beach faces
from an area the size of a small country. Measured consequences (2026-07-26): Pipeline and Sunset
both return 0.0° against a coast that faces ~325-335°; Uluwatu and Nusa Dua — ~130° apart in truth —
came back 0.4° apart. Cost is ~0.30-0.39 rating points per degree of error.

The fix is a 60× finer source (NOAA ETOPO 2022 15s ≈ 463 m, CC0 public domain). But resolution alone
is not enough: at 463 m the land/sea split inside a 1-3 km box is jagged, and the production
centroid estimator jitters. Measured spread across window sizes at Pipeline: centroid 10.1° vs
coast-PCA 5.2°; at Sunset 6.1° vs 2.9°. coast-PCA was the most stable estimator on 6 of 8 test
spots, and it is the physically principled one — it fits the SHORELINE's orientation rather than
comparing bulk land/ocean centroids, so it does not care how much land happens to be in frame.

★ THE SPREAD IS THE INSTRUMENT. Evaluating the same estimator at several window sizes and taking the
maximum pairwise disagreement yields a self-measured confidence. Validated 2026-07-26 against
production:

    spread  spot             prod(0.25°)  ETOPO    OSM (independent)   ETOPO err   coarse err
     0.9    Sunset Beach          0.0     315.5           -                -            -
     2.3    Pipeline              0.0     308.8         304.3            4.5°        ~55°
     3.1    Hossegor            305.0     280.3         276.8            3.5°        28.2°
     8.3    Jeffreys Bay        174.6     105.4          99.0            6.4°        75.6°
    10.4    Nusa Dua            162.9      68.7          59.9            8.8°       103.0°
    16.5    Ocean Beach SF      240.8     269.2         270.0            0.8°        29.2°
    26.0    Steamer Lane        247.9     153.5         143.0           10.5°       105.0°
    39.1    Uluwatu             162.5     308.4         318.6           10.2°       156.2°

The truth column is NOT my reading of a map — it is OSM coastline geometry (see below), which shares
no assumption with this estimator. ETOPO wins every row, and the two worst-spread spots are wins by
the largest margin of all.

⚠️ These are hand-picked test COORDINATES near the named breaks, not necessarily the catalog's stored
coordinates — the "Uluwatu" row is -8.815/115.088, while the DB spot is 1.6 km away at -8.829/115.085
and fits to 273.9°. That gap is itself the point: at 463 m, 1.6 km of placement error changes the
answer by 35°, which is why placement (`nearest_shoreline_km`) and geometry must be fixed together.

★ THE GATE THRESHOLD IS MEASURED, NOT CHOSEN. It was first set to 25° on the assumption that a high
spread meant "no single bearing is correct". **That assumption was wrong.** Cross-validating the
440 gate-rejected spots against OSM showed a high spread means the bearing is scale-DEPENDENT, while
the circular mean across scales stays good:

    spread band   n    ETOPO err vs OSM    coarse err vs OSM    ETOPO closer
      25-40°     17         31.9°                63.1°              76%
      40-60°      7         25.6°                20.0°              14%
      60-120°     7         44.4°                30.8°              43%

In 25-40° the ETOPO bearing HALVES the error and wins 3 times in 4, so gating it out was costing
accuracy on 176 spots. Past 40° the advantage disappears. Hence MAX_SPREAD_DEG = 40: above it we
emit nothing and the caller keeps the coarse value rather than trading one wrong answer for another.

★ WHY THE SMALLEST WINDOW WAS REMOVED. The first full build fitted a ~1.1 km half-width window as
well, and it disqualified spots wholesale: at 463 m that window is only ~5×5 cells, far too short a
baseline to fit a shoreline axis, and because the confidence is a MAX pairwise disagreement a single
bad window poisons the whole spot. Flagler Beach Pier measured [161, 64, 63, 67, 67] — four windows
agreeing inside 4° and one 5×5 outlier forcing a spread of 98°. Dropping it, measured on a random
sample of 140 spots: 11 rescued, 0 lost, acceptance 45.0% -> 52.9%, and on spots accepted BOTH ways
the bearing moved by a median of 0.1° (max 4.4°) — it does not disturb answers that were already
good. All eight validated verdicts above are preserved, Uluwatu and Steamer Lane still rejected, so
this is a correctness fix and not the gate quietly loosening. Rescued examples: Biarritz 55.6°->3.9°,
Burleigh Heads 35.5°->3.7°, Oregon Inlet 58.5°->4.2°.

Pure + numpy-only on purpose: no I/O, no network, so the unit tests drive synthetic coastlines whose
true normal is known exactly.
"""
import math

# Above this multi-window disagreement the ETOPO bearing stops beating the coarse one it replaces.
# Set from the OSM band measurement above (25-40° wins 76%, past 40° it does not), NOT from a guess
# about what a "confident" spread ought to be.
MAX_SPREAD_DEG = 40.0

# Window half-widths (degrees) the estimator is evaluated at: ~1.7 km to ~5.0 km. Small enough to
# resolve a single beach, large enough that one noisy 463 m cell cannot dominate — and no smaller,
# because a ~1.1 km window is only ~5×5 cells at this resolution (see above).
WINDOW_HALF_DEGS = (0.015, 0.020, 0.030, 0.045)

_M_PER_DEG = 111320.0

# Water shallower than this is swash / reef flat, not the depth a wave breaks in. Excluding it is
# what turns Aroa Beach from 0.8 m (the flat) into 16.9 m (the water beyond it).
_MIN_WATER_CELL_M = 1.0
# Below this the 463 m instrument is not resolving nearshore bathymetry — a cell straddling a beach
# reads near-zero. Measured: Black Rock returned 0.1 m and would have capped a real break to 0.12 m.
# Emit nothing instead; a missing break depth is legacy behaviour, a wrong one destroys a spot.
_MIN_TRUSTWORTHY_DEPTH_M = 3.0


def _cell_metres(lats, lons):
    """(metres per row, metres per column) — longitude spacing shrinks with cos(latitude)."""
    dlat = float(lats[1] - lats[0])
    dlon = float(lons[1] - lons[0])
    coslat = math.cos(math.radians(float(lats.mean())))
    return dlat * _M_PER_DEG, dlon * _M_PER_DEG * coslat


def _wrap360(deg):
    """Force a bearing into [0, 360). `% 360.0` alone does NOT guarantee that.

    ⚠️ Measured 2026-07-27: `math.degrees(math.atan2(-1e-17, 1.0))` is -5.73e-16, and
    `-5.73e-16 % 360.0` evaluates to **exactly 360.0** — the true result is unrepresentable, so it
    rounds up to the modulus. A coast facing infinitesimally west of due north therefore produced a
    bearing of 360.0, which is outside the contract every consumer relies on.
    Caught by `test_shipped_asset_respects_its_own_gate` when a spot imported on 2026-07-27 happened
    to fit that angle: the asset build FAILED and refused to commit, which is exactly what that
    guard exists for.
    """
    d = deg % 360.0
    return 0.0 if d >= 360.0 else d


def _bearing(north_m, east_m):
    """Compass bearing (0=N, 90=E) of a north/east vector, or None for a zero vector."""
    if abs(north_m) < 1e-12 and abs(east_m) < 1e-12:
        return None
    return _wrap360(math.degrees(math.atan2(east_m, north_m)))


def angular_diff(a, b):
    """Smallest absolute angle between two bearings, in [0, 180]."""
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def circular_mean(bearings):
    """Mean of compass bearings, done on the unit circle so 359° and 1° average to 0°, not 180°."""
    vals = [b for b in bearings if b is not None]
    if not vals:
        return None
    s = sum(math.sin(math.radians(v)) for v in vals)
    c = sum(math.cos(math.radians(v)) for v in vals)
    if abs(s) < 1e-12 and abs(c) < 1e-12:
        return None
    return _wrap360(math.degrees(math.atan2(s, c)))


def max_spread(bearings):
    """Largest pairwise angular disagreement — the self-measured confidence. None if < 2 values."""
    vals = [b for b in bearings if b is not None]
    if len(vals) < 2:
        return None
    return max(angular_diff(a, b) for a in vals for b in vals)


def shoreline_mask(elev):
    """Ocean cells that touch land on a 4-neighbour — i.e. the shoreline itself.

    `elev` is elevation in metres, positive UP (ETOPO convention), so ocean is < 0."""
    import numpy as np
    ocean = elev < 0
    sh = np.zeros_like(ocean)
    sh[1:, :] |= ocean[1:, :] & ~ocean[:-1, :]
    sh[:-1, :] |= ocean[:-1, :] & ~ocean[1:, :]
    sh[:, 1:] |= ocean[:, 1:] & ~ocean[:, :-1]
    sh[:, :-1] |= ocean[:, :-1] & ~ocean[:, 1:]
    return sh


def coast_pca_bearing(elev, lats, lons):
    """Seaward bearing (deg, 0=N, 90=E) by PCA on the shoreline cells.

    The principal axis of the shoreline points along the coast (the tangent); the shore normal is
    perpendicular to it. Of the two perpendiculars we take the one pointing at the ocean, decided by
    the land→ocean vector (a sign test only — its magnitude, which is what makes the plain centroid
    estimator jittery, is discarded).

    ★ THE SIGN TEST IS DEPTH-WEIGHTED, and it has to be. On a barrier island an unweighted water
    centroid is a coin flip and it lands wrong: measured at Waves on the Outer Banks, a ±5 km window
    holds 210 water cells on each side — Pamlico Sound to the west at a mean depth of 0.9 m, the
    Atlantic to the east at 11.1 m — and the estimator confidently faced the lagoon (273.7° instead
    of ~90°), with a spread of 4.5° that gave no hint anything was wrong. Weighting each water cell
    by its depth encodes the physics: swell arrives from DEEP water, not from a 1 m sound. Land is
    weighted uniformly since only the water side can be ambiguous.

    Returns None when the window has no shoreline (all ocean / all land) or too few shoreline cells
    to fit an axis.
    """
    import numpy as np
    elev = np.asarray(elev, dtype=float)
    ocean = elev < 0
    n_ocean = int(ocean.sum())
    if n_ocean == 0 or n_ocean == elev.size:
        return None
    idx = np.argwhere(shoreline_mask(elev))
    if len(idx) < 3:
        return None
    my, mx = _cell_metres(np.asarray(lats, dtype=float), np.asarray(lons, dtype=float))
    pts = np.column_stack([idx[:, 0] * my, idx[:, 1] * mx])      # (north_m, east_m)
    pts = pts - pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts, full_matrices=False)
    tangent = vt[0]
    normal = np.array([-tangent[1], tangent[0]])
    rows, cols = np.indices(elev.shape)
    land = ~ocean
    depth = np.where(ocean, -elev, 0.0)                          # metres, positive down
    w = depth[ocean]
    w_sum = float(w.sum())
    if w_sum <= 0:                                               # degenerate: fall back to unweighted
        sea_row, sea_col = float(rows[ocean].mean()), float(cols[ocean].mean())
    else:
        sea_row = float((rows[ocean] * w).sum() / w_sum)
        sea_col = float((cols[ocean] * w).sum() / w_sum)
    to_sea = np.array([(sea_row - float(rows[land].mean())) * my,
                       (sea_col - float(cols[land].mean())) * mx])
    if float(np.dot(normal, to_sea)) < 0:
        normal = -normal
    return _bearing(float(normal[0]), float(normal[1]))


def crop(elev, lats, lons, clat, clon, half_deg):
    """Sub-window of `elev` within ±half_deg of (clat, clon). Returns (None, None, None) if too small."""
    import numpy as np
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    mi = (lats >= clat - half_deg) & (lats <= clat + half_deg)
    mj = (lons >= clon - half_deg) & (lons <= clon + half_deg)
    if int(mi.sum()) < 3 or int(mj.sum()) < 3:
        return None, None, None
    return elev[np.ix_(mi, mj)], lats[mi], lons[mj]


def fit_shore_normal(elev, lats, lons, clat, clon, half_degs=WINDOW_HALF_DEGS):
    """Multi-window coast-PCA fit at (clat, clon).

    Returns (bearing_deg, spread_deg, n_windows). `bearing` is the circular mean across window
    sizes; `spread` is the maximum pairwise disagreement — the caller gates on it. Both are None
    when fewer than 2 windows produced a bearing (no usable shoreline in view).
    """
    bearings = []
    for h in half_degs:
        sub_e, sub_la, sub_lo = crop(elev, lats, lons, clat, clon, h)
        if sub_e is None:
            continue
        try:
            b = coast_pca_bearing(sub_e, sub_la, sub_lo)
        except Exception:
            b = None
        if b is not None:
            bearings.append(b)
    if len(bearings) < 2:
        return None, None, len(bearings)
    return circular_mean(bearings), max_spread(bearings), len(bearings)


def nearshore_depth_m(elev, lats, lons, lat, lon, radius_m=1000.0):
    """Median depth (m, positive down) of the water within ``radius_m`` — the depth a wave actually
    breaks in, as opposed to the shelf it crossed to get here.

    WHY THIS IS A SEPARATE NUMBER FROM shelf_depth_at() — AND WHY THAT ONE IS NOT A BUG
    `surf_transform.estimate_surf` uses ONE depth for two unrelated jobs: cross-shelf bottom
    friction, and the depth-limited breaking cap (`breaker_index * depth`).

    `bathymetry.shelf_depth_at` answers the FIRST one well, and measurement says so — Cocoa Beach
    24 m over a 73 km shelf gives a 24.6% friction loss, Galveston 16 m over 167 km gives 57.1%,
    while Mavericks (101 m) loses 2.7% and Pipeline (2534 m) loses none. That is exactly the wide-
    shallow-shelf vs steep-coast distinction it was built for. Do NOT "fix" it.

    Fed to the SECOND job the same number is meaningless: measured 2026-07-27 across 395 live spots
    the cap **binds on 0 of them**, median cap **107x the wave**. Santa Cruz reads 452 m — correct as
    "deep water offshore, little friction", absurd as "waves here break at 350 m".

    So this is an ADDITIONAL depth, not a replacement. At ETOPO's 463 m the same points read 8.5 m
    (Cowell's) and 13.4 m (Steamer Lane), so H <= gamma*d becomes real physics again — and it
    distinguishes two spots 1.9 km apart, which a 139 km median cannot do by construction.
    ⚠️ Small blast radius by design: with the live breaker index the cap only binds above ~9 m of
    offshore swell, so ordinary days are untouched and big-swell days stop going unphysical.

    Deliberately the MEDIAN of water cells rather than the minimum: one 463 m cell that clips a
    sandbar should not cap an entire break.

    ★ TWO GUARDS, BOTH FROM MEASURED FAILURES — a bad break depth is worse than none, because it
    caps a real break out of existence.
      * SWASH/REEF-FLAT cells are excluded (`_MIN_WATER_CELL_M`). Aroa Beach sits behind a reef flat
        and medianed to **0.8 m** over all water, which would have capped it to ~1 m; excluding the
        sub-1 m cells gives **16.9 m**, the water outside the flat, which is the depth that matters.
      * Anything still below `_MIN_TRUSTWORTHY_DEPTH_M` returns **None**. At 463 m a cell straddling
        a beach reads near-zero, so a very shallow answer means the instrument cannot resolve the
        nearshore — not that the water is 10 cm deep. Measured: Black Rock came back at **0.1 m**
        and the cap crushed a real break from 2.40 m to **0.12 m**. Emitting nothing there keeps
        legacy behaviour, exactly as the shore-normal gate does when it cannot tell.
    """
    import numpy as np
    elev = np.asarray(elev, dtype=float)
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    my, mx = _cell_metres(lats, lons)
    i = int(np.argmin(np.abs(lats - lat)))
    j = int(np.argmin(np.abs(lons - lon)))
    rows, cols = np.indices(elev.shape)
    dist = np.hypot((rows - i) * my, (cols - j) * mx)
    depth = -elev
    water = (elev < 0) & (dist <= radius_m) & (depth >= _MIN_WATER_CELL_M)
    if not water.any():
        return None
    med = float(np.median(depth[water]))
    return med if med >= _MIN_TRUSTWORTHY_DEPTH_M else None


def fronting_water_depth_m(elev, lats, lons, lat, lon, radius_cells=3):
    """Mean depth (m, positive down) of the water immediately in front of the spot — a PLACEMENT
    signal that distinguishes an ocean beach from a lagoon shore.

    Measured need: "Cape Canaveral Air Force Station" is geocoded onto the Banana River, whose water
    averages 1.3 m, with the Atlantic barely reaching the ±5 km window. Its bearing is confidently
    computed and confidently useless. A real ocean break fronts water metres to tens of metres deep,
    so this number separates the two — but it is REPORTED, not gated on, because a gently shelving
    coast (Florida's Atlantic side) is genuinely shallow this close in and must not be discarded.

    Returns None when there is no water in the neighbourhood."""
    import numpy as np
    elev = np.asarray(elev, dtype=float)
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    i = int(np.argmin(np.abs(lats - lat)))
    j = int(np.argmin(np.abs(lons - lon)))
    i0, i1 = max(0, i - radius_cells), min(elev.shape[0], i + radius_cells + 1)
    j0, j1 = max(0, j - radius_cells), min(elev.shape[1], j + radius_cells + 1)
    sub = elev[i0:i1, j0:j1]
    water = sub[sub < 0]
    if water.size == 0:
        return None
    return float(-water.mean())


def nearest_shoreline_km(elev, lats, lons, lat, lon):
    """Distance (km) from (lat, lon) to the nearest shoreline cell — a PLACEMENT signal.

    A correctly-placed break is within a few hundred metres of the shoreline. A spot geocoded to a
    town centre, a clifftop, or (measured) a waterfall in the Jamaican interior is kilometres away.
    Returns None when the window holds no shoreline at all.
    """
    import numpy as np
    elev = np.asarray(elev, dtype=float)
    idx = np.argwhere(shoreline_mask(elev))
    if len(idx) == 0:
        return None
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    d_north = (lats[idx[:, 0]] - lat) * _M_PER_DEG
    d_east = (lons[idx[:, 1]] - lon) * _M_PER_DEG * math.cos(math.radians(lat))
    return float(np.hypot(d_north, d_east).min() / 1000.0)
