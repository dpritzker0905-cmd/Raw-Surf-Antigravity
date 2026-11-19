"""M1-0 PARITY PROBE: is the served tide level (Open-Meteo `sea_level_height_msl`) the CMEMS global analysis-forecast
merged sea level read directly? (Director, 2026-11-18, from the research lead's finding that Open-Meteo's sea level IS
CMEMS cmems_mod_glo_phy_anfc_merged-sl_PT1H-i.) Model values only: no observed water is read.

RULE, fixed in code before any run (tests/test_tide_cmems.py pins it):
- held set: the 20 keys in parity_rules.HELD_KEYS (0.1-degree served cache keys), fixed before any value was seen;
- pairs: every hour of the 48 h before the run's 00Z (hindcast hours, so the two sides cannot differ by forecast run);
- primary candidate: CMEMS `total_sea_level` at the grid cell NEAREST the key, against Open-Meteo at the same key;
- PASS: the 99th percentile of |CMEMS - Open-Meteo| over all pairs <= 0.01 m, with >= 90% of pairs present.
Other candidates (ocean_tide + sea_surface_height, + invert_barometer, nearest WET cell) and the forecast hours are
REPORTED only, to diagnose a miss; they cannot make a PASS. A miss means: do not switch; find the cause; re-register.
Credentials: Copernicus Marine from the environment of its one workflow step, never printed.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parity_rules as PR                                        # noqa: E402

OM = "https://marine-api.open-meteo.com/v1/marine"


def log(m):
    print(m, file=sys.stderr, flush=True)


def om_series(key, start, end):
    url = (f"{OM}?latitude={key[0]}&longitude={key[1]}&hourly=sea_level_height_msl"
           f"&start_date={start:%Y-%m-%d}&end_date={end:%Y-%m-%d}&timezone=GMT")
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "raw-surf-m1-0-parity"}),
                                        timeout=60) as r:
                h = json.loads(r.read().decode("utf-8")).get("hourly") or {}
            return {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
                    for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}
        except Exception as e:                                   # noqa: BLE001
            log(f"open-meteo {key}: {type(e).__name__} (try {k + 1})")
            time.sleep(2 + 3 * k)
    return {}


def cmems_cells(key, start, end, work):
    """{variable: (lat, lon, [hour], [values]) } at the nearest cell and the nearest WET cell (total_sea_level finite)."""
    import copernicusmarine
    import xarray as xr
    work.mkdir(parents=True, exist_ok=True)
    name = f"sl_{key[0]:.1f}_{key[1]:.1f}.nc".replace("-", "m")
    copernicusmarine.subset(dataset_id=PR.DATASET, variables=list(PR.VARIABLES),
                            minimum_longitude=key[1] - PR.BOX, maximum_longitude=key[1] + PR.BOX,
                            minimum_latitude=key[0] - PR.BOX, maximum_latitude=key[0] + PR.BOX,
                            start_datetime=f"{start:%Y-%m-%dT%H:%M:%S}", end_datetime=f"{end:%Y-%m-%dT%H:%M:%S}",
                            output_directory=str(work), output_filename=name,
                            username=os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", ""),
                            password=os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", ""),
                            disable_progress_bar=True)
    ds = xr.open_dataset(work / name).load()
    (work / name).unlink(missing_ok=True)
    lats, lons = ds.latitude.values, ds.longitude.values
    times = [datetime.fromtimestamp(t.astype("datetime64[s]").astype(int), timezone.utc) for t in ds.time.values]
    near = PR.nearest_cell(lats, lons, key)
    tsl = ds["total_sea_level"].values                          # (time, lat, lon)
    wet = PR.nearest_wet_cell(lats, lons, key, np.isfinite(tsl).any(axis=0))
    out = {}
    for tag, cell in (("nearest", near), ("nearest_wet", wet)):
        if cell is None:
            continue
        iy, ix = cell
        out[tag] = {"lat": float(lats[iy]), "lon": float(lons[ix]), "times": times,
                    **{v: ds[v].values[:, iy, ix].astype(float) for v in PR.VARIABLES}}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="parity_work")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    args = ap.parse_args()
    now = datetime.now(timezone.utc)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hind0, hind1 = day0 - timedelta(hours=PR.HINDCAST_H), day0 - timedelta(hours=1)
    fc1 = day0 + timedelta(hours=PR.FORECAST_H - 1)
    pairs = {c: {"hindcast": [], "forecast": []} for c in PR.CANDIDATES}
    per_key = {}
    for key in PR.HELD_KEYS:
        om = om_series(key, hind0, fc1)
        try:
            cells = cmems_cells(key, hind0, fc1, Path(args.work))
        except Exception as e:                                   # noqa: BLE001 - per key, recorded
            log(f"cmems {key}: {type(e).__name__}")
            cells = {}
        per_key[f"{key[0]:.1f},{key[1]:.1f}"] = {t: {"lat": c["lat"], "lon": c["lon"]} for t, c in cells.items()}
        for cand, (cell_tag, terms) in PR.CANDIDATES.items():
            c = cells.get(cell_tag)
            if c is None:
                continue
            series = PR.combine(c, terms)
            for t, v in zip(c["times"], series):
                if t not in om or not np.isfinite(v):
                    continue
                bucket = "hindcast" if hind0 <= t <= hind1 else ("forecast" if day0 <= t <= fc1 else None)
                if bucket:
                    pairs[cand][bucket].append(abs(float(v) - float(om[t])))
        log(f"key {key} done")
    expected = len(PR.HELD_KEYS) * PR.HINDCAST_H
    report = {"rule": PR.RULE_TEXT, "run_utc": now.strftime("%Y-%m-%dT%H:%MZ"), "dataset": PR.DATASET,
              "expected_hindcast_pairs": expected, "cells": per_key,
              "candidates": {c: {b: PR.stats(v) for b, v in d.items()} for c, d in pairs.items()}}
    report["verdict"] = PR.verdict(pairs[PR.PRIMARY]["hindcast"], expected)
    print(json.dumps(report, indent=1, default=str))
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(f"## M1-0 parity (CMEMS merged-sl direct vs served Open-Meteo): **{report['verdict']}**\n\n")
            for c, d in report["candidates"].items():
                fh.write(f"- {c}: hindcast {d['hindcast']}; forecast {d['forecast']}\n")


if __name__ == "__main__":
    main()
