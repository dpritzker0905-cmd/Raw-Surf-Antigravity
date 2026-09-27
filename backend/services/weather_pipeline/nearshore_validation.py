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


def transform_factors(tp_s: float, swell_from_deg, shore_normal_deg, station_depth_m: float,
                      shelf_depth_m: float, shelf_width_km: float) -> dict:
    """The components `model_hs_at_station` multiplies, one by one — DIAGNOSTICS ONLY (2026-09-27).

    The first graded run read LOW at every live station (bias -0.06 to -0.55 m), so the question is
    which factor. The served number stays `model_hs_at_station` (pinned to `estimate_surf`); this
    reports the same components separately so a report can attribute the bias instead of guessing."""
    from services.weather_pipeline.surf_transform import (
        REFRACTION_KR, _height_exposure_factor, shelf_dissipation, shoaling_coefficient)
    try:
        kr = float(os.environ.get("SURF_REFRACTION_KR", REFRACTION_KR))
    except (TypeError, ValueError):
        kr = REFRACTION_KR
    f = {"friction": float(shelf_dissipation(tp_s, shelf_depth_m, shelf_width_km)),
         "shoaling": float(shoaling_coefficient(tp_s, station_depth_m)),
         "exposure": float(_height_exposure_factor(swell_from_deg, shore_normal_deg)),
         "kr": float(kr) if kr > 0 else 1.0}
    f["total"] = f["friction"] * f["shoaling"] * f["exposure"] * f["kr"]
    return {k: round(v, 4) for k, v in f.items()}


# ── THE SPECTRAL ARM (roadmap stage 3, 2026-09-27) ──────────────────────────────────────────────
# SURF_PARTITIONS is built and off: with it on, the served height transforms each swell train on its
# own period and bearing (`estimate_surf_partitioned`) instead of shoaling one blended sea. Offshore
# buoys cannot judge that flip (it changes nothing offshore); these instruments can. The arm below is
# what the station would read IF the flag were on, graded beside the bulk arm on the same hours.

def train_from_point(kind: str, payload: dict):
    """One /point partition answer -> a train, under `point_resolution._resolve_partitions`'s rules:
    a ratio-derived train is the total re-weighted (skipped, never fed back as spectrum), a missing,
    zero or NaN height/period is skipped, and a NaN bearing is nulled. PURE; parity-pinned."""
    basis = (payload or {}).get("estimate_basis")
    if isinstance(basis, dict) and basis.get("method") == "wave_component_ratio_estimation":
        return None
    p = (payload or {}).get("point") or {}
    h, tp, d = p.get("speed"), p.get("period"), p.get("direction")
    if not h or not tp or h != h or tp != tp or h <= 0 or tp <= 0:
        return None
    return {"h": float(h), "tp": float(tp), "dir": None if d is None or d != d else d, "kind": kind}


def station_trains(answers: list, total_h, total_tp=None):
    """[(kind, payload)] -> the reconciled trains the served lane would use, or None when they do not
    represent the sea (the served lane then falls back to the total field, and so does this arm)."""
    from services.weather_pipeline.surf_transform import partitions_represent, reconcile_partitions
    parts = [t for t in (train_from_point(k, a) for k, a in answers or []) if t]
    if not parts or not partitions_represent(parts, total_h, total_tp):
        return None
    return reconcile_partitions(parts, total_h)


def model_hs_at_station_trains(trains, shore_normal_deg, station_depth_m: float,
                               shelf_depth_m: float, shelf_width_km: float):
    """Each train through `model_hs_at_station` on its own period and bearing, recombined in
    quadrature: the station-depth mirror of `estimate_surf_partitioned` (no cap, as for the bulk arm).
    None when no train transforms. Parity-pinned to the served function."""
    energy, used = 0.0, 0
    for t in trains or []:
        h, tp = t.get("h"), t.get("tp")
        if h is None or tp is None or h <= 0 or tp <= 0:
            continue
        hp = model_hs_at_station(h, tp, t.get("dir"), shore_normal_deg, station_depth_m,
                                 shelf_depth_m, shelf_width_km)
        if hp > 0:
            energy += hp * hp
            used += 1
    return math.sqrt(energy) if used else None


def _arm_stats(rows: list, key: str) -> dict:
    errs = [float(r[key]) - float(r["obs_hs_m"]) for r in rows]
    ratios = [float(r["obs_hs_m"]) / float(r[key]) for r in rows if float(r[key]) > 0]
    out = {"mae_m": round(sum(abs(e) for e in errs) / len(errs), 4),
           "bias_m": round(sum(errs) / len(errs), 4)}
    if ratios:
        out["obs_over_model_median"] = _quantiles(ratios)["median"]
    return out


def trains_ab(matched: list):
    """Bulk vs spectral on the SAME instrument hours. `as_flipped` grades what the flag would serve
    (spectral where the trains represent the sea, bulk elsewhere); `trains_only` isolates the hours
    where the trains were actually used, which is where the flip can move anything. None when no row
    carries the spectral arm (the runner's --trains was off)."""
    rows = [m for m in matched or [] if m.get("model_hs_trains_m") is not None
            and m.get("model_hs_m") is not None]
    if not rows:
        return None
    out = {"n": len(rows), "bulk": _arm_stats(rows, "model_hs_m"),
           "as_flipped": _arm_stats(rows, "model_hs_trains_m")}
    used = [m for m in rows if m.get("trains_used")]
    out["trains_only"] = {"n": len(used)}
    if used:
        better = sum(abs(float(m["model_hs_trains_m"]) - float(m["obs_hs_m"]))
                     < abs(float(m["model_hs_m"]) - float(m["obs_hs_m"])) for m in used)
        out["trains_only"].update({"bulk": _arm_stats(used, "model_hs_m"),
                                   "trains": _arm_stats(used, "model_hs_trains_m"),
                                   "trains_closer_share": round(better / len(used), 4)})
    by_station = {}
    for m in used:
        by_station.setdefault(m.get("station", "?"), []).append(m)
    out["trains_only"]["by_station"] = {
        s: {"n": len(v), "bulk_mae_m": _arm_stats(v, "model_hs_m")["mae_m"],
            "trains_mae_m": _arm_stats(v, "model_hs_trains_m")["mae_m"]}
        for s, v in sorted(by_station.items())}
    return out


def backfill_valid_times(now: datetime, backfill_hours: float = 0.0, step_hours: float = 3.0) -> list:
    """Top-of-hour valid times to grade: the current hour first, then back over `backfill_hours` at
    `step_hours`. One hour per run graded ~7 station-hours; the recent past is still resident (2-day
    product retention) and CDIP serves the same window, so a run can grade dozens. PURE."""
    base = now.replace(minute=0, second=0, microsecond=0)
    step = max(1.0, float(step_hours))
    n = int(max(0.0, float(backfill_hours)) // step)
    return [(base - timedelta(hours=k * step)).strftime("%Y-%m-%dT%H:00") for k in range(n + 1)]


def _quantiles(values: list) -> dict:
    v = sorted(values)
    q = lambda p: v[min(len(v) - 1, int(p * (len(v) - 1) + 0.5))]  # noqa: E731
    return {"n": len(v), "median": round(q(0.5), 4), "p10": round(q(0.1), 4), "p90": round(q(0.9), 4)}


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
    # WHICH WAY AND BY HOW MUCH (2026-09-27): observed / modelled at the instrument — the multiplier
    # the transform would need — overall and per station, and the median of each transform factor
    # when the rows carry them. Additive keys; the per-station mae/bias above are unchanged.
    extra = {}
    ratios = [float(m["obs_hs_m"]) / float(m["model_hs_m"]) for m in matched
              if float(m.get("model_hs_m") or 0) > 0]
    if ratios:
        extra["obs_over_model"] = _quantiles(ratios)
        for name, st in stations.items():
            r = [float(m["obs_hs_m"]) / float(m["model_hs_m"]) for m in matched
                 if m.get("station", "?") == name and float(m.get("model_hs_m") or 0) > 0]
            if r:
                st["obs_over_model_median"] = _quantiles(r)["median"]
    fac = [m["factors"] for m in matched if isinstance(m.get("factors"), dict)]
    if fac:
        extra["factors_median"] = {k: _quantiles([f[k] for f in fac if k in f])["median"]
                                   for k in ("friction", "shoaling", "exposure", "kr", "total")}
    ab = trains_ab(matched)
    if ab:
        extra["trains_ab"] = ab
    return {**base, "available": True, "stations": stations, **extra}


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
