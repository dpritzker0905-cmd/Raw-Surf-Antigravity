#!/usr/bin/env python3
"""Collect the GFS/EURO/ICON per-node spread of the world wave field (DATA ONLY, dark, 2026-10-19).

What it does, once per forecast-ingest cycle when armed: find the valid times at which GFS, EURO and ICON all have an
authoritative `global_mid` marine waves product, keep those at GFS lead 0, 24, 48 ... h (MODEL_SPREAD_LEAD_STEP_H,
at most MODEL_SPREAD_MAX_FRAMES), build services/weather_pipeline/model_spread.build_spread for each frame not
already collected for the same three member runs, and write it to the PRIVATE weather-products bucket under its own
prefix:

  model_spread/global_mid/<valid>/g<run>_e<run>_i<run>.json.gz   gzip JSON, one per frame and member-run triple
  model_spread/global_mid/index.json                            no-cache: every frame's key, members, digest,
                                                                and the latest decile report

Older frames than MODEL_SPREAD_RETAIN_DAYS (by valid time) are dropped from the index and deleted. The decile report
(spread by mean-height decile, pooled over this run's frames) is printed and appended to the Actions step summary.

SERVES NOTHING, DRAWS NOTHING: no route, no client and no manifest entry reads these keys. The `model_spread/` prefix
is namespaced, so the designated-writer gate on top-level pipeline keys is not involved and the pipeline manifest is
never written. Products are read through ProductStore.load_product, so in forecast-ingest.yml the files the ingest step
just wrote come from the runner's disk cache, and only the rest are downloaded.

Credentials by NAME only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GitHub Actions secrets in forecast-ingest.yml).

Dark: forecast-ingest.yml runs it only when the repository variable MODEL_SPREAD_PUBLISH is '1'.

Offline:  python scripts/publish_model_spread.py --store-dir <ProductStore cache dir> --out-dir <dir>
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.weather_pipeline import model_spread as ms  # noqa: E402
from services.weather_pipeline.sampler import PointSampler  # noqa: E402

BUCKET = "weather-products"
PREFIX = f"model_spread/{ms.TIER}"
INDEX = f"{PREFIX}/index.json"
IMMUTABLE = "private, max-age=31536000, immutable"
REVALIDATE = "no-cache"
MEMBER_TAG = {"GFS": "g", "EURO": "e", "ICON": "i"}


def _env_int(name, default):
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _stamp(t):
    return t.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")


def frame_key(vt, items):
    """The object key for one frame: valid time plus the three member runs, so a newer run of any member is a new
    object and an unchanged triple is never rebuilt."""
    runs = "_".join(f"{MEMBER_TAG[m]}{_stamp(items[m].run_time)}" for m in ms.SPREAD_MEMBERS)
    return f"{PREFIX}/{_stamp(vt)}/{runs}.json.gz"


class LocalSink:
    """Writes under out_dir (cache-control recorded); the offline twin of SupabaseSink."""

    def __init__(self, out_dir):
        self.out_dir = Path(out_dir)
        self.headers, self.deleted = {}, []

    def read(self, key):
        p = self.out_dir / key
        return p.read_bytes() if p.exists() else None

    def write(self, key, data, content_type, cache_control):
        dest = self.out_dir / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        self.headers[key] = {"content-type": content_type, "cache-control": cache_control}

    def delete(self, keys):
        for k in keys:
            (self.out_dir / k).unlink(missing_ok=True)
        self.deleted.extend(keys)


class SupabaseSink:
    """Storage REST API, the same mechanism as publish_frame_images.SupabaseStore, on the private products bucket."""

    def __init__(self):
        import requests
        self.requests = requests
        self.base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not self.base or not key:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        self.auth = {"Authorization": f"Bearer {key}", "apikey": key}

    def read(self, key):
        resp = self.requests.get(f"{self.base}/storage/v1/object/{BUCKET}/{key}?cb={int(time.time() * 1000)}",
                                 headers=self.auth, timeout=60)
        if resp.status_code in (400, 404):
            return None                                    # Supabase answers a missing object with 400 or 404
        if resp.status_code != 200:
            raise RuntimeError(f"read {BUCKET}/{key}: HTTP {resp.status_code}")
        return resp.content

    def write(self, key, data, content_type, cache_control):
        headers = dict(self.auth, **{"Content-Type": content_type, "x-upsert": "true", "cache-control": cache_control})
        resp = self.requests.post(f"{self.base}/storage/v1/object/{BUCKET}/{key}", headers=headers, data=data,
                                  timeout=60)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"upload {BUCKET}/{key}: HTTP {resp.status_code}: {resp.text[:200]}")

    def delete(self, keys):
        if not keys:
            return
        resp = self.requests.delete(f"{self.base}/storage/v1/object/{BUCKET}", headers=self.auth,
                                    json={"prefixes": list(keys)}, timeout=60)
        if resp.status_code not in (200, 201):
            print(f"[model_spread] delete of {len(keys)} old frames failed: HTTP {resp.status_code}", file=sys.stderr)


def load_index(sink):
    raw = sink.read(INDEX)
    if not raw:
        return {"version": ms.VERSION, "frames": []}
    return json.loads(raw)


def prune(index, now, retain_days):
    """Drop index entries whose valid time is older than `retain_days`; returns the keys to delete."""
    cutoff = now - timedelta(days=retain_days)
    keep, gone = [], []
    for f in index["frames"]:
        vt = datetime.fromisoformat(f["valid_time"].replace("Z", "+00:00"))
        (keep if vt >= cutoff else gone).append(f)
    index["frames"] = keep
    return [f["key"] for f in gone]


def remote_manifest(sink, fallback):
    """The PUBLISHED manifest (cache-busted read of weather-products/manifest.json), so a frame pairs the members the
    serve box sees; the runner's local copy only when the read answers nothing."""
    raw = sink.read("manifest.json") if isinstance(sink, SupabaseSink) else None
    if not raw:
        return fallback()
    from services.weather_pipeline.schemas import PipelineManifest
    return PipelineManifest.model_validate(json.loads(raw))


def collect(source, sink, now=None, step_h=24, max_frames=8, retain_days=21, sampler_factory=None,
            manifest=None):
    """Build and write every selected frame not yet collected; returns (built frames, index, stats).

    `source` is the ProductStore surface (get_manifest, load_product). A member whose loaded product is not the run
    the manifest names (a stale disk copy) skips that frame rather than mixing runs under one key."""
    now = now or datetime.now(timezone.utc)
    sampler_factory = sampler_factory or (lambda: PointSampler(memoize=True))
    index = load_index(sink)
    have = {f["key"] for f in index["frames"]}
    aligned = ms.aligned_frames(manifest if manifest is not None else source.get_manifest())
    chosen = ms.select_frames(aligned, step_h, max_frames)
    stats = {"aligned": len(aligned), "selected": len(chosen), "already": 0, "built": 0, "unloadable": 0,
             "stale_member": 0, "refused": 0, "bytes": 0}
    built = []
    for vt in chosen:
        items = aligned[vt]
        key = frame_key(vt, items)
        if key in have:
            stats["already"] += 1
            continue
        products = {m: source.load_product(items[m].filename) for m in ms.SPREAD_MEMBERS}
        if any(p is None for p in products.values()):
            stats["unloadable"] += 1
            continue
        if any(p.run_time != items[m].run_time for m, p in products.items()):
            stats["stale_member"] += 1
            continue
        try:
            frame = ms.build_spread(products["GFS"], {m: products[m] for m in ("EURO", "ICON")}, sampler_factory())
        except ValueError as e:
            stats["refused"] += 1
            print(f"[model_spread] {key}: refused ({e})", file=sys.stderr)
            continue
        body = gzip.compress(json.dumps(frame, separators=(",", ":")).encode("utf-8"), compresslevel=9)
        sink.write(key, body, "application/gzip", IMMUTABLE)
        stats["built"] += 1
        stats["bytes"] += len(body)
        index["frames"].append({"key": key, "valid_time": frame["valid_time"], "lead_h": frame["lead_h"],
                                "bytes": len(body), "members": frame["members"], "counts": frame["counts"],
                                "summary": frame["summary"], "max_spread_node": frame["max_spread_node"]})
        built.append(frame)
    gone = prune(index, now, retain_days)
    report = ms.decile_report(built)
    index.update(version=ms.VERSION, tier=ms.TIER, written_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                 writer=f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local",
                 last_run={"stats": stats, "decile_report": report})
    index["frames"].sort(key=lambda f: (f["valid_time"], f["key"]))
    if built or gone:
        sink.write(INDEX, json.dumps(index, indent=1).encode("utf-8"), "application/json", REVALIDATE)
    sink.delete(gone)
    stats["pruned"] = len(gone)
    return built, index, stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store-dir", help="offline: a ProductStore cache dir (manifest.json + product files)")
    ap.add_argument("--out-dir", help="offline: write the objects here (required with --store-dir)")
    ap.add_argument("--step-hours", type=int, default=_env_int("MODEL_SPREAD_LEAD_STEP_H", 24))
    ap.add_argument("--max-frames", type=int, default=_env_int("MODEL_SPREAD_MAX_FRAMES", 8))
    ap.add_argument("--retain-days", type=int, default=_env_int("MODEL_SPREAD_RETAIN_DAYS", 21))
    args = ap.parse_args(argv)
    if bool(args.store_dir) != bool(args.out_dir):
        ap.error("--store-dir and --out-dir go together")
    from services.weather_pipeline.store import ProductStore
    if args.store_dir:
        source, sink = ProductStore(cache_dir=Path(args.store_dir)), LocalSink(args.out_dir)
    else:
        source, sink = ProductStore(), SupabaseSink()
    t0 = time.perf_counter()
    built, index, stats = collect(source, sink, step_h=args.step_hours, max_frames=args.max_frames,
                                  retain_days=args.retain_days, manifest=remote_manifest(sink, source.get_manifest))
    stats["seconds"] = round(time.perf_counter() - t0, 1)
    md = ms.report_markdown(index["last_run"]["decile_report"],
                            f"Model spread (GFS/EURO/ICON, {ms.TIER}): {len(built)} new frames, "
                            f"{sum(len(f['nodes']['mean']) for f in built)} nodes")
    print(json.dumps(stats))
    print(md)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(md + "\n```\n" + json.dumps(stats) + "\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
