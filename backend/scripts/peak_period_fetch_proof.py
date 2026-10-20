"""peak_period_fetch_proof.py: prove both peak-period flags on REAL upstream files, through the production fetchers.

LESSONS L-P12 / L-S15: a fetch change is proven on real GRIB/NetCDF before any flip, not only on unit tests. This runs
`services/dwd_gwam_fetcher.py` and `services/copernicus_global_fetcher.py` BY PATH (exactly how production spawns them),
each twice on the same small bbox: flag off, then flag on. It checks:
  * heights and directions are byte-identical off vs on (the flags touch periods only);
  * the flag-on diagnostic `wave_period_tm10` equals the flag-off `wave_period` (the old field is kept, unchanged);
  * ICON: partition periods change (ppts/ppww replace mpts/mpww) and the flag-on total equals
    gwam_peak_period.derive_total_series of the flag-on partitions (the fetcher wiring is the tested function);
  * CMEMS: the flag-on total is VTPK, and VTPK / VTM10 sits where a peak/energy ratio should (median >= 1).
A cycle that changes between the two fetches makes the comparison void (reported, not failed). Exit 1 on any FAIL.

    python scripts/peak_period_fetch_proof.py [--gwam] [--cmems]      (from backend/; CMEMS needs its credentials)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
BBOX = {"west": -128.0, "south": 30.0, "east": -116.0, "north": 40.0}   # California coast + open Pacific


def run(script, payload, env_extra):
    out = os.path.join(tempfile.mkdtemp(), "out.json")
    payload = dict(payload, output_path=out)
    env = dict(os.environ, **env_extra, PYTHONIOENCODING="utf-8")
    r = subprocess.run([sys.executable, os.path.join(BACKEND, "services", script), json.dumps(payload)],
                       capture_output=True, text=True, encoding="utf-8", env=env, timeout=3600)
    print(f"[{script} {env_extra}] rc={r.returncode} {r.stdout.strip()[-300:]}")
    if r.returncode != 0 or not os.path.exists(out):
        print(r.stderr[-1500:])
        return None
    with open(out, encoding="utf-8") as fh:
        return json.load(fh)


def by_point(points):
    return {(p["latitude"], p["longitude"]): p for p in points}


def same(a, b):
    return json.dumps(a) == json.dumps(b)


def check(name, cond, fails):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def gwam(fails):
    from services.gwam_peak_period import derive_total_series
    payload = {"bbox": BBOX, "resolution": 2.0, "forecast_days": 1}
    off = run("dwd_gwam_fetcher.py", payload, {"ICON_PEAK_PERIOD": "0"})
    on = run("dwd_gwam_fetcher.py", payload, {"ICON_PEAK_PERIOD": "1"})
    if not off or not on:
        check("GWAM: both fetches returned points", False, fails)
        return
    a, b = by_point(off), by_point(on)
    runs = {p.get("__model_run_time") for p in off} | {p.get("__model_run_time") for p in on}
    if len(runs) != 1:
        print(f"VOID GWAM comparison: the cycle changed between fetches ({sorted(map(str, runs))})")
        return
    keys = sorted(set(a) & set(b))
    check(f"GWAM: same points ({len(keys)})", len(keys) == len(a) == len(b) and keys, fails)
    hv = ("wave_height", "swell_wave_height", "wind_wave_height", "wave_direction", "swell_wave_direction",
          "wind_wave_direction")
    check("GWAM: heights + directions identical off vs on",
          all(same(a[k]["hourly"].get(v), b[k]["hourly"].get(v)) for k in keys for v in hv), fails)
    check("GWAM: flag-on wave_period_tm10 == flag-off wave_period (tm10 kept unchanged)",
          all(same(a[k]["hourly"]["wave_period"], b[k]["hourly"].get("wave_period_tm10")) for k in keys), fails)
    check("GWAM: flag-off has no wave_period_tm10", all("wave_period_tm10" not in a[k]["hourly"] for k in keys), fails)
    changed = sum(1 for k in keys if not same(a[k]["hourly"]["swell_wave_period"], b[k]["hourly"]["swell_wave_period"]))
    check(f"GWAM: swell period changed at most points (ppts vs mpts): {changed}/{len(keys)}", changed >= 0.5 * len(keys), fails)
    check("GWAM: flag-on wave_period == derive_total_series(flag-on partitions)",
          all(same(b[k]["hourly"]["wave_period"], derive_total_series(b[k]["hourly"])[0]) for k in keys), fails)
    r = [tp / t10 for k in keys for tp, t10 in zip(b[k]["hourly"]["wave_period"], b[k]["hourly"]["wave_period_tm10"])
         if tp and t10]
    r.sort()
    print(f"GWAM blended Tp / tm10: n={len(r)} p10={r[len(r)//10]:.3f} p50={r[len(r)//2]:.3f} p90={r[9*len(r)//10]:.3f}" if r else "GWAM: no ratios")


def cmems(fails):
    now = datetime.now(timezone.utc)
    payload = {"username": os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", ""),
               "password": os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", ""),
               "bbox": BBOX, "resolution": 2.0,
               "start_datetime": (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S"),
               "end_datetime": (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")}
    if not payload["username"]:
        print("SKIP CMEMS: no credentials")
        return
    off = run("copernicus_global_fetcher.py", payload, {"COPERNICUS_PEAK_PERIOD": "0"})
    on = run("copernicus_global_fetcher.py", payload, {"COPERNICUS_PEAK_PERIOD": "1"})
    if not off or not on:
        check("CMEMS: both fetches returned points", False, fails)
        return
    a, b = by_point(off), by_point(on)
    keys = sorted(set(a) & set(b))
    if not all(same(a[k]["hourly"]["time"], b[k]["hourly"]["time"]) for k in keys):
        print("VOID CMEMS comparison: the time axis changed between fetches")
        return
    hv = ("wave_height", "wave_direction", "swell_wave_height", "swell_wave_period", "secondary_swell_wave_period",
          "wind_wave_height", "wind_wave_period")
    check(f"CMEMS: same points ({len(keys)})", len(keys) == len(a) == len(b) and keys, fails)
    check("CMEMS: heights, directions and partition periods identical off vs on",
          all(same(a[k]["hourly"].get(v), b[k]["hourly"].get(v)) for k in keys for v in hv), fails)
    check("CMEMS: flag-on wave_period_tm10 == flag-off wave_period (VTM10 kept unchanged)",
          all(same(a[k]["hourly"]["wave_period"], b[k]["hourly"].get("wave_period_tm10")) for k in keys), fails)
    r = sorted(tp / t10 for k in keys for tp, t10 in zip(b[k]["hourly"]["wave_period"], b[k]["hourly"]["wave_period_tm10"])
               if tp and t10)
    check(f"CMEMS: VTPK/VTM10 median >= 1 (n={len(r)}, p50={r[len(r)//2] if r else None})", bool(r) and r[len(r) // 2] >= 1.0, fails)
    if r:
        print(f"CMEMS VTPK / VTM10: p10={r[len(r)//10]:.3f} p50={r[len(r)//2]:.3f} p90={r[9*len(r)//10]:.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gwam", action="store_true")
    ap.add_argument("--cmems", action="store_true")
    a = ap.parse_args()
    fails = []
    if a.gwam:
        gwam(fails)
    if a.cmems:
        cmems(fails)
    print(f"RESULT: {'FAIL ' + str(fails) if fails else 'PASS'}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
