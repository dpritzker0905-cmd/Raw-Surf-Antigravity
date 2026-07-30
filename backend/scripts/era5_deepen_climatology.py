"""Deepen per-spot size climatology to ~47 years with ERA5 — the CDS lane (v3).

Measured 2026-07-30 with a live CDS token:
  * `reanalysis-era5-single-levels-timeseries` returns a spot's FULL hourly history
    (1979→present: 416,952 rows, 100% finite at Sebastian Inlet) in ~32 s, ~8 MB, ONE request.
    It carries Hs (`swh`), mean wave period (`mwp`) and mean direction (`mwd`) — but NOT the peak
    period, and mwp reads LOW vs the surf-relevant peak (5.6 vs ~7.9 s at Sebastian), the same
    mean-vs-peak defect class the OM backfill's v2 fixed.
  * The GRIDDED `reanalysis-era5-single-levels` DOES carry `peak_wave_period` (verified: a 1985
    single-hour pull retrieved it). A single-cell, one-year, 3-hourly pull is tiny (cost ≈ 2.9k of
    the 121k/request cap) and yields the spot's own hour-matched Tp/Tm ratio.

So v3 composes: 47 years of (Hs, Tm, dir) from the timeseries lane × the spot's own measured
Tp≈r·Tm calibration from the gridded lane — then EVERY sample goes through the production
`resolve_surf_geometry` + `estimate_surf_at` chain and the percentile is taken on the TRANSFORMED
distribution (the composition mandate: one chain for live, hub, sim, glyphs and climatology).
Output merges into the SAME rolling-histogram blob (`spot_ratings/size_climatology.json`).

Usage (from backend/):
  python scripts/era5_deepen_climatology.py --query "sebastian inlet" --dry-run
  python scripts/era5_deepen_climatology.py --all --upload      # the full campaign (~1-2 min/spot)

Requires ~/.cdsapirc. RATING_LOCAL_SIZE stays OFF until scripts/local_size_gonogo.py says GO.
"""
import argparse
import json
import sys
import time
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.spot_size_climatology import (  # noqa: E402
    SCHEMA_VERSION, hist_count, merge_samples, reference_from_hist,
)

ERA5_BACKFILL_VERSION = 3
TS_DATASET = "reanalysis-era5-single-levels-timeseries"
GRID_DATASET = "reanalysis-era5-single-levels"
TS_START = "1979-01-01"               # ERA5's well-observed satellite era; extend later if wanted
RATIO_YEAR = "2024"                   # the per-spot Tp/Tm calibration year (gridded, single cell)
STRIDE_H = 3


def _cds():
    import cdsapi
    return cdsapi.Client(quiet=True)


def fetch_timeseries(client, lat, lng, end_date):
    """47 years of hourly (Hs, Tm, dir) at the point. ~32 s, ~8 MB."""
    import netCDF4
    import numpy as np
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tf:
        target = tf.name
    try:
        client.retrieve(TS_DATASET, {
            "variable": ["significant_height_of_combined_wind_waves_and_swell",
                         "mean_wave_period", "mean_wave_direction"],
            "location": {"latitude": lat, "longitude": lng},
            "date": [f"{TS_START}/{end_date}"],
            "data_format": "netcdf",
        }, target)
        with zipfile.ZipFile(target) as z:
            member = [n for n in z.namelist() if n.endswith(".nc")][0]
            data = z.read(member)
        ds = netCDF4.Dataset("inmem", memory=data)
        swh = np.array(ds.variables["swh"][:]).squeeze()
        mwp = np.array(ds.variables["mwp"][:]).squeeze()
        mwd = np.array(ds.variables["mwd"][:]).squeeze()
        ds.close()
        return swh, mwp, mwd
    finally:
        try:
            os.unlink(target)
        except OSError:
            pass


def fetch_tp_tm_ratio(client, lat, lng):
    """The spot's own peak/mean period ratio: one tiny gridded pull (one year, 3-hourly, 2
    variables), hour-matched median of pp1d/mwp over the cells around the spot. Falls back to 1.0
    (identity — the lenient direction) when the pull or parse fails.

    ⚠️ AREA (measured 2026-07-30): ERA5 WAVE fields live on the ~0.5° wave grid, not the 0.25°
    atmospheric grid — a sub-half-degree box can contain ZERO wave-grid points and MARS fails the
    whole job (MarsRuntimeError, bisected live: the same request succeeds with a 1° box). ±0.5°
    guarantees at least one wave cell everywhere."""
    import netCDF4
    import numpy as np
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tf:
        target = tf.name
    try:
        client.retrieve(GRID_DATASET, {
            "product_type": ["reanalysis"],
            "variable": ["peak_wave_period", "mean_wave_period"],
            "year": [RATIO_YEAR],
            "month": [f"{m:02d}" for m in range(1, 13)],
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": [f"{h:02d}:00" for h in range(0, 24, STRIDE_H)],
            "area": [round(lat + 0.5, 3), round(lng - 0.5, 3),
                     round(lat - 0.5, 3), round(lng + 0.5, 3)],
            "data_format": "netcdf",
            "download_format": "unarchived",
        }, target)
        ds = netCDF4.Dataset(target)
        pp1d = np.array(ds.variables["pp1d"][:])
        mwp = np.array(ds.variables["mwp"][:])
        ds.close()
        # collapse the small spatial box to a per-hour mean over its (few) wave cells
        pp1d = np.nanmean(pp1d.reshape(pp1d.shape[0], -1), axis=1)
        mwp = np.nanmean(mwp.reshape(mwp.shape[0], -1), axis=1)
        ok = np.isfinite(pp1d) & np.isfinite(mwp) & (mwp > 0)
        if ok.sum() < 100:
            return 1.0, int(ok.sum())
        return float(np.median(pp1d[ok] / mwp[ok])), int(ok.sum())
    except Exception:
        return 1.0, 0
    finally:
        try:
            os.unlink(target)
        except OSError:
            pass


def era5_breaking_samples(lat, lng, end_date, client=None):
    """The spot's ~47-year TRANSFORMED breaking-height distribution. Returns
    (samples, n_offshore, geometry_ok, tp_tm_ratio, ratio_n)."""
    import numpy as np
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    client = client or _cds()
    swh, mwp, mwd = fetch_timeseries(client, lat, lng, end_date)
    ratio, ratio_n = fetch_tp_tm_ratio(client, lat, lng)
    try:
        geo = resolve_surf_geometry(float(lat), float(lng))
    except Exception:
        geo = None
    samples, n_off = [], 0
    for i in range(0, len(swh), STRIDE_H):
        h, p, d = float(swh[i]), float(mwp[i]), float(mwd[i])
        if not (np.isfinite(h) and np.isfinite(p)) or h <= 0 or p <= 0:
            continue
        n_off += 1
        tp = p * ratio
        breaking = None
        if geo is not None:
            try:
                breaking, _regime = estimate_surf_at(lat, lng, h, tp,
                                                     swell_from_deg=d if np.isfinite(d) else None,
                                                     geometry=geo)
            except Exception:
                breaking = None
        if breaking is None:
            from services.weather_pipeline.surf_transform import komar_breaker_height
            breaking = komar_breaker_height(h, tp)
        if breaking is not None:
            samples.append(breaking)
    return samples, n_off, geo is not None, ratio, ratio_n


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--query", default="", help="comma-separated name substrings")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--upload", action="store_true", help="merge + upload to L2")
    ap.add_argument("--dry-run", action="store_true", help="(default)")
    args = ap.parse_args()
    if not (args.query or args.limit or args.all):
        ap.error("pick a scope: --query, --limit or --all")

    import requests
    from scripts.local_size_gonogo import _prod_credentials, _all_spots
    from scripts.build_spot_size_climatology import load_live_blob, upload_blob
    session = requests.Session()
    url, svc, _env = _prod_credentials(session)
    spots = _all_spots(session, url, svc)
    if args.query:
        needles = [q.strip().lower() for q in args.query.split(",") if q.strip()]
        spots = [s for s in spots if any(n in (s.get("name") or "").lower() for n in needles)]
    if args.limit:
        spots = spots[:args.limit]

    # resume: skip spots already deepened at this version (in the blob OR pending in the inbox)
    from scripts.build_spot_size_climatology import pending_inbox_spot_ids
    live_now = load_live_blob(session, url, svc) or {}
    done = {sid for sid, rec in (live_now.get("spots") or {}).items()
            if isinstance(rec, dict) and (rec.get("era5") or {}).get("v") == ERA5_BACKFILL_VERSION}
    done |= pending_inbox_spot_ids(session, url, svc, "era5", ERA5_BACKFILL_VERSION)
    spots = [s for s in spots if str(s["id"]) not in done]
    print(f"spots in scope after resume filter: {len(spots)}")

    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    client = _cds()
    results = {}
    t0 = time.time()
    for i, s in enumerate(spots):
        sid, name = str(s["id"]), s.get("name") or "?"
        t1 = time.time()
        try:
            samples, n_off, geo_ok, ratio, ratio_n = era5_breaking_samples(
                float(s["latitude"]), float(s["longitude"]), end_date, client=client)
        except Exception as e:
            print(f"  [{i+1}/{len(spots)}] {name}: FAILED — {str(e)[:140]}")
            continue
        hist = merge_samples(None, samples)
        ref = reference_from_hist(hist)
        results[sid] = {"hist": hist, "n": hist_count(hist), "ratio": round(ratio, 3)}
        print(f"  [{i+1}/{len(spots)}] {name}: offshore={n_off} surfable={hist_count(hist)} "
              f"Tp/Tm={ratio:.3f} (n={ratio_n}) reference={ref} m  [{time.time()-t1:.0f}s]"
              f"{'' if geo_ok else '  (NO GEOMETRY)'}")
    print(f"\nprocessed {len(results)} spots in {(time.time()-t0)/60:.1f} min")

    if not args.upload or not results:
        print("DRY RUN or nothing to upload — done.")
        return
    # INBOX, not read-modify-write (2026-07-30, measured): a direct blob merge was erased within
    # the hour by the precompute's concurrent write. The precompute is THE single writer; this
    # script drops a batch it folds in during its own cycle.
    from services.weather_pipeline.spot_size_climatology import INBOX_PREFIX
    batch_id = f"era5-v{ERA5_BACKFILL_VERSION}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    spots_payload = {
        sid: {"hist": rec["hist"], "n": rec["n"],
              "era5": {"v": ERA5_BACKFILL_VERSION, "from": TS_START, "to": end_date,
                       "n": rec["n"], "tp_tm_ratio": rec["ratio"]}}
        for sid, rec in results.items()
    }
    resp = session.post(
        f"{url}/storage/v1/object/weather-products/{INBOX_PREFIX}{batch_id}.json",
        headers={"Authorization": f"Bearer {svc}", "apikey": svc,
                 "Content-Type": "application/json", "x-upsert": "true"},
        data=json.dumps({"batch_id": batch_id, "spots": spots_payload},
                        separators=(",", ":")).encode("utf-8"), timeout=120)
    if resp.status_code not in (200, 201):
        raise SystemExit(f"inbox upload failed: HTTP {resp.status_code} {resp.text[:200]}")
    print(f"inbox batch uploaded: {batch_id} ({len(spots_payload)} spots). The next precompute "
          f"cycle folds it in; run scripts/local_size_gonogo.py after that.")


if __name__ == "__main__":
    main()
