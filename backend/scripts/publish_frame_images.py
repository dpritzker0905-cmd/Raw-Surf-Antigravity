#!/usr/bin/env python3
"""Publish static forecast frames to the public bucket `weather-frames` (#399 proof + step 2b frames, 2026-10-20).

Leading forecast maps serve a FINITE set of precomputed bytes per model x run x layer x valid time from a CDN and let
the browser decode them, so a scrub costs the server nothing. Raw Surf's 1-CPU Render box instead builds every world
`/grid` (2.3 MB of JSON) and 48-frame `/grid_series` page on demand. This script, run by forecast-ingest-pilots.yml after
its ingest step, writes two things:

  1. The step 2b frame sets (services/frame_set.py, codec services/frame_binary.py): every stored GFS waves global_mid
     product as one gzipped little-endian binary frame (~55 KB), a run index, and a no-cache `v1/latest.json` pointer
     written LAST; frames and indexes are immutable and content-addressed; only changed frames are uploaded; the
     current and previous index of each set are kept and everything older is deleted. Each frame is decoded and
     compared with its source product node by node before upload; a single bad node refuses that frame.
  2. The #399 one-field proof, unchanged in its outputs: the frame nearest now as one RGBA PNG at
     `gfs/waves/global_mid/<run>/<valid>.png` plus `manifest.json` (no-cache), which frameImageProof.js reads.

EGRESS RULE: everything is built from product files already on this runner's disk (the ProductStore cache the ingest
step just wrote, and its local manifest.json). Nothing is downloaded from the private `weather-products` bucket:
re-reading every product from storage would cost about 490 GB a month against the plan's 250 GB of egress.
ONE bounded exception, dark (FRAME_TAIL_DOWNLOAD=1, see TailDownloads): the ICON/EURO world estimated tails the core lane
bakes, which this disk never holds; only changed ones, at most FRAME_TAIL_DOWNLOAD_MAX per run, with their wire bytes reported.

SERVES NOTHING BY DEFAULT: the client reads the frames only when built with REACT_APP_STATIC_FRAMES=true (dark), and
the proof only with its own opt-in. Writes go ONLY to `weather-frames`; the pipeline manifest and products are never
written (the designated-writer gate is not involved).

Credentials by NAME only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GitHub Actions secrets in forecast-ingest.yml).
Dark: forecast-ingest-pilots.yml runs it, after its ingest step, only when the repository variable FRAME_IMAGES_PUBLISH
is '1'. The PILOTS lane is the one that writes the GFS world products (scheduler/forecast.py pilot_jobs: the 2-degree
global_mid rides the GFS Marine Pilot pass); the core lane's disk held only 60 of 115 (5 within 0-165 h; runs
39546548998 vs 39543806662, 2026-10-21), and a set below FRAME_MIN_COVERAGE (0.9) publishes nothing.

Offline:  python scripts/publish_frame_images.py --store-dir <ProductStore dir> --out-dir <dir> [--only frames|png]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import frame_set as fs  # noqa: E402
from services import frame_set_bundle as fsb  # noqa: E402
from services.frame_image import encode_png, parity  # noqa: E402

FRAME_BUCKET = "weather-frames"
TARGET = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
IMMUTABLE = fs.IMMUTABLE
REVALIDATE = fs.REVALIDATE
UPLOAD_WORKERS = 4
UPLOAD_BACKOFF_S = (2.0, 5.0, 12.0)        # waits between the 4 attempts of one upload (SupabaseSink.write)
RETRY_STATUS = (429, 500, 502, 503, 504)
_sleep = time.sleep                        # the tests replace it


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


class LocalCache:
    """The runner's own product files: a ProductStore cache dir (manifest.json + product JSON). Never downloads."""

    def __init__(self, cache_dir):
        self.cache_dir = Path(cache_dir)
        self._manifest = None

    def manifest(self):
        if self._manifest is None:
            path = self.cache_dir / "manifest.json"
            if not path.exists():
                raise RuntimeError(f"no local manifest at {path}; the frames are built from the runner's disk only")
            self._manifest = json.loads(path.read_bytes())
        return self._manifest

    def product_bytes(self, filename):
        path = self.cache_dir / filename
        if not path.is_file() or path.resolve().parent != self.cache_dir.resolve():
            return None
        return path.read_bytes()


PRODUCTS_BUCKET = "weather-products"
TAIL_MODELS = ("ICON", "EURO")
TAIL_WORKERS = 4


class TailDownloads:
    """The ONE exception to the egress rule (2026-10-24, FRAME_TAIL_DOWNLOAD, dark): the ICON/EURO world ESTIMATED tails.

    The core lane bakes the ICON swell_1 / wind_waves and EURO waves 14-day tails (168-336 h / 240-336 h), so this runner's disk
    never holds them and their index entries were `not_local` (/grid served those hours; measured on the CDN 2026-10-24: ICON
    swell_1 61 of 117 built, wind_waves 60, EURO waves 69). With the flag on, a tail entry of an ICON/EURO `global_mid` set
    that is not on disk is downloaded from the private products bucket, the same stored product /grid serves, and then goes
    through publish_set unchanged: the run check (a copy of another run than the manifest names is `stale_local`) and the
    node-by-node parity gate. Nothing authoritative is ever downloaded, a frame already published for the same product is
    carried without a download, and at most `cap` products (FRAME_TAIL_DOWNLOAD_MAX, default 240) are fetched per run.
    COST, measured not assumed: a tail product is 2.2 MB of JSON and Supabase serves JSON brotli-compressed (an index here: 199,705
    bytes as 10,028 on the wire), so ~170 tail products per publish cost about 10-20 MB; `stats` reports the wire bytes.
    `fetch(filename) -> (bytes or None, wire_bytes)`; offline, a second ProductStore dir stands in for the bucket."""

    def __init__(self, local, fetch, cap=240, log=print):
        self.local, self.fetch, self.cap, self.log = local, fetch, int(cap), log
        self._got = {}
        self.stats = {"downloaded": 0, "download_failed": 0, "download_capped": 0, "wire_bytes": 0, "bytes": 0}

    def manifest(self):
        return self.local.manifest()

    def product_bytes(self, filename):
        raw = self.local.product_bytes(filename)
        return raw if raw is not None else self._got.get(filename)

    @staticmethod
    def wants(target):
        return target.get("model") in TAIL_MODELS and target.get("domain") == "marine" and target.get("region_id") == "global_mid"

    def prefetch(self, target, previous_index=None):
        """Download, TAIL_WORKERS at a time, the tail entries of `target` that are neither on disk nor carried from
        `previous_index` (same source identity). Returns the number downloaded for this set."""
        if not self.wants(target):
            return 0
        carried = {(f.get("valid_time"), bool(f.get("is_estimated"))): f.get("source")
                   for f in (previous_index or {}).get("frames", []) if f.get("path")}
        todo = []
        for e in fs.select_entries(self.manifest().get("products"), target):
            if not e.get("is_estimated"):
                continue
            vt = fs.iso(e.get("valid_time_start") or e.get("valid_time"))
            if carried.get((vt, True)) == fs.source_identity(e) or self.local.product_bytes(e["filename"]) is not None:
                continue
            todo.append(e["filename"])
        room = max(0, self.cap - self.stats["downloaded"])
        if len(todo) > room:
            self.stats["download_capped"] += len(todo) - room
            todo = todo[:room]

        def one(name):
            try:
                return name, self.fetch(name)
            except Exception as e:  # a failed download leaves the entry not_local: /grid serves it, as before
                self.log(f"[frames] tail download {name} failed ({type(e).__name__}: {e})")
                return name, (None, 0)
        with ThreadPoolExecutor(max_workers=TAIL_WORKERS) as pool:
            got = list(pool.map(one, todo))
        n = 0
        for name, (data, wire) in got:
            if data is None:
                self.stats["download_failed"] += 1
                continue
            self._got[name] = data
            self.stats["downloaded"] += 1
            self.stats["bytes"] += len(data)
            self.stats["wire_bytes"] += int(wire or 0)
            n += 1
        return n


def tail_downloads_enabled():
    return os.environ.get("FRAME_TAIL_DOWNLOAD", "0") == "1"


def tail_cap():
    try:
        return max(0, int(os.environ.get("FRAME_TAIL_DOWNLOAD_MAX", "240")))
    except ValueError:
        return 240


def supabase_product_fetcher():
    """(filename) -> (bytes or None, wire bytes) from the private products bucket, retried like an upload. Credentials by NAME."""
    import requests
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    auth = {"Authorization": f"Bearer {key}", "apikey": key, "Accept-Encoding": "gzip, deflate"}

    def fetch(filename):
        url = f"{base}/storage/v1/object/{PRODUCTS_BUCKET}/{filename}"
        for wait in UPLOAD_BACKOFF_S + (None,):
            try:
                resp = requests.get(url, headers=auth, timeout=60, stream=True)
                wire = 0
                chunks = []
                for chunk in resp.raw.stream(65536, decode_content=False):
                    wire += len(chunk)
                    chunks.append(chunk)
                raw = b"".join(chunks)
                enc = (resp.headers.get("Content-Encoding") or "").lower()
                if resp.status_code == 200:
                    if enc == "gzip":
                        import gzip
                        raw = gzip.decompress(raw)
                    elif enc == "deflate":
                        import zlib
                        raw = zlib.decompress(raw)
                    elif enc not in ("", "identity"):
                        raise RuntimeError(f"unexpected Content-Encoding {enc!r}")
                    return raw, wire
                if resp.status_code in (400, 404):
                    return None, wire       # gone since the manifest was written: the entry stays not_local
                if resp.status_code not in RETRY_STATUS or wait is None:
                    raise RuntimeError(f"HTTP {resp.status_code}")
            except (requests.ConnectionError, requests.Timeout):
                if wait is None:
                    raise
            _sleep(wait)
        return None, 0
    return fetch


def local_product_fetcher(store_dir):
    """Offline twin of supabase_product_fetcher: a ProductStore dir standing in for the private bucket."""
    other = LocalCache(store_dir)

    def fetch(filename):
        data = other.product_bytes(filename)
        return data, (len(data) if data is not None else 0)
    return fetch


class LocalSink:
    """Writes the public objects under out_dir and records each one's headers (the offline twin of SupabaseSink)."""

    def __init__(self, out_dir):
        self.out_dir = Path(out_dir)
        self.headers, self.deleted, self.order = {}, [], []

    def ensure_bucket(self):
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def read(self, path):
        p = self.out_dir / path
        return p.read_bytes() if p.is_file() else None

    def write(self, path, data, content_type, cache_control):
        dest = self.out_dir / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        self.headers[path] = {"content-type": content_type, "cache-control": cache_control}
        self.order.append(path)

    def list(self, prefix):
        root = self.out_dir / prefix
        if not root.exists():
            return []
        return sorted(p.relative_to(self.out_dir).as_posix() for p in root.rglob("*") if p.is_file())

    def delete(self, paths):
        for p in paths:
            (self.out_dir / p).unlink(missing_ok=True)
        self.deleted.extend(paths)


class SupabaseSink:
    """Storage REST API on the PUBLIC frames bucket (x-upsert + cache-control, no Content-Encoding, ever)."""

    def __init__(self):
        import requests
        self.requests = requests
        self.base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not self.base or not key:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        self.auth = {"Authorization": f"Bearer {key}", "apikey": key}
        self.order = []

    def ensure_bucket(self):
        resp = self.requests.post(f"{self.base}/storage/v1/bucket", headers=self.auth, timeout=30,
                                  json={"id": FRAME_BUCKET, "name": FRAME_BUCKET, "public": True})
        if resp.status_code not in (200, 201) and "already exists" not in resp.text.lower():
            raise RuntimeError(f"create bucket {FRAME_BUCKET}: HTTP {resp.status_code}: {resp.text[:200]}")

    def read(self, path):
        resp = self.requests.get(f"{self.base}/storage/v1/object/{FRAME_BUCKET}/{path}?cb={int(time.time() * 1000)}",
                                 headers=self.auth, timeout=60)
        if resp.status_code in (400, 404):
            return None                    # Supabase answers a missing object with 400 or 404
        if resp.status_code != 200:
            raise RuntimeError(f"read {FRAME_BUCKET}/{path}: HTTP {resp.status_code}")
        return resp.content

    def write(self, path, data, content_type, cache_control):
        """One upload, retried with backoff on 429 / 5xx / a dropped connection (Supabase answered cold-cache bursts with
        429 on 2026-10-20). Every object is content-addressed or a whole-file upsert, so a retry is always safe."""
        headers = dict(self.auth, **{"Content-Type": content_type, "x-upsert": "true", "cache-control": cache_control})
        url = f"{self.base}/storage/v1/object/{FRAME_BUCKET}/{path}"
        for attempt, wait in enumerate(UPLOAD_BACKOFF_S + (None,)):
            try:
                resp = self.requests.post(url, headers=headers, data=data, timeout=60)
            except (self.requests.ConnectionError, self.requests.Timeout) as e:
                if wait is None:
                    raise RuntimeError(f"upload {FRAME_BUCKET}/{path}: {type(e).__name__} after {attempt + 1} attempts")
                _sleep(wait)
                continue
            if resp.status_code in (200, 201):
                self.order.append(path)
                return
            if resp.status_code not in RETRY_STATUS or wait is None:
                raise RuntimeError(f"upload {FRAME_BUCKET}/{path}: HTTP {resp.status_code}: {resp.text[:200]}")
            _sleep(wait)

    def list(self, prefix):
        """Every object path under `prefix`, recursing into folders (the list API returns one level at a time)."""
        out, todo = [], [prefix.rstrip("/")]
        while todo:
            folder = todo.pop()
            offset = 0
            while True:
                resp = self.requests.post(f"{self.base}/storage/v1/object/list/{FRAME_BUCKET}", headers=self.auth,
                                          timeout=60, json={"prefix": folder + "/", "limit": 1000, "offset": offset})
                if resp.status_code != 200:
                    raise RuntimeError(f"list {FRAME_BUCKET}/{folder}: HTTP {resp.status_code}")
                rows = resp.json() or []
                for row in rows:
                    path = f"{folder}/{row['name']}"
                    (out if row.get("id") else todo).append(path)
                if len(rows) < 1000:
                    break
                offset += 1000
        return sorted(out)

    def delete(self, paths):
        for i in range(0, len(paths), 500):
            chunk = list(paths[i:i + 500])
            resp = self.requests.delete(f"{self.base}/storage/v1/object/{FRAME_BUCKET}", headers=self.auth,
                                        json={"prefixes": chunk}, timeout=60)
            if resp.status_code not in (200, 201):
                print(f"[frames] delete of {len(chunk)} old objects failed: HTTP {resp.status_code}", file=sys.stderr)


def decode_png(png):
    import io
    from PIL import Image
    img = Image.open(io.BytesIO(png))
    if img.mode != "RGBA":
        raise ValueError(f"PNG decoded as {img.mode}, expected RGBA")
    return img.tobytes(), img.width, img.height


def publish_png_proof(source, sink, now=None):
    """The #399 proof: pick, encode, self-check, upload. Returns the manifest frame record; raises on parity failure."""
    now = now or datetime.now(timezone.utc)
    entry = pick_entry(source.manifest().get("products"), now)
    if entry is None:
        raise RuntimeError(f"no stored {TARGET} product in the manifest")
    raw = source.product_bytes(entry["filename"])
    if raw is None:
        raise RuntimeError(f"{entry['filename']} is not on this runner's disk; the proof never downloads")
    product = json.loads(raw)
    t0 = time.perf_counter()
    png, meta = encode_png(product)
    encode_ms = round((time.perf_counter() - t0) * 1000, 1)
    check = parity(product, *decode_png(png))
    if check["bad"]:
        raise RuntimeError(f"self-parity failed, nothing uploaded: {check}")
    path = frame_path(product)
    sink.write(path, png, "image/png", IMMUTABLE)
    record = dict(meta, path=path, bytes=len(png), source_filename=entry["filename"], parity=check, encode_ms=encode_ms)
    index = {"version": 1, "written_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "writer": _writer(), "frames": [record]}
    sink.write("manifest.json", json.dumps(index, indent=1).encode("utf-8"), "application/json", REVALIDATE)
    return record


def _writer():
    return f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local"


def _uploader(sink):
    def upload(jobs):
        if len(jobs) <= 1 or isinstance(sink, LocalSink):
            for job in jobs:
                sink.write(*job)
            return
        with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as pool:
            list(pool.map(lambda job: sink.write(*job), jobs))   # list() re-raises the first upload error
    return upload


def selected_sets(sets=None):
    """FRAME_SETS (comma list of set keys, e.g. 'GFS/marine/waves/global_mid') narrows the run; default every set: the world
    sets, then the regional bundle sets (frame_set_bundle.REGIONAL_SETS, LAST so the budget stagger drops them first; off with
    FRAME_REGIONAL_BUNDLES=0)."""
    if sets is None:
        sets = tuple(fs.SETS) + (fsb.selected_regional_sets() if fsb.enabled() else ())
    want = [k.strip() for k in os.environ.get("FRAME_SETS", "").split(",") if k.strip()]
    return [t for t in sets if not want or fs.set_key(t) in want]


def publish_frame_sets(source, sink, sets=None, log=print, budget_s=None, clock=time.perf_counter):
    """Every set: frames, then its index; then latest.json LAST; then retention. Returns {set key: stats}.

    STAGGER: once `budget_s` (FRAME_PUBLISH_BUDGET_S, default 600 s, inside the step's 15-min timeout) has elapsed, no
    further set is started this run; a skipped set keeps its published index and is reported `skipped_budget`."""
    sets = selected_sets() if sets is None else sets
    budget = float(os.environ.get("FRAME_PUBLISH_BUDGET_S", "600")) if budget_s is None else budget_s
    raw_latest = sink.read(fs.LATEST)
    latest = json.loads(raw_latest) if raw_latest else {"version": 1, "sets": {}}
    upload = _uploader(sink)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report, changed, keep_by_set = {}, False, {}
    started = clock()
    # The HRRR lane the serve box blends into GFS wind (frame_set_wind.py): read once, applied to every wind frame.
    from services import frame_set_wind as fsw
    wind_lane = fsw.load_publish_lane(log) if any(fsw.is_wind(t) for t in sets) else None
    for target in sets:
        key = fs.set_key(target)
        if clock() - started > budget:
            report[key] = {"skipped_budget": True, "index": (latest.get("sets", {}).get(key) or {}).get("index")}
            log(f"[frames] {key}: skipped, the run is past its {budget:.0f} s budget (the published index stays)")
            continue
        entry = latest.get("sets", {}).get(key)
        prev_raw = sink.read(entry["index"]) if entry and entry.get("index") else None
        prev_index = json.loads(prev_raw) if prev_raw else None
        t0 = time.perf_counter()
        bundled = fsb.is_bundle(target)
        if bundled:
            try:
                index, stats = fsb.publish_bundle_set(source, sink, target, prev_index, upload, log=log)
            except Exception as e:  # one regional set's failed upload must not cost the world sets their pointer move
                log(f"[frames] {key}: bundle publish failed ({type(e).__name__}: {e}); the published bundle stays")
                report[key] = {"error": f"{type(e).__name__}: {e}"[:300], "index": (entry or {}).get("index")}
                continue
        else:
            fetched = source.prefetch(target, prev_index) if isinstance(source, TailDownloads) else 0
            index, stats = fs.publish_set(source, sink, target, prev_index, upload, log=log, wind_lane=wind_lane)
            if isinstance(source, TailDownloads):
                stats["tail_downloaded"] = fetched
        if index is not None:
            sink.write(index["path"], fs.index_bytes(index), fs.JSON_TYPE, IMMUTABLE)
            latest.setdefault("sets", {})[key] = (fsb.latest_record if bundled else fs.latest_record)(index, entry, now, _writer())
            changed = True
            # RETENTION only when the previous index was actually READ: a missing or unreadable latest.json (Supabase
            # answers some failures with 400, which reads as "not found") must never delete the run clients are
            # pinned to. The first publish has nothing to delete anyway.
            if entry and entry.get("index") and prev_index is not None:
                keep_by_set[key] = (target, fs.referenced_paths(index) | fs.referenced_paths(prev_index))
            elif entry and entry.get("index"):
                log(f"[frames] {key}: previous index {entry['index']} unreadable; retention skipped this run")
        stats["seconds"] = round(time.perf_counter() - t0, 1)
        stats["index"] = index["path"] if index else (entry or {}).get("index")
        stats["deleted"] = 0
        report[key] = stats
    if changed:
        latest.update(version=1, written_at=now, writer=_writer())
        sink.write(fs.LATEST, json.dumps(latest, indent=1, sort_keys=True).encode("utf-8"), fs.JSON_TYPE, REVALIDATE)
    if wind_lane is not None:
        _wind_lane_pointer(sink, wind_lane, log)
    for key, (target, keep) in keep_by_set.items():        # after the pointer moved, never before
        gone = fs.retention_deletes(sink.list(fs.set_prefix(target)), target, keep)
        if gone:
            sink.delete(gone)
        report[key]["deleted"] = len(gone)
    return report


def _wind_lane_pointer(sink, wind_lane, log):
    """Keep v1/wind_lane.json naming the lane L2 holds NOW (re-read here, at the end of the publish: the core lane may have
    published a newer cycle since this run loaded its lane, and the pointer must name that one so the client refuses this run's
    lane-window frames; frame_set_wind.write_lane_pointer also never moves it to an older cycle). Offline (LocalSink, the
    harness) the pointer names the frames' own lane, written an hour ago: the box is taken to hold it."""
    from services import frame_set_wind as fsw
    if isinstance(sink, LocalSink):
        ident = wind_lane.identity()
        lane_index = {"key": ident["key"], "cycle": ident["cycle"], "horizon": ident["horizon"],
                      "hours": len(getattr(wind_lane.lane, "hours", {}) or {})}
        rec = fsw.pointer_record(lane_index, None, "offline-harness")
        rec["written_at"] = datetime.fromtimestamp(time.time() - 3600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        sink.write(fsw.LANE_POINTER, json.dumps(rec, indent=1).encode("utf-8"), fs.JSON_TYPE, REVALIDATE)
        return
    from services.weather_pipeline import wind_lane as wl
    try:
        held = wl._l2_get(wl.INDEX_KEY)
    except Exception as e:  # never fail the publish over the pointer: the core lane keeps it current
        log(f"[wind-lane pointer] L2 index unreadable ({type(e).__name__}); pointer left as it is")
        return
    if held and held.get("key"):
        fsw.write_lane_pointer(held, log)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store-dir", help="offline: a ProductStore dir (manifest.json + products) instead of the runner's")
    ap.add_argument("--out-dir", help="offline: write the public objects here (required with --store-dir)")
    ap.add_argument("--only", choices=("frames", "png"), help="run one half only (default: both)")
    ap.add_argument("--tail-store-dir", help="offline, with FRAME_TAIL_DOWNLOAD=1: a ProductStore dir standing in for the "
                                             "private products bucket the ICON/EURO tails are downloaded from")
    args = ap.parse_args(argv)
    if bool(args.store_dir) != bool(args.out_dir):
        ap.error("--store-dir and --out-dir go together")
    if args.store_dir:
        source, sink = LocalCache(args.store_dir), LocalSink(args.out_dir)
    else:
        from services.weather_pipeline.store import ProductStore
        source, sink = LocalCache(ProductStore().cache_dir), SupabaseSink()
    if tail_downloads_enabled():
        fetch = local_product_fetcher(args.tail_store_dir) if args.tail_store_dir else (
            None if args.store_dir else supabase_product_fetcher())
        if fetch is not None:
            source = TailDownloads(source, fetch, cap=tail_cap())
    sink.ensure_bucket()
    status = 0
    if args.only in (None, "frames"):
        report = publish_frame_sets(source, sink)
        if isinstance(source, TailDownloads):
            report["__tail_downloads__"] = dict(source.stats)
        print(json.dumps({"frame_sets": report}))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write("### Static frames\n```\n" + json.dumps(report, indent=1) + "\n```\n")
        if any(s.get("refused") or s.get("coverage_refused") for s in report.values()):
            status = 1                     # visible in the step (continue-on-error keeps the cycle green)
    if args.only in (None, "png"):
        try:
            record = publish_png_proof(source, sink)
            print(json.dumps({k: record[k] for k in ("path", "bytes", "width", "height", "valid_time", "encode_ms",
                                                     "parity")}))
        except RuntimeError as e:
            print(f"[frames] png proof skipped: {e}", file=sys.stderr)
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
