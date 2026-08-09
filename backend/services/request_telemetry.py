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


def _percentile_ms(entry: dict, q: float) -> Optional[float]:
    n = entry["n"]
    if n == 0:
        return None
    target = max(1, math.ceil(q * n))
    acc = 0
    for i, count in enumerate(entry["buckets"]):
        acc += count
        if acc >= target:
            if i < len(BUCKET_BOUNDS_MS):
                return float(BUCKET_BOUNDS_MS[i])
            return round(entry["max_ms"], 1)          # overflow bucket: the honest representative
    return round(entry["max_ms"], 1)


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
    rows: List[dict] = []
    ranked = sorted(_routes.items(), key=lambda kv: kv[1]["n"], reverse=True)[:max(0, top)]
    for (method, template), entry in ranked:
        rows.append({
            "route": f"{method} {template}", "n": entry["n"], "err_5xx": entry["err"],
            "avg_ms": round(entry["sum_ms"] / entry["n"], 1) if entry["n"] else None,
            "p50_ms": _percentile_ms(entry, 0.50), "p90_ms": _percentile_ms(entry, 0.90),
            "p99_ms": _percentile_ms(entry, 0.99), "max_ms": round(entry["max_ms"], 1),
        })
    return {
        "started_at": _started_at, "routes_tracked": len(_routes),
        "total": {"n": total["n"], "err_5xx": total["err"],
                  "p50_ms": _percentile_ms(total, 0.50), "p99_ms": _percentile_ms(total, 0.99),
                  "max_ms": round(total["max_ms"], 1)},
        "top_routes": rows,
        "note": "percentiles are bucket upper bounds (read high, never low); cumulative since started_at",
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
