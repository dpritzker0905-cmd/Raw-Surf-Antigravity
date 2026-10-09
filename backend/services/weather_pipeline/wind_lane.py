"""wind_lane.py — the wind map's model is chosen by PLACE and TIME, never by zoom (2026-10-09, D-017).

THE DEFECT IT ENDS. Two zoom stops over the Gulf hurricane drew two models under one GFS label: Open-Meteo's
`gfs_seamless` (HRRR inside HRRR's domain) in one box, NOAA GFS in the next, so the eye moved 38 km on a one-stop zoom
(log 2026-10-09-hurricane-eye-one-model.md). WIND_GRID_GFS_GLOBAL made every tier GFS and lost HRRR's coast.

THE LANE. Inside HRRR's domain and inside HRRR's horizon the wind is HRRR; everywhere else it is GFS. ONE stored HRRR
field per hour (built by the ingest on GitHub Actions: services/noaa_hrrr_wind_fetcher.py, wind_lane_ingest.py) is
blended into EVERY GFS wind grid the map is served (the 10-deg and 2-deg world tiers, the 0.25-deg regional tiles,
the dynamic viewport boxes, the native recovery) by `apply_wind_lane`, called once in the /grid route that /grid_series
also calls per frame. A node's HRRR value is the same in every tier, so a zoom or a pan cannot change the model under
the eye. Nothing is written back: stored and cached products stay GFS, so spot points, ratings and glyphs (which read
those products and fetch_point, never this route) see no change.

SEAMS (measured 2026-10-09, HRRR 12Z vs NOAA GFS 12Z at f03/f12/f24/f36/f48, 0.25-deg lattice):
  * space: a cos^2 feather over FEATHER_KM inside HRRR's edge, starting past HRRR's own relaxation rows (15 km). The
    seam term |H-G|.|dw/dx| peaks at 0.53-1.07 kn/km with a hard cut, 2.4-4.4x the field's natural interior p95
    (0.19-0.32); 150 km still exceeded it at f03 (0.221 vs 0.190); 200 km held at all five (0.128-0.186).
  * time: HRRR's weight tapers linearly over its last TAPER_HOURS hours, Open-Meteo's own seamless hand-off
    (measured: 1.0 / 0.75 / 0.5 / 0.25 / 0). A hard switch made the step at the horizon 10.62 kn p95 against a natural
    hourly 3.9-4.9; the taper kept every step at 4.07-4.74.
  * blend: SCALAR speed, direction from the blended vector (LESSONS L-S16: a speed averaged as a vector can only shrink).

FLAGS. WIND_HRRR_LANE (default "1", owner 2026-10-09: "start it switched on"); "0" returns every product untouched, which
is the gfs_global map exactly as it was. Per session: the client's `window.__RAW_DISABLE_WIND_HRRR_LANE__` sends
`wind_lane=gfs`, which server.py's middleware puts in `request_mode`.
"""
import logging
import math
import os
import threading
import time
from contextvars import ContextVar
from typing import Optional

logger = logging.getLogger(__name__)

FLAG = "WIND_HRRR_LANE"
INDEX_KEY = "wind_lane/index.json"
SOURCE = "NOAA HRRR CONUS 3 km (AWS Open Data), 0.25-deg area mean, rotated to earth"

# The client kill switch for one session: "gfs" skips the lane for this request (set by server.py's middleware).
request_mode: ContextVar = ContextVar("wind_lane_request_mode", default=None)


def enabled() -> bool:
    return os.environ.get(FLAG, "1") != "0"


def feather_km() -> float:
    try:
        return max(0.0, float(os.environ.get("WIND_HRRR_FEATHER_KM", "200")))
    except ValueError:
        return 200.0


def taper_hours() -> int:
    try:
        return max(0, int(os.environ.get("WIND_HRRR_TAPER_HOURS", "3")))
    except ValueError:
        return 3


def _grid():
    try:
        from services import _hrrr_grid
    except ImportError:  # pragma: no cover
        import _hrrr_grid
    return _hrrr_grid


class Lane:
    """One HRRR cycle on the lattice, kept as int16 (0.1 kn), shape (hour, lat, lon): 7.4 MB for 49 hours. Only the
    hour a request needs is turned into floats."""

    def __init__(self, obj, key=None):
        import numpy as np
        try:
            from services.noaa_hrrr_wind_fetcher import decode_q, FORMAT, MISSING
        except ImportError:  # pragma: no cover
            from noaa_hrrr_wind_fetcher import decode_q, FORMAT, MISSING
        if obj.get("format") != FORMAT:
            raise ValueError(f"wind lane format {obj.get('format')!r} != {FORMAT!r}")
        hg = _grid()
        self.key = key
        self.cycle = hg.utc(obj["cycle"])
        self.hours = {hg.utc(h): k for k, h in enumerate(obj["hours"])}
        self.horizon = max(self.hours)
        la = obj["lattice"]
        self.lat0, self.lon0, self.res = float(la["lat0"]), float(la["lon0"]), float(la["res"])
        self.nlat, self.nlon = int(la["nlat"]), int(la["nlon"])
        shape = (len(obj["hours"]), self.nlat, self.nlon)
        self.uq = decode_q(obj["u"], shape)
        self.vq = decode_q(obj["v"], shape)
        if not ((self.uq != MISSING).any() and (self.vq != MISSING).any()):
            raise ValueError("wind lane holds no HRRR cell")

    def time_weight(self, valid):
        """HRRR's weight at `valid`: 0 before the cycle, at an hour it does not hold, or past its horizon."""
        if valid < self.cycle or self.hour_index(valid) is None:
            return 0.0
        return _grid().time_weight(valid, self.horizon, taper_hours())

    def hour_index(self, valid):
        return self.hours.get(valid.replace(second=0, microsecond=0))

    def sample(self, lats, lngs, k):
        """Bilinear HRRR (u, v) at points, NaN-aware (the corners that hold HRRR carry the weight); NaN off HRRR."""
        import numpy as np
        y = (np.asarray(lats, dtype=float) - self.lat0) / self.res
        x = (np.asarray(lngs, dtype=float) - self.lon0) / self.res
        y0 = np.floor(y + 1e-9).astype(int)
        x0 = np.floor(x + 1e-9).astype(int)
        ty, tx = np.clip(y - y0, 0.0, 1.0), np.clip(x - x0, 0.0, 1.0)
        try:
            from services.noaa_hrrr_wind_fetcher import dequantize
        except ImportError:  # pragma: no cover
            from noaa_hrrr_wind_fetcher import dequantize
        U, V = dequantize(self.uq[k]), dequantize(self.vq[k])
        su = np.zeros(y.shape)
        sv = np.zeros(y.shape)
        sw = np.zeros(y.shape)
        for dy, wy in ((0, 1.0 - ty), (1, ty)):
            for dx, wx in ((0, 1.0 - tx), (1, tx)):
                yy, xx = y0 + dy, x0 + dx
                inb = (yy >= 0) & (yy < self.nlat) & (xx >= 0) & (xx < self.nlon)
                yc, xc = np.clip(yy, 0, self.nlat - 1), np.clip(xx, 0, self.nlon - 1)
                cu, cv = U[yc, xc], V[yc, xc]
                w = wy * wx * (inb & np.isfinite(cu) & np.isfinite(cv))
                su += np.where(w > 0, w * np.nan_to_num(cu), 0.0)
                sv += np.where(w > 0, w * np.nan_to_num(cv), 0.0)
                sw += w
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(sw > 1e-9, su / sw, np.nan), np.where(sw > 1e-9, sv / sw, np.nan)


class WindLaneRequestMode:
    """ASGI middleware: `wind_lane=gfs` on /grid or /grid_series (the client kill switch) skips the lane for that
    request. It sets `request_mode` for the call, so /grid_series' per-frame tasks, which copy the context, inherit it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = None
        if scope.get("type") == "http" and scope.get("path", "").endswith(("/weather/grid", "/weather/grid_series")):
            from urllib.parse import parse_qs
            mode = (parse_qs((scope.get("query_string") or b"").decode("latin-1")).get("wind_lane") or [None])[0]
            if mode == "gfs":
                token = request_mode.set("gfs")
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                request_mode.reset(token)


# ───────────────────────────── loading (L2 -> memory, off the event loop) ─────────────────────────────
_state = {"lane": None, "checked": 0.0, "error": None}
_lock = threading.Lock()


def install(lane: Optional[Lane]):
    """Make `lane` the served one (the loader and tests)."""
    _state["lane"] = lane
    _state["checked"] = time.monotonic()


def _l2_get(key):
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not secret:
        return None
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    resp = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}",
                        headers={"Authorization": f"Bearer {secret}", "apikey": secret}, timeout=60)
    return resp.json() if resp.status_code == 200 else None


def refresh():
    """Read the index; load its cycle when it is not the one in memory. Never raises."""
    if not _lock.acquire(blocking=False):
        return
    try:
        index = _l2_get(INDEX_KEY)
        if not index or not index.get("key"):
            return
        cur = _state["lane"]
        if cur is not None and cur.key == index["key"]:
            return
        obj = _l2_get(index["key"])
        if obj:
            install(Lane(obj, key=index["key"]))
            logger.info(f"[wind-lane] loaded HRRR cycle {obj.get('cycle')} ({len(obj.get('hours') or [])} hours)")
    except Exception as e:
        _state["error"] = f"{type(e).__name__}: {e}"
        logger.warning(f"[wind-lane] refresh failed (serving the last lane, or GFS): {_state['error']}")
    finally:
        _state["checked"] = time.monotonic()
        _lock.release()


def current_lane() -> Optional[Lane]:
    """The lane in memory; starts a background refresh when the index check is older than its TTL."""
    try:
        ttl = float(os.environ.get("WIND_HRRR_LANE_INDEX_TTL_S", "300"))
    except ValueError:
        ttl = 300.0
    if time.monotonic() - _state["checked"] >= ttl or (_state["lane"] is None and _state["checked"] == 0.0):
        _state["checked"] = time.monotonic()
        from services._fetch_common import is_test_environment
        if not is_test_environment():
            threading.Thread(target=refresh, name="wind-lane-refresh", daemon=True).start()
    return _state["lane"]


# ───────────────────────────── the one place the lane meets a served grid ─────────────────────────────
def _data_time(product):
    hg = _grid()
    for attr in ("served_valid_time", "valid_time"):
        v = getattr(product, attr, None)
        if v:
            try:
                return hg.utc(v)
            except Exception:
                continue
    return None


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _stamped(product, info):
    import copy
    out = copy.copy(product)
    out.wind_lane = info
    return out


def apply_wind_lane(product, model, domain, layer, lane=None):
    """Blend the HRRR lane into a GFS wind grid. Returns a NEW product (the input, its grid, its vector list and its
    vectors may be cache objects and are never written to), or `product` itself when the lane is off or the grid is
    not GFS wind. Never raises into the route."""
    try:
        if not enabled() or request_mode.get() == "gfs":
            return product
        if (model or "").upper() != "GFS" or (domain or "").lower() != "wind" or (layer or "").lower() != "wind":
            return product
        grid = getattr(product, "grid", None)
        if not product or not grid or not getattr(grid, "vectors", None):
            return product
        lane = lane if lane is not None else current_lane()
        if lane is None:          # nothing loaded yet (cold start, local dev, tests): the GFS grid, byte-identical
            return product
        base = {"lane": "gfs", "feather_km": feather_km(), "taper_hours": taper_hours(),
                "hrrr_cycle": _iso(lane.cycle), "hrrr_horizon": _iso(lane.horizon), "source": SOURCE}
        valid = _data_time(product)
        if valid is None:
            return _stamped(product, {**base, "reason": "no_valid_time"})
        w_t = lane.time_weight(valid)
        if w_t <= 0.0:
            reason = ("beyond_hrrr_horizon" if valid > lane.horizon else
                      "before_hrrr_cycle" if valid < lane.cycle else "hrrr_hour_missing")
            return _stamped(product, {**base, "valid_time": _iso(valid), "reason": reason})
        return _blend(product, grid, lane, valid, w_t, base)
    except Exception as e:
        logger.warning(f"[wind-lane] apply failed, serving the GFS grid unchanged: {type(e).__name__}: {e}")
        return product


def _blend(product, grid, lane, valid, w_t, base):
    import copy
    import numpy as np
    hg = _grid()
    vectors = grid.vectors
    lats = np.fromiter((v.lat for v in vectors), dtype=float, count=len(vectors))
    lngs = np.fromiter((v.lng for v in vectors), dtype=float, count=len(vectors))
    lngs = ((lngs + 180.0) % 360.0) - 180.0
    near = ((lats >= lane.lat0 - lane.res) & (lats <= lane.lat0 + lane.nlat * lane.res)
            & (lngs >= lane.lon0 - lane.res) & (lngs <= lane.lon0 + lane.nlon * lane.res))
    idx = np.nonzero(near)[0]
    info = {**base, "valid_time": _iso(valid), "time_weight": round(w_t, 4)}
    if idx.size == 0:
        return _stamped(product, {**info, "reason": "outside_hrrr_domain"})
    w = hg.space_weight_np(lats[idx], lngs[idx], feather_km()) * w_t
    hu, hv = lane.sample(lats[idx], lngs[idx], lane.hour_index(valid))
    use = (w > 0.0) & np.isfinite(hu) & np.isfinite(hv)
    if not use.any():
        return _stamped(product, {**info, "reason": "outside_hrrr_domain"})
    out_vectors = list(vectors)
    n_full = 0
    for k in np.nonzero(use)[0]:
        i = int(idx[k])
        g = vectors[i]
        if not getattr(g, "is_valid", True):
            continue
        wk = float(w[k])
        h_u, h_v = float(hu[k]), float(hv[k])
        h_s = math.hypot(h_u, h_v)
        g_s = float(g.speed or 0.0)
        speed = wk * h_s + (1.0 - wk) * g_s
        bu = wk * h_u + (1.0 - wk) * float(g.u or 0.0)
        bv = wk * h_v + (1.0 - wk) * float(g.v or 0.0)
        if math.hypot(bu, bv) < 1e-9:                     # opposed and equal: keep the heavier side's bearing
            bu, bv = (h_u, h_v) if wk >= 0.5 else (float(g.u or 0.0), float(g.v or 0.0))
        norm = math.hypot(bu, bv)
        if norm < 1e-9:
            u_out = v_out = 0.0
            direction = float(g.direction or 0.0)
        else:
            u_out, v_out = speed * bu / norm, speed * bv / norm
            direction = (math.degrees(math.atan2(-u_out, -v_out)) + 360.0) % 360.0
        out_vectors[i] = g.model_copy(update={"speed": round(speed, 4), "u": round(u_out, 4), "v": round(v_out, 4),
                                              "direction": round(direction, 2)})
        n_full += wk >= 0.9999
    out = copy.copy(product)
    out.grid = copy.copy(grid)
    out.grid.vectors = out_vectors
    out.wind_lane = {**info, "lane": "hrrr+gfs", "hrrr_cells": int(use.sum()), "hrrr_full_cells": int(n_full),
                     "max_weight": round(float(w[use].max()), 4)}
    return out
