"""In-process request telemetry — the denominator MASTER-AUDIT-11.0 could not find.

WHY (§3.14, observability rated CRITICAL): zero runtime telemetry existed — no OTel, no
Prometheus, no statsd, no Sentry, no /metrics — so no audit or incident could answer "what
fraction of requests pay this cost", and every performance claim in three consecutive audits
carried a "not quantified in production" caveat. Thirteen audit passes had to hand-build
harnesses to get ANY number. This is deliberately NOT an APM: pure-ASGI accounting into a
bounded in-process histogram, exposed on the EXISTING /api/health payload the health lane and
the external uptime probe already poll. No new dependency, no new route, no new egress.

DESIGN BOUNDS — each one a refusal to grow:
  - route TEMPLATE, never the raw path (an id-bearing path would explode cardinality);
    unmatched requests fold into "(unmatched)"
  - at most MAX_ROUTES distinct (method, template) keys; overflow folds into "(other)"
  - fixed log-scale latency buckets, counts only — no samples, no timestamps retained
  - cumulative since process start; `started_at` rides the payload so a reader can rate it
Percentiles are the CONTAINING BUCKET'S UPPER BOUND — they read high, never low; the overflow
bucket reports max_ms as its representative. Kill: REQUEST_TELEMETRY=0.

Thread note: increments run on the event loop only (the ASGI callable); `to_thread`'d handler
work still accounts to its request because timing wraps the whole send cycle. No lock needed.
"""
import math
import os
import time
from typing import Dict, List, Optional, Tuple

BUCKET_BOUNDS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)
MAX_ROUTES = 200
OTHER_KEY = ("*", "(other)")

_started_at = time.time()
_routes: Dict[Tuple[str, str], dict] = {}


def _new_entry() -> dict:
    return {"n": 0, "err": 0, "sum_ms": 0.0, "max_ms": 0.0,
            "buckets": [0] * (len(BUCKET_BOUNDS_MS) + 1)}


def record(method: str, template: str, status: int, elapsed_ms: float) -> None:
    key = (method or "?", template or "(unmatched)")
    entry = _routes.get(key)
    if entry is None:
        if len(_routes) >= MAX_ROUTES:
            key = OTHER_KEY
            entry = _routes.get(key)
            if entry is None:
                entry = _routes[key] = _new_entry()
        else:
            entry = _routes[key] = _new_entry()
    entry["n"] += 1
    if status >= 500:
        entry["err"] += 1
    entry["sum_ms"] += elapsed_ms
    if elapsed_ms > entry["max_ms"]:
        entry["max_ms"] = elapsed_ms
    for i, bound in enumerate(BUCKET_BOUNDS_MS):
        if elapsed_ms <= bound:
            entry["buckets"][i] += 1
            break
    else:
        entry["buckets"][-1] += 1


def _percentile_ms(entry: dict, q: float):
    """(value_ms, is_overflow). Value is an UPPER BOUND on the true percentile, never a sample.

    ⚠️ TWO WAYS THIS MISLED A READER (2026-08-10, and the reader was the author):
      1. OVERFLOW PRINTED max_ms AS THE PERCENTILE. A route with 5 requests, 3 of them over the
         top bound and one at 85.8 s, reported `p50 = 85778.1` -- indistinguishable from a
         measured 85.8 s median. All that is actually known is "p50 >= 10000". The caller now
         gets `is_overflow` so it can say so instead of printing a number that looks measured.
      2. A BUCKET BOUND CAN EXCEED THE OBSERVED MAX. Five 8 ms requests reported
         `p50 = p90 = p99 = 10.0` beside `max = 8.0` -- a percentile above the maximum, which
         reads as a bug. min() with max_ms keeps it an upper bound AND keeps it believable.
    """
    n = entry["n"]
    if n == 0:
        return None, False
    target = max(1, math.ceil(q * n))
    acc = 0
    for i, count in enumerate(entry["buckets"]):
        acc += count
        if acc >= target:
            if i < len(BUCKET_BOUNDS_MS):
                # Still an upper bound, just never above what was actually observed.
                return round(min(float(BUCKET_BOUNDS_MS[i]), entry["max_ms"]), 1), False
            return round(entry["max_ms"], 1), True
    return round(entry["max_ms"], 1), True


def snapshot(top: int = 30) -> dict:
    """The /api/health block: totals plus the top-N routes by traffic."""
    total = _new_entry()
    for entry in _routes.values():
        total["n"] += entry["n"]
        total["err"] += entry["err"]
        total["sum_ms"] += entry["sum_ms"]
        total["max_ms"] = max(total["max_ms"], entry["max_ms"])
        for i, c in enumerate(entry["buckets"]):
            total["buckets"][i] += c
    _t50, _t50_of = _percentile_ms(total, 0.50)
    _t99, _t99_of = _percentile_ms(total, 0.99)
    rows: List[dict] = []
    ranked = sorted(_routes.items(), key=lambda kv: kv[1]["n"], reverse=True)[:max(0, top)]
    for (method, template), entry in ranked:
        p50, p50_of = _percentile_ms(entry, 0.50)
        p90, p90_of = _percentile_ms(entry, 0.90)
        p99, p99_of = _percentile_ms(entry, 0.99)
        row = {
            "route": f"{method} {template}", "n": entry["n"], "err_5xx": entry["err"],
            "avg_ms": round(entry["sum_ms"] / entry["n"], 1) if entry["n"] else None,
            "p50_ms": p50, "p90_ms": p90, "p99_ms": p99,
            "max_ms": round(entry["max_ms"], 1),
        }
        # ABSENT unless true, so a clean row stays clean and the marker means something when it
        # appears. `over_top_bucket` is the COUNT that exceeded the last bound -- the fact a reader
        # needs to judge whether an overflow percentile represents many requests or one outlier.
        over = entry["buckets"][-1]
        if over:
            row["over_%dms" % BUCKET_BOUNDS_MS[-1]] = over
        for name, flag in (("p50", p50_of), ("p90", p90_of), ("p99", p99_of)):
            if flag:
                row[name + "_ge_ms"] = float(BUCKET_BOUNDS_MS[-1])
        rows.append(row)
    return {
        "started_at": _started_at, "routes_tracked": len(_routes),
        "total": {"n": total["n"], "err_5xx": total["err"],
                  "p50_ms": _t50, "p99_ms": _t99, "max_ms": round(total["max_ms"], 1),
                  **({"p50_ge_ms": float(BUCKET_BOUNDS_MS[-1])} if _t50_of else {}),
                  **({"p99_ge_ms": float(BUCKET_BOUNDS_MS[-1])} if _t99_of else {}),
                  **({"over_%dms" % BUCKET_BOUNDS_MS[-1]: total["buckets"][-1]}
                     if total["buckets"][-1] else {})},
        "top_routes": rows,
        "note": ("percentiles are bucket UPPER BOUNDS, capped at the observed max (read high, "
                 "never low, never above max_ms); CUMULATIVE since started_at, so they include "
                 "past stalls and are NOT a current-latency reading; a `pNN_ge_ms` field means "
                 "that percentile only landed in the overflow bucket -- the true value is >= that "
                 "number and the printed pNN_ms is merely max_ms, not a measurement"),
    }


class RequestTelemetryMiddleware:
    """Pure-ASGI: no BaseHTTPMiddleware (it re-buffers bodies), no dependency. Outermost in the
    stack so elapsed_ms includes CORS + gzip — the number closest to what the client felt."""

    def __init__(self, app):
        self.app = app
        self.enabled = os.environ.get("REQUEST_TELEMETRY", "1") != "0"

    async def __call__(self, scope, receive, send):
        if not self.enabled or scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        t0 = time.perf_counter()
        status_holder = [500]      # a request that dies before http.response.start counts as a 500

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                status_holder[0] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            route = scope.get("route")     # set by the router DURING the app call; dict is shared
            template = (getattr(route, "path_format", None) or getattr(route, "path", None)
                        or "(unmatched)")
            record(scope.get("method", "?"), template, status_holder[0], elapsed_ms)
