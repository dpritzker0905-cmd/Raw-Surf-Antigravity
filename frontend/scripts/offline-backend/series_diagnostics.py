"""Correlated observations for the synthetic ASGI server only; never imported by backend."""
import contextvars
from datetime import datetime, timezone
import json
import logging
import math
import re
import sys
import time
from urllib.parse import parse_qs
import uuid

HEADER = b"x-rawsurf-synthetic-request-id"
_CONTEXT = contextvars.ContextVar("synthetic_series_request", default=None)
_TIMEOUT = re.compile(r"^\[grid_series\] hour \+(\d+)h timed out after ([\d.]+)s$")
_ID = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
_MODELS = {"GFS", "ICON", "EURO"}
_LAYERS = {"waves", "swell_1", "swell_2", "wind_waves", "wind"}


def _query(raw):
    """Allowlisted weather metadata only: no URL, arbitrary query values or headers."""
    try:
        q = parse_qs(raw[:4096].decode("ascii"), max_num_fields=32)
    except (UnicodeError, ValueError):
        return {}
    result = {}
    for key, allowed in (("model", _MODELS), ("domain", {"marine", "atmosphere"}), ("layer", _LAYERS)):
        value = q.get(key, [""])[0]
        if value in allowed:
            result[key] = value
    try:
        hs = sorted({int(h) for h in q["hours"][0].split(",")})
        if hs and len(hs) <= 48 and all(0 <= h <= 1000 for h in hs):
            result["requested_hours"] = hs
    except (KeyError, ValueError):
        pass
    try:
        bbox = [float(x) for x in q["bbox"][0].split(",")]
        if len(bbox) == 4 and all(math.isfinite(x) and -360 <= x <= 360 for x in bbox):
            result["bbox"] = bbox
    except (KeyError, ValueError):
        pass
    if q.get("surf", [""])[0] in ("0", "1"):
        result["surf"] = q["surf"][0] == "1"
    try:
        result["base_time"] = datetime.fromisoformat(q["base_time"][0].replace("Z", "+00:00")).isoformat()
    except (KeyError, ValueError):
        pass
    return result


def _stdout(event):
    sys.stdout.write(json.dumps({"synthetic_series": event}, separators=(",", ":")) + "\n")
    sys.stdout.flush()


class _WarningObserver(logging.Filter):
    def __init__(self, owner):
        super().__init__()
        self.owner = owner

    def filter(self, record):
        state = _CONTEXT.get()
        if record.levelno < logging.WARNING or state is None or state["owner"] is not self.owner:
            return True
        try:
            match = _TIMEOUT.fullmatch(record.getMessage())
            if match is not None:
                state["timeouts"] += 1
                self.owner._emit(state, "frame_timeout", hour_offset=int(match[1]),
                                 printed_budget_seconds=float(match[2]),
                                 effective_budget_seconds=None, timer_origin="unobserved",
                                 after_request_end=state["ended"])
        except Exception:
            pass
        return True  # Preserve ordinary handlers AND Python's lastResort warning path.


class SeriesDiagnostics:
    """Pass-through ASGI wrapper; only synthetic GET/HEAD grid_series requests are observed."""

    def __init__(self, app, emit=None, max_body_bytes=8 * 1024 * 1024):
        self.app = app
        self.emit = emit if emit is not None else _stdout
        self.max_body_bytes = max_body_bytes
        self.logger = logging.getLogger("services.weather_pipeline.grid_series_helper")
        self.warning_filter = _WarningObserver(self)
        self.logger.addFilter(self.warning_filter)

    def close(self):
        self.logger.removeFilter(self.warning_filter)

    def _emit(self, state, event, **fields):
        try:
            self.emit({"schema": 1, "event": event, "request_id": state["id"],
                       "at": datetime.now(timezone.utc).isoformat(), "monotonic_ns": time.monotonic_ns(),
                       "request_elapsed_ms": round((time.monotonic_ns() - state["start"]) / 1_000_000, 3),
                       "request": state["request"], **fields})
        except Exception:
            pass

    @staticmethod
    def _census(state):
        if not state["body_complete"]:
            return {"coverage": "response_incomplete"}
        if state["encoded"]:
            return {"coverage": "encoded"}
        if state["overflow"]:
            return {"coverage": "body_limit"}
        if not state["json"]:
            return {"coverage": "non_json"}
        try:
            data = json.loads(b"".join(state["chunks"]))
        except Exception:
            return {"coverage": "invalid_json"}
        if not isinstance(data, dict) or not isinstance(data.get("frames"), list):
            return {"coverage": "frames_unknown"}
        frames = data["frames"]
        hours = sorted({f["hour_offset"] for f in frames[:48] if isinstance(f, dict)
                        and type(f.get("hour_offset")) is int and 0 <= f["hour_offset"] <= 1000})
        requested = state["request"].get("requested_hours")
        coverage = ("complete" if requested is not None and len(frames) <= 48 and len(hours) == len(frames)
                    else "request_hours_unknown" if requested is None else "frame_hours_unknown")
        return {"coverage": coverage,
                "returned_frame_count": len(frames), "returned_hours": hours,
                "declared_frame_count": data.get("frame_count") if type(data.get("frame_count")) is int else None,
                "missing_hours": sorted(set(requested) - set(hours)) if coverage == "complete" else None}

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") != "/api/weather/grid_series" or scope.get("method") not in ("GET", "HEAD"):
            return await self.app(scope, receive, send)
        candidate = dict(scope.get("headers", [])).get(HEADER, b"").decode("ascii", errors="replace")
        request_id = candidate if _ID.fullmatch(candidate) else uuid.uuid4().hex
        state = {"owner": self, "id": request_id, "start": time.monotonic_ns(),
                 "request": _query(scope.get("query_string", b"")), "timeouts": 0, "ended": False,
                 "disconnect": False, "status": None, "body_complete": False,
                 "chunks": [], "bytes": 0, "overflow": False, "encoded": False, "json": False}
        token = _CONTEXT.set(state)
        outcome = "complete"
        error_type = None
        self._emit(state, "request_start")

        async def observed_receive():
            message = await receive()
            if message.get("type") == "http.disconnect":
                state["disconnect"] = True
                self._emit(state, "disconnect_observed")
            return message

        async def observed_send(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != HEADER]
                headers.append((HEADER, request_id.encode("ascii")))
                state["status"] = message["status"]
                values = {k.lower(): v.lower() for k, v in headers}
                state["json"] = b"application/json" in values.get(b"content-type", b"")
                state["encoded"] = bool(values.get(b"content-encoding"))
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body":
                body = message.get("body", b"")
                if not state["overflow"]:
                    if state["bytes"] + len(body) <= self.max_body_bytes:
                        state["chunks"].append(body)
                    else:
                        state["overflow"] = True
                        state["chunks"].clear()
                await send(message)
                state["bytes"] += len(body)
                if not message.get("more_body", False):
                    state["body_complete"] = True
                return
            await send(message)

        try:
            await self.app(scope, observed_receive, observed_send)
        except BaseException as error:
            error_type = type(error).__name__
            outcome = "cancelled" if error_type == "CancelledError" else "error"
            raise
        finally:
            state["ended"] = True
            self._emit(state, "request_end", outcome=outcome, error_type=error_type,
                       status=state["status"], response_bytes=state["bytes"],
                       disconnect_observed=state["disconnect"], timeout_warnings=state["timeouts"],
                       frame_census=self._census(state))
            state["chunks"].clear()
            _CONTEXT.reset(token)
