"""skill_direction_period.py — S7 (peak period) and S8 (wave direction) graded at the buoys, per lane and lead.

WHY (audit 2026-09-30, log/2026-09-30-audit-sota.md §3.3). The Jacobian of the served rating with MEASURED errors put
33% of its variance on swell DIRECTION and 10% on PERIOD, yet the skill ledger graded only height: every accuracy
decision so far (the consensus, the regrid, the scalar height) was chosen without seeing direction or period error.
A one-hour NDBC snapshot that day read direction MAE 18.6 deg (RMS 28.7, p90 52) and period MAE 1.5 s, and EURO led
both; the consensus product keeps GFS's direction and period. That is a hypothesis until graded on the ledger's own
held-out rows, which is what this is.

The rows already exist: the ledger records each lane's forecast `tp_s` and, since this change, `dir_deg`; scoring
attaches the buoy's `obs_dpd_s`, `obs_mwd_deg` and `obs_apd_s`. No fetch, no new pending rows.

  * PERIOD: forecast `tp_s` vs NDBC DPD (dominant period), signed error and MAE in seconds.
  * DIRECTION: forecast `dir_deg` (mean direction FROM) vs NDBC MWD (the direction at the dominant period), the
    circular difference folded to [0, 180]: MAE, median, RMS, p90. Only where the observed Hs >= DIR_MIN_OBS_HS_M:
    on a near-flat sea the direction is noise on both sides.
  * UNIMODAL split: DPD vs APD within BIMODAL_GAP_S. When they diverge the sea has two peaks, DPD can jump between them
    and MWD follows DPD, so the row measures the definition as much as the forecast (the 2026-09-30 period validator:
    unimodal median error 0.0 s against a +2.4 s long-period Pacific median).
  * `persistence` carries the buoy's CURRENT direction as its forecast: S8's no-skill reference.
  * THE REFUSAL (forecast_skill's rule): a metric is None below MIN_N, never 0; a lane with no direction rows yet says
    so in `status` (the first `dir_deg` rows score 24 h after this change deploys).
  * WIND, S9 (2026-09-30): forecast `wind_kt` / `wind_from_deg` vs the buoy's anemometer (`obs_wind_kt`, age-gated
    upstream): speed MAE/bias in knots; direction only where the observed wind >= WIND_DIR_MIN_KT (a light wind's
    bearing is noise). Wind was 19% of the rating's variance and the ledger had never graded it: the calibration
    loop's own wind residual read wind_n 0 from 2026-08-09 to 2026-09-30, because its fetch parsed waves only
    (buoy_calibration.parse_ndbc_obs fixes that). `wind_status` says scored / insufficient / no_wind_rows.

Changes no served number.
"""
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, _lead, _parse

MIN_N = 10
DIR_MIN_OBS_HS_M = 0.3
BIMODAL_GAP_S = 3.0
WIND_DIR_MIN_KT = 5.0


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def circular_error_deg(a, b) -> Optional[float]:
    """|a - b| folded onto [0, 180] degrees, or None when either side is missing. PURE."""
    if not (_num(a) and _num(b)):
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def unimodal(row) -> Optional[bool]:
    """True/False when both DPD and APD are known, else None (unknown is not unimodal). PURE."""
    dpd, apd = row.get("obs_dpd_s"), row.get("obs_apd_s")
    if not (_num(dpd) and _num(apd)):
        return None
    return abs(dpd - apd) <= BIMODAL_GAP_S


def _pct(sorted_vals: List[float], q: float) -> float:
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def _period_stats(errs: List[float]) -> Dict:
    if len(errs) < MIN_N:
        return {"n": len(errs), "mae_s": None, "bias_s": None}
    return {"n": len(errs), "mae_s": round(sum(abs(e) for e in errs) / len(errs), 3),
            "bias_s": round(sum(errs) / len(errs), 3)}


def _dir_stats(errs: List[float]) -> Dict:
    if len(errs) < MIN_N:
        return {"n": len(errs), "mae_deg": None, "median_deg": None, "rms_deg": None, "p90_deg": None}
    s = sorted(errs)
    return {"n": len(errs), "mae_deg": round(sum(s) / len(s), 2), "median_deg": round(_pct(s, 0.5), 2),
            "rms_deg": round(math.sqrt(sum(e * e for e in s) / len(s)), 2), "p90_deg": round(_pct(s, 0.9), 2)}


def _wind_stats(errs: List[float]) -> Dict:
    if len(errs) < MIN_N:
        return {"n": len(errs), "mae_kt": None, "bias_kt": None}
    return {"n": len(errs), "mae_kt": round(sum(abs(e) for e in errs) / len(errs), 3),
            "bias_kt": round(sum(errs) / len(errs), 3)}


def direction_period_report(rows, now: datetime, holdout_days: int = HOLDOUT_DAYS) -> Dict:
    """{holdout_days, cutoff, by_source: {source: {lead: {period, period_unimodal, direction, direction_unimodal,
    status}}}} over the scored rows whose target falls in the held-out week. PURE."""
    cutoff = now - timedelta(days=holdout_days)
    acc: Dict[str, Dict[int, Dict[str, List[float]]]] = {}
    for r in rows or []:
        t, lead = _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if t is None or lead is None or t > now or t < cutoff or not r.get("source"):
            continue
        cell = acc.setdefault(r["source"], {}).setdefault(
            lead, {"p": [], "pu": [], "d": [], "du": [], "dir_recorded": [], "w": [], "wd": [], "wind_recorded": []})
        fw, ow = r.get("wind_kt"), r.get("obs_wind_kt")
        if _num(fw):
            cell["wind_recorded"].append(1.0)
        if _num(fw) and _num(ow) and fw >= 0 and ow >= 0:
            cell["w"].append(fw - ow)
            werr = circular_error_deg(r.get("wind_from_deg"), r.get("obs_wind_from_deg"))
            if werr is not None and ow >= WIND_DIR_MIN_KT:
                cell["wd"].append(werr)
        uni = unimodal(r)
        tp, dpd = r.get("tp_s"), r.get("obs_dpd_s")
        if _num(tp) and _num(dpd) and tp > 0 and dpd > 0:
            cell["p"].append(tp - dpd)
            if uni:
                cell["pu"].append(tp - dpd)
        if _num(r.get("dir_deg")):
            cell["dir_recorded"].append(1.0)
        obs_hs = r.get("obs_hs_m")
        err = circular_error_deg(r.get("dir_deg"), r.get("obs_mwd_deg"))
        if err is not None and _num(obs_hs) and obs_hs >= DIR_MIN_OBS_HS_M:
            cell["d"].append(err)
            if uni:
                cell["du"].append(err)
    by_source = {}
    for src, leads in sorted(acc.items()):
        by_source[src] = {}
        for lead, c in sorted(leads.items()):
            d = _dir_stats(c["d"])
            status = ("scored" if d["mae_deg"] is not None else
                      "no_direction_rows" if not c["dir_recorded"] else "insufficient")
            w = _wind_stats(c["w"])
            wind_status = ("scored" if w["mae_kt"] is not None else
                           "no_wind_rows" if not c["wind_recorded"] else "insufficient")
            by_source[src][str(lead)] = {"status": status,
                                         "period": _period_stats(c["p"]), "period_unimodal": _period_stats(c["pu"]),
                                         "direction": d, "direction_unimodal": _dir_stats(c["du"]),
                                         "wind_status": wind_status, "wind_speed": w,
                                         "wind_direction": _dir_stats(c["wd"])}
    return {"holdout_days": holdout_days, "cutoff": cutoff.isoformat(), "min_n": MIN_N,
            "dir_min_obs_hs_m": DIR_MIN_OBS_HS_M, "bimodal_gap_s": BIMODAL_GAP_S,
            "wind_dir_min_kt": WIND_DIR_MIN_KT, "by_source": by_source}
