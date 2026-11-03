"""gate_v2.py - validation gates v2: the PAIRED comparison of two skill-ledger lanes and the flip verdict. PURE.

Decision tooling only: serves nothing, writes nothing. Thresholds: gate_v2_config (one place). Statistics:
gate_v2_stats. Buoy truth (hulls, spectra): gate_v2_truth. Markdown: gate_v2_report.

PAIRING is v1's (`scored_rows_analysis.paired`, which is `forecast_skill.head_to_head`'s rule): the same (buoy, target
hour, lead bucket) AND the same verifying observation. An ITEM is one such pair:
    {buoy, t, lead, obs, f_ref, f_cand, obs_hs, hull, hull_inferred, dpd, multi}
where `obs`/`f_*` are the quantity being judged (Hs in m, or a period in s, or a frequency in Hz) and `obs_hs` is
always the observed Hs, because the big-swell bands select on it whatever the quantity.

THE VERDICT (the owner's three criteria, 2026-11-01), PASS only if ALL hold:
  1. SIGNIFICANT OVERALL: the one-sided DM test (HAC) on the primary loss says the candidate's loss is lower at
     alpha_overall, AND (require_bootstrap_agree) the moving-block bootstrap CI of the mean gain excludes 0;
  2. NO BIG-SWELL BAND WORSENS ITS BIAS: for each band, |bias_cand| - |bias_ref| <= that band's max_bias_worsen_m;
  3. NO SIGNIFICANT HARM: across the family {each lead x each loss, each band x the primary loss}, no one-sided
     "candidate is worse" DM test survives Holm's correction at alpha_harm.
  REFUSED (never PASS) when the pooled pairs are below min_n_overall, the series is too short or has no variance
  (identical lanes), or a required band is untestable. Everything else that looks wrong is a WARNING with a reason.
  Hulls, sea states and the blocked CV are reported with BH q-values; they enter the verdict only through warnings
  (cv_is_gate=True makes the CV binding).

AGGREGATES ONLY (the repo and its Actions logs are public): nothing here returns a row, a buoy id, a target time or a
per-pair value. Buoy CV folds are a stable hash of the id; the id is never kept in the output.
"""
import math
import zlib
from typing import Dict, List, Optional, Sequence

from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline import gate_v2_stats as st
from services.weather_pipeline import gate_v2_truth as truth
from services.weather_pipeline import scored_rows_analysis as sra
from services.weather_pipeline.gate_v2_config import DEFAULT, GateV2Config


# ---- items --------------------------------------------------------------------------------------------------------
def _hull(meta, buoy, t):
    return truth.hull_at(meta, buoy, t) if meta else ("unknown", False)


def _item(key, ra, obs, f_ref, f_cand, meta, multi=None) -> Optional[dict]:
    t = fs._parse_iso(ra.get("target_time"))
    if t is None or not all(fs._finite_number(v) for v in (obs, f_ref, f_cand)):
        return None
    hull, inferred = _hull(meta, key[0], t)
    return {"buoy": key[0], "t": t, "lead": key[2] * 24, "obs": obs, "f_ref": f_ref, "f_cand": f_cand,
            "obs_hs": ra.get("obs_hs_m"), "hull": hull, "hull_inferred": inferred,
            "dpd": ra.get("obs_dpd_s"), "multi": multi}


def height_items(rows, ref: str = sra.SERVED, cand: str = sra.SCALAR, hull_meta=None) -> List[dict]:
    """Hs items for lanes `ref` vs `cand` on v1's paired keys."""
    out = []
    for key, ra, rb in sra.paired(rows, ref, cand):
        it = _item(key, ra, ra.get("obs_hs_m"), ra.get("hs_m"), rb.get("hs_m"), hull_meta, _multi_proxy(ra))
        if it:
            out.append(it)
    return out


def _multi_proxy(row) -> Optional[bool]:
    """Without a spectrum: the ledger's DPD-vs-APD split (skill_direction_period.unimodal), inverted. None = unknown."""
    dpd, apd = row.get("obs_dpd_s"), row.get("obs_apd_s")
    if not (fs._finite_number(dpd) and fs._finite_number(apd)):
        return None
    return abs(dpd - apd) > 3.0


def spectral_index(spectra_by_buoy: Dict[str, list], cfg: GateV2Config = DEFAULT) -> Dict[str, list]:
    """{buoy: [(time, params)]} from {buoy: parse_data_spec(...)} records."""
    out = {}
    for b, recs in (spectra_by_buoy or {}).items():
        got = [(t, truth.spectral_params(s, cfg.multi_peak_rel, cfg.multi_peak_trough)) for t, s in recs]
        out[str(b).upper()] = sorted([(t, p) for t, p in got if p], key=lambda x: x[0])
    return out


def _spectrum_for(row, spec_index, cfg, qc: dict) -> Optional[dict]:
    recs = (spec_index or {}).get(str(row.get("buoy_id") or "").upper())
    when = fs._parse_iso(row.get("obs_time"))
    if not recs or when is None:
        qc["no_spectrum"] = qc.get("no_spectrum", 0) + 1
        return None
    p = truth.nearest_spectrum(recs, when, cfg.spec_join_tol_min)
    if p is None:
        qc["no_spectrum"] = qc.get("no_spectrum", 0) + 1
        return None
    obs_hs = row.get("obs_hs_m")
    if fs._finite_number(obs_hs) and abs(p["hm0_m"] - obs_hs) > max(cfg.spec_hm0_tol_m, cfg.spec_hm0_tol_rel * obs_hs):
        qc["hm0_mismatch"] = qc.get("hm0_mismatch", 0) + 1
        return None
    qc["joined"] = qc.get("joined", 0) + 1
    return p


def period_items(rows, ref: str = sra.SERVED, cand: str = sra.SCALAR, truth_kind: str = "dpd", space: str = "period",
                 spec_index=None, hull_meta=None, cfg: GateV2Config = DEFAULT, qc: Optional[dict] = None) -> List[dict]:
    """Peak-period items: forecast `tp_s` against NDBC DPD (truth_kind "dpd") or the parabolic-fit Tp from the
    spectrum nearest the scored observation (truth_kind "fit"; needs `spec_index`). space "frequency" scores 1/T in
    Hz, where DPD's band quantisation is uniform-ish instead of growing with period. `qc` collects join counts."""
    qc = {} if qc is None else qc
    out = []
    for key, ra, rb in sra.paired(rows, ref, cand):
        fr, fc = ra.get("tp_s"), rb.get("tp_s")
        if not (fs._finite_number(fr) and fs._finite_number(fc) and fr > 0 and fc > 0):
            qc["no_forecast_tp"] = qc.get("no_forecast_tp", 0) + 1
            continue
        multi = _multi_proxy(ra)
        if truth_kind == "dpd":
            obs = ra.get("obs_dpd_s")
            if spec_index:
                p = _spectrum_for(ra, spec_index, cfg, {})
                multi = p["multi_peaked"] if p else multi
        else:
            p = _spectrum_for(ra, spec_index, cfg, qc)
            if p is None:
                continue
            obs, multi = p["fit_tp_s"], p["multi_peaked"]
        if not (fs._finite_number(obs) and obs > 0):
            continue
        if space == "frequency":
            obs, fr, fc = 1.0 / obs, 1.0 / fr, 1.0 / fc
        it = _item(key, ra, obs, fr, fc, hull_meta, multi)
        if it:
            out.append(it)
    return out


def truth_check(rows, spec_index, cfg: GateV2Config = DEFAULT, source: str = sra.SERVED) -> dict:
    """How NDBC's published fields agree with the spectrum they come from, on `source`'s scored rows (one per
    observation): APD vs Tm02, DPD vs the fit Tp, and the multi-peaked share. Aggregates only."""
    seen, apd_d, dpd_fit, dpd_fit_abs, multi, qc = set(), [], [], [], [], {}
    for r in rows:
        if r.get("source") != source:
            continue
        k = (r.get("buoy_id"), r.get("obs_time"))
        if k in seen:
            continue
        seen.add(k)
        p = _spectrum_for(r, spec_index, cfg, qc)
        if p is None:
            continue
        multi.append(p["multi_peaked"])
        if fs._finite_number(r.get("obs_apd_s")) and p["tm02_s"]:
            apd_d.append(r["obs_apd_s"] - p["tm02_s"])
        if fs._finite_number(r.get("obs_dpd_s")):
            dpd_fit.append(r["obs_dpd_s"] - p["fit_tp_s"])
            dpd_fit_abs.append(abs(r["obs_dpd_s"] - p["fit_tp_s"]))
    q = sorted(dpd_fit_abs)
    return {"qc": qc, "n": len(multi),
            "multi_share": (sum(multi) / len(multi)) if multi else None,
            "apd_minus_tm02": _summ(apd_d), "dpd_minus_fit": _summ(dpd_fit),
            "dpd_fit_abs_p50": q[len(q) // 2] if q else None, "dpd_fit_abs_p90": q[int(0.9 * len(q))] if q else None}


def _summ(xs):
    if len(xs) < 10:
        return None
    return {"n": len(xs), "mean": st.mean(xs), "mae": st.mean([abs(x) for x in xs])}


# ---- the comparison ----------------------------------------------------------------------------------------------
def _quantile(xs: Sequence[float], q: float) -> Optional[float]:
    s = sorted(x for x in xs if fs._finite_number(x))
    if not s:
        return None
    return s[min(len(s) - 1, int(math.floor(q * len(s))))]


def _lane_metrics(items, cfg):
    obs = [i["obs"] for i in items]
    return (st.point_metrics([i["f_ref"] for i in items], obs, cfg.min_cell_print),
            st.point_metrics([i["f_cand"] for i in items], obs, cfg.min_cell_print))


def _tests(items, cfg, losses) -> dict:
    """{loss: {dm, boot, dep}} on the per-hour differential series of `items`."""
    out = {}
    for loss in losses:
        d = st.differential_series(items, loss)
        dep = st.dependence(d, cfg.max_block_frac)
        dm = st.diebold_mariano(d, dep["hac_lag"], cfg.min_series_len)
        boot = st.block_bootstrap(d, dep["block"], cfg.bootstrap_reps, cfg.bootstrap_seed, cfg.ci_level,
                                  min_len=cfg.min_series_len)
        out[loss] = {"dm": dm, "boot": boot, "dep": dep, "flat": bool(d) and all(abs(x) < 1e-12 for x in d)}
    return out


def _cell(items, cfg, losses, with_tests=True) -> dict:
    if len(items) < cfg.min_cell_print:
        return {"suppressed": True}
    ref, cand = _lane_metrics(items, cfg)
    out = {"n": len(items), "ref": ref, "cand": cand}
    if with_tests and len(items) >= cfg.min_n_decide:
        out["tests"] = _tests(items, cfg, losses)
    return out


def _bias_worsen_boot(items, cfg) -> Optional[dict]:
    """Block-bootstrap CI of |bias_cand| - |bias_ref| on the per-hour (sum e_ref, sum e_cand, n) series."""
    by_t: Dict[object, list] = {}
    for i in items:
        v = by_t.setdefault(i["t"], [0.0, 0.0, 0])
        v[0] += i["f_ref"] - i["obs"]
        v[1] += i["f_cand"] - i["obs"]
        v[2] += 1
    series = [tuple(v) for _, v in sorted(by_t.items(), key=lambda kv: kv[0])]

    def stat(xs):
        n = sum(x[2] for x in xs)
        return abs(sum(x[1] for x in xs) / n) - abs(sum(x[0] for x in xs) / n)

    dep = st.dependence([x[1] / x[2] - x[0] / x[2] for x in series], cfg.max_block_frac) if series else None
    if not dep:
        return None
    return st.block_bootstrap(series, dep["block"], cfg.bootstrap_reps, cfg.bootstrap_seed, cfg.ci_level, stat=stat,
                              min_len=cfg.min_series_len)


def _fold_gain(items, cfg) -> Optional[float]:
    fn = st.LOSSES[cfg.primary_loss]
    if len(items) < cfg.cv_min_fold_n:
        return None
    return st.mean([fn(i["f_ref"] - i["obs"]) - fn(i["f_cand"] - i["obs"]) for i in items])


def blocked_cv(items, cfg: GateV2Config = DEFAULT) -> dict:
    """Replication on held-out blocks: the primary-loss gain computed INSIDE each buoy fold (stable crc32 hash of the
    id mod cv_buoy_folds) and each ISO week. A fixed A/B has nothing to fit, so "CV" here asks whether the gain holds
    in every block it could have been fitted without; `folds(items, by)` hands the same blocks to fitting callers."""
    out = {}
    for scheme in ("buoy", "week"):
        gains = []
        for _, fold in sorted(folds(items, scheme, cfg).items()):
            gains.append({"n": len(fold), "gain": _fold_gain(fold, cfg)})
        scored = [g for g in gains if g["gain"] is not None]
        out[scheme] = {"folds": gains, "scored": len(scored),
                       "positive_share": (sum(1 for g in scored if g["gain"] > 0) / len(scored)) if scored else None}
    return out


def folds(items, by: str, cfg: GateV2Config = DEFAULT) -> Dict[object, list]:
    """{fold: items}: by "buoy" (crc32(id) mod cv_buoy_folds, so a buoy never straddles folds) or "week" (ISO week)."""
    out: Dict[object, list] = {}
    for i in items:
        if by == "buoy":
            k = zlib.crc32(str(i["buoy"]).encode()) % cfg.cv_buoy_folds
        else:
            iso = i["t"].isocalendar()
            k = f"{iso[0]}-W{iso[1]:02d}"
        out.setdefault(k, []).append(i)
    return out


def _strata(items, key_fn, cfg, losses) -> Dict[str, dict]:
    groups: Dict[str, list] = {}
    for i in items:
        groups.setdefault(key_fn(i), []).append(i)
    return {k: _cell(v, cfg, losses) for k, v in sorted(groups.items())}


def _sea_state(i) -> str:
    return fs.obs_band(i["obs_hs"]) or "unknown"


def _multi_label(i) -> str:
    return "unknown" if i["multi"] is None else ("multi-peaked" if i["multi"] else "single-peaked")


def _dpd_label(cfg):
    def f(i):
        d = i.get("dpd")
        if not fs._finite_number(d):
            return "DPD unknown"
        for lo, hi in cfg.period_strata_s:
            if lo <= d < hi:
                return f"DPD {lo:g}-{hi:g} s" if hi < 99 else f"DPD >= {lo:g} s"
        return "DPD unknown"
    return f


def compare(items: Sequence[dict], cfg: GateV2Config = DEFAULT, quantity: str = "Hs (m)") -> dict:
    """Everything the v2 report prints and the verdict reads, for one set of paired items."""
    items = list(items)
    losses = (cfg.primary_loss,) + tuple(x for x in cfg.secondary_losses if x != cfg.primary_loss)
    res = {"quantity": quantity, "n": len(items), "losses": losses, "cfg": cfg}
    if len(items) < cfg.min_cell_print:
        res["suppressed"] = True
        return res
    res["overall"] = _cell(items, cfg, losses)
    res["leads"] = {lead: _cell([i for i in items if i["lead"] == lead], cfg, losses) for lead in cfg.leads}
    top_thr = None
    bands = {}
    for b in cfg.bands:
        if b.top_share is not None:
            top_thr = _quantile([i["obs_hs"] for i in items], 1.0 - b.top_share)
            sel = [i for i in items if top_thr is not None and fs._finite_number(i["obs_hs"]) and i["obs_hs"] >= top_thr]
        else:
            sel = [i for i in items if fs._finite_number(i["obs_hs"]) and i["obs_hs"] >= b.min_obs_m]
        c = _cell(sel, cfg, (cfg.primary_loss,))
        if not c.get("suppressed"):
            c["worsen"] = abs(c["cand"]["bias"]) - abs(c["ref"]["bias"])
            c["shift"] = c["cand"]["bias"] - c["ref"]["bias"]
            if len(sel) >= cfg.min_n_decide:
                c["worsen_boot"] = _bias_worsen_boot(sel, cfg)
        c["threshold"] = b.max_bias_worsen_m
        c["testable"] = len(sel) >= cfg.min_n_decide
        bands[b.label] = c
    res["bands"], res["top_threshold_m"] = bands, top_thr
    res["hulls"] = _strata(items, lambda i: i["hull"], cfg, (cfg.primary_loss,))
    res["hull_inferred_share"] = sum(1 for i in items if i["hull_inferred"]) / len(items)
    res["nomad_suspect_n"] = sum(1 for i in items if i["hull"] == "nomad_6m" and fs._finite_number(i["obs_hs"])
                                 and i["obs_hs"] >= cfg.nomad_suspect_hs_m)
    res["sea_state"] = _strata(items, _sea_state, cfg, (cfg.primary_loss,))
    res["peaks"] = _strata(items, _multi_label, cfg, (cfg.primary_loss,))
    res["dpd_strata"] = _strata(items, _dpd_label(cfg), cfg, (cfg.primary_loss,))
    res["cv"] = blocked_cv(items, cfg)
    res["harm"] = _harm_family(res, cfg)
    res["strata_q"] = _strata_q(res, cfg)
    return res


def _p_worse(cell, loss) -> Optional[float]:
    dm = ((cell.get("tests") or {}).get(loss) or {}).get("dm")
    return dm["p_worse"] if dm else None


def _harm_family(res, cfg) -> List[dict]:
    """The family Holm corrects: each lead x each loss, and each testable band x the primary loss."""
    fam = []
    for lead, c in res["leads"].items():
        for loss in res["losses"]:
            fam.append({"test": f"lead +{lead} h, {loss} loss", "p": _p_worse(c, loss)})
    for label, c in res["bands"].items():
        fam.append({"test": f"{label}, {cfg.primary_loss} loss", "p": _p_worse(c, cfg.primary_loss)})
    for loss in res["losses"][1:]:
        fam.append({"test": f"all leads, {loss} loss", "p": _p_worse(res["overall"], loss)})
    tested = [f for f in fam if f["p"] is not None]
    for f, h, q in zip(tested, st.holm([f["p"] for f in tested]), st.benjamini_hochberg([f["p"] for f in tested])):
        f["holm"], f["bh"] = h, q
    return fam


def _strata_q(res, cfg) -> Dict[str, float]:
    """BH q-values over every hull / sea-state / peak / DPD stratum's one-sided "candidate is WORSE" primary-loss DM
    p (advisory: these strata are where a flip could hurt one kind of buoy or sea while helping the pool)."""
    keys, ps = [], []
    for dim in ("hulls", "sea_state", "peaks", "dpd_strata"):
        for g, c in res[dim].items():
            dm = ((c.get("tests") or {}).get(cfg.primary_loss) or {}).get("dm")
            if dm:
                keys.append(f"{dim}:{g}")
                ps.append(dm["p_worse"])
    return dict(zip(keys, st.benjamini_hochberg(ps))) if ps else {}


# ---- the verdict -------------------------------------------------------------------------------------------------
def verdict(res: dict, cfg: Optional[GateV2Config] = None) -> dict:
    """{"verdict": PASS | FAIL | REFUSED, "reasons": [...], "warnings": [...]} (see the module docstring)."""
    cfg = cfg or res.get("cfg") or DEFAULT
    reasons, warnings = [], []
    n = res.get("n", 0)
    if res.get("suppressed") or n < cfg.min_n_overall:
        return {"verdict": "REFUSED", "reasons": [f"{n} paired rows; the gate needs >= {cfg.min_n_overall}"],
                "warnings": []}
    prim = (res["overall"].get("tests") or {}).get(cfg.primary_loss) or {}
    if prim.get("flat"):
        return {"verdict": "REFUSED", "reasons": ["the two lanes give the same loss at every hour: nothing to judge"],
                "warnings": []}
    dm, boot = prim.get("dm"), prim.get("boot")
    if dm is None:
        return {"verdict": "REFUSED", "reasons": [f"the hourly series is shorter than {cfg.min_series_len} or has no "
                                                  f"variance; no significance test is possible"], "warnings": []}
    for b in cfg.bands:
        c = res["bands"][b.label]
        if not c["testable"]:
            msg = f"band '{b.label}' has fewer than {cfg.min_n_decide} pairs: its bias cannot be checked"
            if b.label in cfg.required_bands:
                return {"verdict": "REFUSED", "reasons": [msg], "warnings": []}
            warnings.append(msg)
    # 1. significant overall
    if dm["p_better"] >= cfg.alpha_overall:
        reasons.append(f"not significant overall: DM ({cfg.primary_loss} loss) one-sided p = {dm['p_better']:.3g} "
                       f">= {cfg.alpha_overall}")
    if cfg.require_bootstrap_agree and boot and boot["lo"] <= 0:
        reasons.append(f"the {boot['level']:.0%} block-bootstrap CI of the mean gain [{boot['lo']:+.4f}, "
                       f"{boot['hi']:+.4f}] includes 0 (block {boot['block']})")
    # 2. big-swell bias
    for b in cfg.bands:
        c = res["bands"][b.label]
        if c["testable"] and c["worsen"] > b.max_bias_worsen_m:
            reasons.append(f"band '{b.label}': |bias| grows by {c['worsen']:+.3f} (candidate {c['cand']['bias']:+.3f} "
                           f"vs reference {c['ref']['bias']:+.3f}), over the {b.max_bias_worsen_m:.3f} limit")
    # 3. harm, Holm-corrected
    for f in res["harm"]:
        if f.get("holm") is not None and f["holm"] < cfg.alpha_harm:
            reasons.append(f"significant harm: {f['test']} (p {f['p']:.3g}, Holm {f['holm']:.3g} < {cfg.alpha_harm})")
    # warnings
    for scheme, cv in res["cv"].items():
        share = cv["positive_share"]
        if share is not None and share < cfg.cv_min_positive_share:
            msg = (f"blocked CV by {scheme}: the gain is positive in {share:.0%} of {cv['scored']} held-out folds "
                   f"(< {cfg.cv_min_positive_share:.0%})")
            (reasons if cfg.cv_is_gate else warnings).append(msg)
    if res["nomad_suspect_n"]:
        warnings.append(f"{res['nomad_suspect_n']} pairs verify on a 6 m NOMAD hull at observed Hs >= "
                        f"{cfg.nomad_suspect_hs_m:g} m, where the truth itself reads low")
    if res["hulls"].get("unknown", {}).get("n", 0) > 0.5 * n:
        warnings.append("more than half the pairs have no hull class (station metadata absent or uncoded)")
    for key, q in res["strata_q"].items():
        if q < cfg.fdr_q:
            warnings.append(f"the candidate is worse in stratum {key} at BH q = {q:.3g} (advisory)")
    return {"verdict": "FAIL" if reasons else "PASS", "reasons": reasons, "warnings": warnings}


V1_TO_V2 = {"YES": "PASS", "NO": "FAIL", "REFUSED": "REFUSED"}


def disagreement(v1: dict, v2: dict) -> dict:
    """Where v1 (MAE cells) and v2 disagree, and why. `agree` is True when v1's verdict maps onto v2's."""
    mapped = V1_TO_V2.get(v1.get("verdict"), "?")
    return {"v1": v1.get("verdict"), "v1_why": v1.get("why"), "v2": v2["verdict"], "agree": mapped == v2["verdict"],
            "v2_reasons": v2["reasons"], "v2_warnings": v2["warnings"]}


def crps_members(rows, members: Sequence[str] = sra.MEMBERS, cfg: GateV2Config = DEFAULT) -> dict:
    """CRPS of the member ensemble (one forecast per member lane) on keys where every member scored the same
    observation, beside each member's MAE and the equal mean's MAE. A point forecast's CRPS IS its absolute error, so
    the columns compare directly: CRPS below the equal mean's MAE means the spread carries information."""
    by = sra._index(rows, tuple(members))
    vals = {"crps": [], "equal": []}
    per = {m: [] for m in members}
    for k, r0 in by[members[0]].items():
        got = [by[m].get(k) for m in members]
        if any(g is None for g in got) or not sra._same_obs(*got):
            continue
        fc = [g["hs_m"] for g in got]
        obs = r0["obs_hs_m"]
        vals["crps"].append(st.crps_ensemble(fc, obs))
        vals["equal"].append(abs(st.mean(fc) - obs))
        for m, g in zip(members, got):
            per[m].append(abs(g["hs_m"] - obs))
    n = len(vals["crps"])
    if n < cfg.min_cell_print:
        return {"suppressed": True}
    return {"n": n, "crps": st.mean(vals["crps"]), "mae_equal": st.mean(vals["equal"]),
            "mae_members": {m: st.mean(v) for m, v in per.items()}}
