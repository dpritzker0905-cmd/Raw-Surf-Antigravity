"""GET /api/weather/products, encoded once per manifest version (2026-10-20 scrub-lag diagnosis, server quick win 1).

WHY. The route returned `manifest.products` from an `async def` with no response_model, so EVERY call ran FastAPI's
`jsonable_encoder` over the whole registry (11,354 entries, 10.75 MB; about 80% of a 1.0-1.8 s call) and Starlette's
gzip level 9, both ON THE EVENT LOOP, and nothing cached it. A client opens the map with 9-13 of these calls
(lagdeep A_server_telemetry 2c), and each one stalled every other route on the one 1-CPU box (C_server_cost 3, 5).

WHAT (on by default, no served value moves; kill: PRODUCTS_RESPONSE_CACHE=0 restores the per-call FastAPI path):
  1. ONCE PER MANIFEST VERSION. The body is the bytes FastAPI renders for this route (see `_products_json`), pinned
     identical to the flag-off response in tests/test_products_response.py. The version is the manifest object (held
     WEAKLY, so an old manifest is never kept alive by this cache), its products list, its stamp and its length:
     `ProductStore.get_manifest` hands out ONE object per manifest file, and an in-place writer moves the stamp and
     rebinds the list. Only the gzip body is kept; an identity client gets it decompressed.
  2. OFF THE LOOP. Encode, gzip (level PRODUCTS_GZIP_LEVEL, default 9 = the middleware's) and the ETag hash run in a
     worker thread, once; concurrent requests during that encode share one task.
  3. CONDITIONAL GET. A weak ETag over the identity bytes; `If-None-Match` answers 304 with no body.
     `Cache-Control: no-cache` lets a browser keep the body and revalidate it on every call.
  4. `?fields=compact`: the same envelope with only the seven product fields the client reads (model, domain, layer,
     valid_time_start, valid_time_end, coverage, region_id; frontend/src/components/map, 2026-10-20 sweep), so the
     client can switch later. Nothing requests it yet.

A15-16 (audit 15.0): this public, unauthenticated response used to carry the server's absolute cache path and a
listing of every file in it (2,717 names, measured 2026-09-25). Nothing read either field over HTTP; the diagnostics
scripts use the store directly. Both stay gone.
"""
import asyncio
import gzip
import hashlib
import json
import logging
import os
import time
import weakref

from starlette.responses import Response

from services.weather_pipeline.config_env import env_int

logger = logging.getLogger(__name__)
FLAG = "PRODUCTS_RESPONSE_CACHE"
COMPACT_FIELDS = ("model", "domain", "layer", "valid_time_start", "valid_time_end", "coverage", "region_id")  # schema order


def enabled() -> bool:
    return os.environ.get(FLAG, "1") != "0"


def gzip_level() -> int:
    return env_int("PRODUCTS_GZIP_LEVEL", 9, lo=1, hi=9)


def envelope(manifest, compact: bool) -> dict:
    """The route's content, exactly as it always returned it (compact: the client's fields only)."""
    products = manifest.products
    if compact:
        include = set(COMPACT_FIELDS)
        products = [p.model_dump(mode="json", include=include) for p in products]
    return {"last_manifest_update": manifest.last_manifest_update, "products": products}


def _weak(obj):
    """A weak reference to the manifest (PipelineManifest supports one), or a strong one for an object that cannot be
    weakly referenced (test doubles such as SimpleNamespace)."""
    try:
        return weakref.ref(obj)
    except TypeError:
        return lambda: obj


class _Body:
    __slots__ = ("manifest", "products_id", "stamp", "count", "gz", "raw_len", "etag", "encode_ms", "gzip_ms")

    def matches(self, manifest) -> bool:
        return (self.manifest() is manifest and self.products_id == id(manifest.products)
                and self.stamp == manifest.last_manifest_update and self.count == len(manifest.products))


_DUMPS = dict(ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":"))   # JSONResponse.render's
CHUNK = 500


def _products_json(products, compact: bool) -> str:
    """The products array as JSONResponse would render `jsonable_encoder(products)`, in chunks.

    For a pydantic model `jsonable_encoder` IS `model_dump(mode="json", by_alias=True)` followed by a pure-Python walk
    that returns JSON-native values unchanged, so dumping through pydantic's serializer gives equal values, key order
    included, and `json.dumps` then writes the same bytes (pinned against the FastAPI path in
    tests/test_products_response.py). The walk was ~80% of the old per-call cost. Chunks of CHUNK products with a GIL
    yield between them keep this worker thread from holding the event loop off for the whole encode. Anything that is
    not a ManifestProduct goes through `jsonable_encoder` exactly as before."""
    from services.weather_pipeline.schemas import ManifestProduct
    if not products or not all(type(p) is ManifestProduct for p in products):
        from fastapi.encoders import jsonable_encoder
        return json.dumps(jsonable_encoder(products), **_DUMPS)
    include = set(COMPACT_FIELDS) if compact else None
    parts = []
    for i in range(0, len(products), CHUNK):
        rows = [p.model_dump(mode="json", by_alias=True, include=include) for p in products[i:i + CHUNK]]
        parts.append(json.dumps(rows, **_DUMPS)[1:-1])
        time.sleep(0)
    return "[" + ",".join(parts) + "]"


def encode_body(manifest, compact: bool, level: int) -> _Body:
    """Encode one manifest version (worker thread). The bytes FastAPI would render for the route's dict with no
    response_model (`jsonable_encoder`, then JSONResponse's `json.dumps`), so they equal what the route served before
    this module existed."""
    from fastapi.encoders import jsonable_encoder
    body = _Body()
    body.manifest, body.products_id = _weak(manifest), id(manifest.products)
    body.stamp, body.count = manifest.last_manifest_update, len(manifest.products)
    t0 = time.perf_counter()
    stamp = json.dumps(jsonable_encoder(manifest.last_manifest_update), **_DUMPS)
    raw = ('{"last_manifest_update":' + stamp + ',"products":' + _products_json(manifest.products, compact)
           + "}").encode("utf-8")
    t1 = time.perf_counter()
    body.gz, body.raw_len = gzip.compress(raw, compresslevel=level, mtime=0), len(raw)
    body.etag = 'W/"' + hashlib.blake2b(raw, digest_size=12).hexdigest() + '"'
    body.encode_ms, body.gzip_ms = (t1 - t0) * 1000.0, (time.perf_counter() - t1) * 1000.0
    return body


class ProductsCache:
    """One encoded body per variant (full, compact) for the current manifest version, plus the in-flight encode
    every concurrent request awaits. Event-loop only: no lock is needed around the two dicts."""

    def __init__(self):
        self.bodies = {}      # compact(bool) -> _Body
        self.inflight = {}    # compact(bool) -> (manifest, task)

    async def get(self, manifest, compact: bool):
        """(body, outcome): outcome is 'hit', 'miss' (this request encoded) or 'shared' (awaited another's)."""
        body = self.bodies.get(compact)
        if body is not None and body.matches(manifest):
            return body, "hit"
        flight = self.inflight.get(compact)
        if flight is not None and flight[0] is manifest:
            return await asyncio.shield(flight[1]), "shared"
        task = asyncio.ensure_future(asyncio.to_thread(encode_body, manifest, compact, gzip_level()))
        self.inflight[compact] = (manifest, task)
        try:
            body = await asyncio.shield(task)
        finally:
            if self.inflight.get(compact, (None, None))[1] is task:
                self.inflight.pop(compact, None)
        current = self.bodies.get(compact)
        if current is None or not current.matches(manifest):
            self.bodies[compact] = body      # a body for an older manifest never replaces a newer one's
        return body, "miss"


CACHE = ProductsCache()


def _record(name, ms):
    try:
        from services.request_telemetry import record_stage
        record_stage(name, ms)
    except Exception:
        logger.debug("[products] stage telemetry unavailable", exc_info=True)


def etag_matches(header: str, etag: str) -> bool:
    """RFC 9110 weak comparison of If-None-Match against our one ETag ('*' matches any current body)."""
    if not header:
        return False
    want = etag[2:] if etag.startswith("W/") else etag
    for tag in header.split(","):
        tag = tag.strip()
        if tag == "*":
            return True
        if (tag[2:] if tag.startswith("W/") else tag) == want:
            return True
    return False


async def serve_products(store, request=None, compact: bool = False):
    """The /products response. Flag off: the dict the route always returned (FastAPI encodes it per call)."""
    t_start = time.perf_counter()
    manifest = await asyncio.to_thread(store.get_manifest)
    if not enabled():
        return envelope(manifest, compact)
    body, outcome = await CACHE.get(manifest, compact)
    headers = {"ETag": body.etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
    if request is not None and etag_matches(request.headers.get("if-none-match", ""), body.etag):
        outcome = "not_modified"
        resp = Response(status_code=304, headers=headers)
    else:
        from services.weather_pipeline.series_response import accepts_gzip
        gz = accepts_gzip(request)
        # Content-Encoding is always explicit, so the outer GZipMiddleware never compresses this body again
        # (it checks only for the substring 'gzip', even in 'gzip;q=0').
        headers["Content-Encoding"] = "gzip" if gz else "identity"
        resp = Response(body.gz if gz else gzip.decompress(body.gz), media_type="application/json", headers=headers)
    total = (time.perf_counter() - t_start) * 1000.0
    timing = [f"memo;desc={outcome};dur={total:.1f}"]
    if outcome == "miss":
        timing = [f"encode;dur={body.encode_ms:.1f}", f"gzip;dur={body.gzip_ms:.1f}"] + timing
        _record("products.encode", body.encode_ms)
        _record("products.gzip", body.gzip_ms)
    _record("products." + outcome, total)
    resp.headers["Server-Timing"] = ", ".join(timing)
    return resp
