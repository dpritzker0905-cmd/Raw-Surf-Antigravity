"""ens_wind_core.py - the numeric core of the long-range wind extension (ICON 180-336 h, EURO 240-336 h).

Owner 2026-11-15 15:19 EST "Looping is unacceptable. We need real science."; 16:14 EST "Yes to all, hard hand-off".
Pre-registered gate: docs/weather-program/log/2026-11-15-wind-long-range.md (21:45Z). PURE numpy, no I/O, so the
operational extension (scripts/ens_wind_extension_ci.py) and the offline hindcast (scripts/wind_lr_hindcast.py) run
the SAME arithmetic.

Source: ECMWF open-data IFS ENS, stream `enfo`, the member files (`ef`: control `cf` + 50 perturbed `pf`), 0.25 deg.
The open-data ensemble-MEAN product has no 10 m wind past 240 h (senior lead 21:33Z, measured), so the mean is ours:
  - vector (u_bar, v_bar) = member mean; direction from it;
  - speed = MEAN OF MEMBER SPEEDS (a vector mean shrinks speed where members disagree in direction);
  - served (u, v) = (u_bar, v_bar) rescaled to that speed; if |vector mean| ~ 0, the control member's direction;
  - gust = member MEDIAN of 10fg ("max gust in the 6 h to this time" past 144 h); p90 = the risk cue;
  - spread = member standard deviation of speed (a confidence cue; not served by this gate).
Time: steps past 144 h are 6-hourly. A 3-hourly step is linear in (u, v) and in speed between the SAME run's two
neighbouring steps (cross-hour inside one run; never cross-model).
"""
import json
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

BASIS_TYPE = "ens_mean_extension"
LABEL = "Days 8–14: ECMWF ensemble mean (estimate)"
MEMBERS_EXPECTED = 51            # cf + 50 pf
_CALM = 1e-6


# ---------------------------------------------------------------------------------------------- the member reduction
def reduce_members(u: np.ndarray, v: np.ndarray, g: Optional[np.ndarray] = None) -> Dict[str, np.ndarray]:
    """u, v (and gust g) shaped [members, ...] in m/s, member 0 = the control. Returns u, v, speed, gust, spread."""
    u = np.asarray(u, dtype=np.float64)
    v = np.asarray(v, dtype=np.float64)
    if u.shape != v.shape or u.ndim < 1 or u.shape[0] < 1:
        raise ValueError(f"members mismatch: u {u.shape} v {v.shape}")
    spd = np.hypot(u, v)
    ub, vb = np.nanmean(u, axis=0), np.nanmean(v, axis=0)
    speed = np.nanmean(spd, axis=0)
    mag = np.hypot(ub, vb)
    calm = mag <= _CALM
    # direction: the member-mean vector; where it vanishes, the control member's direction
    du = np.where(calm, u[0], ub)
    dv = np.where(calm, v[0], vb)
    dmag = np.hypot(du, dv)
    scale = np.where(dmag > _CALM, speed / np.where(dmag > _CALM, dmag, 1.0), 0.0)
    out = {"u": du * scale, "v": dv * scale, "speed": speed, "spread": np.nanstd(spd, axis=0)}
    if g is not None:
        g = np.asarray(g, dtype=np.float64)
        if g.shape != u.shape:
            raise ValueError(f"gust members {g.shape} != wind {u.shape}")
        out["gust"] = np.nanmedian(g, axis=0)
        out["gust_p90"] = np.nanpercentile(g, 90, axis=0)     # the risk cue (senior lead 21:33Z)
    return out


def control_only(u: np.ndarray, v: np.ndarray, g: Optional[np.ndarray] = None) -> Dict[str, np.ndarray]:
    """The `ens_cf` gate arm: member 0 alone, in the same output shape."""
    u0, v0 = np.asarray(u, dtype=np.float64)[0], np.asarray(v, dtype=np.float64)[0]
    out = {"u": u0, "v": v0, "speed": np.hypot(u0, v0), "spread": np.zeros_like(u0)}
    if g is not None:
        out["gust"] = np.asarray(g, dtype=np.float64)[0]
        out["gust_p90"] = out["gust"]
    return out


# ---------------------------------------------------------------------------------------------- time and de-bias
def interp_step(f0: Dict[str, np.ndarray], f1: Dict[str, np.ndarray], s0: float, s1: float, s: float) -> Dict[str, np.ndarray]:
    """The field at step s from the same run's steps s0 <= s <= s1: (u, v) linear, then rescaled to the linearly
    interpolated speed (keeps the speed from dipping where the direction turns); gust and spread linear."""
    if not (s0 <= s <= s1) or s1 <= s0:
        if s == s0:
            return {k: np.array(val, copy=True) for k, val in f0.items()}
        raise ValueError(f"step {s} outside [{s0}, {s1}]")
    w = (s - s0) / (s1 - s0)
    out = {}
    for k in f0:
        if k in f1:
            out[k] = (1.0 - w) * np.asarray(f0[k]) + w * np.asarray(f1[k])
    if {"u", "v", "speed"} <= set(out):
        mag = np.hypot(out["u"], out["v"])
        scale = np.where(mag > _CALM, out["speed"] / np.where(mag > _CALM, mag, 1.0), 0.0)
        out["u"], out["v"] = out["u"] * scale, out["v"] * scale
    return out


def apply_speed_factor(field: Dict[str, np.ndarray], k: float) -> Dict[str, np.ndarray]:
    """Multiplicative speed de-bias on (u, v) and speed; direction unchanged. Gust is NOT scaled (it is scored and
    calibrated on its own)."""
    out = dict(field)
    for key in ("u", "v", "speed"):
        if key in out:
            out[key] = np.asarray(out[key]) * float(k)
    return out


def fit_speed_factor(obs: Sequence[float], fc: Sequence[float]) -> float:
    """Least squares through the origin, k = sum(obs*f) / sum(f*f), over finite pairs. 1.0 when nothing to fit."""
    o = np.asarray(obs, dtype=np.float64)
    f = np.asarray(fc, dtype=np.float64)
    ok = np.isfinite(o) & np.isfinite(f)
    den = float(np.sum(f[ok] * f[ok]))
    return float(np.sum(o[ok] * f[ok]) / den) if den > 0 else 1.0


# ---------------------------------------------------------------------------------------------- sampling
def bilinear(arr: np.ndarray, meta: dict, lats: Iterable[float], lons: Iterable[float]) -> np.ndarray:
    """Bilinear values at points from a regular grid [nj, ni] (rows south to north, eval_grib2's convention).
    Longitudes wrap; a NaN corner makes the point NaN (the caller decides what a masked corner means)."""
    lats = np.atleast_1d(np.asarray(list(lats) if not isinstance(lats, np.ndarray) else lats, dtype=np.float64))
    lons = np.atleast_1d(np.asarray(list(lons) if not isinstance(lons, np.ndarray) else lons, dtype=np.float64))
    ni, nj = int(meta["ni"]), int(meta["nj"])
    fy = (lats - meta["lat_south"]) / meta["dlat"]
    fx = ((lons - meta["lon_west"]) % 360.0) / meta["dlon"]
    i0 = np.clip(np.floor(fy).astype(int), 0, nj - 2)
    j0 = np.floor(fx).astype(int) % ni
    j1 = (j0 + 1) % ni
    ty = np.clip(fy - i0, 0.0, 1.0)
    tx = fx - np.floor(fx)
    a = np.asarray(arr, dtype=np.float64)
    return ((1 - ty) * (1 - tx) * a[i0, j0] + (1 - ty) * tx * a[i0, j1]
            + ty * (1 - tx) * a[i0 + 1, j0] + ty * tx * a[i0 + 1, j1])


def to_speed_dir(u, v) -> Tuple[np.ndarray, np.ndarray]:
    """Speed (m/s) and meteorological direction (degrees the wind blows FROM)."""
    u = np.asarray(u, dtype=np.float64)
    v = np.asarray(v, dtype=np.float64)
    return np.hypot(u, v), (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0


# ---------------------------------------------------------------------------------------------- ECMWF index
def parse_ecmwf_index(text: str) -> List[dict]:
    """ECMWF open-data `.index`: one JSON object per line with `_offset` and `_length`."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def select_members(entries: Sequence[dict], params: Sequence[str], step: int) -> Dict[Tuple[str, int], Tuple[int, int]]:
    """{(param, member): (offset, length)} for surface fields at `step`; control = member 0."""
    out = {}
    for e in entries:
        if e.get("param") not in params or e.get("levtype", "sfc") != "sfc":
            continue
        if int(e.get("step", -1)) != int(step):
            continue
        typ = e.get("type")
        if typ == "cf":
            member = 0
        elif typ == "pf":
            member = int(e.get("number"))
        else:
            continue
        out[(e["param"], member)] = (int(e["_offset"]), int(e["_length"]))
    return out


def coalesce(ranges: Sequence[Tuple[int, int]], max_gap: int = 0) -> List[Tuple[int, int, List[int]]]:
    """Merge (offset, length) ranges into spans [(start, end_exclusive, [indices into ranges])] so one HTTP Range
    request reads neighbouring messages together."""
    order = sorted(range(len(ranges)), key=lambda i: ranges[i][0])
    spans: List[Tuple[int, int, List[int]]] = []
    for i in order:
        off, ln = ranges[i]
        if spans and off - spans[-1][1] <= max_gap:
            s, e, idx = spans[-1]
            spans[-1] = (s, max(e, off + ln), idx + [i])
        else:
            spans.append((off, off + ln, [i]))
    return spans


def extension_steps(first_valid_h: float, last_valid_h: float, step_h: int = 3) -> List[int]:
    """The served 3-hourly lattice of ENS leads in (first_valid_h, last_valid_h]."""
    start = int(np.floor(first_valid_h / step_h) + 1) * step_h
    return list(range(start, int(last_valid_h) + 1, step_h))


def native_bracket(lead_h: int, native_steps: Sequence[int]) -> Tuple[int, int]:
    """The two archived ENS steps that bracket a lead (equal when the lead is itself archived)."""
    s = sorted(native_steps)
    if lead_h in s:
        return lead_h, lead_h
    lo = max([x for x in s if x < lead_h], default=None)
    hi = min([x for x in s if x > lead_h], default=None)
    if lo is None or hi is None:
        raise ValueError(f"lead {lead_h} outside archived steps {s[0]}..{s[-1]}")
    return lo, hi


def ens_archived_steps(max_h: int = 360) -> List[int]:
    """IFS ENS open-data step lattice: 0-144 h by 3, 150-360 h by 6."""
    return list(range(0, 145, 3)) + list(range(150, max_h + 1, 6))
