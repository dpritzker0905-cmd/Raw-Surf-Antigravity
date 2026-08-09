"""Measure the BAND lane vs the GLYPH lane at the same coordinate, across zoom (bbox size).

The band's rating comes from grid_resolver_surf -> rating_transform_grid with
reference_fn = grid_size_climatology.reference_for(lat,lng)  [GRIDDED blob]
The glyph's rating comes from spot_ratings                    [PER-SPOT blob]

Owner report 2026-08-09: band and glyph colours disagree at CLOSE zoom, agree at wider
zooms that still paint the band. This sweeps bbox size at a fixed centre and reports,
for each: the served grid geometry, the rating diagnostics, the band cell value nearest
the spot, and the glyph score for the same spot.
"""
import json
import math
import sys
import urllib.request
import datetime as dt

API = "https://raw-surf-antigravity.onrender.com"
SPOTS = [
    ("Pipeline", 21.6650, -158.0533),
    ("Sebastian Inlet", 27.8608, -80.4464),
    ("Mavericks", 37.4956, -122.5011),
]
HALF_WIDTHS = [0.08, 0.15, 0.3, 0.6, 1.2, 2.5, 5.0, 10.0]


def get(url, timeout=100):
    req = urllib.request.Request(url, headers={"User-Agent": "lane-sweep/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def vt_now():
    t = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    return t.strftime("%Y-%m-%dT%H:00:00Z")


def nearest_cell(vectors, lat, lng):
    best, bd = None, None
    for v in vectors:
        try:
            d = (float(v["lat"]) - lat) ** 2 + (float(v["lng"]) - lng) ** 2
        except (TypeError, ValueError, KeyError):
            continue
        if bd is None or d < bd:
            bd, best = d, v
    return best, (math.sqrt(bd) if bd is not None else None)


def main():
    vt = vt_now()
    print(f"valid_time={vt}\n")
    for name, lat, lng in SPOTS:
        print("=" * 104)
        print(f"{name}  ({lat}, {lng})")
        print("=" * 104)
        # --- GLYPH LANE: one wide query, the spot's own rating (bbox only selects which spots) ---
        glyph = None
        try:
            gb = f"{lng-0.6:.4f},{lat-0.6:.4f},{lng+0.6:.4f},{lat+0.6:.4f}"
            d = get(f"{API}/api/weather/spot-ratings?bbox={gb}&valid_time={vt}&limit=40")
            for s in (d.get("spots") or []):
                if s.get("name") and name.split()[0].lower() in s["name"].lower():
                    glyph = s
                    break
            if glyph is None and (d.get("spots") or []):
                glyph = min(d["spots"], key=lambda s: (s.get("latitude", 0) - lat) ** 2
                            + (s.get("longitude", 0) - lng) ** 2)
        except Exception as e:
            print(f"  glyph lane FAILED: {type(e).__name__}: {e}")
        if glyph:
            print(f"  GLYPH  {glyph.get('name')}: score={glyph.get('score')} "
                  f"level={glyph.get('level')} ref={glyph.get('reference_size_m')} "
                  f"h_m={glyph.get('surf_height_m')}")
        print()
        print(f"  {'half°':>6} {'cols x rows':>9} {'cell°':>6} {'kind':>12} {'local':>5} "
              f"{'rated':>5} {'masked':>6} {'midres':>6} {'BANDscore':>9} {'dist°':>7}")
        for hw in HALF_WIDTHS:
            bbox = f"{lng-hw:.4f},{lat-hw:.4f},{lng+hw:.4f},{lat+hw:.4f}"
            url = (f"{API}/api/weather/grid?model=GFS&domain=marine&layer=waves"
                   f"&valid_time={vt}&bbox={bbox}&surf=1")
            try:
                d = get(url)
            except Exception as e:
                print(f"  {hw:>6} FAILED {type(e).__name__}: {e}")
                continue
            g = d.get("grid") or {}
            b = g.get("bounds") or {}
            # ⚠️ THE TAG IS NESTED. A first pass read diagnostics.value_kind (absent) and fell back
            # to the product's top-level value_kind, which stays "wave_height" even when the rating
            # overlay ran — so every row read "not rated" while `rated: 42` sat one level down.
            diag = (g.get("diagnostics") or {}).get("surf_transform") or {}
            kind = diag.get("value_kind") or d.get("value_kind")
            cols, rows = g.get("cols"), g.get("rows")
            span = (b.get("east", 0) - b.get("west", 0)) if b else 0
            cell = (span / (cols - 1)) if (cols and cols > 1) else None
            vecs = g.get("vectors") or []
            cellv, dist = nearest_cell(vecs, lat, lng)
            band = None
            if cellv is not None:
                sp = cellv.get("speed")
                # rating overlay stores score/10 in the height channel
                band = round(sp * 10, 1) if (kind == "surf_rating" and sp is not None) else sp
            # The NEAREST cell is usually open ocean (masked to 0). The band a user sees at this
            # spot is the nearest RATED (non-zero) coastal cell — find it and its distance.
            rated_cells = [v for v in vecs if (v.get("speed") or 0) > 0.001]
            rcell, rdist = nearest_cell(rated_cells, lat, lng)
            rband = round((rcell.get("speed") or 0) * 10, 1) if (rcell and kind == "surf_rating") else None
            print(f"  {hw:>6} "
                  + f"{cols}x{rows}".rjust(9)
                  + f"{('%.2f' % cell) if cell else '-':>7}"
                  + f"{str(kind):>13}"
                  + f"{str(diag.get('local_size')):>6}"
                  + f"{str(diag.get('rated')):>6}"
                  + f"{str(diag.get('masked')):>7}"
                  + f"{str(diag.get('mid_res_tier') or (g.get('diagnostics') or {}).get('mid_res_tier')):>7}"
                  + f"{str(rband):>10}"
                  + f"{('%.3f' % rdist) if rdist is not None else '-':>8}")
        print()


if __name__ == "__main__":
    main()
