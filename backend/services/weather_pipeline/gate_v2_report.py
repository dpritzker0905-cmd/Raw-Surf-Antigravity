"""gate_v2_report.py - validation gates v2 as markdown the lead can paste into SCOREBOARD.md / DECISIONS.md. PURE.

AGGREGATES ONLY: every table prints counts and means of a cell of >= min_cell_print pairs; a smaller cell prints
`n<10` and nothing else. No row, buoy id, target time or per-pair value is ever printed (public repo, public logs).
"""
from typing import List, Optional, Sequence

from services.weather_pipeline.gate_v2_config import DEFAULT, GateV2Config


def _f(x, nd=3, sign=False) -> str:
    if x is None:
        return "-"
    return f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}"


def _p(x) -> str:
    if x is None:
        return "-"
    return "<0.001" if x < 0.001 else f"{x:.3f}"


def _pct(x) -> str:
    return "-" if x is None else f"{100 * x:.0f}%"


def _table(head: Sequence[str], body: Sequence[Sequence[str]]) -> List[str]:
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(r) + " |" for r in body]


def _metric_row(label: str, c: dict, cfg: GateV2Config) -> List[str]:
    if c.get("suppressed"):
        return [label, f"n<{cfg.min_cell_print}"] + ["-"] * 11
    r, k = c["ref"], c["cand"]
    t = ((c.get("tests") or {}).get(cfg.primary_loss) or {})
    dm, boot = t.get("dm"), t.get("boot")
    return [label, str(c["n"]), _f(r["bias"], 3, True), _f(k["bias"], 3, True), _f(r["mae"]), _f(k["mae"]),
            _f(r["rmse"]), _f(k["rmse"]), _f(r["si"]), _f(k["si"]), _f(r["hh"]), _f(k["hh"]),
            "-" if not dm else f"{_p(dm['p_better'])} / {_p(dm['p_worse'])}"
            + ("" if not boot else f" (CI {boot['lo']:+.4f}..{boot['hi']:+.4f})")]


METRIC_HEAD = ["cell", "n", "bias ref", "bias cand", "MAE ref", "MAE cand", "RMSE ref", "RMSE cand", "SI ref",
               "SI cand", "HH ref", "HH cand", "DM p better / worse (bootstrap CI of gain)"]


def _strata_table(title: str, cells: dict, cfg: GateV2Config, q: dict, dim: str) -> List[str]:
    body = []
    for g, c in cells.items():
        row = _metric_row(g, c, cfg)
        row[0] += "" if f"{dim}:{g}" not in q else f" (BH q worse {_p(q[f'{dim}:{g}'])})"
        body.append(row)
    return [f"**{title}**", ""] + _table(METRIC_HEAD, body) + [""]


def render(res: dict, v: dict, title: str, ref: str, cand: str, cfg: Optional[GateV2Config] = None) -> str:
    """One comparison as markdown: verdict, rules, significance, leads, bands, harm family, strata, CV."""
    cfg = cfg or res.get("cfg") or DEFAULT
    out = [f"### {title}", "", f"Reference `{ref}`, candidate `{cand}`, quantity {res['quantity']}. "
           f"Paired rows: {res['n']}. Positive gain = the candidate is closer.", "",
           f"**GATE v2: {v['verdict']}**", ""]
    out += [f"- FAIL/REFUSE reason: {r}" for r in v["reasons"]] or ["- every criterion holds"]
    out += [f"- warning: {w}" for w in v["warnings"]]
    out += ["", "Rule: PASS only if (1) the one-sided Diebold-Mariano test (Newey-West HAC) on the "
            f"{cfg.primary_loss} loss gives p < {cfg.alpha_overall}"
            + (" and the block-bootstrap CI of the gain excludes 0" if cfg.require_bootstrap_agree else "")
            + "; (2) no big-swell band (selected on OBSERVED Hs) grows |bias| beyond its limit ("
            + ", ".join(f"{b.label}: {b.max_bias_worsen_m:.2f}" for b in cfg.bands)
            + f"); (3) no harm test (each lead x {'/'.join(res.get('losses', ()))} loss, each band) is significant "
              f"after Holm at {cfg.alpha_harm}. REFUSED below {cfg.min_n_overall} pairs or when "
              f"{', '.join(cfg.required_bands)} has fewer than {cfg.min_n_decide}.", ""]
    if res.get("suppressed"):
        return "\n".join(out + [f"Fewer than {cfg.min_cell_print} paired rows: nothing printed."]) + "\n"
    # significance
    sig = []
    for loss, t in (res["overall"].get("tests") or {}).items():
        dm, boot, dep = t["dm"], t["boot"], t["dep"]
        sig.append([loss, str(dep["T"]), _f(dm["mean"] if dm else None, 5, True), _f(dm["stat"] if dm else None, 2),
                    _p(dm["p_better"] if dm else None), _p(dm["p_worse"] if dm else None),
                    "-" if not boot else f"{boot['lo']:+.5f}..{boot['hi']:+.5f}", str(dep["k"]), str(dep["block"]),
                    str(dep["hac_lag"])])
    out += ["**Significance (all leads)**", ""]
    out += _table(["loss", "T hours", "mean gain", "DM stat", "p better", "p worse", f"{cfg.ci_level:.0%} bootstrap CI",
                   "first lag inside band k", "block", "HAC lag"], sig)
    dep = ((res["overall"].get("tests") or {}).get(cfg.primary_loss) or {}).get("dep") or {}
    out += ["", f"Block-length rule: {dep.get('rule', '-')}. The series is the per-target-hour mean over buoys of "
            f"loss(ref) - loss(cand), in time order; {cfg.bootstrap_reps} moving-block resamples, seed "
            f"{cfg.bootstrap_seed}.", ""]
    out += ["**Pooled and by lead**", ""]
    body = [_metric_row("all leads", res["overall"], cfg)]
    body += [_metric_row(f"+{lead} h", c, cfg) for lead, c in res["leads"].items()]
    out += _table(METRIC_HEAD, body) + [""]
    # bands
    out += [f"**Big-swell bands (observed Hs; top 5% threshold {_f(res.get('top_threshold_m'), 2)} m)**", ""]
    bb = []
    for label, c in res["bands"].items():
        if c.get("suppressed"):
            bb.append([label, f"n<{cfg.min_cell_print}"] + ["-"] * 8)
            continue
        wb = c.get("worsen_boot")
        bb.append([label, str(c["n"]), _f(c["ref"]["bias"], 3, True), _f(c["cand"]["bias"], 3, True),
                   _f(c["shift"], 3, True), _f(c["worsen"], 3, True),
                   "-" if not wb else f"{wb['lo']:+.3f}..{wb['hi']:+.3f}", _f(c["threshold"], 2),
                   _f(c["ref"]["mae"]), _f(c["cand"]["mae"])])
    out += _table(["band", "n", "bias ref", "bias cand", "bias shift (cand - ref)", "abs(bias) growth",
                   "bootstrap CI of growth", "limit", "MAE ref", "MAE cand"], bb) + [""]
    # harm family
    hb = [[f["test"], _p(f["p"]), _p(f.get("holm")), _p(f.get("bh"))] for f in res["harm"]]
    out += ["**Harm family (one-sided: the candidate is WORSE), multiple-comparison corrected**", ""]
    out += _table(["test", "raw p", "Holm (gate)", "BH q (advisory)"], hb) + [""]
    q = res["strata_q"]
    out += _strata_table("By buoy hull (NDBC station metadata at the row's hour; "
                         f"{_pct(res['hull_inferred_share'])} of pairs use the previous deployment's code)",
                         res["hulls"], cfg, q, "hulls")
    out += _strata_table("By sea state (observed Hs band)", res["sea_state"], cfg, q, "sea_state")
    out += _strata_table("By spectral shape (spectrum when joined, else the DPD-vs-APD > 3 s proxy)", res["peaks"],
                         cfg, q, "peaks")
    out += _strata_table("By observed DPD", res["dpd_strata"], cfg, q, "dpd_strata")
    cvb = []
    for scheme, cv in res["cv"].items():
        gains = ", ".join("n<min" if g["gain"] is None else f"{g['gain']:+.4f} (n {g['n']})" for g in cv["folds"])
        cvb.append([scheme, str(cv["scored"]), _pct(cv["positive_share"]), gains])
    out += [f"**Blocked cross-validation ({cfg.primary_loss}-loss gain inside each held-out block; "
            f"{'binding' if cfg.cv_is_gate else 'advisory'}, needs >= {cfg.cv_min_positive_share:.0%} positive)**", ""]
    out += _table(["blocked by", "folds scored", "positive", "gain per fold"], cvb) + [""]
    return "\n".join(out) + "\n"


def render_disagreement(d: dict) -> List[str]:
    head = "AGREE" if d["agree"] else "DISAGREE"
    out = [f"**v1 vs v2: {head}.** v1 (MAE cells, no significance test): **{d['v1']}** - {d['v1_why']}. "
           f"v2: **{d['v2']}**.", ""]
    if not d["agree"]:
        out += ["Where v2 parts from v1:", ""] + [f"- {r}" for r in d["v2_reasons"]] + [""]
    return out


def render_truth_check(tc: dict) -> List[str]:
    qc = tc.get("qc") or {}
    a, b = tc.get("apd_minus_tm02"), tc.get("dpd_minus_fit")
    return ["**Period truth check (NDBC published fields vs the spectrum they come from)**", "",
            f"Spectra joined to scored observations: {qc.get('joined', 0)}; no spectrum within the join window: "
            f"{qc.get('no_spectrum', 0)}; refused because spectral Hm0 disagreed with the observed Hs: "
            f"{qc.get('hm0_mismatch', 0)}.", ""] + _table(
        ["check", "n", "mean (s)", "mean abs (s)"],
        [["NDBC APD - spectral Tm02", str(a["n"]) if a else "n<10", _f(a and a["mean"], 2, True), _f(a and a["mae"], 2)],
         ["NDBC DPD - parabolic-fit Tp", str(b["n"]) if b else "n<10", _f(b and b["mean"], 2, True),
          _f(b and b["mae"], 2)]]) + [
        "", f"|DPD - fit Tp| median {_f(tc.get('dpd_fit_abs_p50'), 2)} s, p90 {_f(tc.get('dpd_fit_abs_p90'), 2)} s; "
            f"multi-peaked spectra: {_pct(tc.get('multi_share'))} of joined hours.", ""]


def render_crps(c: dict) -> List[str]:
    if c.get("suppressed"):
        return ["**Member ensemble CRPS**: fewer than 10 keys where every member scored the same observation.", ""]
    body = [["ensemble CRPS", _f(c["crps"])], ["equal-mean MAE", _f(c["mae_equal"])]]
    body += [[f"{m} MAE", _f(v)] for m, v in c["mae_members"].items()]
    return [f"**Member ensemble CRPS (n {c['n']} keys; a point forecast's CRPS is its MAE)**", ""] + \
        _table(["score", "m"], body) + [""]


# ---- the whole v2 section of the scored-rows job ------------------------------------------------------------------
PERIOD_CANDIDATES = ("raw_surf:ICON", "raw_surf:EURO")     # the members whose period flags (#412) gates v2 will judge


def _period_summary(rows, truth_data, cfg) -> List[str]:
    """Peak period, served GFS vs each member, under four truths: DPD and fit Tp, in seconds and in frequency."""
    from services.weather_pipeline import gate_v2 as g
    spec_index = g.spectral_index((truth_data or {}).get("spectra") or {}, cfg)
    meta = (truth_data or {}).get("meta")
    body = []
    for cand in PERIOD_CANDIDATES:
        for kind in ("dpd", "fit"):
            for space in ("period", "frequency"):
                if kind == "fit" and not spec_index:
                    body.append([cand, kind, space, "no spectra"] + ["-"] * 6)
                    continue
                items = g.period_items(rows, "raw_surf", cand, kind, space, spec_index, meta, cfg)
                res = g.compare(items, cfg, "Tp")
                v = g.verdict(res, cfg)
                if res.get("suppressed"):
                    body.append([cand, kind, space, f"n<{cfg.min_cell_print}"] + ["-"] * 6)
                    continue
                o = res["overall"]
                dm = ((o.get("tests") or {}).get(cfg.primary_loss) or {}).get("dm")
                nd = 4 if space == "frequency" else 3
                body.append([cand, kind, space, str(res["n"]), _f(o["ref"]["mae"], nd), _f(o["cand"]["mae"], nd),
                             _f(o["ref"]["bias"], nd, True), _f(o["cand"]["bias"], nd, True),
                             _p(dm["p_better"] if dm else None), v["verdict"]])
    return ["**Peak period: served GFS (`raw_surf`) vs each member, under each truth** (unit: s for period, Hz for "
            "frequency; a candidate that wins on DPD but not on fit Tp is winning on DPD's band quantisation)", ""] + \
        _table(["candidate", "truth", "space", "n", "MAE served", "MAE cand", "bias served", "bias cand",
                "DM p better", "v2 verdict"], body) + [""]


def build_v2_section(rows, v1_gate: dict, truth_data: Optional[dict] = None, cfg: Optional[GateV2Config] = None,
                     ref: str = "raw_surf", cand: str = "raw_surf:GFS_SCALAR") -> str:
    """The GATES_V2 section the scored-rows job appends: heights ref vs cand (full v2 + v1 disagreement), periods,
    the period truth check and the member-ensemble CRPS. `truth_data` = gate_v2_ndbc.fetch_truth's result or None."""
    from services.weather_pipeline import gate_v2 as g
    cfg = cfg or DEFAULT
    truth_data = truth_data or {}
    counts = truth_data.get("counts") or {}
    out = ["", "## Validation gates v2 (GATES_V2: beside v1, same rows; decision tooling, serves nothing)", "",
           f"NDBC truth fetch: station metadata {counts.get('meta', 'not fetched')}; spectra ok "
           f"{counts.get('spec_ok', 0)}, failed {counts.get('spec_failed', 0)}, empty {counts.get('spec_empty', 0)}, "
           f"not fetched (budget) {counts.get('not_fetched_budget', 0)}.", ""]
    items = g.height_items(rows, ref, cand, truth_data.get("meta"))
    res = g.compare(items, cfg, "Hs (m)")
    v = g.verdict(res, cfg)
    out += render_disagreement(g.disagreement(v1_gate, v))
    out += [render(res, v, f"Hs: {ref} vs {cand}", ref, cand, cfg)]
    out += _period_summary(rows, truth_data, cfg)
    spec_index = g.spectral_index(truth_data.get("spectra") or {}, cfg)
    if spec_index:
        out += render_truth_check(g.truth_check(rows, spec_index, cfg))
    out += render_crps(g.crps_members(rows, cfg=cfg))
    return "\n".join(out) + "\n"
