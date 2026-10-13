"""Queue E#1 — dump the BAND's per-cell composition beside the GLYPH's, input by input.

WHY THIS EXISTS. The band/glyph colour disagreement has been open since 2026-08-09 with a measured
magnitude (band reads 2.3-2.8x ABOVE the glyph, confirmed across GFS/ICON/EURO on 2026-09-21 and
visually confirmed by the owner: "band showing more good colour, glyphs nearby green/fair"). Its
memory record ends with one blocking sentence:

    "The exact binding sub-term is NOT yet isolated (needs a per-cell geometry dump beside the
     score) -- do not tune either lane until it is."

This is that dump. It does not fix anything and must not be used to tune anything. It answers one
question: WHICH INPUT DIFFERS between the two lanes at the same place and hour.

## What the two lanes actually compose

Both run the ONE FORECAST COMPOSITION chain -- `resolve_surf_geometry` + `estimate_surf_at`, then
`surf_rating.compute_surf_rating`. They differ in WHERE they sample it:

    GLYPH : the SPOT's coordinate      -> the spot's own resolved geometry
    BAND  : each GRID CELL's centre    -> that cell's geometry, wind co-sampled at the cell

So every geometric field is a candidate for the binding sub-term, and the honest way to find it is
to resolve BOTH coordinates through the SAME function and diff the results field by field.

## What is already eliminated -- do not re-test these

  * input height           (+3% while scores differ 2.4x)
  * distance-to-spot       (the wide cell is 3-7x FURTHER and agrees BETTER)
  * the local-size flag    (on at both tiers)
  * the reference-population gap  (REFUTED BY SIGN: a larger reference scores LOWER, so the 46%
                                   gap predicts the band reading LOW -- it is a COUNTERACTING term)
  * anything model-dependent      (2026-09-21: the gap is 2.68x GFS / 2.81x ICON / 1.95x EURO)

⭐ THE SIGN TEST IS THE CHEAP FILTER. Any candidate that predicts the band reading LOW is refuted,
not "partial" -- the observed band reads HIGH. Check the direction of a term before its magnitude.

## Usage

    python scripts/band_glyph_cell_dump.py --spot "Sebastian Inlet" --model ICON

Resolves geometry locally (bathymetry + the shore-normal asset are on-disk, no DB needed) and
fetches the served band grid from the API to find which cell the user is actually looking at.
"""
import argparse
import json
import math
import os
import sys
import urllib.request
import datetime as dt

# Running `python scripts/x.py` puts scripts/ on sys.path, not the backend root, so the production
# chain this dump exists to replay would not import. Added explicitly rather than requiring a
# particular cwd: an instrument that only works from one directory gets run from another and
# reports an import error as if it were a finding.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "https://raw-surf-antigravity.onrender.com"

SPOTS = {
    "Sebastian Inlet": (27.8608, -80.4464),
    "Pipeline": (21.6650, -158.0533),
    "Mavericks": (37.4956, -122.5011),
}

# Every field `resolve_surf_geometry` returns. Listed explicitly rather than discovered, so a field
# ADDED upstream shows up as a KeyError here instead of silently dropping out of the comparison --
# a new geometric input is exactly the kind of thing this dump exists to notice.
GEOMETRY_FIELDS = [
    "depth_m", "break_depth_m", "coastal", "nearshore", "shelf_width_km",
    "shore_normal_deg", "shore_normal_src", "shore_normal_match_km",
    "magnet_factor", "magnet_name",
]


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "e1-cell-dump/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def vt_now():
    t = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    return t.strftime("%Y-%m-%dT%H:00:00Z")


def geom_dict(lat, lng):
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    g = resolve_surf_geometry(lat, lng)
    return {f: getattr(g, f, None) for f in GEOMETRY_FIELDS}


def nearest_rated_cell(vectors, lat, lng):
    """The cell the USER sees at this spot: the nearest one carrying a non-zero rating.

    ⚠️ NOT simply the nearest cell. The nearest is usually open ocean and masked to 0, so diffing
    against it would compare the spot to a cell that paints nothing -- the wrong comparison, and an
    easy one to make without noticing.
    """
    best, bd = None, None
    for v in vectors:
        if (v.get("speed") or 0) <= 0.001:
            continue
        d = (v.get("lat", 0) - lat) ** 2 + (v.get("lng", 0) - lng) ** 2
        if bd is None or d < bd:
            bd, best = d, v
    return best, (math.sqrt(bd) if bd is not None else None)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spot", default="Sebastian Inlet", choices=sorted(SPOTS))
    ap.add_argument("--model", default="GFS")
    ap.add_argument("--half-width", type=float, default=0.08,
                    help="bbox half-width in degrees (default 0.08 = the close zoom in question)")
    args = ap.parse_args()

    lat, lng = SPOTS[args.spot]
    vt = vt_now()
    hw = args.half_width
    bbox = f"{lng-hw:.4f},{lat-hw:.4f},{lng+hw:.4f},{lat+hw:.4f}"

    print(f"QUEUE E#1 - per-cell composition dump")
    print(f"spot={args.spot} ({lat}, {lng})  model={args.model}  valid_time={vt}  half-width={hw}")
    print("=" * 100)

    d = get(f"{API}/api/weather/grid?model={args.model}&domain=marine&layer=waves"
            f"&valid_time={vt}&bbox={bbox}&surf=1")
    g = d.get("grid") or {}
    diag = (g.get("diagnostics") or {}).get("surf_transform") or {}
    kind = diag.get("value_kind") or d.get("value_kind")
    if kind != "surf_rating":
        # REFUSE rather than dump a comparison of two things that are not both ratings.
        print(f"  REFUSING: the served grid is '{kind}', not 'surf_rating'. Nothing to compare.")
        return
    cell, dist = nearest_rated_cell(g.get("vectors") or [], lat, lng)
    if cell is None:
        print("  REFUSING: no RATED cell in the served grid — the band paints nothing here.")
        return

    clat, clng = cell.get("lat"), cell.get("lng")
    band_score = round((cell.get("speed") or 0) * 10, 1)
    print(f"\nBAND cell  ({clat:.4f}, {clng:.4f})   {dist:.4f} deg from the spot   score={band_score}")

    glyph = None
    gb = f"{lng-0.6:.4f},{lat-0.6:.4f},{lng+0.6:.4f},{lat+0.6:.4f}"
    try:
        sr = get(f"{API}/api/weather/spot-ratings?bbox={gb}&valid_time={vt}&limit=40")
        cands = [s for s in (sr.get("spots") or [])
                 if args.spot.split()[0].lower() in (s.get("name") or "").lower()]
        glyph = cands[0] if cands else None
    except Exception as e:
        print(f"  glyph lane FAILED: {type(e).__name__}: {e}")
    if glyph:
        print(f"GLYPH      {glyph.get('name')}   score={glyph.get('score')} "
              f"level={glyph.get('level')} ref={glyph.get('reference_size_m')} "
              f"h_m={glyph.get('surf_height_m')}")
        if band_score and glyph.get("score"):
            print(f"           ratio band/glyph = {band_score / max(glyph['score'], 1e-9):.2f}x")

    # ── THE COMPARISON THIS SCRIPT EXISTS FOR ────────────────────────────────────────────────
    print("\n" + "=" * 100)
    print("GEOMETRY, resolved through the SAME function at both coordinates")
    print("=" * 100)
    gs = geom_dict(lat, lng)
    gc = geom_dict(clat, clng)
    print(f"  {'field':24s} {'GLYPH (spot)':>28s} {'BAND (cell)':>28s}   differs")
    for f in GEOMETRY_FIELDS:
        a, b = gs.get(f), gc.get(f)
        same = (a == b)
        mark = "" if same else "  <-- DIFFERS"
        print(f"  {f:24s} {str(a)[:28]:>28s} {str(b)[:28]:>28s}{mark}")

    diffs = [f for f in GEOMETRY_FIELDS if gs.get(f) != gc.get(f)]
    print("\n" + "=" * 100)
    if not diffs:
        # A null result is a RESULT, and stating it plainly is the point: it would mean the binding
        # sub-term is NOT geometry, and the next search must move to the wind co-sampling.
        print("  NO geometric field differs. => the binding sub-term is NOT geometry at this spot;")
        print("     the remaining candidate is the WIND co-sampled at the cell vs at the spot.")
    else:
        print(f"  {len(diffs)} geometric field(s) differ: {', '.join(diffs)}")
        print("  * NEXT: for each, check the SIGN - does it push the band's score UP? A term that")
        print("     predicts the band reading LOW is refuted, not partial. The band reads HIGH.")
    print("=" * 100)
    print("\nNOTE: This dump ISOLATES inputs. It does not authorise tuning either lane.")


if __name__ == "__main__":
    main()
