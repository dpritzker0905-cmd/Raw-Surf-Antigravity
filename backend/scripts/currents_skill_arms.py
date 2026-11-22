"""currents_skill_arms.py - the arm readers and the shared time filter of the currents-skill-v1 registration (section 1, 4).
Serves nothing; reads what the collector saved.

ARMS. CMEMS_025, GIOPS_025 and RTOFS_025 are read from the frames their publishers served (saved verbatim by the collector):
  - a two-byte frame (FRAME_RASTER_ONE_BYTE=0) carries speed (field 4, kn) + direction toward (field 1): u, v at every node;
  - a one-byte frame carries the 0.02 kn speed band (field 13) + the flow-direction byte (field 14), which holds ONE direction
    per 2 x 2 block at the block's south-west cell (frame_binary FLOW_DIR_*). The node's vector is its own band speed along its
    block's direction: exactly what the map's particles use. Scoring the served frames (not a full-precision rebuild) is the
    registration's "each arm is what the map serves"; AMENDMENT QUESTION A1 asks whether that is the intended reading.
  - a frame with a speed but no direction cannot give a vector and is refused (the step is missing; the init drops by rule).
CMEMS_083 is the native 1/12-degree subset (collector `native`), already u, v in m/s.
PERSIST_<src> is the arm's EARLIEST scored step held for every later lead (`persistence`).

STEPS. Every arm is scored from its 6 h step on (registration section 1: "every arm's first served step has the same valid
time (6 h)"); CMEMS and RTOFS also publish 0 h, which is ignored so the arms stand on equal footing (AMENDMENT QUESTION A2).

TIME FILTER (section 4). Steps are interpolated linearly in time to hourly values; the 25 h filter is the centred mean of
those hourly values over the hours of a mask. `window_weights` turns that into one weight per step, so a filtered value is
a dot product with the step values (the filter is linear).
"""
import math
from typing import Dict, Iterable, Optional, Sequence

import numpy as np

KN_TO_MS = 1852.0 / 3600.0
FIRST_STEP_H = 6
HALF_WINDOW_H = 12          # the centred 25 h window: t-12 .. t+12
NEED_HOURS = 20             # >= 20 of 25 hours

SPEED, DIRECTION, CURRENT_KN_BAND, FLOW_DIR_BYTE, FLOW_DIR_STRIDE = 4, 1, 13, 14, 2


def _fb():
    try:
        from services import frame_binary as fb
    except ImportError:  # pragma: no cover - by path
        import frame_binary as fb
    return fb


def decode_frame_uv(data: bytes):
    """(lats asc, lons asc, u m/s, v m/s, valid_epoch_s, run_epoch_s) from one served currents frame (module docstring)."""
    head, planes = _fb().decode_plane(data)
    rows, cols = head["rows"], head["cols"]
    west, south, east, north = head["bounds"]
    lats = np.linspace(south, north, rows)
    lons = np.linspace(west, east, cols)
    if SPEED in planes and DIRECTION in planes:
        spd, to = planes[SPEED], planes[DIRECTION]
    elif CURRENT_KN_BAND in planes and FLOW_DIR_BYTE in planes:
        spd = planes[CURRENT_KN_BAND]
        anchors = planes[FLOW_DIR_BYTE][::FLOW_DIR_STRIDE, ::FLOW_DIR_STRIDE]
        to = np.repeat(np.repeat(anchors, FLOW_DIR_STRIDE, 0), FLOW_DIR_STRIDE, 1)[:rows, :cols]
    else:
        raise ValueError(f"frame has fields {sorted(planes)}: no current vector (speed and direction both needed)")
    s = spd * KN_TO_MS
    rad = np.radians(to)
    u, v = s * np.sin(rad), s * np.cos(rad)                      # uv_convention 1: toward
    u = np.where(np.isfinite(spd), u, np.nan)
    v = np.where(np.isfinite(spd), v, np.nan)
    return lats, lons, u, v, head["valid_epoch"], head["run_epoch"]


class ArmField:
    """An arm's steps for one init: u, v [step, lat, lon] in m/s on ascending axes; `steps_h` lead hours."""

    def __init__(self, name, steps_h, lats, lons, u, v, global_lon=None):
        order = np.argsort(steps_h)
        self.name = name
        self.steps_h = np.asarray(steps_h, dtype=float)[order]
        self.lats, self.lons = np.asarray(lats, float), np.asarray(lons, float)
        self.u, self.v = np.asarray(u, float)[order], np.asarray(v, float)[order]
        if global_lon is None:
            global_lon = (self.lons[-1] - self.lons[0]) + (self.lons[1] - self.lons[0]) >= 359.99
        self.global_lon = bool(global_lon)

    @classmethod
    def from_frames(cls, name, frames: Dict[int, bytes], first_h=FIRST_STEP_H, last_h=None):
        hours = sorted(h for h in frames if h >= first_h and (last_h is None or h <= last_h))
        if not hours:
            raise ValueError(f"{name}: no step at or after {first_h} h")
        us, vs, lats, lons = [], [], None, None
        for h in hours:
            la, lo, u, v, _valid, _run = decode_frame_uv(frames[h])
            if lats is not None and (la.shape != lats.shape or lo.shape != lons.shape):
                raise ValueError(f"{name}: step {h} h has another grid")
            lats, lons = la, lo
            us.append(u)
            vs.append(v)
        return cls(name, hours, lats, lons, np.stack(us), np.stack(vs), global_lon=None)

    @classmethod
    def from_native_npz(cls, name, path, first_h=FIRST_STEP_H, last_h=None):
        z = np.load(path)
        keep = [i for i, h in enumerate(z["steps_h"]) if h >= first_h and (last_h is None or h <= last_h)]
        return cls(name, z["steps_h"][keep], z["lat"], z["lon"], z["u"][keep], z["v"][keep], global_lon=False)

    def map_fields(self, fn, name):
        u, v = fn(self.u.copy(), self.v.copy())
        return ArmField(name, self.steps_h, self.lats, self.lons, u, v, self.global_lon)

    # ---- space -------------------------------------------------------------------------------------------------------
    def _frac(self, lat, lon):
        lat = np.asarray(lat, float)
        lon = np.asarray(lon, float)
        dla = self.lats[1] - self.lats[0]
        dlo = self.lons[1] - self.lons[0]
        if self.global_lon:
            lon = (lon - self.lons[0]) % 360.0 + self.lons[0]
        fi = (lat - self.lats[0]) / dla
        fj = (lon - self.lons[0]) / dlo
        return fi, fj

    def _corners(self, lat, lon):
        fi, fj = self._frac(lat, lon)
        fi, fj = np.where(np.isfinite(fi), fi, -1e9), np.where(np.isfinite(fj), fj, -1e9)     # NaN -> off the grid
        i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
        wi, wj = fi - i0, fj - j0
        nr, nc = len(self.lats), len(self.lons)
        inside = (i0 >= 0) & (i0 + 1 < nr) & (fi >= 0)
        if self.global_lon:
            j1 = (j0 + 1) % nc
            j0 = j0 % nc
        else:
            inside &= (j0 >= 0) & (j0 + 1 < nc)
            j1 = j0 + 1
        i0c, i1c = np.clip(i0, 0, nr - 1), np.clip(i0 + 1, 0, nr - 1)
        j0c, j1c = np.clip(j0, 0, nc - 1), np.clip(j1, 0, nc - 1)
        return inside, (i0c, i1c, j0c, j1c), (wi, wj)

    def sample_steps(self, lat, lon, strict=True):
        """(u, v) [step, point]: bilinear from the arm's own grid. strict: NaN unless all four corners are water (M1: an arm
        cell that is land or missing drops the row); otherwise weights renormalised over the wet corners (advection)."""
        lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
        inside, (i0, i1, j0, j1), (wi, wj) = self._corners(lat, lon)
        w = [((1 - wi) * (1 - wj), i0, j0), ((1 - wi) * wj, i0, j1), (wi * (1 - wj), i1, j0), (wi * wj, i1, j1)]
        out = []
        for arr in (self.u, self.v):
            tot = np.zeros((arr.shape[0], lat.size))
            wsum = np.zeros((arr.shape[0], lat.size))
            bad = np.zeros((arr.shape[0], lat.size), bool)
            for ww, ii, jj in w:
                val = arr[:, ii, jj]
                ok = np.isfinite(val)
                bad |= ~ok & (ww > 1e-12)
                tot += np.where(ok, val, 0.0) * ww
                wsum += np.where(ok, ww, 0.0)
            with np.errstate(invalid="ignore", divide="ignore"):
                res = tot / wsum if not strict else tot
            if strict:
                res = np.where(bad, np.nan, res)
            res = np.where((wsum > 1e-12) & inside, res, np.nan)
            out.append(res)
        return out[0], out[1]

    def is_land(self, lat, lon):
        """True where the nearest node of the arm's own grid has no water at the first step (the arm's land mask), or the
        point is off the grid. Vectorised; a scalar in gives a bool out."""
        scalar = np.ndim(lat) == 0
        fi, fj = self._frac(np.atleast_1d(lat), np.atleast_1d(lon))
        fi, fj = np.where(np.isfinite(fi), fi, -1e9), np.where(np.isfinite(fj), fj, -1e9)
        i, j = np.rint(fi).astype(int), np.rint(fj).astype(int)
        nr, nc = len(self.lats), len(self.lons)
        if self.global_lon:
            j %= nc
        off = ~((i >= 0) & (i < nr) & (j >= 0) & (j < nc))
        land = off | ~np.isfinite(self.u[0, np.clip(i, 0, nr - 1), np.clip(j, 0, nc - 1)])
        return bool(land[0]) if scalar else land


# ---- time ------------------------------------------------------------------------------------------------------------
def hourly_weights(steps_h: Sequence[float], hours: Iterable[float]):
    """W[hour, step]: linear interpolation of the steps at each hour; a row of NaN outside the steps' span."""
    steps = np.asarray(steps_h, float)
    hours = np.asarray(list(hours), float)
    W = np.zeros((hours.size, steps.size))
    for k, h in enumerate(hours):
        if h < steps[0] - 1e-9 or h > steps[-1] + 1e-9:
            W[k] = np.nan
            continue
        j = int(np.searchsorted(steps, h, side="right")) - 1
        j = min(max(j, 0), steps.size - 1)
        if j == steps.size - 1 or abs(h - steps[j]) < 1e-9:
            W[k, j] = 1.0
        else:
            a = (h - steps[j]) / (steps[j + 1] - steps[j])
            W[k, j], W[k, j + 1] = 1 - a, a
    return W


def window_hours(t):
    return np.arange(t - HALF_WINDOW_H, t + HALF_WINDOW_H + 1, dtype=float)


def window_weights(steps_h, t, mask=None, need=NEED_HOURS):
    """(weights over steps, hours used) for the centred 25 h mean at lead hour t over the hours where `mask` is True
    (default all) and the steps are defined; None when fewer than `need` hours remain."""
    hrs = window_hours(t)
    W = hourly_weights(steps_h, hrs)
    ok = np.isfinite(W).all(axis=1)
    if mask is not None:
        ok &= np.asarray(mask, bool)
    n = int(ok.sum())
    if n < need:
        return None, n
    return W[ok].sum(axis=0) / n, n


def persistence(arm: ArmField) -> ArmField:
    """PERSIST_<src>: the arm's earliest scored step held for every later step (section 1)."""
    u = np.repeat(arm.u[:1], arm.u.shape[0], axis=0)
    v = np.repeat(arm.v[:1], arm.v.shape[0], axis=0)
    return ArmField(f"PERSIST_{arm.name}", arm.steps_h, arm.lats, arm.lons, u, v, arm.global_lon)


def _vel_from_weights(arm, w, lat, lon):
    lat, lon = np.atleast_1d(np.asarray(lat, float)), np.atleast_1d(np.asarray(lon, float))
    if w is None:
        return np.full(lat.size, np.nan), np.full(lat.size, np.nan)
    used = w > 0
    us, vs = arm.sample_steps(lat, lon, strict=False)
    us, vs = us[used], vs[used]
    bad = ~(np.isfinite(us).all(0) & np.isfinite(vs).all(0))
    u, v = w[used] @ np.nan_to_num(us), w[used] @ np.nan_to_num(vs)
    return np.where(bad, np.nan, u), np.where(bad, np.nan, v)


def lowpassed_velocity_fn(arm: ArmField, need=1):
    """vel(lat[], lon[], t) -> (u[], v[]) m/s of the arm's 25 h low-passed field at lead hour t (float): filter weights at
    the two whole hours around t, linearly interpolated (section 4, M2: "recomputed at each hour by linear interpolation in
    time"), bilinear in space over the wet corners. Near the first step fewer than 20 hours of the field exist; `need` is the
    hours the edge may use (AMENDMENT QUESTION A3; 1 = the window is truncated to the defined hours, the same for every arm)."""
    cache = {}

    def weights(h):
        if h not in cache:
            cache[h] = window_weights(arm.steps_h, h, need=need)[0]
        return cache[h]

    def vel(lat, lon, t):
        h0 = math.floor(t)
        a = t - h0
        w0 = weights(h0)
        w1 = weights(h0 + 1) if a > 1e-9 else w0
        w = None if (w0 is None or w1 is None) else (1 - a) * w0 + a * w1
        return _vel_from_weights(arm, w, lat, lon)
    return vel


def unfiltered_velocity_fn(arm: ArmField):
    """The hourly-interpolated (unfiltered) field, for the reported raw separation."""
    def vel(lat, lon, t):
        W = hourly_weights(arm.steps_h, [t])[0]
        return _vel_from_weights(arm, W if np.isfinite(W).all() else None, lat, lon)
    return vel


def scaled(arm: ArmField, factor: float) -> ArmField:
    """Lagrangian plant: the velocity scaled by `factor` (section 7)."""
    return arm.map_fields(lambda u, v: (u * factor, v * factor), f"{arm.name}_x{factor:g}")


def first_step_index(arm: Optional[ArmField]):
    return None if arm is None else int(np.argmin(arm.steps_h))
