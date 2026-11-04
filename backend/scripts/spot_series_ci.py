#!/usr/bin/env python3
"""spot_series_ci.py: the spot-hub chart series producer (spot-hub phase 3, `.github/workflows/spot-series.yml`).

Rates every active spot on the hub's frame plan with `spot_ratings.rate_one_spot` IN CI, never on the 1-CPU serve box,
and builds 64 gzipped hash shards per model (`services/weather_pipeline/spot_series.py` holds the logic and the
format). Three steps, one per workflow stage:

    rate      one matrix job: one model, the hash shards `s % jobs == job`; restores products from L2 exactly as
              precompute_ci.py does, rates, writes `rows-<MODEL>-<job>.json.gz` + `meta-<MODEL>-<job>.json`.
              --hub-parity K also runs the PHASE-2 hub path (`spot_hub_composition.resolve_hub_conditions`) on K
              spots and compares it with the glyph's precomputed item and with these rows: the flip-gate read
              "hub ratings equal glyph ratings" on real products.
    assemble  reads every rows file, applies the glyph precompute's observation gate across models, builds the
              shards + index.json, writes them under --out and a summary (bytes, frames, time, parity) to stdout and
              $GITHUB_STEP_SUMMARY.
    publish   uploads --dir to Supabase Storage under spot_series/v1/. ON by default; the repo variable
              SPOT_SERIES_PUBLISH='0' is the kill switch (the workflow skips the step, and this refuses).
    synthetic a local, network-free dry run on a synthetic catalogue: the producer's own overhead, the frame count
              and the shard bytes (the resolve cost is CI's measured ~54 ms/frame, not this machine's).

ENV: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (rate / assemble reports / publish), the served science flags (the
workflow copies precompute.yml's; tests/test_spot_series.py pins that they match).
"""
import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
from datetime import timedelta
from glob import glob

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from services.weather_pipeline import spot_series as SS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
logger = logging.getLogger("spot_series_ci")


def _restore_products() -> bool:
    """The serve-box pattern precompute_ci.py uses: L2 -> local store, then the L1 grid prewarm."""
    from services.weather_pipeline.store import ProductStore
    restored, errors = ProductStore().restore_from_supabase()
    logger.info("L2 restore: %d products%s", restored, f" (errors: {errors})" if errors else "")
    if not restored:
        return False
    from services.weather_pipeline.prefetcher import prefetch_supabase_products
    asyncio.run(prefetch_supabase_products())
    return True


def _ref_map():
    if os.environ.get("RATING_LOCAL_SIZE", "0") != "1":
        return {}
    from services.weather_pipeline.spot_size_climatology import load_size_climatology_for_rating, reference_map
    clim, status = load_size_climatology_for_rating()
    if status == "unavailable":
        # The glyph precompute REFUSES to rate without each spot's reference; so does this.
        raise RuntimeError("size climatology unreadable: refusing to rate on the global curve while the flag says local")
    return reference_map(clim)


async def _prewarm(spots, model):
    coords = [(s["latitude"], s["longitude"]) for s in spots]
    if model == "EURO":
        try:
            from services.copernicus_point_batching import EURO_POINT_FORECAST_DAYS, prewarm_euro_marine_point_cache
            await prewarm_euro_marine_point_cache(coords, forecast_days=EURO_POINT_FORECAST_DAYS)
        except Exception as e:
            logger.warning("CMEMS pre-warm skipped: %s", e)
    if os.environ.get("RATING_TIDE", "0") == "1":
        try:
            from services.weather_pipeline.tide import prewarm_tide_cache
            logger.info("tide cache pre-warmed: %d cells", await prewarm_tide_cache(coords))
        except Exception as e:
            logger.warning("tide pre-warm skipped: %s", e)


async def hub_parity(resolver, spots, model, base, rows, l2):
    """The phase-2 hub path vs the glyph item (current frame) and vs these rows (daily max). Counts only."""
    from services.weather_pipeline.spot_hub_composition import (
        clear_caches, current_valid_time, local_date, precomputed_item, resolve_hub_conditions, valid_time_str)
    out = {"spots": 0, "glyph_compared": 0, "glyph_equal": 0, "days_compared": 0, "days_equal": 0, "mismatches": []}
    vt = valid_time_str(current_valid_time(base))
    for sp in spots:
        clear_caches()
        hub = await resolve_hub_conditions(resolver, model, sp["latitude"], sp["longitude"], 3, spot_id=sp["id"],
                                           spot_meta=sp, horizon_hours=72, now=base, load_l2=lambda: l2)
        out["spots"] += 1
        cur = hub["current_conditions"]
        glyph, _src, _served = precomputed_item(l2, sp, model, vt, exact=False)
        if glyph is not None:
            out["glyph_compared"] += 1
            same = (cur.get("surf_height_m"), cur.get("rating"), cur.get("rating_level")) == (
                glyph.get("surf_height_m"), glyph.get("score"), glyph.get("level"))
            out["glyph_equal"] += int(same)
            if not same and len(out["mismatches"]) < 10:
                out["mismatches"].append({"spot": str(sp["id"]), "hub": [cur.get("surf_height_m"), cur.get("rating")],
                                          "glyph": [glyph.get("surf_height_m"), glyph.get("score")]})
        series = rows.get(str(sp["id"]), {})
        for day in hub["forecast"]:
            if day.get("status") != "available":
                continue
            heights = [r["surf_height_m"] for r in series.get("rows", [])
                       if isinstance(r.get("surf_height_m"), (int, float))
                       and local_date(SS._parse(r["valid_time"]), series.get("off", 0)).isoformat() == day["date"]
                       and SS._parse(r["valid_time"]) <= base + timedelta(hours=72)]
            if heights:
                out["days_compared"] += 1
                out["days_equal"] += int(max(heights) == day.get("surf_height_max_m"))
    return out


def cmd_rate(a) -> int:
    from services.weather_pipeline.spot_ratings_precompute import _make_point_resolver, fetch_active_spots_via_rest
    model = a.model.upper()
    base = SS.base_time_from(a.base_time)
    if not _restore_products():
        logger.error("no products restored from L2; nothing to rate")
        return 1
    wanted = set(SS.job_shards(a.job, a.jobs))
    spots = [s for s in fetch_active_spots_via_rest() if SS.shard_of(s["id"]) in wanted]
    if a.limit:
        spots = spots[:a.limit]
    if not spots:
        logger.error("no spots in shards %s", sorted(wanted))
        return 1
    resolver = _make_point_resolver()
    asyncio.run(_prewarm(spots, model))
    horizon = SS.horizon_for(model)
    t0 = time.monotonic()
    rows = asyncio.run(SS.rate_spot_series(resolver, spots, model, base, horizon, _ref_map()))
    elapsed = time.monotonic() - t0
    n_frames = sum(len(r["rows"]) for r in rows.values())
    n_rated = sum(1 for r in rows.values() for f in r["rows"] if f.get("raw_score") is not None)
    meta = {"model": model, "job": a.job, "jobs": a.jobs, "base_time": SS._iso(base), "horizon_h": horizon,
            "spots": len(spots), "frames": n_frames, "rated": n_rated, "elapsed_s": round(elapsed, 1),
            "ms_per_frame": round(1000 * elapsed / n_frames, 1) if n_frames else None}
    if a.hub_parity:
        from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2
        meta["hub_parity"] = asyncio.run(hub_parity(resolver, spots[:a.hub_parity], model, base, rows,
                                                    load_spot_ratings_l2()))
    os.makedirs(a.out, exist_ok=True)
    SS.dump_model_rows(os.path.join(a.out, f"rows-{model}-{a.job}.json.gz"), model, base, rows, meta)
    with open(os.path.join(a.out, f"meta-{model}-{a.job}.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    logger.info("rate %s job %d/%d: %s", model, a.job, a.jobs, json.dumps(meta))
    # The glyph precompute's per-model coverage guard (SPOT_RATINGS_MIN_COVERAGE, default 0.05): a job below it
    # fails, so the assemble job's publish step (which needs every rate job green) never ships a hollow series.
    floor = float(os.environ.get("SPOT_RATINGS_MIN_COVERAGE", "0.05"))
    if not n_frames or n_rated / n_frames < floor:
        logger.error("coverage %d/%d below the %.0f%% floor: failing the job", n_rated, n_frames, floor * 100)
        return 1
    return 0


def _assemble(paths, base, reports=None):
    by_model, metas = {}, []
    for p in paths:
        obj = SS.load_model_rows(p)
        by_model.setdefault(obj["model"], {}).update(obj["spots"])
        metas.append(obj.get("meta") or {})
    capped = SS.gate_models(by_model, reports)
    return by_model, metas, capped


def cmd_assemble(a) -> int:
    paths = sorted(glob(os.path.join(a.inp, "**", "rows-*.json.gz"), recursive=True))
    if not paths:
        logger.error("no rows files under %s", a.inp)
        return 1
    reports = {}
    if os.environ.get("RATING_OBS_GATE", "0") == "1":
        try:
            from services.weather_pipeline.rating_confirmation import fetch_recent_reports_via_rest
            reports = fetch_recent_reports_via_rest()
        except Exception as e:
            logger.warning("reports unavailable (model agreement still gates): %s", e)
    base = SS.base_time_from(SS.load_model_rows(paths[0])["base_time"])
    by_model, metas, capped = _assemble(paths, base, reports)
    objects = SS.build_shards(by_model, base)
    os.makedirs(a.out, exist_ok=True)
    for key, data in objects.items():
        dest = os.path.join(a.out, key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
    summary = {**SS.summarize(objects), "capped": capped, "jobs": metas}
    with open(os.path.join(a.out, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1)
    _step_summary(summary)
    logger.info("assemble: %s", json.dumps({k: v for k, v in summary.items() if k != "jobs"}))
    return 0


def _step_summary(summary):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = ["## Spot series (dark)", "",
             f"shards {summary['shards']}, gz total {summary['bytes_gz_total']:,} B, "
             f"mean {summary['bytes_gz_mean']:,} B, max {summary['bytes_gz_max']:,} B; capped {summary['capped']}", "",
             "| model | job | spots | frames | rated | s | ms/frame | hub = glyph | hub day max = series |",
             "|---|---|---|---|---|---|---|---|---|"]
    for m in summary["jobs"]:
        hp = m.get("hub_parity") or {}
        lines.append(f"| {m.get('model')} | {m.get('job')} | {m.get('spots')} | {m.get('frames')} | {m.get('rated')} "
                     f"| {m.get('elapsed_s')} | {m.get('ms_per_frame')} "
                     f"| {hp.get('glyph_equal', '-')}/{hp.get('glyph_compared', '-')} "
                     f"| {hp.get('days_equal', '-')}/{hp.get('days_compared', '-')} |")
    text = "\n".join(lines) + "\n"
    print(text)
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)


def cmd_publish(a) -> int:
    if os.environ.get("SPOT_SERIES_PUBLISH", "1") == "0":
        logger.error("SPOT_SERIES_PUBLISH is '0' (the kill switch): refusing to upload (the workflow gates this too)")
        return 1
    from services.weather_pipeline.store import ProductStore
    store = ProductStore()
    root = os.path.join(a.dir, SS.L2_PREFIX.split("/")[0])
    files = sorted(glob(os.path.join(root, "**", "*.*"), recursive=True))
    # Shards first, the index LAST, so a reader that sees a new index never meets an old shard set.
    files.sort(key=lambda f: f.endswith("index.json"))
    for f in files:
        key = os.path.relpath(f, a.dir).replace(os.sep, "/")
        with open(f, "rb") as fh:
            store._upload_to_supabase(key, fh.read(), strict=True)
    logger.info("published %d objects under %s/", len(files), SS.L2_PREFIX)
    return 0


class _SyntheticResolver:
    """A network-free stand-in for the point resolver: plausible seas, so frame counts and bytes are real."""

    def __init__(self, seed=7):
        self.rng = random.Random(seed)

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
        dt = SS._parse(valid_time_str)
        h = max(0.2, 1.2 + 0.8 * self.rng.random() - 0.3 * ((dt.hour % 12) / 12))
        r = NormalizedPointResponse(
            model=model, provider="synthetic", domain=domain, layer=layer, run_time=dt - timedelta(hours=6),
            valid_time=dt, is_forecast_authoritative=True, is_estimated=False,
            point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
                                        interpolation_method="nearest",
                                        speed=(h * 0.9 if domain == "marine" else 3 + 15 * self.rng.random()),
                                        direction=self.rng.uniform(0, 360), period=8 + 8 * self.rng.random()),
            value_kind="wave", value_unit="m", display_unit_hint="ft", source_variables=["x"], freshness_sec=0)
        if domain == "marine":
            r.surf_height_m, r.surf_regime, r.shore_normal_deg = h, "breaking", self.rng.uniform(0, 360)
        return r

    async def find_cached_grid_product(self, *a, **k):
        return None


def cmd_synthetic(a) -> int:
    os.environ.setdefault("RATING_OBS_GATE", "1")        # the served lane gates; reports {} = model agreement only
    rng = random.Random(11)
    spots = [{"id": f"syn-{i:04d}", "name": None, "latitude": rng.uniform(-45, 60), "longitude": rng.uniform(-180, 180),
              "accuracy_flag": None, "is_verified_peak": False, "best_tide": None} for i in range(a.spots)]
    base = SS.base_time_from(a.base_time)
    resolver = _SyntheticResolver()
    by_model, timing = {}, {}
    for model in a.models.split(","):
        t0 = time.monotonic()
        by_model[model] = asyncio.run(SS.rate_spot_series(resolver, spots, model, base, SS.horizon_for(model)))
        timing[model] = round(time.monotonic() - t0, 1)
    capped = SS.gate_models(by_model)
    t0 = time.monotonic()
    objects = SS.build_shards(by_model, base)
    frames = {m: sum(len(r["rows"]) for r in v.values()) for m, v in by_model.items()}
    out = {**SS.summarize(objects), "spots": a.spots, "frames": frames, "rate_s": timing,
           "build_s": round(time.monotonic() - t0, 1), "capped": capped,
           "projected_ci_min_per_model_at_54ms": {m: round(n * 0.054 / 60, 1) for m, n in frames.items()}}
    print(json.dumps(out, indent=1))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rate")
    r.add_argument("--model", required=True)
    r.add_argument("--job", type=int, default=0)
    r.add_argument("--jobs", type=int, default=1)
    r.add_argument("--base-time", default=None)
    r.add_argument("--limit", type=int, default=0, help="rate at most N spots (a dry run)")
    r.add_argument("--hub-parity", type=int, default=0)
    r.add_argument("--out", required=True)
    s = sub.add_parser("assemble")
    s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--out", required=True)
    p = sub.add_parser("publish")
    p.add_argument("--dir", required=True)
    y = sub.add_parser("synthetic")
    y.add_argument("--spots", type=int, default=1773)
    y.add_argument("--models", default="GFS,EURO,ICON")
    y.add_argument("--base-time", default=None)
    a = ap.parse_args(argv)
    return {"rate": cmd_rate, "assemble": cmd_assemble, "publish": cmd_publish, "synthetic": cmd_synthetic}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
