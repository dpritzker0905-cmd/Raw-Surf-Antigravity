"""W-4 (2026-10-19 scrub audit, F-05): stop rebuilding the same /grid_series page. Dark: GRID_SERIES_PAGE_MEMO=1.

WHY. Live (Render logs 2026-10-19 02:37Z) /grid_series ran p95 10 s / p99 13.8 s on the one 1-CPU box that serves
production and dev. Three costs stacked on the event loop: every zoom step re-asked for the SAME 48-hour page under a
slightly different bbox (4 bboxes in ~25 s) and the cache key was the exact bbox; nothing shared a page across clients
or across two identical requests in flight; and the response went through jsonable_encoder + gzip level 9 on the loop.

WHAT, with the flag on (route `get_grid_series` dispatches here; flag off is untouched):
  1. SNAP. The bbox is snapped outward with the resolver's own tile snap (`route_helpers.get_snapped_bbox`: 1 deg GFS,
     2 deg otherwise) and the page is BUILT for the snapped box, so the frames are exactly what a flag-off request for
     the snapped box serves. A snap that would move the request across any span threshold the resolver branches on
     (`_span_edges`) is refused and the exact bbox is used, so a snap never changes the tier, reval or gate decision.
  2. SHARE + MEMO. One build per key (model, domain, layer, snapped bbox, hours, surf, anchor) in flight; identical
     requests await it. A finished page is kept as its encoded bytes for GRID_SERIES_PAGE_MEMO_TTL_S (180 s) within
     GRID_SERIES_PAGE_MEMO_MAX_MB (32) of bodies, keyed also on the manifest stamp: a new model run (any manifest write)
     clears the memo. A page is NOT kept when a later request could legitimately build something else: a frame missing,
     a frame with an SWR sharpen pending or served from a preview tier, a frame the per-hour loop did not build (fast
     paths, live recovery), or a zoomed 2-deg mid clip inside the sharpen span (the next request may get the fine tile).
  3. OFF THE LOOP. The direct serializer (series_response.encode_json, the GRID_SERIES_RESPONSE_BOUNDS path) and gzip at
     GRID_SERIES_GZIP_LEVEL (default 4, clamped 1-4) run in a worker thread, once per page, not per request.
  4. STAGES. build / encode / gzip / outcome go to request_telemetry stages (/api/health) and a Server-Timing header.

Payload semantics are unchanged: decoded JSON equals the flag-off response for the snapped bbox (pinned in
tests/test_series_page_memo.py). Kill: unset the flag.
"""
import asyncio
import gzip
import logging
import os
import time
from collections import OrderedDict

from starlette.responses import Response

from services.weather_pipeline.config_env import env_float, env_int
from services.weather_pipeline import grid_series_helper as _gsh   # looked up per call: tests patch build_grid_series
from services.weather_pipeline.grid_series_helper import MAX_FRAMES, SERIES_FRAME_SINK, _resolve_series_anchor
from services.weather_pipeline.route_helpers import get_snapped_bbox, parse_bbox

logger = logging.getLogger(__name__)
FLAG = "GRID_SERIES_PAGE_MEMO"


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def _record(name, ms):
    try:
        from services.request_telemetry import record_stage
        record_stage(name, ms)
    except Exception:
        logger.debug("[series-memo] stage telemetry unavailable", exc_info=True)


# ── 1. SNAP ───────────────────────────────────────────────────────────────────────────────────────────────────
# Every span the series path branches on, read at call time like the code that reads them. ⚠️ A NEW span threshold
# in weather_pipeline must be added here; tests/test_series_page_memo.py fails until it is (it scans for *SPAN* env
# names), because a snap across an unlisted edge silently changes which tier serves the page.
def _span_edges():
    return (
        env_float("SURF_REGIONAL_PREFER_FULLCOVER_SPAN_DEG", 4.75),
        env_float("MARINE_MID_REVAL_MAX_SPAN", 8.0), env_float("WIND_MID_REVAL_MAX_SPAN", 20.0),
        env_float("WIND_DYNAMIC_MAX_SPAN_DEG", 100.0),
        env_float("MARINE_MID_RES_MIN_SPAN", 0.0), env_float("MARINE_MID_RES_MAX_SPAN", 400.0),
        env_float("WIND_MID_RES_MIN_SPAN", 0.0), env_float("WIND_MID_RES_MAX_SPAN", 400.0),
        15.0, 90.0, 180.0, 350.0,          # wide-request cut; viewport_service's global view (lng > 180 / lat > 90); global
    )


def _spans(w, s, e, n):
    lng, lat = e - w, n - s
    return lng, lat, max(lng, lat)


def snap_series_bbox(bbox: str, model: str) -> str:
    """The bbox to BUILD and KEY the page on: the resolver's tile snap, or `bbox` itself when snapping would cross a
    span edge, cross the antimeridian, or leave the plain [-180,180] x [-90,90] box. Never raises."""
    try:
        w, s, e, n = parse_bbox(bbox)
        if not (-180.0 <= w < e <= 180.0 and -90.0 <= s < n <= 90.0):
            return bbox
        snapped = get_snapped_bbox(bbox, model)
        sw, ss, se, sn = parse_bbox(snapped)
        if not (sw < se and ss < sn):
            return bbox
        raw, out = _spans(w, s, e, n), _spans(sw, ss, se, sn)
        for edge in _span_edges():
            for a, b in zip(raw, out):
                if (a > edge) != (b > edge) or (a >= edge) != (b >= edge):
                    return bbox
        return snapped
    except Exception:
        return bbox


# ── 2. SHARE + MEMO ───────────────────────────────────────────────────────────────────────────────────────────
class _Waiters:
    """The `request` a shared build sees: gone only when EVERY client waiting on it is gone, so one tab closing
    never truncates the page another tab is waiting for.

    ABANDONMENT IS STICKY (review F4, 2026-10-19). The per-hour loop asks this once per hour; the first time every
    waiter is gone, the hours still queued return nothing and the build is cancelled. A client that joined AFTER that
    moment would be handed the truncated page -- with the flag off it would have built a full one -- so an abandoned
    flight takes no new waiter: a later request starts its own build."""
    def __init__(self):
        self.requests = []
        self.abandoned = False

    def add(self, request):
        if request is not None:
            self.requests.append(request)

    async def is_disconnected(self):
        if self.abandoned:
            return True
        if not self.requests:
            return False
        for r in self.requests:
            try:
                if not await r.is_disconnected():
                    return False
            except Exception:
                return False
        self.abandoned = True
        return True


class _Abandoned(Exception):
    """Every client waiting on a shared build left; the build was cancelled and nothing is encoded or kept."""


class _Page:
    __slots__ = ("body", "gzipped", "raw_len", "timing", "cacheable")

    def __init__(self, body, gzipped, raw_len, timing, cacheable):
        self.body, self.gzipped, self.raw_len, self.timing, self.cacheable = body, gzipped, raw_len, timing, cacheable


class PageMemo:
    def __init__(self):
        self.entries = OrderedDict()      # key -> (expires_monotonic, _Page)
        self.bytes = 0
        self.token = None
        self.inflight = {}                # (key, token) -> (task, _Waiters)

    def _drop(self, key):
        _, page = self.entries.pop(key)
        self.bytes -= len(page.body)

    def set_token(self, token):
        if token != self.token:
            self.entries.clear()
            self.bytes = 0
            self.token = token

    def get(self, key):
        hit = self.entries.get(key)
        if hit is None:
            return None
        if hit[0] <= time.monotonic():
            self._drop(key)
            return None
        self.entries.move_to_end(key)
        return hit[1]

    def put(self, key, page):
        cap = env_float("GRID_SERIES_PAGE_MEMO_MAX_MB", 32.0, lo=0.0, hi=256.0) * 1024 * 1024
        if len(page.body) > cap or self.token == NO_TOKEN:
            return
        if key in self.entries:
            self._drop(key)
        self.entries[key] = (time.monotonic() + env_float("GRID_SERIES_PAGE_MEMO_TTL_S", 180.0, lo=1.0, hi=3600.0), page)
        self.bytes += len(page.body)
        while self.bytes > cap or len(self.entries) > env_int("GRID_SERIES_PAGE_MEMO_MAX_ENTRIES", 64, lo=1, hi=1024):
            self._drop(next(iter(self.entries)))


MEMO = PageMemo()


def _hour_key(hours: str):
    try:
        return tuple(sorted({int(h) for h in hours.split(",") if h.strip() != ""})[:MAX_FRAMES])
    except ValueError:
        return None


# Review F6: a manifest read that fails must not give every request its own token (that disables sharing as well
# as the memo) nor log a traceback per request on the 1-CPU box. One fixed sentinel: requests still share in-flight
# builds; finished pages are not kept (put() refuses under the sentinel); one warning a minute at most.
NO_TOKEN = ("manifest-unavailable",)
_token_warned_at = [0.0]


def _manifest_token(store):
    m = store.get_manifest()
    stamp = getattr(m, "last_manifest_update", None)
    return (id(m), stamp.isoformat() if hasattr(stamp, "isoformat") else str(stamp), len(getattr(m, "products", ()) or ()))


def _cacheable(payload, sink, n_hours, domain, snapped):
    """Keep a page only if a later identical request would build exactly it (see module docstring, 2)."""
    frames = payload.get("frames") if isinstance(payload, dict) else None
    if not frames or len(frames) != n_hours or len(sink) != len(frames):
        return False
    if payload.get("warming") or payload.get("_error"):
        return False
    if any(stale or hit.startswith("stale") or hit.endswith("preview") for stale, hit in sink):
        return False
    cap = env_float("WIND_MID_REVAL_MAX_SPAN" if domain.lower() == "wind" else "MARINE_MID_REVAL_MAX_SPAN",
                    20.0 if domain.lower() == "wind" else 8.0)
    if _spans(*parse_bbox(snapped))[2] <= cap and any("global_mid" in str(f.get("product_id") or "") for f in frames):
        return False
    return True


def gzip_level() -> int:
    return env_int("GRID_SERIES_GZIP_LEVEL", 4, lo=1, hi=4)


def _encode(payload, level):
    from services.weather_pipeline.series_response import encode_json
    t0 = time.perf_counter()
    raw = encode_json(payload)
    t1 = time.perf_counter()
    if len(raw) >= 500:
        body, gz = gzip.compress(raw, compresslevel=level), True
    else:
        body, gz = raw, False
    return body, gz, len(raw), (t1 - t0) * 1000.0, (time.perf_counter() - t1) * 1000.0


def _admission_lane(n_hours):
    """With GRID_SERIES_RESPONSE_BOUNDS also on, the ONE shared build takes that envelope's per-process slot (the
    route takes the envelope only when GRID_RESPONSE_BOUNDS is off; same condition here)."""
    if os.environ.get("GRID_SERIES_RESPONSE_BOUNDS", "0") == "1" and os.environ.get("GRID_RESPONSE_BOUNDS", "0") != "1":
        return "mini" if n_hours == 1 else "page"
    return None


def _deadline_for(lane):
    """The response envelope's budget, when the envelope applies (same bound serve_series uses); else None."""
    if lane is None:
        return None
    return time.monotonic() + env_float("GRID_SERIES_DEADLINE_S", 20.0, lo=1.0, hi=20.0)


def _late():
    from fastapi import HTTPException
    return HTTPException(503, "Series response deadline exceeded", headers={"Retry-After": "1"})


async def _build_watched(builder, waiters):
    """Run the build; cancel it the moment every waiter has gone (the switch-away case: an abandoned 48-frame page
    kept the box busy for up to ~12 s offline and starved the new layer's /grid). Raises _Abandoned."""
    build = asyncio.create_task(builder())
    poll = env_float("GRID_SERIES_PAGE_MEMO_CANCEL_POLL_S", 0.25, lo=0.05, hi=5.0)
    try:
        while True:
            done, _ = await asyncio.wait({build}, timeout=poll)
            if done:
                break
            if await waiters.is_disconnected():
                raise _Abandoned()
    except BaseException:      # _Abandoned, or this task itself cancelled: the build stops either way
        build.cancel()
        raise
    if waiters.abandoned:      # the loop noticed first and returned a truncated page: never encode or serve it
        raise _Abandoned()
    return build.result()


async def _lead(builder, n_hours, domain, snapped, waiters, lane, deadline):
    sink = []
    if lane is not None:
        from services.weather_pipeline.series_response import ADMISSION
        await ADMISSION.acquire(lane, waiters, deadline)
    try:
        tok = SERIES_FRAME_SINK.set(sink)       # set BEFORE the build task exists: the task copies this context
        t0 = time.perf_counter()
        try:
            payload = await _build_watched(builder, waiters)
        finally:
            SERIES_FRAME_SINK.reset(tok)
        build_ms = (time.perf_counter() - t0) * 1000.0
        if deadline is not None and time.monotonic() >= deadline:
            raise _late()
        body, gz, raw_len, enc_ms, gz_ms = await asyncio.to_thread(_encode, payload, gzip_level())
        if deadline is not None and time.monotonic() >= deadline:
            raise _late()
    finally:
        if lane is not None:
            ADMISSION.release(lane)
    _record("grid_series.build", build_ms)
    _record("grid_series.encode", enc_ms)
    _record("grid_series.gzip", gz_ms)
    timing = {"build": build_ms, "encode": enc_ms, "gzip": gz_ms}
    return _Page(body, gz, raw_len, timing, _cacheable(payload, sink, n_hours, domain, snapped))


def _respond(page, request, outcome, t_start):
    from services.weather_pipeline.series_response import accepts_gzip
    body, enc = page.body, "identity"
    if page.gzipped:
        if accepts_gzip(request):
            enc = "gzip"
        else:
            body = gzip.decompress(body)
    t = page.timing if outcome == "miss" else {}
    total = (time.perf_counter() - t_start) * 1000.0
    timing = ", ".join([f"{k};dur={v:.1f}" for k, v in t.items()] + [f"memo;desc={outcome};dur={total:.1f}"])
    _record("grid_series.memo_" + outcome, total)
    # Content-Encoding is always set, so the outer GZipMiddleware leaves the body alone (series_response does the same).
    return Response(body, media_type="application/json",
                    headers={"Vary": "Accept-Encoding", "Content-Encoding": enc, "Server-Timing": timing})


async def serve_memo_series(resolve_grid, viewport_service, store, model, domain, layer, bbox, hours,
                            request=None, surf=False, base_time=None):
    t_start = time.perf_counter()
    hour_key = _hour_key(hours)
    if not hour_key:     # let the builder raise its own 400, exactly as flag-off does
        return await _gsh.build_grid_series(resolve_grid, viewport_service, model, domain, layer, bbox, hours,
                                            request=request, surf=surf, base_time=base_time)
    from datetime import datetime, timezone
    anchor, anchor_source = _resolve_series_anchor(base_time, datetime.now(timezone.utc))
    snapped = snap_series_bbox(bbox, model)
    key = (model.upper(), domain.lower(), layer.lower(), snapped, hour_key, bool(surf),
           anchor.strftime("%Y-%m-%dT%H:%M:%SZ"), anchor_source)
    try:
        MEMO.set_token(await asyncio.to_thread(_manifest_token, store))
    except Exception:
        if time.monotonic() - _token_warned_at[0] > 60.0:
            _token_warned_at[0] = time.monotonic()
            logger.warning("[series-memo] manifest token unavailable; memo cleared, in-flight sharing only", exc_info=True)
        MEMO.set_token(NO_TOKEN)
    page = MEMO.get(key)
    if page is not None:
        return _respond(page, request, "hit", t_start)
    token = MEMO.token
    fkey = (key, token)          # a build started under an older manifest never serves a newer request
    flight = MEMO.inflight.get(fkey)
    outcome = "shared"
    if flight is None or flight[1].abandoned:
        outcome = "miss"
        waiters = _Waiters()
        lane = _admission_lane(len(hour_key))
        deadline = _deadline_for(lane)

        def builder():
            # The anchor the key was built from, so an hour rollover cannot file one hour's page under another's key.
            return _gsh.build_grid_series(resolve_grid, viewport_service, model, domain, layer, snapped, hours,
                                          request=waiters, surf=surf, base_time=base_time,
                                          resolved_anchor=(anchor, anchor_source))
        task = asyncio.create_task(_lead(builder, len(hour_key), domain, snapped, waiters, lane, deadline))
        flight = MEMO.inflight[fkey] = (task, waiters, deadline)

        def _done(t, key=key, token=token, fkey=fkey):
            if MEMO.inflight.get(fkey, (None,))[0] is t:
                MEMO.inflight.pop(fkey, None)
            if t.cancelled():
                return
            exc = t.exception()
            if isinstance(exc, _Abandoned):
                _record("grid_series.memo_abandoned", 0.0)
                return
            if exc is not None:
                # Review F5: with no client left waiting, nobody else would ever see this.
                logger.warning("[series-memo] shared series build failed: %s", type(exc).__name__, exc_info=exc)
                return
            if t.result().cacheable and MEMO.token == token:
                MEMO.put(key, t.result())
        task.add_done_callback(_done)
    flight[1].add(request)
    try:
        if flight[2] is None:
            page = await asyncio.shield(flight[0])
        else:     # the envelope's outer bound: a late page is refused with its 503, never delivered (review item 5)
            page = await asyncio.wait_for(asyncio.shield(flight[0]), max(0.0, flight[2] - time.monotonic()))
    except asyncio.TimeoutError:
        raise _late()
    except _Abandoned:
        from fastapi import HTTPException
        raise HTTPException(499, "Client disconnected")
    return _respond(page, request, outcome, t_start)
