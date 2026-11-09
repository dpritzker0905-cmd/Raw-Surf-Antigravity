"""bight_hs_consensus.py — SURF_BIGHT_HS_CONSENSUS: the GFS+EURO mean offshore Hs inside the SoCal Bight (ON, kill "0").

WHY. Inside the island-sheltered Bight the served lane (GFS-Wave 0.25) reads LOW: research round 4 (2026-11-03, the
evaluation harness at production parity, 8 CDIP nearshore stations, n 1,224 served spot-hours, window 10-20..11-01,
leads 24/48/72) measured the served `hs_station` bias at -0.161 m with MAE 0.264 m, which loses to climatology. Of
the five arms scored in one Holm family, the GFS+EURO mean of Hs at Bight coordinates PASSED (+0.077 m
[0.066, 0.086], bias -0.063) and was the ONLY passing arm that left the advisory breaking-height check neutral
(hb_proxy -0.004, not significant): site-k and EURO-alone raised Hs further and made the breaking height worse,
because today the offshore-low and breaking-high errors cancel. Jason-3 OUTSIDE the islands shows GFS unbiased
(-0.011 m) and EURO +0.126 m high, which is why the mean is confined to the Bight and never applied in open water.
Research record: the round-4 journal (owner memory, research-journal-2026-11-02.md) and
docs/weather-program/log/2026-11-03-claude-bight-hs-consensus.md.

WHAT. `compose(gfs, choose_euro)` returns a NEW GFS waves product whose ocean cells INSIDE `BIGHT_LINE` carry
(Hs_GFS + Hs_EURO) / 2 wherever EURO answers that cell; every other cell is GFS's own object, untouched. Period and
direction stay GFS's to the last digit: u and v are scaled by Hs_mean / Hs_GFS (consensus_product's rule, mirrored,
not re-derived), and speed carries the mean, so the vector and the scalar-height lanes of the sampler agree.
  * EURO's answer is the PRODUCTION PointSampler on the EURO product the point resolver would answer that cell from
    (manifest_point_selection, AUTHORITATIVE candidates only: an estimated EURO tail is not EURO's own answer), read
    from EURO's OWN WET NODES only (`euro_hs`): an exact node that is valid, or a bilinear stencil (masked corners
    renormalized by the sampler). Never a nearest-wet-node fallback, and never a DRY node: the GFS and EURO pilot
    tiles share one 0.25 lattice, so most cells hit the sampler's exact-match path, which (SAMPLER_EXACT_VALIDITY
    '0', the served default) returns a land node's stored 0.0 m as if it were sea; averaged in, that would halve
    the coast. The scored arm kept GFS where EURO's node was dry, and so does this. EURO missing, estimated, dry,
    unavailable or out of bounds there = the cell stays GFS.
  * A frame whose grid does not touch `BIGHT_BBOX` is never examined further (`touches_bight`), and a frame with no
    blended cell is served as the stored object itself, so off-Bight frames cost one bounds compare.

WHERE (one composition). It runs in the serving view `consensus_serve.ServedStore.load_product`, the one place every
serving surface loads a GFS waves frame through: /point (spot_ratings.rate_one_spot's input), the spot hub's cached
grid lane (find_cached_grid_product), /grid and /grid_series, alerts, the sim (it reads /api/weather/point) and the
glyph precompute (spot_ratings_precompute._make_point_resolver). So every surface gets the same Hs, and the surf chain
(surf_point.resolve_surf_geometry + estimate_surf_at -> surf_rating.compute_surf_rating) runs on it unchanged. It
never runs at ingest (ingest's ProductStore is not the view), so no stored product changes.

FROZEN POLYGON (provenance). `BIGHT_LINE` is round 4's own boundary, copied verbatim from the arm that was scored
(r4_arms.inside_bight, 2026-11-03): a seaward line Point Conception (34.45 N, 120.47 W) -> west of San Miguel
(34.03, -120.37) -> San Nicolas (33.25, -119.50) -> south of San Clemente (32.82, -118.35) -> Ensenada (31.75,
-116.75), drawn from geography BEFORE any scoring, and a point is inside when it lies EAST of that line within the
bbox 31.75..34.6 N, 120.6..116.5 W. It was not tuned on any evaluation window and must not be: a change is a
DECISIONS entry and a fresh harness run. Edge convention (pinned by tests): a point ON the line is outside (strict
`>`); a latitude shared by two segments is decided by the northern one; north of 34.45 N inside the bbox the line is
the meridian 120.47 W.

PRECEDENCE (log 2026-11-03-claude-bight-hs-consensus.md):
  1. CONSENSUS_SERVE: a GFS frame served as its CONSENSUS twin (the equal GFS/EURO/ICON mean) is NOT composed again:
     the twin already carries EURO, and averaging EURO in a second time would weight it twice. The Bight mean applies
     only to frames the view serves as GFS (switch off, no same-run twin, or a CONSENSUS_SERVE_KEEP_GFS region).
  2. serve_raw() (the ledger's GFS_RAW baseline lane) answers raw GFS: no Bight mean either.
  3. CONSENSUS_PERIOD_MEDIAN / CONSENSUS_DIRECTION_VECTOR act only inside a consensus build; under this flag period
     and direction are always GFS's, so they never meet.
  4. SURF_SPECTRAL_K (California, #706, a dark draft): at its table spots the breaking height comes from CDIP MOP ray K
     applied at a frozen open-ocean READ POINT; the SoCal read point (32.00 N, 119.80 W) lies OUTSIDE this polygon
     (pinned by a test), so the Bight mean never feeds MOP K and the sheltering is not corrected twice. Those spots'
     own-cell offshore Hs (displayed, and the bulk chain on fail-open) does carry the mean.

DEFAULT ON, KILL "0" (2026-11-04): built dark on 2026-11-03; the owner's policy relayed by the lead ~01:41Z ("fixes now
ship ON by default with a kill switch, plus a history filter and a live guardrail"; precedent DECISIONS 2026-11-01
22:10 EST, "measured features ship ON by default with a kill switch") moved the code default to "1". An os.environ read
at call time through services/runtime_flags (GUARDED, D-065: env > runtime manifest > code default "1"; on iff "1"). Registered in `_RATING_FLAGS` (routes/admin/surf_forecast.py) and declared '1'
in forecast-ingest.yml, precompute.yml, forecast-ingest-pilots.yml and sim-parity-monitor.yml; Render env needs no
entry for ON. Kill: SURF_BIGHT_HS_CONSENSUS='0' in Render env AND those four lanes together. The lead merges it only
after the guardrail PR (claude/default-on-guardrails). Evidence and the open breaking-height bias: the log.
"""
import math
import os
from typing import Callable, Optional

FLAG = "SURF_BIGHT_HS_CONSENSUS"
POLYGON_VERSION = "r4-2026-11-03"
# (lat, lng) from north to south — round 4's BIGHT_LINE, verbatim. Never tune it on an evaluation window.
BIGHT_LINE = ((34.45, -120.47), (34.03, -120.37), (33.25, -119.50), (32.82, -118.35), (31.75, -116.75))
BIGHT_BBOX = (31.75, 34.6, -120.6, -116.5)        # (south, north, west, east)


WEIGHT_FLAG = "SURF_BIGHT_HS_EURO_WEIGHT"
EQUAL_WEIGHT = 0.5


def euro_weight() -> float:
    """SURF_BIGHT_HS_EURO_WEIGHT (DARK arm option, default "0.5" = the equal mean, byte-identical): EURO's weight w in
    Hs = (1 - w) Hs_GFS + w Hs_EURO inside the polygon, read at call time and only while SURF_BIGHT_HS_CONSENSUS is on.
    WHY (research round 6, 2026-11-04, offline, HIGH): Jason-3's in-situ offset is ~0 at <= 10-15 km collocation, so
    inside the Bight GFS reads -0.327 m, EURO +0.068 and the equal mean still -0.129 (October buoys -0.319 / +0.054 /
    -0.133): EURO is the least-biased offshore Hs. A EURO-weighted mean raises the breaking height further, whose bias
    already flips -0.077 -> +0.140 under the equal mean, so it is scored ONLY jointly with a breaker re-calibration
    (log 2026-11-03-claude-bight-hs-consensus.md, section 9). A value outside [0, 1] or unparsable reads 0.5."""
    raw = os.environ.get("SURF_BIGHT_HS_EURO_WEIGHT", "0.5")      # literal: the lane-parity scan reads it
    try:
        w = float(raw)
    except (TypeError, ValueError):
        return EQUAL_WEIGHT
    return w if math.isfinite(w) and 0.0 <= w <= 1.0 else EQUAL_WEIGHT


def enabled() -> bool:
    """On when the guarded flag is effectively "1" (code default; the guardrail or env "0" kills it), and never for the
    ledger's raw baseline (consensus_serve.serve_raw)."""
    from services import runtime_flags as _rf     # D-065: guarded (env > runtime manifest > code default '1')
    if not _rf.on("SURF_BIGHT_HS_CONSENSUS"):
        return False
    from services.weather_pipeline.consensus_serve import raw_requested
    return not raw_requested()


def inside_bight(lat: float, lng: float) -> bool:
    """True when (lat, lng) lies inside the frozen Bight polygon (module docstring). PURE."""
    south, north, west, east = BIGHT_BBOX
    if not (south <= lat <= north and west <= lng <= east):
        return False
    for (la0, lo0), (la1, lo1) in zip(BIGHT_LINE, BIGHT_LINE[1:]):
        if min(la0, la1) <= lat <= max(la0, la1):
            lo = lo0 + (lat - la0) / (la1 - la0) * (lo1 - lo0)
            return lng > lo
    return lat > BIGHT_LINE[0][0] and lng > BIGHT_LINE[0][1]


def touches_bight(product) -> bool:
    """Whether a frame's grid bounds overlap the Bight bbox (the cheap pre-check). PURE."""
    grid = getattr(product, "grid", None)
    b = getattr(grid, "bounds", None)
    if b is None or not grid.vectors:
        return False
    south, north, west, east = BIGHT_BBOX
    return b.south <= north and b.north >= south and b.west <= east and b.east >= west


def bight_cells(product) -> list:
    """Indices of the frame's vectors inside the polygon (validity is judged later, by the sampler). PURE."""
    if not touches_bight(product):
        return []
    return [i for i, v in enumerate(product.grid.vectors) if inside_bight(v.lat, v.lng)]


def euro_chooser(manifest, valid_time, load: Callable, cache: dict) -> Callable:
    """(lat, lng) -> the AUTHORITATIVE EURO marine waves product the point resolver answers that cell from, or None.
    The resolver's own selection (point_candidates + choose_for_point) with the estimated list emptied; each file is
    loaded once per `cache`."""
    from services.weather_pipeline.manifest_point_selection import choose_for_point, point_candidates
    authoritative, _estimated = point_candidates(manifest, "EURO", "marine", "waves", valid_time)
    candidates = (authoritative, [])

    def choose(lat, lng):
        item = choose_for_point(candidates, lat, lng)
        if item is None:
            return None
        if item.filename not in cache:
            cache[item.filename] = load(item.filename)
        return cache[item.filename]

    def pick(lat, lng):
        """(filename, run_time) of the item `choose` would load, or None. Filenames are NOT unique per run
        (store_helpers._build_product_filename carries no run), so a cache key must carry the run too."""
        item = choose_for_point(candidates, lat, lng)
        return None if item is None else (item.filename, item.run_time.isoformat() if item.run_time else None)
    choose.pick = pick
    return choose


EURO_OWN_METHODS = frozenset({"exact_match", "bilinear", "bilinear_ocean_masked"})


def euro_hs(sampler, euro, lat: float, lng: float, nodes: dict) -> Optional[float]:
    """EURO's own Hs at (lat, lng), or None (module docstring: own wet nodes only). `nodes` memoizes, per EURO
    product, {(lat, lng): vector} so an exact match can be checked for validity."""
    pt = sampler.sample_point(euro, lat, lng).point
    if pt is None or pt.interpolation_method not in EURO_OWN_METHODS:
        return None
    if pt.interpolation_method == "exact_match":
        table = nodes.get(id(euro))
        if table is None:
            table = nodes[id(euro)] = {(round(v.lat, 4), round(v.lng, 4)): v for v in euro.grid.vectors}
        node = table.get((round(pt.sampled_lat, 4), round(pt.sampled_lng, 4)))
        if node is None or not sampler._is_vector_valid(node, euro.domain, euro.layer):
            return None
    try:
        hs = float(pt.speed)
    except (TypeError, ValueError):
        return None
    return hs if math.isfinite(hs) and hs >= 0 else None


def _ratio_quantiles(ratios):
    if not ratios:
        return None
    r = sorted(ratios)
    return {"p10": round(r[len(r) // 10], 3), "median": round(r[len(r) // 2], 3),
            "p90": round(r[min(len(r) - 1, 9 * len(r) // 10)], 3)}


def compose(gfs, choose_euro: Callable, cells: Optional[list] = None, sampler=None):
    """The served frame: `gfs` with the GFS+EURO mean Hs at every valid ocean cell inside the polygon where EURO
    answers, as a NEW product sharing every untouched vector object with `gfs` (never mutated). None when no cell
    blended (the caller then serves `gfs` itself). `cells`: precomputed `bight_cells(gfs)`. PURE given a pure
    chooser."""
    from services.weather_pipeline.sampler import PointSampler
    if gfs is None or gfs.grid is None or (gfs.model or "").upper() != "GFS" or (gfs.layer or "") != "waves":
        return None
    idx = bight_cells(gfs) if cells is None else cells
    if not idx:
        return None
    sampler = sampler or PointSampler(memoize=True)
    vectors = list(gfs.grid.vectors)
    counts = {"inside": len(idx), "blended": 0, "not_ocean": 0, "gfs_zero": 0, "euro_missing": 0}
    sources, offsets, ratios, nodes = {}, 0, [], {}
    w = euro_weight()
    for i in idx:
        vec = vectors[i]
        if not sampler._is_vector_valid(vec, gfs.domain, gfs.layer):
            counts["not_ocean"] += 1
            continue
        hs_g = math.hypot(vec.u, vec.v)
        if not hs_g > 0:
            counts["gfs_zero"] += 1
            continue
        euro = choose_euro(vec.lat, vec.lng)
        hs_e = None
        if euro is not None and (euro.model or "").upper() == "EURO" and euro.value_unit == gfs.value_unit \
                and not euro.is_estimated and (euro.layer or "") == "waves" and euro.grid is not None:
            hs_e = euro_hs(sampler, euro, vec.lat, vec.lng, nodes)
        if hs_e is None:
            counts["euro_missing"] += 1
            continue
        mean = 0.5 * (hs_g + hs_e) if w == EQUAL_WEIGHT else (1.0 - w) * hs_g + w * hs_e
        k = mean / hs_g
        vectors[i] = vec.model_copy(update={"u": round(vec.u * k, 4), "v": round(vec.v * k, 4),
                                            "speed": round(mean, 4)})
        counts["blended"] += 1
        pid = euro.product_id or "?"
        sources[pid] = sources.get(pid, 0) + 1
        offsets += euro.valid_time != gfs.valid_time
        ratios.append(k)
    if counts["blended"] == 0:
        return None
    diagnostics = dict(gfs.grid.diagnostics or {})
    diagnostics["bight_hs_consensus"] = {
        "flag": FLAG, "polygon": POLYGON_VERSION, "method": "mean(GFS, EURO) Hs; GFS period and direction",
        "cells": counts, "euro_sources": sources, "euro_frame_offset_cells": offsets,
        "mean_over_gfs": _ratio_quantiles(ratios)}
    if w != EQUAL_WEIGHT:            # metadata changes only with the arm: at 0.5 the diagnostics are byte-identical
        diagnostics["bight_hs_consensus"]["euro_weight"] = w
        diagnostics["bight_hs_consensus"]["method"] = f"({1.0 - w:g} GFS + {w:g} EURO) Hs; GFS period and direction"
    grid = gfs.grid.model_copy(update={"vectors": vectors, "diagnostics": diagnostics})
    return gfs.model_copy(update={"grid": grid})
