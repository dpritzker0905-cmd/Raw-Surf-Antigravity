"""skill_direction_period_paired.py -- S8/S7 v2: swell DIRECTION and PERIOD graded PAIRED, by lead and coast, with
every period compared only to the buoy period of the SAME definition, and two no-skill references beside the models.

WHY (STATE "Next fixes" item 4; audit 2026-09-30 section 3.3: direction and period carry ~33% + ~10% of the served
rating's variance). The lanes already record a direction and a period per row (skill_direction_period grades them per
lane, skill_direction_consensus tests a blend), but three things kept those grades from settling a decision:

  1. PERIOD DEFINITIONS WERE MIXED. Every lane's `tp_s` was scored against NDBC DPD. DPD is a PEAK period (the band
     with the most energy). GFS-Wave PERPW and ECMWF pp1d are peak periods, so those rows are like for like; DWD GWAM
     (ICON) serves `tm10`, the energy period Tm-1,0, while ICON_PEAK_PERIOD is '0'. Tm-1,0 is a MEAN, shorter than the
     peak in a swell-dominated sea, so ICON's "-2 s bias" was largely the definition, and the three-model period
     consensus averaged a mean into two peaks. Here each forecast period carries a KIND (`tp_kind`), a peak is graded
     only against DPD, a mean only against APD, and they are never pooled. NDBC APD is Tm02 (sqrt(m0/m2)); no lane
     serves Tm02, so a Tm-1,0 vs APD cell is labelled `definition_exact: false` (Tm-1,0 >= Tm01 >= Tm02 for every
     spectrum, so part of a positive bias there is definitional, not forecast error).
  2. NO CIRCULAR BIAS. MAE says how far, not which way. `circ_bias_deg` is the circular mean of the signed differences
     (forecast minus observed, wrapped to [-180, 180)); positive = the forecast direction sits CLOCKWISE of the buoy's.
  3. UNPAIRED POPULATIONS. Per-lane tables are separate populations (forecast_skill.head_to_head's lesson). Here every
     candidate is graded on the SAME (buoy, target hour, lead) keys with the SAME verifying observation.

  * DIRECTION truth: NDBC MWD, the direction (FROM) at the dominant period. GFS DIRPW is a PEAK direction (like for
    like); ECMWF and GWAM `mwd` are energy-MEAN directions, which differ from the peak direction in a two-system sea, so
    `direction_unimodal` (|DPD - APD| <= BIMODAL_GAP_S) is reported beside the full cell. Only obs Hs >= 0.3 m.
  * NULL CONTROLS on the same keys: `persistence` (the buoy's own value at issue time) and `climatology` (the buoy's
    circular-mean MWD / mean DPD / mean APD over the rows OLDER than the held-out window, n >= MIN_CLIM).
  * CONSENSUS: the equal circular mean of the three member directions (fallback to the GFS member where the members
    cancel, counted, never dropped); per period kind, the equal mean of the members OF THAT KIND only.
  * Default OFF behind FORECAST_SKILL_DIRPER_PAIRED (registered in routes/admin/surf_forecast._RATING_FLAGS). While
    off, the ledger writes and reports byte-identically. While on, new rows carry `tp_kind` / `dir_kind` (and
    persistence rows `tp_mean_s` = the buoy's APD), and the report gains `direction_period["paired"]`.

Changes no served number: it reads scored ledger rows and returns a dict.
"""
import math
import os
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from services.weather_pipeline.skill_consensus import region_of
from services.weather_pipeline.skill_direction_consensus import MIN_RESULTANT, circular_mean_deg
from services.weather_pipeline.skill_direction_period import BIMODAL_GAP_S, DIR_MIN_OBS_HS_M, MIN_N, _num
from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, _lead, _parse

FLAG = "FORECAST_SKILL_DIRPER_PAIRED"
PERSISTENCE = "persistence"
CLIMATOLOGY = "climatology"
CONSENSUS = "consensus_equal"
MIN_CLIM = 20                 # training observations a buoy needs before its climatology is a fair reference
KIND_SHARE = 0.8              # a member joins a period-kind table only if >= 80% of its window rows are that kind

# Forecast period kinds and the NDBC column each one is graded against. DPD = dominant (peak) period; APD = average
# period, which NDBC computes as Tm02. Never pooled across kinds.
PERIOD_TRUTH = {"peak": "obs_dpd_s", "tm10": "obs_apd_s", "tm01": "obs_apd_s", "tm02": "obs_apd_s"}
PERIOD_LABEL = {
    "peak": "forecast spectral PEAK period (GFS-Wave PERPW, ECMWF pp1d, GWAM peak under ICON_PEAK_PERIOD) vs NDBC DPD",
    "tm10": "forecast energy period Tm-1,0 (GWAM tm10, ECMWF mwp) vs NDBC APD (= Tm02): NOT the same moment",
    "tm01": "forecast mean period Tm01 vs NDBC APD (= Tm02): NOT the same moment",
    "tm02": "forecast mean period Tm02 vs NDBC APD (= Tm02): the same moment",
}
DEFINITION_EXACT = {"peak": True, "tm10": False, "tm01": False, "tm02": True}
DIR_LABEL = {"peak": "peak/primary direction (GFS-Wave DIRPW)", "mean": "energy-mean direction (ECMWF/GWAM mwd)",
             "blend": "served consensus blend (CONSENSUS_DIRECTION_VECTOR)", "obs": "the buoy's own MWD at issue time"}


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


# ── definitions per lane ────────────────────────────────────────────────────────────────────────────────────────
def lane_kinds(model: str, env=None) -> Tuple[Optional[str], Optional[str]]:
    """(period kind, direction kind) of the period/direction a ledger lane records, from the model name and the
    environment AT LEDGER TIME. (None, None) for lanes whose period is not a total-sea period (the Open-Meteo lanes
    record `swell_wave_period`, a partition). PURE given `env`."""
    env = os.environ if env is None else env
    m = (model or "").strip().upper()
    if m.endswith("_SCALAR"):                       # scalar-height shadows sample the same period/direction
        m = m[:-len("_SCALAR")]
    if m in ("GFS", "GFS_RAW"):
        return "peak", "peak"
    if m == "EURO":
        return "peak", "mean"                       # pp1d (mwp only where a whole block has no pp1d), mwd
    if m == "ICON":
        return ("peak" if env.get("ICON_PEAK_PERIOD", "0") == "1" else "tm10"), "mean"
    if m == "CONSENSUS":
        return "peak", "blend"                      # GFS's period (or the median of peaks); the hybrid vector direction
    return None, None


def tag_lane_rows(rows: List[dict], model: str, env=None) -> List[dict]:
    """Stamp `tp_kind` / `dir_kind` on a lane's fresh ledger rows (in place). Rows keep their existing fields."""
    pk, dk = lane_kinds(model, env)
    for r in rows or []:
        if pk and _num(r.get("tp_s")):
            r["tp_kind"] = pk
        if dk and _num(r.get("dir_deg")):
            r["dir_kind"] = dk
    return rows


def tag_persistence_rows(rows: List[dict], report) -> List[dict]:
    """Persistence rows: `tp_s` is the buoy's DPD (peak), and `tp_mean_s` gains the buoy's APD so the mean-period
    tables have a no-skill reference too. In place."""
    apd = {}
    for entry in (report or {}).get("spots") or []:
        res = entry.get("residual") or {}
        if entry.get("buoy_id") is not None and _num(res.get("buoy_apd_s")):
            apd.setdefault(entry["buoy_id"], res["buoy_apd_s"])
    for r in rows or []:
        if r.get("source") != PERSISTENCE:
            continue
        if _num(r.get("tp_s")):
            r["tp_kind"] = "peak"
        if r.get("buoy_id") in apd:
            r["tp_mean_s"], r["tp_mean_kind"] = apd[r["buoy_id"]], "obs_apd"
        if _num(r.get("dir_deg")):
            r["dir_kind"] = "obs"
    return rows


def _source_model(source: str, primary: str) -> Optional[str]:
    s = str(source or "")
    if s == "raw_surf":
        return (primary or "GFS").upper()
    if s.startswith("raw_surf:"):
        return s.split(":", 1)[1].upper()
    return None


def row_period(row: dict, kind: str) -> Optional[float]:
    """The row's forecast period of `kind`, from `tp_s` or `tp_mean_s`, else None. PURE."""
    if row.get("source") == PERSISTENCE:
        v = row.get("tp_s") if kind == "peak" else row.get("tp_mean_s")
        return v if _num(v) and v > 0 else None
    for val, k in ((row.get("tp_s"), row.get("tp_kind")), (row.get("tp_mean_s"), row.get("tp_mean_kind"))):
        if k == kind and _num(val) and val > 0:
            return val
    return None


# ── statistics ──────────────────────────────────────────────────────────────────────────────────────────────────
def signed_circular_diff(f, o) -> Optional[float]:
    """forecast - observed wrapped to [-180, 180) degrees; positive = forecast clockwise of observed. PURE."""
    if not (_num(f) and _num(o)):
        return None
    return (f - o + 180.0) % 360.0 - 180.0


def _q(sorted_vals: List[float], q: float) -> float:
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def direction_stats(diffs: List[float]) -> Dict:
    """MAE, circular bias, resultant length, RMS, median and p90 of |error| over signed circular differences."""
    n = len(diffs)
    if n < MIN_N:
        return {"n": n, "mae_deg": None, "circ_bias_deg": None}
    a = sorted(abs(d) for d in diffs)
    s = sum(math.sin(math.radians(d)) for d in diffs) / n
    c = sum(math.cos(math.radians(d)) for d in diffs) / n
    return {"n": n, "mae_deg": round(sum(a) / n, 2),
            "circ_bias_deg": round(math.degrees(math.atan2(s, c)), 2), "resultant": round(math.hypot(s, c), 3),
            "rms_deg": round(math.sqrt(sum(d * d for d in diffs) / n), 2),
            "median_deg": round(_q(a, 0.5), 2), "p90_deg": round(_q(a, 0.9), 2)}


def period_stats(errs: List[float]) -> Dict:
    n = len(errs)
    if n < MIN_N:
        return {"n": n, "mae_s": None, "bias_s": None}
    return {"n": n, "mae_s": round(sum(abs(e) for e in errs) / n, 3), "bias_s": round(sum(errs) / n, 3),
            "rmse_s": round(math.sqrt(sum(e * e for e in errs) / n), 3)}


# ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────
def _members(sources: Iterable[str], primary: str) -> List[str]:
    """[GFS member, EURO, ICON] among the sources present: the raw GFS lane is `raw_surf:GFS_RAW` when the served
    primary is the consensus product, otherwise `raw_surf` (when the primary is GFS)."""
    present = set(sources)
    gfs = "raw_surf:GFS_RAW" if "raw_surf:GFS_RAW" in present else (
        "raw_surf" if (primary or "GFS").upper() == "GFS" else "raw_surf:GFS")
    return [m for m in (gfs, "raw_surf:EURO", "raw_surf:ICON") if m in present]


def _climatology(train_keys: Dict[tuple, Dict[str, dict]]) -> Dict[str, Dict[str, float]]:
    """Per buoy, from the observations of keys OLDER than the window: circular-mean MWD, mean DPD, mean APD."""
    seen, acc = set(), {}
    for (buoy, t_iso, _lead_h), got in train_keys.items():
        if (buoy, t_iso) in seen:
            continue
        seen.add((buoy, t_iso))
        r = next(iter(got.values()))
        a = acc.setdefault(buoy, {"d": [], "dpd": [], "apd": []})
        if _num(r.get("obs_mwd_deg")) and _num(r.get("obs_hs_m")) and r["obs_hs_m"] >= DIR_MIN_OBS_HS_M:
            a["d"].append(r["obs_mwd_deg"])
        for k, col in (("dpd", "obs_dpd_s"), ("apd", "obs_apd_s")):
            if _num(r.get(col)) and r[col] > 0:
                a[k].append(r[col])
    out = {}
    for buoy, a in acc.items():
        c = {}
        if len(a["d"]) >= MIN_CLIM:
            s = sum(math.sin(math.radians(x)) for x in a["d"])
            co = sum(math.cos(math.radians(x)) for x in a["d"])
            c["dir_deg"] = math.degrees(math.atan2(s, co)) % 360.0
        for k in ("dpd", "apd"):
            if len(a[k]) >= MIN_CLIM:
                c[k] = sum(a[k]) / len(a[k])
        out[buoy] = c
    return out


def _same_obs(got: Dict[str, dict]) -> bool:
    """Every row on a key verifies against the SAME observation (forecast_skill.head_to_head's parity rule)."""
    ids = {(r.get("obs_time"), r.get("obs_hs_m"), r.get("obs_mwd_deg"), r.get("obs_dpd_s")) for r in got.values()}
    return len(ids) == 1


def _verdict(stats: Dict[str, Dict], members: List[str], key: str, cand: str) -> Optional[bool]:
    vals = [stats[m].get(key) for m in members if m in stats]
    if stats.get(cand, {}).get(key) is None or None in vals or not vals:
        return None
    return stats[cand][key] < min(vals)


def _direction_cell(keys: List[tuple], cands: List[str], fc: Dict[str, Dict[tuple, float]], obs: Dict[tuple, float]):
    return {c: direction_stats([signed_circular_diff(fc[c][k], obs[k]) for k in keys]) for c in cands}


def _direction_block(window, members, clim, by_buoy: bool) -> Dict:
    """One lead's paired direction grades: members, the equal consensus, persistence and climatology on one key set."""
    keys, fc, obs, uni, reg, drop = [], {}, {}, {}, {}, {"no_member": 0, "no_persistence": 0, "no_climatology": 0,
                                                           "flat_or_no_obs": 0, "obs_mismatch": 0}
    n_fallback = 0
    cands = list(members) + [CONSENSUS, PERSISTENCE, CLIMATOLOGY]
    for c in cands:
        fc[c] = {}
    for key, got in window:
        if not all(_num(got.get(m, {}).get("dir_deg")) for m in members):
            drop["no_member"] += 1
            continue
        r0 = got[members[0]]
        if not (_num(r0.get("obs_mwd_deg")) and _num(r0.get("obs_hs_m")) and r0["obs_hs_m"] >= DIR_MIN_OBS_HS_M):
            drop["flat_or_no_obs"] += 1
            continue
        if not _same_obs({m: got[m] for m in list(members) + ([PERSISTENCE] if PERSISTENCE in got else [])}):
            drop["obs_mismatch"] += 1
            continue
        p = got.get(PERSISTENCE, {}).get("dir_deg")
        if not _num(p):
            drop["no_persistence"] += 1
            continue
        cl = clim.get(key[0], {}).get("dir_deg")
        if cl is None:
            drop["no_climatology"] += 1
            continue
        ds = [got[m]["dir_deg"] for m in members]
        mean, _r = circular_mean_deg(ds)
        if mean is None:
            n_fallback += 1
            mean = ds[0]
        keys.append(key)
        obs[key] = r0["obs_mwd_deg"]
        for m in members:
            fc[m][key] = got[m]["dir_deg"]
        fc[CONSENSUS][key], fc[PERSISTENCE][key], fc[CLIMATOLOGY][key] = mean, p, cl
        u = (_num(r0.get("obs_dpd_s")) and _num(r0.get("obs_apd_s"))
             and abs(r0["obs_dpd_s"] - r0["obs_apd_s"]) <= BIMODAL_GAP_S)
        uni[key] = bool(u)
        reg.setdefault(region_of(key[0]), []).append(key)
    out = {"n": len(keys), "dropped": drop, "n_consensus_fallback": n_fallback,
           "all": _direction_cell(keys, cands, fc, obs),
           "unimodal": _direction_cell([k for k in keys if uni[k]], cands, fc, obs),
           "by_region": {g: _direction_cell(ks, cands, fc, obs) for g, ks in sorted(reg.items())}}
    out.update(_summary(out["all"], members, "mae_deg", keys, fc, obs, signed_circular_diff))
    if by_buoy:
        bb = {}
        for k in keys:
            bb.setdefault(k[0], []).append(k)
        out["by_buoy"] = {b: _direction_cell(ks, cands, fc, obs) for b, ks in sorted(bb.items())}
    return out


def _summary(cell, members, metric, keys, fc, obs, err) -> Dict:
    """Best member, whether the consensus STRICTLY beats it, its paired win rate, and skill against persistence."""
    scored = [m for m in members if cell.get(m, {}).get(metric) is not None]
    if not scored:
        return {"best_member": None}
    best = min(scored, key=lambda m: cell[m][metric])
    out = {"best_member": best}
    if CONSENSUS in cell and cell[CONSENSUS].get(metric) is not None:
        out["consensus_beats_best"] = _verdict(cell, members, metric, CONSENSUS)
        wins = sum(1 for k in keys if abs(err(fc[CONSENSUS][k], obs[k])) < abs(err(fc[best][k], obs[k])))
        out["consensus_win_rate_vs_best"] = round(wins / len(keys), 3) if keys else None
    pers = cell.get(PERSISTENCE, {}).get(metric)
    if pers:
        out["skill_vs_persistence"] = {c: round(1.0 - v[metric] / pers, 3) for c, v in cell.items()
                                       if v.get(metric) is not None and c != PERSISTENCE}
    return out


def _period_err(f, o):
    return f - o


def _period_block(window, members_k: List[str], kind: str, clim, by_buoy: bool) -> Dict:
    truth = PERIOD_TRUTH[kind]
    clim_key = "dpd" if truth == "obs_dpd_s" else "apd"
    cands = list(members_k) + ([CONSENSUS] if len(members_k) >= 2 else []) + [PERSISTENCE, CLIMATOLOGY]
    keys, fc, obs, reg = [], {c: {} for c in cands}, {}, {}
    drop = {"no_member": 0, "no_truth": 0, "no_persistence": 0, "no_climatology": 0, "obs_mismatch": 0}
    for key, got in window:
        vals = {m: row_period(got.get(m, {}), kind) for m in members_k}
        if any(v is None for v in vals.values()):
            drop["no_member"] += 1
            continue
        r0 = got[members_k[0]]
        o = r0.get(truth)
        if not (_num(o) and o > 0):
            drop["no_truth"] += 1
            continue
        if not _same_obs({m: got[m] for m in list(members_k) + ([PERSISTENCE] if PERSISTENCE in got else [])}):
            drop["obs_mismatch"] += 1
            continue
        p = row_period(got.get(PERSISTENCE, {"source": PERSISTENCE}), "peak" if kind == "peak" else "mean")
        if p is None:
            drop["no_persistence"] += 1
            continue
        cl = clim.get(key[0], {}).get(clim_key)
        if cl is None:
            drop["no_climatology"] += 1
            continue
        keys.append(key)
        obs[key] = o
        for m, v in vals.items():
            fc[m][key] = v
        if CONSENSUS in fc:
            fc[CONSENSUS][key] = sum(vals.values()) / len(vals)
        fc[PERSISTENCE][key], fc[CLIMATOLOGY][key] = p, cl
        reg.setdefault(region_of(key[0]), []).append(key)

    def cell(ks):
        return {c: period_stats([fc[c][k] - obs[k] for k in ks]) for c in cands}
    out = {"kind": kind, "truth": truth.replace("obs_", "").replace("_s", "").upper(), "label": PERIOD_LABEL[kind],
           "definition_exact": DEFINITION_EXACT[kind], "members": list(members_k), "n": len(keys), "dropped": drop,
           "all": cell(keys), "by_region": {g: cell(ks) for g, ks in sorted(reg.items())}}
    out.update(_summary(out["all"], members_k, "mae_s", keys, fc, obs, _period_err))
    if by_buoy:
        bb = {}
        for k in keys:
            bb.setdefault(k[0], []).append(k)
        out["by_buoy"] = {b: cell(ks) for b, ks in sorted(bb.items())}
    return out


def _kind_members(window_rows: Dict[str, List[dict]], members: List[str], kind: str) -> Tuple[List[str], List[str]]:
    """Members whose window rows are `kind` at least KIND_SHARE of the time, and those excluded as mixed."""
    keep, mixed = [], []
    for m in members:
        rows = window_rows.get(m) or []
        has = sum(1 for r in rows if row_period(r, kind) is not None)
        if rows and has / len(rows) >= KIND_SHARE:
            keep.append(m)
        elif has:
            mixed.append(m)
    return keep, mixed


def paired_direction_period_report(rows, now: datetime, primary: str = "GFS", holdout_days: int = HOLDOUT_DAYS,
                                   env=None, by_buoy: bool = False) -> Dict:
    """PURE: the paired S8/S7 v2 grades over scored ledger rows (see the module docstring).

    Rows without `tp_kind` / `dir_kind` (written before the flag, or offline) get the kinds of their lane under
    `env` (default os.environ), counted in `n_kind_inferred`."""
    cutoff = now - timedelta(days=holdout_days)
    by_key: Dict[tuple, Dict[str, dict]] = {}
    inferred = 0
    for r in rows or []:
        src = str(r.get("source") or "")
        model = _source_model(src, primary)
        if model is None and src != PERSISTENCE:
            continue
        t, lead = _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if t is None or lead is None or t > now or r.get("buoy_id") is None:
            continue
        r = dict(r)
        if model is not None and "tp_kind" not in r and _num(r.get("tp_s")):
            pk, dk = lane_kinds(model, env)
            if pk:
                r["tp_kind"] = pk
                inferred += 1
            if dk and _num(r.get("dir_deg")):
                r.setdefault("dir_kind", dk)
        by_key.setdefault((r["buoy_id"], t.isoformat(), lead), {})[src] = dict(r, _t=t)
    members = _members({s for got in by_key.values() for s in got}, primary)
    train = {k: g for k, g in by_key.items() if next(iter(g.values()))["_t"] < cutoff}
    clim = _climatology(train)
    leads: Dict[int, list] = {}
    window_rows: Dict[str, List[dict]] = {}
    for key, got in by_key.items():
        if next(iter(got.values()))["_t"] >= cutoff:
            leads.setdefault(key[2], []).append((key, got))
            for s, r in got.items():
                window_rows.setdefault(s, []).append(r)
    dir_kinds = {}
    for m in members + [PERSISTENCE]:
        ks = {r.get("dir_kind") for r in window_rows.get(m, []) if r.get("dir_kind")}
        dir_kinds[m] = {k: DIR_LABEL.get(k, k) for k in sorted(ks)}
    out = {"method": "paired_direction_period_v2", "flag": FLAG, "primary": primary, "members": members,
           "holdout_days": holdout_days, "cutoff": cutoff.isoformat(), "min_n": MIN_N, "min_clim": MIN_CLIM,
           "dir_min_obs_hs_m": DIR_MIN_OBS_HS_M, "bimodal_gap_s": BIMODAL_GAP_S, "min_resultant": MIN_RESULTANT,
           "n_kind_inferred": inferred, "direction_kinds": dir_kinds,
           "climatology_buoys": sum(1 for c in clim.values() if c), "by_lead": {}}
    if len(members) < 2:
        out["status"] = "insufficient_members"
        return out
    period_tables = {}
    for kind in PERIOD_TRUTH:
        keep, mixed = _kind_members(window_rows, members, kind)
        if keep:
            period_tables[kind] = (keep, mixed)
    out["period_kinds"] = {k: {"members": v[0], "excluded_mixed_kind": v[1], "label": PERIOD_LABEL[k],
                               "definition_exact": DEFINITION_EXACT[k]} for k, v in period_tables.items()}
    for lead, window in sorted(leads.items()):
        entry = {"direction": _direction_block(window, members, clim, by_buoy)}
        for kind, (keep, _mixed) in period_tables.items():
            entry["period_" + kind] = _period_block(window, keep, kind, clim, by_buoy)
        out["by_lead"][str(lead)] = entry
    out["status"] = "scored" if any(e["direction"]["n"] >= MIN_N for e in out["by_lead"].values()) else "insufficient"
    return out
