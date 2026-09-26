"""Which COMPOSITION term makes the rating band disagree with the glyph? (Queue E#1, 2026-09-26)

The band (grid_resolver_surf -> surf_rating.rating_transform_grid) and the glyph (spot_ratings.rate_one_spot)
compose a rating from the same offshore sea differently:

  height        band: surf_transform.estimate_surf(sp, T, shelf_depth_at, shelf_width_km)
                glyph: surf_point.estimate_surf_at(lat, lng, sp, T, swell_from, geometry)
  shore normal  band: bathymetry.shore_normal_at      glyph: geometry.shore_normal_deg
  break depth   band: not passed (deliberately)        glyph: geometry.break_depth_m

This holds the DATA identical (same offshore Hs, period, swell bearing, wind) and swaps ONE composition term
at a time, at real spot coordinates, so each term's share of the band-vs-glyph gap is measured rather than
argued. It cannot see the DATA terms (cell vs point offshore sampling, the wind sampler, the tier chosen by
zoom): scripts/band_glyph_lane_sweep.py measures those end to end against production.

Run from backend/:  python scripts/band_glyph_attribution.py <spots.json>   (spots.json = GET /api/surf-spots)
"""
import json
import random
import statistics
import sys

sys.path.insert(0, ".")
from services.weather_pipeline.bathymetry import shelf_depth_at, shelf_width_km, shore_normal_at  # noqa: E402
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry  # noqa: E402
from services.weather_pipeline.surf_rating import compute_surf_rating  # noqa: E402
from services.weather_pipeline.surf_transform import estimate_surf  # noqa: E402

SCENARIOS = [(hs, tp, off) for hs in (1.0, 1.8, 3.0) for tp in (9.0, 13.0) for off in (0.0, 35.0)]
WIND_MS = 3.0   # light, blowing from land: the case where shore-normal errors matter most


def rate(h, tp, wind_from, sn, swell_from, break_depth=None):
    s, _ = compute_surf_rating(h, tp, WIND_MS, wind_from_deg=wind_from, shore_normal_deg=sn,
                               swell_from_deg=swell_from, break_depth_m=break_depth)
    return s


def main(path, n=60, seed=26):
    d = json.load(open(path, encoding="utf-8"))
    spots = [s for s in (d if isinstance(d, list) else d.get("spots", []))
             if s.get("latitude") is not None and s.get("longitude") is not None]
    random.seed(seed)
    sample = random.sample(spots, min(n, len(spots)))
    rows = []
    for sp in sample:
        lat, lng = float(sp["latitude"]), float(sp["longitude"])
        geo = resolve_surf_geometry(lat, lng)
        sn_g = getattr(geo, "shore_normal_deg", None)
        if sn_g is None:
            continue
        sn_b = shore_normal_at(lat, lng)
        depth, width = shelf_depth_at(lat, lng), shelf_width_km(lat, lng) or 0.0
        bd = getattr(geo, "break_depth_m", None)
        for hs, tp, off in SCENARIOS:
            swell_from = (sn_g + off) % 360
            wind_from = (sn_g + 180.0) % 360
            h_g, _ = estimate_surf_at(lat, lng, hs, tp, swell_from_deg=swell_from, geometry=geo)
            h_b, reg_b = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
            if h_g is None or h_b is None or reg_b in ("open_ocean", "calm", "unknown"):
                continue
            s_g = rate(h_g, tp, wind_from, sn_g, swell_from, bd)
            s_b = rate(h_b, tp, wind_from, sn_b, swell_from, None)
            if s_g is None or s_b is None:
                continue
            rows.append({
                "gap": s_g - s_b, "h_ratio": h_g / h_b if h_b else None,
                "sn_diff": min(abs(sn_g - sn_b) % 360, 360 - abs(sn_g - sn_b) % 360) if sn_b is not None else None,
                # one term swapped in from the glyph lane; what is left of the gap
                "left_height": s_g - rate(h_g, tp, wind_from, sn_b, swell_from, None),
                "left_normal": s_g - rate(h_b, tp, wind_from, sn_g, swell_from, None),
                "left_depth": s_g - rate(h_b, tp, wind_from, sn_b, swell_from, bd),
            })

    def med_abs(k):
        v = sorted(abs(r[k]) for r in rows if r[k] is not None)
        return {"p50": round(statistics.median(v), 2), "p90": round(v[int(0.9 * len(v))], 2),
                "share_over_10pts": round(sum(1 for x in v if x > 10) / len(v), 3)} if v else None
    base = med_abs("gap")
    out = {
        "cases": len(rows), "spots": len({id(x) for x in sample}),
        "abs_gap_points": base,
        "height_ratio_glyph_over_band": {
            "p10": round(sorted(r["h_ratio"] for r in rows if r["h_ratio"])[int(0.1 * len(rows))], 2),
            "p50": round(statistics.median(r["h_ratio"] for r in rows if r["h_ratio"]), 2),
            "p90": round(sorted(r["h_ratio"] for r in rows if r["h_ratio"])[int(0.9 * len(rows))], 2)},
        "median_shore_normal_diff_deg": round(statistics.median(r["sn_diff"] for r in rows if r["sn_diff"] is not None), 1),
        "abs_gap_left_after_swapping": {
            "height (estimate_surf -> estimate_surf_at)": med_abs("left_height"),
            "shore normal (shore_normal_at -> geometry)": med_abs("left_normal"),
            "break depth (none -> geometry)": med_abs("left_depth"),
        },
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "spots.json")
