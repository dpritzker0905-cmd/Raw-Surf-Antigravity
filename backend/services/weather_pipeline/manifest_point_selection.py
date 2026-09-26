"""manifest_point_selection.py — which scheduled product answers a coordinate. ONE definition.

The point resolver's manifest pick lived in two verbatim copies (`_resolve_point_internal` step 2b and
`find_cached_grid_product`), and the rating band's wind sampler had a THIRD that was not a copy at all:
`grid_resolver_surf._build_wind_sampler` took `min(products, key=time)` over EVERY wind product of the
model, with no coverage test and no island gate.

★ WHAT THAT COST (measured 2026-09-26, production, 21Z). Each model carries 16 wind products per hour —
14 regional 0.25° tiles, `global_mid` (2°) and `global_coarse` (10°) — and all 16 tie on time, so the
manifest's ORDER chose the band's wind for the whole planet: `global_mid` for GFS and EURO, and the
**Florida tile for ICON**, whose nearest vector to a Portuguese or Californian cell is the Florida
grid's edge. The glyph's wind point, meanwhile, came from the finest product COVERING the spot. Served
ICON band cells in Florida reproduced EXACTLY from ICON's local wind (16.1, 18.2) and in Portugal and
SoCal from no local wind at all — the owner's "the ICON band colour does not match the glyphs".

So the band's wind now comes from the product the point resolver would answer that CELL from, and all
three sites share this module: the candidate set is built once (`point_candidates`) and resolved per
coordinate (`choose_for_point`), which is what lets a 15,000-cell frame pay the scan once.
"""
import os
from datetime import timezone

MAX_TIME_DIFF_S = 3 * 3600     # a product more than 3 h from the requested hour never answers
EST_PREFERENCE_S = 1800        # an estimated product within 30 min beats an authoritative one beyond it


def selection_key(pair):
    """Candidate ranking for the point resolver's manifest selection, ONE definition for every site.
    ⭐ RESOLUTION BREAKS TIME TIES (2026-08-09, MASTER-AUDIT-11.0 resolution F7): the old key was
    (time_diff, bbox_area), and two GLOBAL products at the same hour tie on BOTH terms — manifest order
    decided, so a 10° product could answer a point a 2° product covered. 55.22% of served spots depend
    on a global tier, and this tie-break is the gate the audit put in front of any 0.25° coverage
    expansion. Finer resolution wins within a time tie; area stays the final term.
    Kill: POINT_RES_TIEBREAK=0 restores (diff, area) exactly."""
    from services.weather_pipeline.product_selection import get_bbox_area
    p, diff = pair
    area = get_bbox_area(p.coverage.west, p.coverage.south, p.coverage.east, p.coverage.north)
    if os.environ.get("POINT_RES_TIEBREAK", "1") != "0":
        from services.weather_pipeline.selection_identity import selection_identity
        return (diff, float(p.resolution), area, *selection_identity(p))
    return (diff, area)


def point_candidates(manifest, model, domain, layer, target_dt):
    """PURE: (authoritative, estimated) — every product of the lane within MAX_TIME_DIFF_S of
    `target_dt` that the island gate lets serve, as (product, time_diff_s, actual_bounds), each list
    SORTED by `selection_key`. Containment is left to `choose_for_point`, so one candidate set can
    answer every cell of a grid."""
    from services.weather_pipeline.island_gate import is_island_gated
    from services.weather_pipeline.manifest_view import products_for
    from services.weather_pipeline.route_helpers import get_actual_grid_bounds
    t2 = target_dt.replace(tzinfo=timezone.utc) if target_dt.tzinfo is None else target_dt
    authoritative, estimated = [], []
    for p in products_for(manifest, model, domain, layer):
        if is_island_gated(p):
            continue
        t1 = p.valid_time_start.replace(tzinfo=timezone.utc) if p.valid_time_start.tzinfo is None else p.valid_time_start
        diff = abs(t1.timestamp() - t2.timestamp())
        if diff > MAX_TIME_DIFF_S:
            continue
        entry = (p, diff, get_actual_grid_bounds(p.coverage, p.resolution))
        (estimated if getattr(p, "is_estimated", False) else authoritative).append(entry)
    # A STABLE sort, so the first CONTAINING entry below is exactly `min(containing, key=...)`,
    # manifest order included on a full tie — the behaviour of the two loops this replaced.
    authoritative.sort(key=lambda e: selection_key((e[0], e[1])))
    estimated.sort(key=lambda e: selection_key((e[0], e[1])))
    return authoritative, estimated


def choose_for_point(candidates, lat, lng):
    """The manifest product the point resolver answers (lat, lng) from, or None."""
    from services.weather_pipeline.route_helpers import is_inside_bounds
    authoritative, estimated = candidates
    best_auth = next(((p, d) for p, d, cov in authoritative
                      if is_inside_bounds(lat, lng, cov, margin=0.0001)), None)
    best_est = next(((p, d) for p, d, cov in estimated
                     if is_inside_bounds(lat, lng, cov, margin=0.0001)), None)
    if best_auth and best_est:
        return best_est[0] if (best_est[1] <= EST_PREFERENCE_S and best_auth[1] > EST_PREFERENCE_S) else best_auth[0]
    if best_auth:
        return best_auth[0]
    return best_est[0] if best_est else None
