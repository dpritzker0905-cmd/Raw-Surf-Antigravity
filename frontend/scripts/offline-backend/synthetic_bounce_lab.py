"""The offline harness's BOUNCE LAB (2026-11-12, scn_bounce_holds_on.js): two response rewrites the finer-resident hold has never met.

The ICON wind-wave "bounce" (a pan flashes the heatmap coarse, then it resharpens) is held offline by marineFinerResidentHold.js (#746,
#752) whenever the synthetic backend answers as it always does. Two live conditions it never produced:
  UNLABEL  a WORLD frame with no `served_valid_time` (the engine's no-downgrade guard "fails open" on an unlabelled frame, 2026-11-08 note).
           Armed: every marine /grid and /grid_series answer whose frame is world tier (region_id global_mid / global_coarse, or a
           bounds span >= 340 deg of longitude) loses its served_valid_time key. Nothing else changes.
  CYCLE    a model cycle that advances MID-SESSION. Armed with hours=H and a scope: every marine answer of that tier has run_time,
           model_run_time and ingested_at moved H hours later (the field values stay; only the identity says "new run"), the way a new
           ingest lands one tier before the other.
Control routes (GET): /__lab/unlabel?on=1|0   /__lab/cycle?hours=6&scope=world|regional|any (hours=0 disarms)   /__lab/bounce/status
The rewrite is a pure ASGI wrapper around the app; it asks the app for an uncompressed body so it can edit the JSON.
"""
import json
from datetime import datetime, timedelta, timezone

LAB = {"unlabel": False, "cycle_hours": 0, "cycle_scope": "any", "rewritten": {"unlabel": 0, "cycle": 0}, "requests": []}
_TIME_KEYS = ("run_time", "model_run_time", "ingested_at")


def _span(b):
    try:
        w, e = float(b["west"]), float(b["east"])
    except (TypeError, KeyError, ValueError):
        return None
    return e - w if e > w else e + 360.0 - w


def _is_world(d, inherited):
    rid = d.get("region_id")
    if rid in ("global_mid", "global_coarse"):
        return True
    if isinstance(rid, str) and rid:
        return False
    for b in (d.get("bounds"), (d.get("grid") or {}).get("bounds") if isinstance(d.get("grid"), dict) else None):
        s = _span(b) if isinstance(b, dict) else None
        if s is not None:
            return s >= 340.0
    return inherited


def _shift(value, hours):
    if not isinstance(value, str) or not value.endswith("Z"):
        return value
    try:
        t = datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return value
    return (t + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


def rewrite(obj, world=None):
    """Edit a decoded /grid or /grid_series body in place per LAB; returns how many dicts were touched (unlabel, cycle)."""
    n = [0, 0]

    def walk(o, ctx):
        if isinstance(o, list):
            for x in o:
                walk(x, ctx)
            return
        if not isinstance(o, dict):
            return
        w = _is_world(o, ctx)
        if LAB["unlabel"] and w is True and "served_valid_time" in o:
            del o["served_valid_time"]
            n[0] += 1
        h, scope = LAB["cycle_hours"], LAB["cycle_scope"]
        if h and w is not None and (scope == "any" or (scope == "world") == w) and any(k in o for k in _TIME_KEYS):
            for k in _TIME_KEYS:
                if k in o:
                    o[k] = _shift(o[k], h)
            n[1] += 1
        for k, v in o.items():
            if k != "vectors":
                walk(v, w)
    walk(obj, world)
    return n


class BounceLab:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "") if scope.get("type") == "http" else ""
        if path.endswith("/weather/grid") or path.endswith("/weather/grid_series"):
            # every marine grid request, armed or not: whether a pan / cycle step asked the backend at all
            LAB["requests"].append({"path": path.rsplit("/", 1)[-1], "q": (scope.get("query_string") or b"").decode()[:300]})
        if not (path.endswith("/weather/grid") or path.endswith("/weather/grid_series")) or not (LAB["unlabel"] or LAB["cycle_hours"]):
            return await self.app(scope, receive, send)
        scope = dict(scope, headers=[(k, v) for k, v in scope.get("headers", []) if k.lower() != b"accept-encoding"])
        start, chunks = {}, []

        async def capture(message):
            if message["type"] == "http.response.start":
                start.update(message)
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if not message.get("more_body"):
                    body = b"".join(chunks)
                    try:
                        obj = json.loads(body)
                        u, c = rewrite(obj)
                        LAB["rewritten"]["unlabel"] += u
                        LAB["rewritten"]["cycle"] += c
                        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
                    except ValueError:
                        pass
                    headers = [(k, v) for k, v in start.get("headers", []) if k.lower() not in (b"content-length", b"etag")]
                    headers.append((b"content-length", str(len(body)).encode()))
                    await send(dict(start, headers=headers))
                    await send({"type": "http.response.body", "body": body})
        return await self.app(scope, receive, capture)


def install_bounce_lab(app):
    """Add the control routes to `app` and return the wrapped ASGI app to serve."""
    from fastapi.responses import JSONResponse

    async def lab_unlabel(on: int = 1):
        LAB["unlabel"] = bool(on)
        return JSONResponse(status())

    async def lab_cycle(hours: int = 0, scope: str = "any"):
        if scope not in ("world", "regional", "any"):
            return JSONResponse({"error": "scope must be world, regional or any"}, status_code=400)
        LAB.update({"cycle_hours": int(hours), "cycle_scope": scope})
        return JSONResponse(status())

    async def lab_status():
        return JSONResponse(status())
    app.add_api_route("/__lab/unlabel", lab_unlabel, methods=["GET"])
    app.add_api_route("/__lab/cycle", lab_cycle, methods=["GET"])
    app.add_api_route("/__lab/bounce/status", lab_status, methods=["GET"])
    return BounceLab(app)


def status():
    return {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in LAB.items()}
