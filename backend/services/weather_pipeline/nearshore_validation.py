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

from services.weather_pipeline.consensus_product import CONSENSUS_MEMBERS, equal_consensus  # noqa: F401 (re-export)

PAIRS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "data", "nearshore_validation_pairs.json")
PAIRS_MAX_AGE_DAYS = 90.0     # regenerate with build_nearshore_pairs.py; staleness REFUSES
THREDDS_RT = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime"
UA = {"User-Agent": "raw-surf-nearshore-validation"}
# THE LEGACY-FRICTION ARM (2026-09-28): cross-shelf friction went off by default (surf_transform.SHELF_CF_SCALE_DEFAULT,
# #146), which made the shelf arm below silent by design (served == no friction). This keeps the evidence running
# BOTH ways: on rows where the old scale would have applied, the chain at 0.25 rides beside the served one, so a
# shelf where friction-off reads HIGH (the Gulf was ungraded when it flipped) shows up here, not in a complaint.
LEGACY_SHELF_CF_SCALE = 0.25


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
                        shelf_width_km: float, cf_scale: Optional[float] = None) -> float:
    """The served composition's own components, evaluated at the INSTRUMENT:
    friction over the SHELF (its correct scale) x linear shoaling to the STATION depth (where the
    buoy floats; linear, not Komar — a 20 m buoy is not at the break point) x the SAME directional
    exposure x the SAME measured Kr. Hs-statistic in, Hs-statistic out: no cap, no H1/10.
    Pinned EXACTLY equal to `estimate_surf` in the composable configuration by the parity test."""
    from services.weather_pipeline.surf_transform import (
        REFRACTION_KR, _height_exposure_factor, shelf_dissipation, shoaling_coefficient)
    h = float(hs_m)
    h *= shelf_dissipation(tp_s, shelf_depth_m, shelf_width_km, cf_scale)   # None = the served scale
    h *= shoaling_coefficient(tp_s, station_depth_m)
    h *= _height_exposure_factor(swell_from_deg, shore_normal_deg)
    try:
        kr = float(os.environ.get("SURF_REFRACTION_KR", REFRACTION_KR))
    except (TypeError, ValueError):
        kr = REFRACTION_KR
    if kr > 0:
        h *= kr
    return float(h)


def model_hs_from_nearshore_input(hs_m: float, tp_s: float, input_depth_m, station_depth_m: float):
    """The station Hs if the served value is ALREADY a nearshore value at `input_depth_m` (2026-09-28): linear
    shoaling from the input's depth to the station's, and nothing else — no cross-shelf friction, no exposure,
    no Kr, because the wave model has already carried the sea across the shelf (the entry #128 built for MOP,
    `mop_nearshore.estimate_surf_from_nearshore`, at the instrument). None without a usable input depth. PURE."""
    from services.weather_pipeline.surf_transform import shoaling_coefficient
    if hs_m is None or tp_s is None or input_depth_m is None or float(input_depth_m) <= 0:
        return None
    ks_in = shoaling_coefficient(tp_s, float(input_depth_m))
    if not ks_in or ks_in <= 0:
        return None
    return float(hs_m) * shoaling_coefficient(tp_s, station_depth_m) / ks_in


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
    from services.weather_pipeline.surf_partitions import partitions_represent, reconcile_partitions
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


# ── THE MOP ARM (roadmap stage 4, 2026-09-27) ────────────────────────────────────────────────────
# Stage 4 replaces the parametric transform with a real nearshore model where one exists. For California
# that is CDIP's MOP: a spectral refraction model, and CDIP publishes its forecast AT ITS OWN BUOYS
# (MOP_validation/BPnnn_forecast.nc). The forecast is driven by WaveWatch III, the same model our GFS lane
# serves, so graded beside the bulk arm on the same instrument hours it isolates the transform: MOP's
# spectral refraction against our parametric chain. It decides whether stage 4 is worth building.
MOP_VALIDATION = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_validation"
MOP_EPOCH = 1648771200      # 2022-04-01T00Z: index 0 of every MOP_validation series (hourly, contiguous)


def mop_station_id(station: str):
    """'153p1' -> 'BP153' (MOP_validation names sites by the CDIP station number). None otherwise."""
    m = re.fullmatch(r"(\d{3})p\d", station or "")
    return f"BP{m.group(1)}" if m else None


def _ascii_series(txt: str, name: str) -> list:
    """One variable's values from an OPeNDAP .ascii response, in order. PURE."""
    m = re.search(rf"^{name}(?:\.{name})?\[\d+\]\n([^\n]+)", txt, re.M) or re.search(rf"{name}\[\d+\]\s*\n([^\n]+)", txt)
    out = []
    for v in (m.group(1).split(",") if m else []):
        try:
            out.append(float(v.strip()))
        except ValueError:
            continue
    return out


def parse_mop_ascii(txt: str) -> dict:
    """{epoch_s: hs_m} for QC-good MOP hours (waveFlagPrimary == 1; absent flags pass). PURE."""
    times, hs, flags = _ascii_series(txt, "waveTime"), _ascii_series(txt, "waveHs"), _ascii_series(txt, "waveFlagPrimary")
    out = {}
    for i in range(min(len(times), len(hs))):
        if flags and i < len(flags) and int(flags[i]) != 1:
            continue
        if hs[i] == hs[i] and hs[i] >= 0:
            out[int(times[i])] = hs[i]
    return out


def fetch_mop_hs(station: str, valid_times: list, product: str = "forecast", timeout: float = 90.0) -> dict:
    """MOP Hs at `station` for each ISO valid time ('YYYY-MM-DDTHH:00:00Z'), from the index slice that
    covers them. Keys are only the hours the server's own waveTime confirms, so an axis that ever stops
    being contiguous yields fewer matches, never a shifted one. Raises on transport errors (the caller
    isolates per station; a 404 means MOP has no site at this buoy)."""
    bp = mop_station_id(station)
    stamps = sorted({int(_parse_dt(t).timestamp()) for t in valid_times if _parse_dt(t)})
    if not bp or not stamps:
        return {}
    lo, hi = (max(0, (stamps[0] - MOP_EPOCH) // 3600), (stamps[-1] - MOP_EPOCH) // 3600)
    rng = f"[{lo}:1:{hi}]"
    url = (f"{MOP_VALIDATION}/{bp}_{product}.nc.ascii"
           f"?waveTime{rng},waveHs{rng},waveFlagPrimary{rng}")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        by_epoch = parse_mop_ascii(r.read().decode("utf-8", "replace"))
    fmt = lambda e: datetime.fromtimestamp(e, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    return {fmt(e): by_epoch[e] for e in stamps if e in by_epoch}


def arm_ab(matched: list, key: str):
    """Any second forecast graded beside the served (bulk) number on the SAME instrument hours: MAE,
    bias and observed/modelled for both, the share of hours the arm was strictly closer, per station.
    Counts spot-hours AND station-hours (an arm read at the buoy repeats across a station's spots)."""
    rows = [m for m in matched or [] if m.get(key) is not None and m.get("model_hs_m") is not None]
    if not rows:
        return None
    closer = sum(abs(float(m[key]) - float(m["obs_hs_m"])) < abs(float(m["model_hs_m"]) - float(m["obs_hs_m"]))
                 for m in rows)
    by_station = {}
    for m in rows:
        by_station.setdefault(m.get("station", "?"), []).append(m)
    return {"n": len(rows), "n_station_hours": len({(m.get("station"), m.get("obs_time")) for m in rows}),
            "bulk": _arm_stats(rows, "model_hs_m"), "arm": _arm_stats(rows, key),
            "arm_closer_share": round(closer / len(rows), 4),
            "by_station": {s: {"n": len(v), "bulk_mae_m": _arm_stats(v, "model_hs_m")["mae_m"],
                               "arm_mae_m": _arm_stats(v, key)["mae_m"],
                               "arm_bias_m": _arm_stats(v, key)["bias_m"]}
                           for s, v in sorted(by_station.items())}}


# ── THE CONSENSUS ARM (roadmap stage 5, 2026-09-29) ──────────────────────────────────────────────────────
# The skill ledger grades the three-model consensus at DEEP buoys (the equal mean was best-calibrated on big
# swells: bias -0.10 / -0.03 / -0.02 m at 24 / 48 / 72 h). What the app shows is the NEARSHORE height after the
# transform, and GFS-Wave's regional bias differs by coast (x1.10-1.27 on Florida's east coast, x0.85-0.89 in
# SoCal, x0.54-0.85 in the Gulf), so a consensus INPUT has to be graded where the transform lands, too.
# The equal mean (`equal_consensus`) and CONSENSUS_MEMBERS live in consensus_product since 2026-09-29, so this arm
# grades the SAME function the ingest builder serves; imported at the top and re-exported for the runner and tests.
# The equal mean WITHOUT ICON (2026-09-29): #155's paired nearshore hours put ICON at 0.203 m MAE (+0.12 m high)
# against GFS 0.156, EURO 0.102 and the three-model mean 0.117, so the pair is the next candidate to grade.
PAIR_MEMBERS = ("GFS", "EURO")


def shadow_ab(matched: list):
    """THE BUILT SHADOW ARM (D-009): the CONSENSUS product's own /point answer through the transform, graded like any
    arm, plus the CONSTRUCTION check: at the offshore point, how far the built product is from the consensus this
    judge computes from the members' answers (`built_vs_computed`, median and p90 |diff| on rows with both). The
    shadow interpolates from grid nodes and the computed mean averages point answers, so a small gap is
    interpolation and a large one a broken build. PURE."""
    arm = arm_ab(matched, "model_hs_shadow_m")
    if not arm:
        return None
    gaps = sorted(abs(float(m["shadow_offshore_hs_m"]) - float(m["consensus_offshore_hs_m"])) for m in matched
                  if m.get("shadow_offshore_hs_m") is not None and m.get("consensus_offshore_hs_m") is not None)
    arm["built_vs_computed"] = {"n": len(gaps),
                                "median_m": round(gaps[len(gaps) // 2], 4) if gaps else None,
                                "p90_m": round(gaps[min(len(gaps) - 1, 9 * len(gaps) // 10)], 4) if gaps else None}
    return arm


# ── THE ARCHIVED MOP-GRID ARM (stage 4, 2026-09-27) ──────────────────────────────────────────────────
# The product stage 4 would SERVE is the regional sea+swell grid (ECMWF-driven), not the WW3-driven buoy
# series the MOP arm grades, and it holds only future hours. The ingest (#126) archives every run at a
# cell of each CDIP buoy's own depth; this grades those archives as a forecast would have been served.

def load_mop_archives(root: str) -> list:
    """Every archived ingest blob under `root` (the ingest workflow's artifacts, one per run). Unreadable
    files are skipped: an archive that cannot be read is absent evidence, never an error."""
    blobs = []
    for dirpath, _dirs, files in os.walk(root or ""):
        for name in files:
            if name.endswith(".json"):
                try:
                    with open(os.path.join(dirpath, name), encoding="utf-8") as f:
                        b = json.load(f)
                    if isinstance(b, dict) and isinstance(b.get("stations"), dict):
                        blobs.append(b)
                except (OSError, ValueError):
                    continue
    return blobs


def mop_grid_hours(blobs: list, station: str, now: datetime, lookback_hours: float) -> dict:
    """{ISO hour: {hs, run, lead_h}} for a buoy over the last `lookback_hours`: each hour from the LATEST
    archived run issued at or before it (the shortest lead, as the forecast would have been served), never
    from a run issued after it. PURE."""
    out = {}
    lo = now - timedelta(hours=lookback_hours)
    for b in blobs or []:
        s = (b.get("stations") or {}).get(station)
        run = _parse_dt(((b.get("grids") or {}).get((s or {}).get("grid")) or {}).get("run"))
        if not s or run is None:
            continue
        for t_iso, hs in zip(s.get("times") or [], s.get("hs") or []):
            t = _parse_dt(t_iso)
            if hs is None or t is None or t < run or not (lo <= t <= now):
                continue
            key = t.strftime("%Y-%m-%dT%H:%M:%SZ")
            prev = out.get(key)
            if prev is None or run > _parse_dt(prev["run"]):
                out[key] = {"hs": hs, "run": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "lead_h": round((t - run).total_seconds() / 3600.0, 1)}
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
                 min_matched: int = None, min_station_hours: int = 0) -> dict:
    """The banked report. REFUSES (available:false + reason + counters) below the match floor —
    the counters stay readable so the refusal explains itself.

    `min_station_hours` (VA-03, 2026-10-08) is the GRADED floor in the honest unit: distinct buoy readings, not the
    spot-hours `min_matched` counts (linked spots share one reading). The runner passes its policy; 0 = no floor."""
    if min_matched is None:
        try:
            min_matched = max(1, int(os.environ.get("NEARSHORE_VAL_MIN_MATCHED", "1")))
        except (TypeError, ValueError):
            min_matched = 1
    n_station_hours = len({(m.get("station"), m.get("obs_time")) for m in matched or []})
    base = {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
            "quantity": "transform_hs_at_station_depth_vs_cdip_hs (Hs statistic; no cap, no H1/10)",
            "n_stations": n_stations, "n_obs": n_obs, "n_preds": n_preds,
            "n_matched": len(matched or []), "n_station_hours": n_station_hours}
    if not matched or len(matched) < min_matched:
        return {**base, "available": False,
                "reason": (f"no usable nearshore evidence: n_matched={len(matched or [])} "
                           f"(min {min_matched}), n_obs={n_obs}, n_preds={n_preds}"),
                "stations": {}}
    if n_station_hours < min_station_hours:
        return {**base, "available": False,
                "reason": (f"too thin to grade: station-hours={n_station_hours} (min {min_station_hours}), "
                           f"spot-hours={len(matched)}, n_obs={n_obs}, n_preds={n_preds}"),
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
    mop = arm_ab(matched, "mop_hs_m")
    if mop:
        extra["mop_ab"] = mop
    grid = arm_ab(matched, "mop_grid_hs_m")
    if grid:
        extra["mop_grid_ab"] = grid
    nwps = arm_ab(matched, "nwps_hs_m")
    if nwps:
        extra["nwps_ab"] = nwps
    # THE SHELF ARM (2026-09-28). On a WIDE shelf the served field at the spot is already a shelf-water value:
    # /point at the spot read 0.44 of /point at the shelf edge at Duck (90 km shelf), 0.60 at Wrightsville (124 km),
    # 0.66 at Cape Canaveral (74 km), against 0.93-0.99 on California's narrow shelves. The chain then applies
    # cross-shelf friction (0.67-0.80 there) as if the input came from the shelf edge; the Kr study never saw it
    # (all 10 of its pairs are narrow-shelf California, friction 1.0). Graded on the rows where friction applies.
    fr = arm_ab(matched, "model_hs_no_friction_m")
    if fr:
        extra["no_friction_ab"] = fr
    lf = arm_ab(matched, "model_hs_legacy_friction_m")   # see LEGACY_SHELF_CF_SCALE
    if lf:
        extra["legacy_friction_ab"] = lf
    # THE NEARSHORE-INPUT ARM (2026-09-28), same wide-shelf rows: it is not only friction the chain applies twice
    # there. The served value already crossed the shelf in the wave model, shoaling and refracting on the way,
    # so it enters as a nearshore value at the shelf depth: shoaling from that depth to the station, nothing else.
    ni = arm_ab(matched, "model_hs_nearshore_input_m")
    if ni:
        extra["nearshore_input_ab"] = ni
    # THE CONSENSUS ARM (stage 5): the equal-mean input through the same transform, and each other member alone.
    cons = arm_ab(matched, "model_hs_consensus_m")
    if cons:
        # SAME ROWS: every member AND the consensus on exactly the hours where all three answered, so "the equal
        # mean vs the best single model" is a paired comparison (the member arms below each cover their own rows).
        both = [m for m in matched if m.get("model_hs_consensus_m") is not None and m.get("model_hs_m") is not None]
        cons["same_rows"] = {"gfs": _arm_stats(both, "model_hs_m"), "consensus": _arm_stats(both, "model_hs_consensus_m"),
                             **{m.lower(): _arm_stats(both, f"model_hs_{m.lower()}_m")
                                for m in CONSENSUS_MEMBERS if m != "GFS"},
                             # every consensus row has GFS and EURO, so the pair is on the same hours
                             **({"pair_gfs_euro": _arm_stats(both, "model_hs_pair_m")}
                                if all(m.get("model_hs_pair_m") is not None for m in both) else {})}
        extra["consensus_ab"] = cons
    pair = arm_ab(matched, "model_hs_pair_m")
    if pair:
        extra["pair_ab"] = pair
    shadow = shadow_ab(matched)
    if shadow:
        extra["shadow_ab"] = shadow
    members = {m: arm_ab(matched, f"model_hs_{m.lower()}_m") for m in CONSENSUS_MEMBERS if m != "GFS"}
    if any(members.values()):
        extra["member_ab"] = {m: v for m, v in members.items() if v}
    # The transform is graded with the BUOY's geometry (2026-09-28); the spot-geometry number rides beside it
    # on the same hours, so the change is measured rather than asserted.
    sg = [m for m in matched if m.get("model_hs_spot_geometry_m") is not None]
    if sg:
        extra["spot_geometry"] = {"n": len(sg), "station": _arm_stats(sg, "model_hs_m"),
                                  "spot": _arm_stats(sg, "model_hs_spot_geometry_m")}
    return {**base, "available": True, "stations": stations, **extra}


def fetch_station_hs(station: str, hours: float = 26.0, timeout: float = 90.0) -> list:
    """Recent Hs from a CDIP realtime deployment via the OPeNDAP ascii interface (no netCDF dep,
    the discovery script's own transport). Returns [{time, hs_m, flag}]. Failures raise — the
    caller's per-station isolation decides what one dead buoy costs (one buoy, never the run).
    An `ndbc:<id>` station reads NOAA NDBC instead (ndbc_nearshore: the Gulf had no live CDIP station)."""
    from services.weather_pipeline.ndbc_nearshore import fetch_ndbc_hs, is_ndbc
    if is_ndbc(station):
        return fetch_ndbc_hs(station, hours=hours, timeout=timeout)
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
