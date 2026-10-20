#!/usr/bin/env python3
"""Publish ONE per-time-step field image to a public bucket (one-field proof, 2026-10-19).

What it proves: the world-view wave field the browser asks the 1-CPU Render box for (`/grid` -> the stored
`gfs_marine_waves_global_mid_<valid>.json`, 181 x 82 nodes at 2 deg) can instead be a static ~20-40 KB PNG on the
Supabase CDN, decoded by the browser with no server CPU at all. This is the pattern the leading forecast maps use
(finite precomputed bytes per model x run x layer x valid time, cached hard; the GPU does the rest). It serves
NOTHING: no client draws from it. The dark client loader (frontend frameImageProof.js) only fetches it, decodes it
and compares it node by node with /grid for the same valid time.

  one field:   GFS / marine / waves / global_mid, the stored product nearest to now (not estimated)
  one object:  weather-frames/gfs/waves/global_mid/<run>/<valid>.png   cache-control: immutable, 1 year
  index:       weather-frames/manifest.json                            cache-control: no-cache (store.py 07-06 scar)

The image is checked against its own source before anything is uploaded (decode the PNG bytes back, compare every
node); a single mismatching node aborts the publish.

Credentials by NAME only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GitHub Actions secrets in forecast-ingest.yml).
The private `weather-products` bucket is only READ. The only writes go to the separate public `weather-frames`
bucket, so this cannot touch the pipeline manifest or any product (the designated-writer gate is not involved).

Dark: forecast-ingest.yml runs it only when the repository variable FRAME_IMAGES_PUBLISH is '1'.

Offline:  python scripts/publish_frame_images.py --store-dir <serve_synthetic store> --out-dir <dir>
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.frame_image import encode_png, parity  # noqa: E402

SOURCE_BUCKET = "weather-products"
FRAME_BUCKET = "weather-frames"
TARGET = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


def _parse(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def pick_entry(products, now):
    """The stored target product whose valid time is nearest `now` (ties -> the earlier one), or None."""
    best = None
    for p in products or []:
        if any(p.get(k) != v for k, v in TARGET.items()) or p.get("is_estimated") or not p.get("filename"):
            continue
        vt = _parse(p.get("valid_time_start") or p.get("valid_time"))
        if vt is None:
            continue
        key = (abs((vt - now).total_seconds()), vt)
        if best is None or key < best[0]:
            best = (key, p)
    return best[1] if best else None


def frame_path(product):
    stamp = lambda ts: (ts or "unknown").replace("-", "").replace(":", "")  # noqa: E731
    run = stamp(product.get("model_run_time") or product.get("run_time"))
    return f"gfs/waves/global_mid/{run}/{stamp(product.get('valid_time'))}.png"


class LocalStore:
    """Reads a serve_synthetic store directory; writes the public objects under out_dir (cache-control recorded)."""

    def __init__(self, store_dir, out_dir):
        self.store_dir, self.out_dir = Path(store_dir), Path(out_dir)
        self.headers = {}

    def read_source(self, name):
        return (self.store_dir / name).read_bytes()

    def ensure_bucket(self):
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def write(self, path, data, content_type, cache_control):
        dest = self.out_dir / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        self.headers[path] = {"content-type": content_type, "cache-control": cache_control}


class SupabaseStore:
    """Storage REST API, the same mechanism as store.py `_upload_to_supabase` (x-upsert + cache-control headers)."""

    def __init__(self):
        import requests
        self.requests = requests
        self.base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not self.base or not self.key:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        self.auth = {"Authorization": f"Bearer {self.key}", "apikey": self.key}

    def read_source(self, name):
        bust = f"?cb={int(time.time() * 1000)}" if name == "manifest.json" else ""
        resp = self.requests.get(f"{self.base}/storage/v1/object/{SOURCE_BUCKET}/{name}{bust}", headers=self.auth, timeout=60)
        if resp.status_code != 200:
            raise RuntimeError(f"read {SOURCE_BUCKET}/{name}: HTTP {resp.status_code}")
        return resp.content

    def ensure_bucket(self):
        resp = self.requests.post(f"{self.base}/storage/v1/bucket", headers=self.auth, timeout=30,
                                  json={"id": FRAME_BUCKET, "name": FRAME_BUCKET, "public": True})
        if resp.status_code not in (200, 201) and "already exists" not in resp.text.lower():
            raise RuntimeError(f"create bucket {FRAME_BUCKET}: HTTP {resp.status_code}: {resp.text[:200]}")

    def write(self, path, data, content_type, cache_control):
        headers = dict(self.auth, **{"Content-Type": content_type, "x-upsert": "true", "cache-control": cache_control})
        resp = self.requests.post(f"{self.base}/storage/v1/object/{FRAME_BUCKET}/{path}", headers=headers, data=data, timeout=60)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"upload {FRAME_BUCKET}/{path}: HTTP {resp.status_code}: {resp.text[:200]}")


def decode_png(png):
    from PIL import Image
    img = Image.open(io.BytesIO(png))
    if img.mode != "RGBA":
        raise ValueError(f"PNG decoded as {img.mode}, expected RGBA")
    return img.tobytes(), img.width, img.height


def publish(store, now=None):
    """Pick, encode, self-check, upload. Returns the manifest frame record; raises on any parity failure."""
    now = now or datetime.now(timezone.utc)
    manifest = json.loads(store.read_source("manifest.json"))
    entry = pick_entry(manifest.get("products"), now)
    if entry is None:
        raise RuntimeError(f"no stored {TARGET} product in the manifest")
    product = json.loads(store.read_source(entry["filename"]))
    t0 = time.perf_counter()
    png, meta = encode_png(product)
    encode_ms = round((time.perf_counter() - t0) * 1000, 1)
    check = parity(product, *decode_png(png))
    if check["bad"]:
        raise RuntimeError(f"self-parity failed, nothing uploaded: {check}")
    path = frame_path(product)
    store.ensure_bucket()
    store.write(path, png, "image/png", IMMUTABLE)
    record = dict(meta, path=path, bytes=len(png), source_filename=entry["filename"], parity=check, encode_ms=encode_ms)
    index = {"version": 1, "written_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "writer": f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local",
             "frames": [record]}
    store.write("manifest.json", json.dumps(index, indent=1).encode("utf-8"), "application/json", REVALIDATE)
    return record


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store-dir", help="offline: read a serve_synthetic store instead of Supabase")
    ap.add_argument("--out-dir", help="offline: write the public objects here (required with --store-dir)")
    args = ap.parse_args(argv)
    if bool(args.store_dir) != bool(args.out_dir):
        ap.error("--store-dir and --out-dir go together")
    store = LocalStore(args.store_dir, args.out_dir) if args.store_dir else SupabaseStore()
    record = publish(store)
    print(json.dumps({k: record[k] for k in ("path", "bytes", "width", "height", "valid_time", "encode_ms", "parity")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
