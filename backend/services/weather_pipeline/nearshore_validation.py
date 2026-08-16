"""nearshore_validation.py — the outcome loop for the SERVED nearshore quantity (WS-CAN-0076).

THE GAP THIS CLOSES (Master Codex MC-03's deep half, reproduced live 2026-08-15): 60,000 archived
predictions of the served nearshore height and ZERO matched observations. Offshore buoy skill
(buoy_calibration.py) validates the model's INPUT; surfer reports have not accrued; nothing has
ever scored the TRANSFORM's output against an instrument. CDIP nearshore buoys sit INSIDE the
transform chain (≤30 m, median ~20 m — after shelf friction and most shoaling, before breaking),
and the committed pair table (data/nearshore_validation_pairs.json, DISCOVERED identities,
provenance-stamped) links 20 of them to 48 catalogue spot pairings within 10 km.

THE QUANTITY, stated before any code: the transform evaluated AT THE STATION'S DEPTH — an
Hs-statistic (no H1/10 conversion: buoys measure Hs) with no breaking cap (a 20 m buoy is not in
the break). This carries ~all of the served height's error budget (the cap binds 0.145% of served
spot-hours). NOT a climatological ratio study (that was 2026-07-29's Kr work): forecast-time,
recurring, banked.

ONE COMPOSITION, structurally: `model_hs_at_station` composes THE SERVING PATH'S OWN COMPONENT
FUNCTIONS — `shelf_dissipation`, `shoaling_coefficient`, `_height_exposure_factor`, and the same
`SURF_REFRACTION_KR` read — and the parity pin in tests/test_nearshore_validation.py drives
`estimate_surf` into the composable configuration and demands EXACT equality. Divergent
components cannot ship silently; that is the pin's whole job (the sim's +19.1% lesson).

REFUSAL FIRST (the WS-CAN-0073 pattern, from birth): a stale pair table refuses; an empty match
set publishes available:false with a reason AND its counters. Per-station segmentation from day
one; per-direction sectors follow once samples accrue (the Kr study measured 1.75x directional
swings at one site — a pooled MAE would hide exactly what this lane exists to see).
"""
import json
import math
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

PAIRS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "data", "nearshore_validation_pairs.json")
PAIRS_MAX_AGE_DAYS = 90.0     # regenerate with build_nearshore_pairs.py; staleness REFUSES
THREDDS_RT = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime"
UA = {"User-Agent": "raw-surf-nearshore-validation"}


class Refusal(RuntimeError):
    """The instrument cannot answer and says so — never a silent empty."""


def load_pairs(path: str = None, max_age_days: float = None) -> dict:
    p = path or PAIRS_PATH
    try:
        with open(p, encoding="utf-8") as f:
            obj = json.load(f)
    except (OSError, ValueError) as e:
        raise Refusal(f"pair table unreadable at {p}: {e}") from e
    age_cap = PAIRS_MAX_AGE_DAYS if max_age_days is None else max_age_days
    gen = obj.get("generated_at")
    try:
        gen_dt = datetime.fromisoformat(str(gen).replace("Z", "+00:00"))
    except (TypeError, ValueError) as e:
        raise Refusal(f"pair table has no parseable generated_at ({gen!r})") from e
    age_d = (datetime.now(timezone.utc) - gen_dt).total_seconds() / 86400.0
    if age_d > age_cap:
        raise Refusal(f"pair table is stale: generated {age_d:.0f} days ago (cap {age_cap:.0f}) "
                      f"— rerun backend/scripts/build_nearshore_pairs.py")
    return obj


def model_hs_at_station(hs_m: float, tp_s: float, swell_from_deg, shore_normal_deg,
                        station_depth_m: float, shelf_depth_m: float,
                        shelf_width_km: float) -> float:
    """The served composition's own components, evaluated at the INSTRUMENT:
    friction over the SHELF (its correct scale) x linear shoaling to the STATION depth (where the
    buoy floats; linear, not Komar — a 20 m buoy is not at the break point) x the SAME directional
    exposure x the SAME measured Kr. Hs-statistic in, Hs-statistic out: no cap, no H1/10.
    Pinned EXACTLY equal to `estimate_surf` in the composable configuration by the parity test."""
    from services.weather_pipeline.surf_transform import (
        REFRACTION_KR, _height_exposure_factor, shelf_dissipation, shoaling_coefficient)
    h = float(hs_m)
    h *= shelf_dissipation(tp_s, shelf_depth_m, shelf_width_km)
    h *= shoaling_coefficient(tp_s, station_depth_m)
    h *= _height_exposure_factor(swell_from_deg, shore_normal_deg)
    try:
        kr = float(os.environ.get("SURF_REFRACTION_KR", REFRACTION_KR))
    except (TypeError, ValueError):
        kr = REFRACTION_KR
    if kr > 0:
        h *= kr
    return float(h)


def qc_filter(rows: list) -> list:
    """CDIP's own 'good' flag only (waveFlagPrimary == 1) — everything else is discarded, the
    2026-07-29 study's discipline."""
    return [r for r in rows or [] if r.get("flag") == 1 and r.get("hs_m") is not None]


def _parse_dt(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def match(preds: list, obs: list, tolerance_s: float = 1800.0) -> list:
    """Pair each prediction with the nearest QC-good observation within tolerance. PURE."""
    out = []
    obs_t = [(o, _parse_dt(o.get("time"))) for o in qc_filter(obs)]
    obs_t = [(o, t) for o, t in obs_t if t is not None]
    for p in preds or []:
        pt = _parse_dt(p.get("valid_time"))
        if pt is None or p.get("model_hs_m") is None:
            continue
        best, best_dt = None, None
        for o, t in obs_t:
            d = abs((t - pt).total_seconds())
            if d <= tolerance_s and (best_dt is None or d < best_dt):
                best, best_dt = o, d
        if best is not None:
            out.append({**{k: v for k, v in p.items()},
                        "obs_hs_m": best["hs_m"], "obs_time": best["time"]})
    return out


def build_report(matched: list, n_stations: int, n_obs: int, n_preds: int,
                 min_matched: int = None) -> dict:
    """The banked report. REFUSES (available:false + reason + counters) below the match floor —
    the counters stay readable so the refusal explains itself."""
    if min_matched is None:
        try:
            min_matched = max(1, int(os.environ.get("NEARSHORE_VAL_MIN_MATCHED", "1")))
        except (TypeError, ValueError):
            min_matched = 1
    base = {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
            "quantity": "transform_hs_at_station_depth_vs_cdip_hs (Hs statistic; no cap, no H1/10)",
            "n_stations": n_stations, "n_obs": n_obs, "n_preds": n_preds,
            "n_matched": len(matched or [])}
    if not matched or len(matched) < min_matched:
        return {**base, "available": False,
                "reason": (f"no usable nearshore evidence: n_matched={len(matched or [])} "
                           f"(min {min_matched}), n_obs={n_obs}, n_preds={n_preds}"),
                "stations": {}}
    stations = {}
    for m in matched:
        s = stations.setdefault(m.get("station", "?"),
                                {"n": 0, "_ae": 0.0, "_err": 0.0})
        err = float(m["model_hs_m"]) - float(m["obs_hs_m"])
        s["n"] += 1
        s["_ae"] += abs(err)
        s["_err"] += err
    for s in stations.values():
        s["mae_m"] = round(s.pop("_ae") / s["n"], 4)
        s["bias_m"] = round(s.pop("_err") / s["n"], 4)   # >0 = model above the instrument
    return {**base, "available": True, "stations": stations}


def fetch_station_hs(station: str, hours: float = 26.0, timeout: float = 90.0) -> list:
    """Recent Hs from a CDIP realtime deployment via the OPeNDAP ascii interface (no netCDF dep,
    the discovery script's own transport). Returns [{time, hs_m, flag}]. Failures raise — the
    caller's per-station isolation decides what one dead buoy costs (one buoy, never the run)."""
    url = (f"{THREDDS_RT}/{station}_rt.nc.ascii"
           f"?waveTime,waveHs,waveFlagPrimary")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        txt = r.read().decode("utf-8", "replace")

    def series(name):
        m = re.search(rf"^{name}(?:\.{name})?\[\d+\]\n([^\n]+)", txt, re.M)
        if not m:
            m = re.search(rf"{name}\[\d+\]\s*\n([^\n]+)", txt)
        if not m:
            return []
        vals = []
        for v in m.group(1).split(","):
            v = v.strip()
            if not v:
                continue
            try:
                vals.append(float(v))
            except ValueError:
                continue
        return vals

    times, hs, flags = series("waveTime"), series("waveHs"), series("waveFlagPrimary")
    n = min(len(times), len(hs), len(flags))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    out = []
    for i in range(n):
        t = datetime.fromtimestamp(times[i], tz=timezone.utc)
        if t >= cutoff:
            out.append({"time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "hs_m": hs[i], "flag": int(flags[i])})
    return out
