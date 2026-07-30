"""Backfill per-spot size climatology from ~4 years of hourly wave history — the local-size unlock.

WHY: `RATING_LOCAL_SIZE` needs each spot's typical surfable-day BREAKING height. The live blob
accumulates our own forecasts (~2 days deep at any moment); Surfline's edge is 35 years of
observations. Verified 2026-07-30 (STUDY §8): Open-Meteo's marine archive serves ~2022-08→present
hourly wave height/period/direction per point in ONE call (35,016 rows, 0 nulls at Mavericks) —
~700x the evidence, today, on infrastructure the app already uses. ERA5 (1940→) deepens this in
place once CDS credentials exist; the blob format doesn't change.

THE COMPOSITION MANDATE (owner, 2026-07-30): the reference must be produced through the SAME
chain the live height uses — `resolve_surf_geometry` once per spot, then EVERY archived offshore
sample through `estimate_surf_at` (offshore→breaking), THEN the percentile of the TRANSFORMED
distribution. The transform is nonlinear in period, so percentile-then-transform is wrong. This
script reuses the production helpers directly (`merge_samples`, `reference_from_hist`), so the
histogram it writes is byte-compatible with what `reference_map` reads.

Usage (from backend/):
  python scripts/build_spot_size_climatology.py --query "mavericks,pipeline,sebastian" --dry-run
  python scripts/build_spot_size_climatology.py --limit 25            # smoke a slice, dry run
  python scripts/build_spot_size_climatology.py --all --upload        # full catalogue -> L2 (paced)

Default is DRY RUN (prints per-spot references, uploads nothing). --upload MERGES into the live
blob (the rolling histograms keep accumulating our own forecasts on top). After an upload, run
`scripts/local_size_gonogo.py` — the owner-anchor go/no-go stays the flip gate.
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.spot_size_climatology import (  # noqa: E402
    SCHEMA_VERSION, SIZE_CLIMATOLOGY_L2_KEY, hist_count, merge_samples, reference_from_hist,
)

OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
HISTORY_START = "2022-08-01"          # measured coverage floor (values are null before ~2022)
DEFAULT_STRIDE_H = 3                  # 3-hourly sampling: identical percentiles, 1/3 the transform cost
CALL_PACING_S = 0.25                  # ~240 calls/min, well under the free tier's 600/min


BACKFILL_VERSION = 2   # v2: swell-first period selector (v1 fed the MEAN period — see below)


def fetch_spot_history(lat: float, lng: float, end_date: str):
    """One call: the spot's full hourly offshore history.

    ⚠️ PERIOD SEMANTICS (v2, measured 2026-07-30): the API's `wave_period` is a MEAN-class period,
    not the peak our live chain feeds the transform — at Sebastian Inlet it read 4.9 s against a
    served peak of 7.9 s (windsea drags the mean down), and the transform is period-nonlinear
    exactly at shallow spots like it. The SWELL partition period matched the served peak there
    almost exactly (7.35-8.0 vs 7.35-8.38 s), so v2 selects swell-first. Deep-shelf spots
    (Mavericks: Kf/Ks ≈ 1, cap never binds) are measured period-INSENSITIVE, so the selector
    change is harmless where the swell label diverges from the served peak."""
    url = (f"{OM_MARINE}?latitude={lat}&longitude={lng}"
           f"&hourly=wave_height,wave_period,swell_wave_height,swell_wave_period,"
           f"swell_wave_direction,wind_wave_period"
           f"&start_date={HISTORY_START}&end_date={end_date}&timezone=UTC")
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-climatology"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    h = d.get("hourly") or {}
    return (h.get("time") or [], h.get("wave_height") or [], h.get("wave_period") or [],
            h.get("swell_wave_height") or [], h.get("swell_wave_period") or [],
            h.get("swell_wave_direction") or [], h.get("wind_wave_period") or [])


def _select_period_direction(mean_p, swell_h, swell_p, swell_d, wind_p):
    """The surf-relevant (period, direction) for one hour: the SWELL train's when a swell exists
    (>=0.15 m — the spectral peak rides it even when windsea height edges it out, measured), else
    the windsea's period with no direction (neutral exposure), else the mean-period fallback."""
    if swell_h is not None and swell_h >= 0.15 and swell_p and swell_p > 0:
        return swell_p, swell_d
    if wind_p and wind_p > 0:
        return wind_p, None
    return mean_p, None


def breaking_samples_for_spot(lat: float, lng: float, end_date: str, stride_h: int):
    """The spot's TRANSFORMED breaking-height samples: geometry resolved ONCE, every archived
    offshore sample through the production chain. Returns (samples, n_offshore, geometry_ok)."""
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    times, hs, mean_tp, sw_h, sw_p, sw_d, wn_p = fetch_spot_history(lat, lng, end_date)
    try:
        geo = resolve_surf_geometry(float(lat), float(lng))
    except Exception:
        geo = None
    samples, n_off = [], 0
    for i in range(0, len(times), max(1, stride_h)):
        h = hs[i] if i < len(hs) else None
        if h is None or h <= 0:
            continue
        p, d = _select_period_direction(
            mean_tp[i] if i < len(mean_tp) else None,
            sw_h[i] if i < len(sw_h) else None,
            sw_p[i] if i < len(sw_p) else None,
            sw_d[i] if i < len(sw_d) else None,
            wn_p[i] if i < len(wn_p) else None,
        )
        if p is None or p <= 0:
            continue
        n_off += 1
        breaking = None
        if geo is not None:
            try:
                breaking, _regime = estimate_surf_at(float(lat), float(lng), float(h), float(p),
                                                     swell_from_deg=d, geometry=geo)
            except Exception:
                breaking = None
        if breaking is None:
            # No geometry (open ocean / unresolvable pin): mirror sim_rating's fallback so a spot
            # is never silently skipped — but mark it by geometry_ok=False for the report.
            from services.weather_pipeline.surf_transform import komar_breaker_height
            breaking = komar_breaker_height(float(h), float(p))
        if breaking is not None:
            samples.append(breaking)
    return samples, n_off, geo is not None


def load_live_blob(session, url, svc):
    from scripts.local_size_gonogo import _get_json
    try:
        return _get_json(session, f"{url}/storage/v1/object/weather-products/{SIZE_CLIMATOLOGY_L2_KEY}",
                         svc, "size climatology blob")
    except SystemExit:
        return None


def upload_blob(session, url, svc, blob):
    resp = session.post(
        f"{url}/storage/v1/object/weather-products/{SIZE_CLIMATOLOGY_L2_KEY}",
        headers={"Authorization": f"Bearer {svc}", "apikey": svc,
                 "Content-Type": "application/json", "x-upsert": "true"},
        data=json.dumps(blob, separators=(",", ":")).encode("utf-8"), timeout=120,
    )
    if resp.status_code not in (200, 201):
        raise SystemExit(f"upload failed: HTTP {resp.status_code} {resp.text[:200]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--query", default="", help="comma-separated name substrings to include")
    ap.add_argument("--limit", type=int, default=0, help="cap the number of spots processed")
    ap.add_argument("--all", action="store_true", help="process the whole active catalogue")
    ap.add_argument("--stride", type=int, default=DEFAULT_STRIDE_H, help="sample stride in hours")
    ap.add_argument("--upload", action="store_true", help="merge + upload the blob to L2")
    ap.add_argument("--dry-run", action="store_true", help="(default) fetch+transform+report only")
    ap.add_argument("--no-resume", action="store_true",
                    help="re-fetch spots even if already backfilled (default resumes)")
    args = ap.parse_args()
    if not (args.query or args.limit or args.all):
        ap.error("pick a scope: --query, --limit or --all")

    import requests
    from scripts.local_size_gonogo import _prod_credentials, _all_spots
    session = requests.Session()
    url, svc, _env = _prod_credentials(session)
    spots = _all_spots(session, url, svc)
    if args.query:
        needles = [q.strip().lower() for q in args.query.split(",") if q.strip()]
        spots = [s for s in spots if any(n in (s.get("name") or "").lower() for n in needles)]
    if args.limit:
        spots = spots[:args.limit]

    # RESUME (2026-07-30, learned on the first full run): the free tier's budget is WEIGHTED —
    # a 4-year historical call counts as many calls, and the first run hit sustained 429 at spot
    # 152 of 1,773. Spots whose blob record already carries this backfill's marker are skipped, so
    # the catalogue completes across daily chunks. --no-resume re-fetches everything in scope.
    if not args.no_resume:
        live_now = load_live_blob(session, url, svc) or {}
        done = {sid for sid, rec in (live_now.get("spots") or {}).items()
                if isinstance(rec, dict) and (rec.get("backfill") or {}).get("v") == BACKFILL_VERSION}
        before = len(spots)
        spots = [s for s in spots if str(s["id"]) not in done]
        print(f"resume: {before - len(spots)} spots already backfilled, {len(spots)} remaining")
    print(f"spots in scope: {len(spots)}  (history {HISTORY_START}->today, stride {args.stride}h)")

    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    results, no_geometry = {}, 0
    consecutive_429 = 0
    t0 = time.time()
    for i, s in enumerate(spots):
        sid, name = str(s["id"]), s.get("name") or "?"
        try:
            samples, n_off, geo_ok = breaking_samples_for_spot(
                float(s["latitude"]), float(s["longitude"]), end_date, args.stride)
            consecutive_429 = 0
        except Exception as e:
            msg = str(e)[:120]
            print(f"  [{i+1}/{len(spots)}] {name}: FETCH/TRANSFORM FAILED — {msg}")
            if "429" in msg:
                consecutive_429 += 1
                if consecutive_429 >= 5:
                    # CIRCUIT BREAKER: the budget is exhausted — burning 1,600 more refused calls
                    # helps nobody. Save what we have; the resume filter continues tomorrow.
                    print(f"  BUDGET EXHAUSTED after {len(results)} spots — halting; "
                          f"re-run tomorrow to resume where this left off.")
                    break
            continue
        if not geo_ok:
            no_geometry += 1
        hist = merge_samples(None, samples)
        ref = reference_from_hist(hist)
        results[sid] = {"hist": hist, "n": hist_count(hist), "name": name,
                        "geometry_ok": geo_ok, "n_offshore": n_off, "ref_preview": ref}
        print(f"  [{i+1}/{len(spots)}] {name}: offshore={n_off} surfable={hist_count(hist)} "
              f"reference={ref if ref is not None else 'n/a'} m"
              f"{'' if geo_ok else '  (NO GEOMETRY — komar fallback)'}")
        time.sleep(CALL_PACING_S)
    print(f"\nprocessed {len(results)} spots in {time.time()-t0:.0f}s; {no_geometry} without geometry")

    if not args.upload:
        print("\nDRY RUN — nothing uploaded. Re-run with --upload to MERGE into the live blob, "
              "then run scripts/local_size_gonogo.py for the owner-anchor go/no-go.")
        return
    if not results:
        print("nothing to upload (no spots processed this run).")
        return

    live = load_live_blob(session, url, svc) or {}
    live_spots = dict(live.get("spots") or {})
    merged_new, merged_into = 0, 0
    for sid, rec in results.items():
        existing = live_spots.get(sid) if isinstance(live_spots.get(sid), dict) else None
        if existing and isinstance(existing.get("hist"), list):
            # Merge counts bin-wise: the live rolling histogram keeps accumulating on top.
            combined = [a + b for a, b in zip(existing["hist"], rec["hist"])]
            live_spots[sid] = {"hist": combined, "n": hist_count(combined),
                               "backfill": {"source": "om_marine", "v": BACKFILL_VERSION, "from": HISTORY_START,
                                            "to": end_date, "n": rec["n"]}}
            merged_into += 1
        else:
            live_spots[sid] = {"hist": rec["hist"], "n": rec["n"],
                               "backfill": {"source": "om_marine", "v": BACKFILL_VERSION, "from": HISTORY_START,
                                            "to": end_date, "n": rec["n"]}}
            merged_new += 1
    blob = {"schema_version": SCHEMA_VERSION,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "spots": live_spots}
    upload_blob(session, url, svc, blob)
    print(f"uploaded {SIZE_CLIMATOLOGY_L2_KEY}: {merged_new} new spot histograms, "
          f"{merged_into} merged into existing.")

    # VERIFY-AFTER-UPLOAD: the precompute cron also read-modify-writes this blob (single-writer
    # assumption). If its write raced ours between our read and upload, our whole backfill is the
    # side that vanishes. Check a sentinel and re-merge onto the CURRENT blob once if needed —
    # `results` is still in memory, so the retry costs one download+upload, not a 2h re-run.
    sentinel = next(iter(results))
    after = load_live_blob(session, url, svc) or {}
    if not ((after.get("spots") or {}).get(sentinel, {}) or {}).get("backfill"):
        print("RACE DETECTED: backfill marker missing after upload (precompute wrote concurrently). "
              "Re-merging onto the current blob...")
        live_spots = dict((after.get("spots") or {}))
        for sid, rec in results.items():
            existing = live_spots.get(sid) if isinstance(live_spots.get(sid), dict) else None
            if existing and isinstance(existing.get("hist"), list):
                combined = [a + b for a, b in zip(existing["hist"], rec["hist"])]
                live_spots[sid] = {"hist": combined, "n": hist_count(combined),
                                   "backfill": {"source": "om_marine", "v": BACKFILL_VERSION, "from": HISTORY_START,
                                                "to": end_date, "n": rec["n"]}}
            else:
                live_spots[sid] = {"hist": rec["hist"], "n": rec["n"],
                                   "backfill": {"source": "om_marine", "v": BACKFILL_VERSION, "from": HISTORY_START,
                                                "to": end_date, "n": rec["n"]}}
        upload_blob(session, url, svc, {"schema_version": SCHEMA_VERSION,
                                        "updated_at": datetime.now(timezone.utc).isoformat(),
                                        "spots": live_spots})
        print("re-upload complete.")
    print("Run scripts/local_size_gonogo.py next — the owner-anchor go/no-go stays the flip gate.")


if __name__ == "__main__":
    main()
