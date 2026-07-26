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

    spread  spot             prod(0.25°)  ETOPO   real-world truth   who is right
     0.9    Sunset Beach          0.0     315.5   ~335 NW            ETOPO
     2.3    Pipeline              0.0     308.8   ~325 NW            ETOPO
     3.1    Hossegor            305.0     280.3   ~275 W             ETOPO
     8.3    Jeffreys Bay        174.6     105.4   ~110 ESE           ETOPO
    10.4    Nusa Dua            162.9      68.7   ~110 E             ETOPO
    16.5    Ocean Beach SF      240.8     269.2    270 due W         ETOPO
    26.0    Steamer Lane        247.9     153.5   ~180 S             NEITHER
    39.1    Uluwatu             162.5     308.4   ~250 WSW           NEITHER

Every low-spread spot, ETOPO wins outright. Both high-spread spots sit where a coastline genuinely
bends (a peninsula corner, a headland) and NO single bearing is correct — the estimator is reporting
a real ambiguity of the location, not a bug. Hence MAX_SPREAD_DEG: above it we emit nothing and the
caller keeps the coarse value rather than trading one wrong answer for another.

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

# Above this multi-window disagreement the location has no single well-defined shore normal.
# Chosen from the table above: the trustworthy band tops out at 16.5° and the untrustworthy band
# starts at 26.0°; 25° sits in the gap between them.
MAX_SPREAD_DEG = 25.0

# Window half-widths (degrees) the estimator is evaluated at: ~1.7 km to ~5.0 km. Small enough to
# resolve a single beach, large enough that one noisy 463 m cell cannot dominate — and no smaller,
# because a ~1.1 km window is only ~5×5 cells at this resolution (see above).
WINDOW_HALF_DEGS = (0.015, 0.020, 0.030, 0.045)

_M_PER_DEG = 111320.0


def _cell_metres(lats, lons):
    """(metres per row, metres per column) — longitude spacing shrinks with cos(latitude)."""
    dlat = float(lats[1] - lats[0])
    dlon = float(lons[1] - lons[0])
    coslat = math.cos(math.radians(float(lats.mean())))
    return dlat * _M_PER_DEG, dlon * _M_PER_DEG * coslat


def _bearing(north_m, east_m):
    """Compass bearing (0=N, 90=E) of a north/east vector, or None for a zero vector."""
    if abs(north_m) < 1e-12 and abs(east_m) < 1e-12:
        return None
    return math.degrees(math.atan2(east_m, north_m)) % 360.0


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
    return math.degrees(math.atan2(s, c)) % 360.0


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
    the bulk land→ocean vector (a sign test only — its magnitude, which is what makes the plain
    centroid estimator jittery, is discarded).

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
    to_sea = np.array([float(rows[ocean].mean() - rows[land].mean()) * my,
                       float(cols[ocean].mean() - cols[land].mean()) * mx])
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
