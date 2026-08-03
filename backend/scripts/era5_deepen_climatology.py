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
import os
import re
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


# ⛔⛔ ERA5's WAVE GRID IS ~0.5 deg AND A SURF SPOT IS ON THE COAST (measured 2026-08-03).
# The timeseries lane samples the spot's EXACT coordinate, and at many spots that cell is land: every
# value comes back masked, `isfinite` rejects all of them, and the spot yields `offshore=0`. Measured
# on the first campaign spot — `Nosara - Playa Guiones: offshore=0 surfable=0 reference=None` after
# 311 s — and independently by `directional_exposure_probe` at BOTH Raglan spots ("0 usable samples"),
# while Arugam Bay and Hossegor returned 139,016 samples each from the same code. So it is the
# COORDINATE, not the lane.
# ★ Nudging SEAWARD is not a workaround, it is more correct: the production chain wants an OFFSHORE
#   Hs which it then transforms through the spot's geometry. Sampling inside the surf zone of a 0.5 deg
#   cell is neither the offshore sea state nor the breaking one.
# ⚠️ Costs an EXTRA ~47-year fetch only for spots that fail, so spots that already work are unchanged
#   and pay nothing. Offsets are in degrees along the seaward shore normal, widening until wet.
OFFSHORE_NUDGE_DEG = (0.0, 0.35, 0.7, 1.0)


def _seaward(lat, lng, geo, deg):
    """`deg` degrees along the seaward shore normal. Falls back to due-west when the normal is
    unknown — arbitrary but harmless, since a nudge is only attempted after the exact point failed."""
    import math
    if deg <= 0:
        return lat, lng
    normal = None
    for attr in ("shore_normal_deg", "shore_normal", "normal_deg"):
        v = getattr(geo, attr, None) if not isinstance(geo, dict) else (geo or {}).get(attr)
        if v is not None:
            try:
                normal = float(v)
                break
            except Exception:
                continue
    if normal is None:
        normal = 270.0
    r = math.radians(normal)
    dlat = deg * math.cos(r)
    dlng = deg * math.sin(r) / max(0.2, math.cos(math.radians(lat)))
    return round(lat + dlat, 4), round(((lng + dlng + 180) % 360) - 180, 4)


def era5_breaking_samples(lat, lng, end_date, client=None):
    """The spot's ~47-year TRANSFORMED breaking-height distribution. Returns
    (samples, n_offshore, geometry_ok, tp_tm_ratio, ratio_n)."""
    import numpy as np
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    client = client or _cds()
    try:
        geo = resolve_surf_geometry(float(lat), float(lng))
    except Exception:
        geo = None
    # Try the spot itself, then step seaward until the cell is actually water.
    swh = mwp = mwd = None
    for deg in OFFSHORE_NUDGE_DEG:
        slat, slng = _seaward(lat, lng, geo, deg)
        swh, mwp, mwd = fetch_timeseries(client, slat, slng, end_date)
        if int(np.isfinite(np.asarray(swh, dtype=float)).sum()) > 0:
            if deg:
                print(f"      (nudged {deg} deg seaward to {slat},{slng} — the spot's own cell is dry "
                      f"in ERA5's ~0.5 deg wave grid)", flush=True)
            break
    ratio, ratio_n = fetch_tp_tm_ratio(client, lat, lng)
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


# ★ BANK THE WORK AS IT IS EARNED. This script used to upload ONE inbox batch after the whole run,
# so nothing landed until it exited — and a campaign is HOURS long. Measured 2026-07-31: 150 spots
# took 15+ h wall for 610 s of CPU, because CDS queueing makes each spot ~6 min of WAITING (~7x the
# 32 s/spot the earlier research predicted). At that length "92% complete" was worth exactly 0%:
# one Ctrl-C, one battery event, one closed shell and the entire campaign was gone.
# The inbox is append-only and the resume filter already reads it (`pending_inbox_spot_ids`), so a
# banked batch is skipped on the next run — checkpointing costs nothing and bounds the loss to the
# last N spots. ⚠️ Keep N well under the resume filter's `limit: 100` batch listing.
CHECKPOINT_EVERY = int(os.environ.get("ERA5_CHECKPOINT_EVERY", "10"))


def _is_this_script(proc_name, cmdline) -> bool:
    """True only for a PYTHON process running THIS script as an argv element.

    ⛔⛔ THE SUBSTRING TEST THAT BROKE THE CAMPAIGN (measured 2026-08-03). The original guard asked
    `any(basename in part for part in cmdline)` over EVERY process. A shell that launches this
    script necessarily carries the script's name in its OWN command line, so
    `bash -c "python scripts/era5_deepen_climatology.py --all --upload"` matched itself, the guard
    reported "another ERA5 campaign is already running (pid <the launching shell>)", and the run
    aborted before its first fetch. Every wrapper launch — `bash -c`, the nightly scheduled task,
    CI — self-aborted, which is why the campaign was never established at scale. The guard did not
    fail to run; it ran and blocked the only thing it was protecting.

    Two conditions, both required, each killing one false positive:
      * the process must be a PYTHON INTERPRETER — kills the launching shell; and
      * the name must sit in python's SCRIPT SLOT — the first non-flag argument — which kills
        `python -c "<blob that mentions the script>"`.

    ⚠️ THE SCRIPT SLOT IS THE RULE, AND STRING SHAPE IS NOT. Testing `part.endswith(basename)` or
    `os.path.basename(part) == basename` over every argv element looks equivalent and is not:
    `posixpath.basename` splits a CODE BLOB on '/' just as happily as a path, so
    `python -c "# audit scripts/era5_deepen_climatology.py"` satisfies BOTH. That variant was
    written here, passed its own unit test (whose blob happened not to end on the name), and was
    caught only by a mutation harness. `-c`/`-m` mean there is no script file at all — return
    early rather than inspecting the payload.
    """
    if "python" not in (proc_name or "").lower():
        return False
    here = os.path.basename(__file__)
    args = [str(p) for p in (cmdline or ()) if p is not None][1:]   # drop the interpreter itself
    i = 0
    while i < len(args) and args[i].startswith("-"):
        if args[i] in ("-c", "-m"):             # inline code / module: no script path follows
            return False
        i += 1
    if i >= len(args):                          # a bare REPL, no script
        return False
    slot = args[i]
    return os.path.basename(slot) == here or slot.endswith(here)


def _another_instance_pid():
    """PID of another live run of THIS script, or None. Best-effort — never raises.

    ⚠️⚠️ THE COLLISION THIS PREVENTS IS REAL AND WAS ABOUT TO HAPPEN. The nightly scheduled task
    (`RawSurf ERA5 Climatology Campaign`, 21:30) fires whether or not a manual campaign is already
    in flight. Because the running one has banked nothing yet, the scheduled run's resume filter
    cannot see its spots — so it would re-fetch the SAME spots concurrently, double the CDS queue
    load that is already the bottleneck, and race the same inbox prefix.
    ★ A lock FILE would not have caught it: the run in flight predates this guard and holds no
    lock. Scanning for the process itself is what makes the guard work on the very first night.
    ★ Self and ANCESTORS are excluded: the launching shell (and its shell, under CI) is not a
      competing campaign, it is this one. See `_is_this_script` for the substring bug this replaced.
    """
    try:
        import psutil
    except Exception:
        return None
    me = os.getpid()
    kin = {me}
    try:                                       # the whole ancestor chain, not just the parent
        for anc in psutil.Process(me).parents():
            kin.add(anc.pid)
    except Exception:
        kin.add(os.getppid())
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if proc.info["pid"] in kin:
                continue
            if _is_this_script(proc.info["name"], proc.info["cmdline"]):
                return proc.info["pid"]
        except Exception:                      # a process can exit mid-iteration
            continue
    return None


def _upload_inbox_batch(session, url, svc, results, end_date, seq):
    """Drop ONE inbox batch and return its id. Raises SystemExit on a failed upload.

    INBOX, not read-modify-write (2026-07-30, measured): a direct blob merge was erased within the
    hour by the precompute's concurrent write. The precompute is THE single writer; this script
    drops a batch it folds in during its own cycle.
    """
    from services.weather_pipeline.spot_size_climatology import INBOX_PREFIX
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    batch_id = f"era5-v{ERA5_BACKFILL_VERSION}-{stamp}-{seq:03d}"
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
    return batch_id


def select_scope(spots, query="", limit=0, done=frozenset()):
    """The spots THIS run will fetch, plus how many still need work. Pure; no network.

    ⭐⭐⭐ `--limit` MUST BE APPLIED AFTER THE RESUME FILTER, NEVER BEFORE (MASTER AUDIT 1.0 §3).
    `_all_spots` pages `order=id`, so the order is stable. Applying the slice first means
    `--limit 150` selects the first 150 spots BY ID and then drops the ones already deepened — so
    once those 150 are banked the nightly task resolves to an empty batch and **never advances to
    spot 151**. The job keeps succeeding, keeps reporting "0 spots in scope", and the campaign is
    permanently frozen at the head of the catalogue. Ordered the other way round, `--limit` means
    "the next 150 spots that still need work", which is the only reading that lets an incremental
    task finish a 1,773-spot catalogue.
    ⚠️ `--query` stays BEFORE the resume filter: it is a scope selector (which spots am I asking
    about), not a batch size (how many will I do tonight). Only `--limit` moves.

    Returns (batch, n_remaining). `n_remaining` is reported so a capped run says what it left —
    a silent cap and a finished catalogue print the same line otherwise.
    """
    if query:
        needles = [q.strip().lower() for q in query.split(",") if q.strip()]
        spots = [s for s in spots if any(n in (s.get("name") or "").lower() for n in needles)]
    remaining = [s for s in spots if str(s.get("id")) not in done]
    return (remaining[:limit] if limit else remaining), len(remaining)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--query", default="", help="comma-separated name substrings")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--upload", action="store_true", help="merge + upload to L2")
    ap.add_argument("--dry-run", action="store_true", help="(default)")
    ap.add_argument("--force", action="store_true",
                    help="run even if another campaign is already in flight (see _another_instance_pid)")
    args = ap.parse_args()
    if not (args.query or args.limit or args.all):
        ap.error("pick a scope: --query, --limit or --all")

    other = _another_instance_pid()
    if other and not args.force:
        raise SystemExit(
            f"another ERA5 campaign is already running (pid {other}). Two campaigns re-fetch the "
            f"SAME spots — the resume filter cannot see work that has not been banked yet — and "
            f"double the CDS queue load that is already this lane's bottleneck. Wait for it, or "
            f"pass --force if you know the scopes are disjoint.")

    import requests
    from scripts.local_size_gonogo import _prod_credentials, _all_spots
    from scripts.build_spot_size_climatology import load_live_blob, upload_blob
    session = requests.Session()
    url, svc, _env = _prod_credentials(session)

    # ⛔⛔ NAME THE TARGET BEFORE SPENDING 38 HOURS ON IT (2026-08-03).
    # `_prod_credentials` is called "prod" but returns whatever `os.environ` holds, checking the
    # process env BEFORE falling back to discovering the real values from Render. `backend/.env`
    # points at the DEV project — so anyone who sources it (or a CI job with dev secrets) silently
    # retargets this campaign, and the only symptom is that production's climatology never changes.
    # The blob is written through an append-only inbox, so a wrong target fails SILENTLY and looks
    # exactly like success. Print the ref always; refuse only when uploading.
    _ref = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    _ref = _ref.group(1) if _ref else "UNKNOWN"
    _want = os.environ.get("ERA5_EXPECT_PROJECT_REF", "jnfbxcvcbtndtsvscppt")
    print(f"upload target: supabase project ref = {_ref}"
          f"{'' if _ref == _want else f'   ⛔ EXPECTED {_want}'}")
    if args.upload and _ref != _want:
        raise SystemExit(
            f"REFUSING TO UPLOAD: resolved project ref '{_ref}' is not the expected production ref "
            f"'{_want}'. A campaign is ~38 h of CDS queueing and the inbox write would succeed "
            f"against the wrong project, which is indistinguishable from success. Unset "
            f"SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY so the Render lookup runs, or set "
            f"ERA5_EXPECT_PROJECT_REF if you genuinely mean to target '{_ref}'.")

    spots = _all_spots(session, url, svc)

    # resume: skip spots already deepened at this version (in the blob OR pending in the inbox)
    from scripts.build_spot_size_climatology import pending_inbox_spot_ids
    live_now = load_live_blob(session, url, svc) or {}
    done = {sid for sid, rec in (live_now.get("spots") or {}).items()
            if isinstance(rec, dict) and (rec.get("era5") or {}).get("v") == ERA5_BACKFILL_VERSION}
    done |= pending_inbox_spot_ids(session, url, svc, "era5", ERA5_BACKFILL_VERSION)
    # ⭐ THE SLICE HAPPENS INSIDE, AFTER THE RESUME FILTER — see `select_scope` for why the other
    #   order freezes a nightly `--limit` run at the head of the catalogue forever.
    spots, n_remaining = select_scope(spots, args.query, args.limit, done)
    print(f"spots in scope after resume filter: {len(spots)}"
          + (f"  (of {n_remaining} still needing work; --limit {args.limit} caps THIS run — "
             f"{n_remaining - len(spots)} deferred to the next)"
             if args.limit and n_remaining > len(spots) else ""))

    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    client = _cds()
    results = {}
    banked, batches = 0, []
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
        # ⛔⛔ NEVER BANK AN EMPTY SPOT. A record is stamped `era5.v == ERA5_BACKFILL_VERSION`, and the
        # resume filter treats any such stamp as DONE — so banking `n=0` marks the spot permanently
        # complete and a LATER, CORRECTED campaign would skip it. That converts a transient fetch
        # problem into a permanent hole in the blob, and the failure is invisible because the upload
        # succeeds. Measured 2026-08-03: the first campaign spot returned `offshore=0` and would have
        # been banked exactly this way. Skipping leaves the spot unstamped, so a re-run retries it.
        if hist_count(hist) <= 0:
            print(f"  [{i+1}/{len(spots)}] {name}: NO SAMPLES (offshore={n_off}) — NOT banked, so a "
                  f"re-run retries it  [{time.time()-t1:.0f}s]", flush=True)
            continue
        results[sid] = {"hist": hist, "n": hist_count(hist), "ratio": round(ratio, 3)}
        print(f"  [{i+1}/{len(spots)}] {name}: offshore={n_off} surfable={hist_count(hist)} "
              f"Tp/Tm={ratio:.3f} (n={ratio_n}) reference={ref} m  [{time.time()-t1:.0f}s]"
              f"{'' if geo_ok else '  (NO GEOMETRY)'}", flush=True)

        # ★ BANK IT NOW, not at the end. See CHECKPOINT_EVERY: a campaign runs for hours and used
        # to lose everything if it did not reach the last spot.
        if args.upload and len(results) >= CHECKPOINT_EVERY:
            bid = _upload_inbox_batch(session, url, svc, results, end_date, len(batches) + 1)
            banked += len(results)
            batches.append(bid)
            print(f"    ↳ banked {len(results)} spots as {bid} ({banked}/{len(spots)} safe)",
                  flush=True)
            results = {}

    if args.upload and results:
        bid = _upload_inbox_batch(session, url, svc, results, end_date, len(batches) + 1)
        banked += len(results)
        batches.append(bid)
        print(f"    ↳ banked the final {len(results)} spots as {bid}", flush=True)

    print(f"\nprocessed {banked if args.upload else len(results)} spots in "
          f"{(time.time()-t0)/60:.1f} min")
    if not args.upload:
        print("DRY RUN — nothing uploaded.")
        return
    if not batches:
        print("nothing to upload — done.")
        return
    print(f"{len(batches)} inbox batch(es) uploaded, {banked} spots. The next precompute cycle "
          f"folds them in; run scripts/local_size_gonogo.py after that.")


if __name__ == "__main__":
    main()
