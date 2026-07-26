#!/usr/bin/env python3
"""
map_spots_to_ndbc_buoys.py — populate surf_spots.noaa_buoy_id from the live NDBC station set.

WHY THIS EXISTS
---------------
`buoy_calibration.run_buoy_calibration()` is the app's only OFFSHORE ground-truth loop: it compares
the ingested model against NOAA buoy observations and writes a bias/MAE report to L2. It is enabled
(BUOY_CALIBRATION=1 in forecast-ingest.yml and precompute.yml) and it runs every cycle — but it
selects spots via `noaa_buoy_id=not.is.null`, and that column was NEVER POPULATED. Verified
2026-07-26: 0 of 1516 spots carry a buoy id, so every cycle logs

    WARNING [buoy-calibration] no buoy-tagged spots from REST — nothing to do.

inside a guarded try/except, and /api/weather/buoy-calibration returns {"available": false}. The
measurement that would tell us how accurate our forecast actually is has never produced a number.
This script is the one-time (re-runnable) fix.

SOURCE
------
https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt — ONE request returns every reporting
station's id, lat, lon and latest obs (incl. WVHT). Preferred over activestations.xml because
activestations has no wave flag: `met="y"` only means it reports meteorology, and most `fixed`
(coastal tower) and `oilrig` stations have no wave sensor at all. Filtering on "is currently
reporting a WVHT" yields the set that can actually calibrate us (~189 of 899 reporting stations).

DISTANCE POLICY
---------------
A buoy is a MODEL-VERIFICATION point, not a proxy for the spot's surf. `--max-km` bounds how far a
spot may reach for one so the pairing stays regionally meaningful; the honest use of the residual is
"is our OFFSHORE model biased in this region", not "this is the surf at this spot". The companion
change resolves the model AT THE BUOY's own coordinates rather than the spot's, so the residual is a
clean model-vs-observation number instead of a model error conflated with the real offshore->nearshore
difference.

USAGE
-----
    python scripts/map_spots_to_ndbc_buoys.py                 # DRY RUN — prints the plan, writes nothing
    python scripts/map_spots_to_ndbc_buoys.py --apply         # writes noaa_buoy_id via PostgREST
    python scripts/map_spots_to_ndbc_buoys.py --max-km 300 --apply

Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY).
"""
import argparse
import math
import os
import sys
from typing import Optional

NDBC_LATEST_OBS_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"

# 100 km chosen from MEASURED coverage against the live spot table (2026-07-26, 189 wave-reporting
# stations vs 1516 active spots, 1-degree cell-centre approximation):
#
#     <=100 km : 410 spots (27.0%) | 49 distinct buoys | median  38 km
#     <=250 km : 514 spots (33.9%) | 53 distinct buoys | median  44 km
#     <=600 km : 608 spots (40.1%) | 58 distinct buoys | median  54 km
#
# Coverage SATURATES near 34-40%: relaxing 100 -> 600 km buys only 9 more buoys while badly degrading
# pairing quality. The ceiling is structural — NDBC is US-centric, so most Indonesian / European /
# Australian spots have no station at any radius, and no threshold fixes that.
#
# That ceiling is fine, because a buoy is a MODEL-VERIFICATION point, not a per-spot surf proxy: the
# offshore model is global, so a systematic Hs/Tp bias measured at 49 well-spread buoys characterises
# the model everywhere, including spots with no buoy of their own. Prefer tight, trustworthy pairings
# over broad, noisy ones. Non-US coverage needs other networks (CDIP, EMODnet, Copernicus in-situ) —
# tracked separately, not solved by widening this radius.
DEFAULT_MAX_KM = 100.0
EARTH_R_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def _num(tok) -> Optional[float]:
    t = (tok or "").strip()
    if not t or t.upper() == "MM":
        return None
    try:
        return float(t)
    except ValueError:
        return None


def parse_latest_obs(text: str) -> list:
    """PURE: -> [{id, lat, lon, wvht_m}] for stations currently reporting a wave height.

    Column order is taken from the '#STN LAT LON ...' header rather than hardcoded, so an NDBC
    format change surfaces as "no wave stations" instead of silently reading the wrong column."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    header = next((ln for ln in lines if ln.startswith("#STN")), None)
    if not header:
        return []
    cols = header.lstrip("#").split()
    try:
        i_stn, i_lat, i_lon, i_wvht = (cols.index("STN"), cols.index("LAT"),
                                       cols.index("LON"), cols.index("WVHT"))
    except ValueError:
        return []
    out = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        t = ln.split()
        if len(t) <= max(i_stn, i_lat, i_lon, i_wvht):
            continue
        wvht = _num(t[i_wvht])
        lat, lon = _num(t[i_lat]), _num(t[i_lon])
        if wvht is None or lat is None or lon is None:
            continue
        out.append({"id": t[i_stn].strip(), "lat": lat, "lon": lon, "wvht_m": wvht})
    return out


def nearest_buoy(lat, lon, buoys, max_km):
    """PURE: (buoy, km) for the closest wave buoy within max_km, else (None, None)."""
    best, best_km = None, None
    for b in buoys:
        km = haversine_km(lat, lon, b["lat"], b["lon"])
        if best_km is None or km < best_km:
            best, best_km = b, km
    if best_km is not None and best_km <= max_km:
        return best, best_km
    return None, None


# ── I/O ────────────────────────────────────────────────────────────────────────────────────────
def _rest(base, key):
    import requests
    return requests, {"apikey": key, "Authorization": f"Bearer {key}",
                      "Content-Type": "application/json"}


PAGE = 1000


def fetch_spots(base, key) -> list:
    """ALL active spots, paginated.

    PostgREST enforces a SERVER-SIDE max-rows (1000 here) that a `limit=` query param does NOT
    override — it silently truncates and returns 200. A single unpaginated request looked completely
    successful while quietly dropping 516 of 1516 spots (caught 2026-07-26 by comparing the script's
    'Active spots' line against a direct SQL count). Page until a short page comes back."""
    requests, headers = _rest(base, key)
    out, offset = [], 0
    while True:
        url = (f"{base}/rest/v1/surf_spots?select=id,name,latitude,longitude,noaa_buoy_id"
               f"&is_active=eq.true&latitude=not.is.null&longitude=not.is.null"
               f"&order=id&limit={PAGE}&offset={offset}")
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if len(batch) < PAGE:
            return out
        offset += PAGE


def write_buoy_ids(base, key, pairs, chunk=150) -> tuple:
    """Assign noaa_buoy_id, ONE PATCH PER BUOY. `pairs` = [(spot_id, buoy_id)]. Returns (ok, failed).

    Deliberately an UPDATE, not an upsert. `surf_spots` is locked down — service_role holds SELECT
    plus UPDATE on noaa_buoy_id ALONE (migration grant_service_role_update_noaa_buoy_id). A bulk
    upsert (POST + resolution=merge-duplicates) would need INSERT, which service_role does not have
    and should not be given, so it fails 42501 exactly like the original table-wide denial did.

    Grouping by buoy keeps it to ~1 request per distinct station (measured: 441 spots -> 62 buoys)
    instead of 441 sequential round-trips, using only the one column-scoped privilege."""
    requests, headers = _rest(base, key)
    by_buoy = {}
    for sid, bid in pairs:
        by_buoy.setdefault(bid, []).append(str(sid))
    ok = fail = 0
    for bid, ids in by_buoy.items():
        for i in range(0, len(ids), chunk):
            group = ids[i:i + chunk]
            url = f"{base}/rest/v1/surf_spots?id=in.({','.join(group)})"
            r = requests.patch(url, headers={**headers, "Prefer": "return=minimal"},
                               json={"noaa_buoy_id": bid}, timeout=60)
            if r.status_code in (200, 204):
                ok += len(group)
            else:
                fail += len(group)
                print(f"    buoy {bid}: HTTP {r.status_code} {r.text[:180]}")
    return ok, fail


def main() -> int:
    ap = argparse.ArgumentParser(description="Map surf spots to their nearest NDBC wave buoy")
    ap.add_argument("--apply", action="store_true", help="write noaa_buoy_id (default: dry run)")
    ap.add_argument("--max-km", type=float, default=DEFAULT_MAX_KM)
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        print("ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) required.")
        return 2

    import requests
    print(f"Fetching NDBC latest observations … {NDBC_LATEST_OBS_URL}")
    buoys = parse_latest_obs(requests.get(NDBC_LATEST_OBS_URL, timeout=60).text)
    print(f"  wave-reporting stations: {len(buoys)}")
    if not buoys:
        print("ERROR: no wave stations parsed — NDBC format may have changed. Aborting.")
        return 1

    spots = fetch_spots(base, key)
    print(f"Active spots with coordinates: {len(spots)}")
    if len(spots) % PAGE == 0 and spots:
        # Pagination should always end on a SHORT page. Landing exactly on a page boundary is the
        # signature of the silent PostgREST truncation this loop exists to defeat — say so loudly.
        print(f"  ⚠ count is an exact multiple of the {PAGE}-row page size — verify against a direct"
              f" SQL count before trusting this run.")

    matched, unmatched, dists = [], [], []
    for sp in spots:
        b, km = nearest_buoy(float(sp["latitude"]), float(sp["longitude"]), buoys, args.max_km)
        if b is None:
            unmatched.append(sp)
        else:
            matched.append((sp, b, km))
            dists.append(km)

    print(f"\n  matched   : {len(matched)}  ({100*len(matched)/max(1,len(spots)):.1f}%)")
    print(f"  unmatched : {len(unmatched)}  (no wave buoy within {args.max_km:.0f} km)")
    if dists:
        dists.sort()
        q = lambda p: dists[min(len(dists) - 1, int(p * len(dists)))]  # noqa: E731
        print(f"  distance km: min {dists[0]:.0f} | p25 {q(.25):.0f} | median {q(.5):.0f} "
              f"| p75 {q(.75):.0f} | max {dists[-1]:.0f}")
        distinct = len({b['id'] for _, b, _ in matched})
        print(f"  distinct buoys used: {distinct}")
        print("\n  closest 8 pairings:")
        for sp, b, km in sorted(matched, key=lambda x: x[2])[:8]:
            print(f"    {sp['name'][:34]:<34} -> {b['id']:>7}  {km:6.1f} km  (buoy Hs {b['wvht_m']} m)")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply to persist.")
        return 0

    print(f"\nWriting noaa_buoy_id for {len(matched)} spots …")
    ok, fail = write_buoy_ids(base, key, [(sp["id"], b["id"]) for sp, b, _km in matched])
    print(f"  updated {ok}, failed {fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
