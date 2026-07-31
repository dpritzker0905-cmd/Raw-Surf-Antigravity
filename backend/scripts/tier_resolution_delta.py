"""What does the COARSE tier cost on the height chain? -- the horizon/coverage decision instrument.

TWO QUESTIONS IT ANSWERS, both measured at the SERVE path rather than reasoned about:

 1. COVERAGE (the silent one). A region whose 0.25 deg tile is missing or past its horizon falls
    through to a coarser tier -- and degrades SILENTLY. Measured 2026-07-31: uk_ireland was served
    gfs_marine_waves_GLOBAL_MID, and east_australia had no tile at all and answered
    `source: backend_direct_point` with run_time stamped at REQUEST time, i.e. a LIVE per-request
    upstream fetch. This script names which tier actually served each region.

 2. MAGNITUDE. Same coordinate, same valid_time, same model, same run -- only the product tier
    differs (forced via grid_product_id), so the delta is RESOLUTION, not forecast drift.
    Measured 2026-08-01T00:00Z across 8 regions holding both tiers:
        BREAKING |delta|  median 21.0%  max 41.7%   (worst florida/Cocoa 0.518 -> 0.302 m)
        OFFSHORE |delta|  median 24.0%  max 74.4%
    Signed BOTH ways, so no constant corrects it -- consistent with the Cape Canaveral precedent
    (10 deg coarse read 2.7 ft vs the truer 1.9 ft).

WHY IT MATTERS FOR THE HORIZON. The worldwide pilot horizon is short (GFS_MARINE_FORECAST_DAYS),
so worldwide regions get 0.25 deg only inside it and the coarse tier past it. Resolution error is
SYSTEMATIC (a geometry/bathymetry effect) and therefore does NOT shrink with lead time, while
forecast error grows. Whether closing a systematic 21% bias is worth its product-count cost at
day 4+ depends on per-lead forecast SKILL -- which `services/weather_pipeline/forecast_skill.py`
already scores against NDBC buoys into L2 (calibration/skill/scored-*) but does not expose. Get
that number before spending the horizon; do not reason about it.

Reports BREAKING height (surf_height_m -- the headline, per CLAUDE.md) first and OFFSHORE
significant height (point.speed) second. They are different quantities; never conflate them.

Usage:
  python scripts/tier_resolution_delta.py
  python scripts/tier_resolution_delta.py --base http://localhost:8000
  python scripts/tier_resolution_delta.py --model ICON --coarse-region global_coarse

Credential-free, read-only. ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import statistics
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
LATTICE_H = 3

# One representative coastal coordinate per pilot region.
SITES = {
    "hawaii": (21.665, -158.052),
    "iberia_west": (43.40, -8.40),
    "uk_ireland": (50.40, -5.10),
    "east_australia": (-33.89, 151.27),
    "indonesia": (-8.80, 115.10),
    "brazil_east": (-8.10, -34.90),
    "south_africa": (-34.10, 18.40),
    "mexico_centralamerica_pac": (20.50, -105.30),
    "florida_east_coast": (28.32, -80.607),
    "us_west_coast_socal": (33.65, -118.00),
}


def lattice_slot(now, ahead=1):
    """Both tiers only carry products ON the 3-hourly UTC lattice. Off-lattice times snap to a
    NEIGHBOURING slot, and the two tiers can snap differently -- which silently turns a resolution
    comparison into a time comparison. (Cost me one run: 23:00Z fine snapped to 00:00Z, coarse
    stayed at 23:00Z, and every row came back incomparable.)"""
    h = ((now.hour // LATTICE_H) + ahead) * LATTICE_H
    return now.replace(minute=0, second=0, microsecond=0, hour=0) + timedelta(hours=h)


def get_point(base, model, lat, lng, vt, pid=None, timeout=90):
    u = (f"{base}/api/weather/point?model={model}&domain=marine&layer=waves"
         f"&lat={lat}&lng={lng}&valid_time={vt}")
    if pid:
        u += f"&grid_product_id={pid}"
    req = urllib.request.Request(u, headers={"User-Agent": "tier-resolution-delta"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def tier_of(region, product_id, source):
    pid = str(product_id or "")
    if not pid:
        return "LIVE-FETCH" if source == "backend_direct_point" else "none"
    if region in pid:
        return "own 0.25"
    if "global_mid" in pid:
        return "global_mid"
    if "global" in pid:
        return "global_coarse"
    return "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--model", default="GFS", choices=("GFS", "ICON", "EURO"))
    ap.add_argument("--coarse-region", default="global_mid",
                    choices=("global_mid", "global_coarse"))
    ap.add_argument("--pace", type=float, default=0.7,
                    help="seconds between requests (the serve box has a three-incident melt history)")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    vt_dt = lattice_slot(now)
    vt = vt_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    coarse_pid = (f"{args.model.lower()}_marine_waves_{args.coarse_region}_"
                  f"{vt_dt.strftime('%Y%m%dT%H0000Z')}.json")

    print(f"{args.model} marine waves @ {vt}   coarse tier = {coarse_pid}\n")
    print(f"{'region':26s} {'served tier':13s} {'BREAKING m':>21s}  {'OFFSHORE Hs m':>21s}")
    print(f"{'':26s} {'':13s} {'fine':>6s} {'coarse':>6s} {'d%':>6s}  "
          f"{'fine':>6s} {'coarse':>6s} {'d%':>6s}")

    rows, fellthrough = [], []
    for region, (lat, lng) in SITES.items():
        try:
            f = get_point(args.base, args.model, lat, lng, vt)
            time.sleep(args.pace)
            c = get_point(args.base, args.model, lat, lng, vt, coarse_pid)
            time.sleep(args.pace)
        except Exception as e:
            print(f"{region:26s} ERROR {type(e).__name__}: {e}")
            continue

        served = tier_of(region, f.get("product_id"), f.get("source"))
        if served != "own 0.25":
            fellthrough.append((region, served))

        fb, cb = f.get("surf_height_m"), c.get("surf_height_m")
        fo = (f.get("point") or {}).get("speed")
        co = (c.get("point") or {}).get("speed")
        if None in (fb, cb, fo, co) or not fb or not fo:
            print(f"{region:26s} {served:13s} incomplete (fine_pid={f.get('product_id')})")
            continue
        db = (cb - fb) / fb * 100.0
        do = (co - fo) / fo * 100.0
        # A region already falling through has no FINE side: its "fine" call returned the coarse
        # product (or a live fetch), so its delta is degenerate — uk_ireland measured +0.0% purely
        # because both calls resolved to the SAME global_mid file. Including those rows dilutes the
        # exact statistic that quantifies why the tile matters, so they are reported but not scored.
        rows.append((region, fb, cb, db, fo, co, do, served == "own 0.25"))
        print(f"{region:26s} {served:13s} {fb:6.3f} {cb:6.3f} {db:+5.1f}%  "
              f"{fo:6.3f} {co:6.3f} {do:+5.1f}%")

    scored = [r for r in rows if r[7]]
    if not scored:
        # REFUSE rather than report a confident nothing: with no region holding BOTH tiers there is
        # no comparison to make, and a "0% difference" here would be an artifact of missing tiles.
        print(f"\nREFUSING TO REPORT: {len(rows)} region(s) answered but NONE was served by its own "
              "0.25 deg tile -- every 'fine' value IS the coarse one. Cannot distinguish "
              "'no difference' from 'no fine tier'.")
        sys.exit(2)

    ab = [abs(r[3]) for r in scored]
    ao = [abs(r[6]) for r in scored]
    worst = max(scored, key=lambda r: abs(r[3]))
    print(f"\nn={len(scored)} scored (of {len(rows)} answered)   "
          f"BREAKING |delta| median {statistics.median(ab):.1f}%  max {max(ab):.1f}%"
          f"   OFFSHORE |delta| median {statistics.median(ao):.1f}%  max {max(ao):.1f}%")
    print(f"worst breaking: {worst[0]} {worst[1]:.3f} -> {worst[2]:.3f} m ({worst[3]:+.1f}%)")
    signs = {"+" if r[3] > 0 else "-" for r in scored}
    if len(signs) > 1:
        print("delta is signed BOTH ways -- no constant corrects it; only the resolution can.")
    if len(scored) < len(rows):
        skipped = [r[0] for r in rows if not r[7]]
        print(f"excluded from the statistic (no fine tier to compare): {', '.join(skipped)}")

    if fellthrough:
        print(f"\n{len(fellthrough)} region(s) NOT served by their own 0.25 deg tile:")
        for region, served in fellthrough:
            note = "  <-- LIVE per-request upstream fetch" if served == "LIVE-FETCH" else ""
            print(f"    {region:26s} served by {served}{note}")
    else:
        print("\nEvery region served by its own 0.25 deg tile.")


if __name__ == "__main__":
    main()
