"""eval_gate.py - the evaluation harness's REGRESSION / ROLLBACK GATE: one scorecard, one verdict per candidate arm.

THE RULES (owner decision 2026-11-02 19:32 EST: "require measured improvement before any rating-changing
activation"). A candidate arm PASSES on the PRIMARY quantity only if ALL hold:
  1. MEASURED IMPROVEMENT: gates v2's overall test passes (one-sided Diebold-Mariano with HAC on the CRPS loss, which
     for a deterministic forecast is the absolute error, AND the moving-block bootstrap CI of the mean gain excludes
     0) and the DM p-value survives Holm across every candidate arm scored in the same run;
  2. NO BAND SIGNIFICANTLY WORSE: gates v2's harm family (each lead x each loss, each band) PLUS the threshold-weighted
     CRPS above the observed p90, Holm-corrected; and gates v2's per-band bias-growth limits;
  3. TOP-DECILE BIAS NO WORSE: in the observed top 10% (a REQUIRED band), |bias| may not grow by more than its limit
     and its bootstrap CI of the growth may not sit wholly above 0;
  4. THE TWO-WAY CI EXCLUDES 0 (D-065, binding): eval_twoway.two_way_ci, spatial block (complete linkage <= 100 km)
     x UTC day, over at least 14 target days; fewer days = REFUSED. The station-cluster CI is advisory;
  5. THE CONTROLS PASS: on the served baseline's own pairs, an identical candidate gives gain 0 with a CI covering 0
     and never PASSES, a 20%-less-error candidate PASSES and a 25%-more-error candidate FAILS. If they do not, the
     instrument is broken and every arm is INVALID.
REFUSED (never PASS): fewer than 14 UTC target days (the two-way CI cannot bind), too few pairs, too short a series, a required band untestable, or a candidate that does not
move the quantity at all (the gate refuses to call "no change" an improvement).
Secondary quantities get the same verdict as ADVISORY lines; only the primary one decides.

THRESHOLDS: gate_v2_config.DEFAULT (one place), with the bands REPLACED: the observed top 10% is added and made the
required band, because California nearshore buoys rarely reach the default required band (obs >= 2 m) in a week.
"""
import dataclasses
from typing import Dict, List, Optional, Sequence

from services.weather_pipeline import eval_scoring as sc
from services.weather_pipeline import eval_twoway as tw
from services.weather_pipeline import gate_v2
from services.weather_pipeline import gate_v2_stats as st
from services.weather_pipeline.gate_v2_config import DEFAULT, Band, GateV2Config

TOP = "obs top 10% (p90)"
SCHEMA = "raw-surf/eval-harness-scorecard/0"


def harness_config(base: GateV2Config = DEFAULT) -> GateV2Config:
    return dataclasses.replace(base, bands=(
        Band(TOP, top_share=0.10, max_bias_worsen_m=0.05),
        Band("obs >= 2 m", min_obs_m=2.0, max_bias_worsen_m=0.05),
        Band("obs >= 4 m", min_obs_m=4.0, max_bias_worsen_m=0.10),
    ), required_bands=(TOP,))


def _ci(b):
    return None if not b else [round(b["lo"], 5), round(b["hi"], 5)]


def summarize(items: Sequence[dict], cfg: GateV2Config, thr: Optional[float]) -> dict:
    """The comparison of f_ref vs f_cand on gate_v2 items, compacted for the scorecard (aggregates only)."""
    res = gate_v2.compare(items, cfg)
    v = gate_v2.verdict(res, cfg)
    out = {"n": res.get("n", 0), "target_hours": len({i["t"] for i in items}), "gate_v2": v}
    if res.get("suppressed"):
        return out
    ov = res["overall"]
    t = (ov.get("tests") or {}).get(cfg.primary_loss) or {}
    dm, boot = t.get("dm"), t.get("boot")
    out.update({
        "ref": {k: ov["ref"].get(k) for k in ("bias", "mae", "rmse", "si", "hh")},
        "cand": {k: ov["cand"].get(k) for k in ("bias", "mae", "rmse", "si", "hh")},
        "crps_gain": dm["mean"] if dm else (st.mean(st.differential_series(items, "abs")) if items else None),
        "crps_gain_ci": _ci(boot), "dm_p_better": dm["p_better"] if dm else None,
        "dm_p_worse": dm["p_worse"] if dm else None, "flat": bool(t.get("flat")),
        "block": (t.get("dep") or {}).get("block"), "hac_lag": (t.get("dep") or {}).get("hac_lag"),
        "leads": {str(k): ({"n": c["n"], "ref_mae": c["ref"]["mae"], "cand_mae": c["cand"]["mae"]}
                           if not c.get("suppressed") else {"suppressed": True}) for k, c in res["leads"].items()},
        "bands": {k: {"n": c.get("n"), "testable": c.get("testable"), "worsen": c.get("worsen"),
                      "worsen_ci": _ci(c.get("worsen_boot")), "limit": c.get("threshold")}
                  for k, c in res["bands"].items()},
        "harm": [{"test": f["test"], "p": f.get("p"), "holm": f.get("holm")} for f in res["harm"]],
        "cv": {k: {"scored": c["scored"], "positive_share": c["positive_share"]} for k, c in res["cv"].items()},
        "twcrps": _tw(sc.twcrps_test(items, thr, cfg)),
        "station_cluster": sc.station_cluster_boot(items),
        "two_way": _two_way(items, cfg),
        "station_week": sc.station_week_folds(items),
    })
    return out


def _two_way(items, cfg) -> dict:
    r = tw.two_way_ci(items, reps=cfg.bootstrap_reps, seed=cfg.bootstrap_seed, level=cfg.ci_level)
    r.pop("block_of", None)
    r["block_names"] = sorted(set(tw.item_blocks(items).values())) if items else []
    for k in ("ci", "ci_percentile"):
        if r.get(k):
            r[k] = [round(x, 5) for x in r[k]]
    return r


def _tw(t):
    if not t:
        return None
    return {"threshold": t["threshold"], "mean_gain": t["mean_gain"], "flat": t["flat"], "ci": _ci(t["boot"]),
            "p_worse": t["dm"]["p_worse"] if t["dm"] else None, "p_better": t["dm"]["p_better"] if t["dm"] else None}


def rules(s: dict, cfg: GateV2Config, controls_ok: bool) -> dict:
    """PASS / FAIL / REFUSED / INVALID with reasons, from one `summarize` result (Holm across arms comes later)."""
    v = s["gate_v2"]
    if controls_ok == "underpowered":
        return {"verdict": "REFUSED", "reasons": ["the positive control cannot pass at this sample size: the "
                                                  "instrument is underpowered for this quantity"], "warnings": []}
    if not controls_ok:
        return {"verdict": "INVALID", "reasons": ["the controls failed: the instrument cannot be trusted"],
                "warnings": v.get("warnings", [])}
    if v["verdict"] == "REFUSED":
        return {"verdict": "REFUSED", "reasons": list(v["reasons"]), "warnings": []}
    reasons, warnings = list(v["reasons"]), list(v["warnings"])
    top = s["bands"].get(TOP) or {}
    if top.get("worsen_ci") and top["worsen_ci"][0] > 0:
        reasons.append(f"top decile: |bias| grows significantly (CI {top['worsen_ci']})")
    tw = s.get("twcrps")
    fam = [h["p"] for h in s["harm"] if h.get("p") is not None]
    if tw and tw.get("p_worse") is not None:
        adj = st.holm(fam + [tw["p_worse"]])[-1]
        if adj < cfg.alpha_harm:
            reasons.append(f"significant harm above the observed p90: twCRPS (p {tw['p_worse']:.3g}, Holm {adj:.3g})")
    elif tw is None:
        warnings.append("twCRPS above p90 not computable")
    cal = s.get("two_way_calibration") or {}
    if cal.get("warning"):
        warnings.append(cal["warning"])
    cl = s.get("station_cluster") or {}
    if cl.get("note"):
        warnings.append(f"{cl['note']}: CI {cl.get('ci') and [round(x, 4) for x in cl['ci']]}")
    w2 = s.get("two_way") or {}
    if w2.get("computable") and w2["ci"][0] <= 0:
        reasons.append(f"the binding two-way (block x day) CI of the gain {w2['ci']} includes 0 "
                       f"({w2['blocks']} blocks x {w2['days']} days)")
    if reasons:
        return {"verdict": "FAIL", "reasons": reasons, "warnings": warnings}
    if not w2.get("computable"):
        return {"verdict": "REFUSED", "reasons": [f"two-way CI not computable: {w2.get('reason') or 'missing'}"],
                "warnings": warnings}
    return {"verdict": "PASS", "reasons": reasons, "warnings": warnings}


def baseline_warnings(arm_vs: dict) -> List[str]:
    """Advisory: a candidate that beats the served chain can still lose to a forecast built from truth alone. The
    flip gate compares candidate to SERVED (the decision is whether to change what is served); this says when both
    have no skill over a trivial baseline, which is a finding about the chain, for the owner, not a pass/fail rule."""
    out = []
    for b, c in (arm_vs or {}).items():
        ci = c.get("crps_gain_ci")
        if ci and ci[1] < 0:
            out.append(f"the candidate is significantly WORSE than {b} (gain CI {ci}): no skill over a truth-only "
                       f"baseline on this quantity")
    return out


def holm_across_arms(arms: Dict[str, dict], primary: str, cfg: GateV2Config) -> None:
    """Demote a PASS whose DM p-value does not survive Holm across every arm scored on the primary quantity."""
    names = [a for a in arms if arms[a]["quantities"].get(primary, {}).get("summary", {}).get("dm_p_better") is not None]
    if not names:
        return
    adj = st.holm([arms[a]["quantities"][primary]["summary"]["dm_p_better"] for a in names])
    for a, p in zip(names, adj):
        q = arms[a]["quantities"][primary]
        q["holm_across_arms"] = {"arms": len(names), "p_adj": p}
        if q["verdict"]["verdict"] == "PASS" and p >= cfg.alpha_overall:
            q["verdict"]["verdict"] = "FAIL"
            q["verdict"]["reasons"].append(f"not significant after Holm across {len(names)} arms (p_adj {p:.3g})")


def _cal_summary(cal: Optional[dict]) -> Optional[dict]:
    if cal is None:
        return None
    out = {k: cal[k] for k in ("layout", "false_pass", "advisory_nulls", "power", "worst_false_pass", "ok",
                               "reasons", "n_sets", "reps")}
    hi = {k: v for k, v in cal["advisory_nulls"].items() if v > tw.MAX_FALSE_PASS}
    out["warning"] = (f"advisory: with {cal['layout']['blocks']} spatial block(s) a PERSISTENT regional effect is not "
                      f"separable from skill (persistent nulls falsely pass {hi}); a PASS here generalises to these "
                      f"stations, not beyond them") if hi else ""
    return out


def run_controls(base_items: Sequence[dict], cfg: GateV2Config, thr: Optional[float], calibrate: bool = True) -> dict:
    """The four controls on the served baseline's pairs, and whether the instrument passes them."""
    out, ok = {}, True
    for kind in ("null_identical", "null_swap", "positive", "negative"):
        items = sc.control_items(base_items, kind)
        s = summarize(items, cfg, thr)
        r = rules(s, cfg, True)
        if (kind == "positive" and r["verdict"] == "FAIL" and r["reasons"]
                and all(x.startswith("the binding two-way") for x in r["reasons"])):
            # 20% less error everywhere, held back ONLY by the binding two-way CI: a power floor of this layout
            # (too few independent blocks x days for this quantity), not a broken instrument.
            r = dict(r, verdict="REFUSED", reasons=["underpowered: " + r["reasons"][0]])
        gain, ci = s.get("crps_gain"), s.get("crps_gain_ci")
        if kind == "null_identical":
            passed = (gain is not None and abs(gain) < 1e-12 and (ci is None or ci[0] <= 0 <= ci[1])
                      and r["verdict"] != "PASS")
        elif kind == "null_swap":
            passed = ci is None or ci[0] <= 0 <= ci[1]
        elif kind == "positive":
            passed = r["verdict"] == "PASS"
        else:
            passed = r["verdict"] == "FAIL"
        binding = kind != "null_swap"
        ok = ok and (passed or not binding)
        out[kind] = {"n": s.get("n"), "crps_gain": gain, "crps_gain_ci": ci, "verdict": r["verdict"],
                     "reasons": r["reasons"][:3], "passed": passed, "binding": binding}
    # The binding two-way rule must hold its false-pass rate on THIS run's layout (blocks, days, rows), else INVALID.
    cal = tw.calibrate_items(base_items) if calibrate else None
    out["two_way_calibration"] = _cal_summary(cal)
    false_pass_ok = cal is None or cal["worst_false_pass"] <= tw.MAX_FALSE_PASS
    if not false_pass_ok:
        ok = False                      # the rule passes noise on this layout: INVALID
    underpowered = cal is not None and false_pass_ok and not cal["ok"]     # honest but cannot see 4 null SD
    # A REFUSED positive control is a sample-size floor, not a broken instrument: the quantity cannot decide.
    neg_ok = out["negative"]["verdict"] in ("FAIL", "REFUSED")
    if (false_pass_ok and out["null_identical"]["passed"] and neg_ok
            and ((not ok and out["positive"]["verdict"] == "REFUSED") or (ok is True and underpowered))):
        ok = "underpowered"
    out["ok"] = ok
    return out


def impact(served_rows: Sequence[dict], cand_rows: Sequence[dict]) -> dict:
    """What the candidate changes in the SERVED OUTPUTS, every replayed spot-hour (anchor or not): the linkage
    between an input change and what a surfer would see. Descriptive; not scored (no rating truth exists yet)."""
    key = (lambda r: (r["spot"], r["valid"], r["lead_h"]))
    base = {key(r): r for r in served_rows}
    n = dh = dl = 0
    ds = []
    for r in cand_rows:
        b = base.get(key(r))
        if b is None:
            continue
        n += 1
        ho, hc = (b.get("outputs") or {}).get("surf_height_m"), (r.get("outputs") or {}).get("surf_height_m")
        so, scn = (b.get("outputs") or {}).get("score"), (r.get("outputs") or {}).get("score")
        dh += ho != hc
        dl += (b.get("outputs") or {}).get("level") != (r.get("outputs") or {}).get("level")
        if so is not None and scn is not None:
            ds.append(abs(scn - so))
    return {"spot_hours": n, "height_changed": dh, "level_changed": dl,
            "mean_abs_score_change": (sum(ds) / len(ds)) if ds else None,
            "max_abs_score_change": max(ds) if ds else None}


def versus_baselines(pairs: Sequence[dict], cfg: GateV2Config, thr: Optional[float]) -> dict:
    """The CANDIDATE against persistence and climatology on its own pairs (positive gain = candidate better)."""
    out = {}
    for b in ("persistence", "climatology"):
        pp = [dict(i, f_ref=i[b], f_cand=i["f_cand"]) for i in pairs if i.get(b) is not None]
        s = summarize(pp, cfg, thr)
        out[b] = {k: s.get(k) for k in ("n", "crps_gain", "crps_gain_ci", "dm_p_better")}
    return out


ECCODES_BACKENDS = ("pygrib", "eccodes")


def input_parity(rows: Sequence[dict]) -> dict:
    """Did the replay read the SERVED inputs? Production parity = every field decoded by an ecCodes backend (pygrib,
    as production and CI, or ECMWF's eccodes binding: the same library) AND the pgrb2 10 m wind the served lane reads.
    It covers the decoder and the wind only; the named substitutions (grid, repo variables, tide by date) apply to
    every run, CI included, and are listed in the scorecard. A run without parity is scoped to its substitutions:
    its verdicts carry a warning and the CLI exit stays non-zero unless --allow-substitutions."""
    dec = sorted({d for r in rows for d in (r.get("decoders") or [])})
    wind = sorted({r.get("wind_source") for r in rows if r.get("wind_source")})
    versions = sorted({r.get("grib_backend_version") for r in rows if r.get("grib_backend_version")})
    ok = bool(dec) and all(d in ECCODES_BACKENDS for d in dec) and wind == ["pgrb2"]
    return {"decoders": dec, "wind_sources": wind, "backend_versions": versions, "production_parity": ok}


def baseline_block(items: Dict[tuple, dict], cfg: GateV2Config, thr: Optional[float]) -> dict:
    """Scores of served / persistence / climatology, and served vs each baseline (positive gain = served better)."""
    lst = list(items.values())
    out = {"scores": {f: sc.arm_scores(lst, f, thr) for f in ("f", "persistence", "climatology")}}
    for b in ("persistence", "climatology"):
        pairs = [dict(i, f_ref=i[b], f_cand=i["f"]) for i in lst if i.get(b) is not None]
        s = summarize(pairs, cfg, thr)
        out[f"served_vs_{b}"] = {k: s.get(k) for k in ("n", "target_hours", "crps_gain", "crps_gain_ci",
                                                         "dm_p_better", "twcrps")}
    out["scores"]["served"] = out["scores"].pop("f")
    return out


def markdown(card: dict) -> str:
    """The short human summary of a scorecard."""
    def f(x, nd=3):
        return "-" if x is None else (f"{x:+.{nd}f}" if isinstance(x, float) else str(x))
    L = [f"# Evaluation harness scorecard ({card['window']['targets']})", "",
         f"Code {card['code']['commit'][:12]}{' (dirty)' if card['code'].get('dirty') else ''}; served env from "
         f"`{card['served_env']['workflow']}` sha256 {card['served_env']['sha256'][:12]}; primary `{card['primary']}`; "
         f"controls {card.get('controls_state')}; input parity {card['input_parity']}.", ""]
    for al in card.get("alarms") or []:
        L.append(f"> **TOP-PRIORITY {al['message']}** (does not block an improving candidate)")
    if card.get("alarms"):
        L.append("")
    rat = card.get("ratchet") or {}
    for q, state in (rat.get("served_state") or {}).items():
        locks = (rat.get("locks_after") or {}).get(q) or {}
        L += [f"## Climatology ratchet: {q} (out-of-sample climatology, embargo from {rat.get('embargo')})", "",
              "| lead h | class | served vs clim gain | 95% CI | n | locked | would lock |", "|---|---|---|---|---|---|---|"]
        for lead, x in state.items():
            L.append(f"| {lead} | {x['lead_class']} | {f(x['gain'], 4)} | {x['ci'] and [round(c, 4) for c in x['ci']]} | "
                     f"{x['n']} | {'yes' if lead in locks else 'no'} | {'yes' if x['beats_climatology'] and x['lead_class'] != 'long' else 'no'} |")
        L.append("")
    for q, b in card["baselines"].items():
        L += [f"## {q} ({card['quantities'][q]['truth']})", "",
              "| arm | n | bias | MAE (=CRPS) | RMSE | SI | HH | twCRPS>p90 | top-decile bias |", "|---|---|---|---|---|---|---|---|---|"]
        for arm, s in b["scores"].items():
            if not s or s.get("suppressed"):
                L.append(f"| {arm} | {s and s.get('n')} | suppressed | | | | | | |")
                continue
            L.append(f"| {arm} | {s['n']} | {f(s['bias'])} | {f(s['mae'])} | {f(s['rmse'])} | {f(s['si'])} | "
                     f"{f(s['hh'])} | {f(s.get('twcrps_p90'))} | {f(s.get('top_decile_bias'))} |")
        for k in ("served_vs_persistence", "served_vs_climatology"):
            c = b[k]
            L.append(f"- {k.replace('_', ' ')}: gain {f(c.get('crps_gain'), 4)} m, CI {c.get('crps_gain_ci')}, "
                     f"n {c.get('n')}, {c.get('target_hours')} h, DM p {f(c.get('dm_p_better'))}")
        ctl = card["controls"].get(q, {})
        if ctl:
            L.append(f"- controls ({ctl['ok'] if ctl['ok'] == 'underpowered' else ('pass' if ctl['ok'] else 'FAIL')}): "
                     + "; ".join(f"{k} {v['verdict']} gain {f(v['crps_gain'], 4)} CI {v['crps_gain_ci']}"
                                 f" -> {'ok' if v['passed'] else 'not met'}" for k, v in ctl.items()
                                 if k not in ("ok", "two_way_calibration")))
            cal = ctl.get("two_way_calibration")
            if cal:
                L.append(f"- two-way calibration on this layout ({cal['layout']}): false pass {cal['false_pass']}, "
                         f"power {cal['power']['rate']} -> {'ok' if cal['ok'] else 'FAIL'}")
        L.append("")
    st_ = card.get("two_way_self_test") or {}
    if st_:
        L += [f"Two-way gate self-test (D-065): worst null false-pass {st_.get('worst_false_pass')}, power "
              f"{(st_.get('power') or {}).get('rate')} at {(st_.get('power') or {}).get('effect_in_null_sd')} null SD; "
              f"ok {st_.get('ok')}.", ""]
    L += ["## Candidate arms", "", "| arm | quantity | n | gain (m) | 95% CI | two-way CI (binding) | DM p | verdict | "
          "first reason |", "|---|---|---|---|---|---|---|---|---|"]
    for arm, a in card["arms"].items():
        for q, r in a["quantities"].items():
            s, v = r["summary"], r["verdict"]
            tag = "" if q == card["primary"] else " (advisory)"
            w2 = s.get("two_way") or {}
            L.append(f"| `{arm}` | {q}{tag} | {s.get('n')} | {f(s.get('crps_gain'), 4)} | {s.get('crps_gain_ci')} | "
                     f"{w2.get('ci') if w2.get('computable') else 'n/a (' + str(w2.get('days')) + ' days)'} | "
                     f"{f(s.get('dm_p_better'))} | **{v['verdict']}** | {(v['reasons'] or ['-'])[0][:110]} |")
    for arm, a in card["arms"].items():
        im = a.get("impact") or {}
        L.append(f"- `{arm}` changes served outputs on {im.get('height_changed')} heights / "
                 f"{im.get('level_changed')} levels of {im.get('spot_hours')} replayed spot-hours "
                 f"(mean |score change| {f(im.get('mean_abs_score_change'))}); flag reads: {a.get('flag_reads')}")
    L += ["", "## Named gaps (offline-unreachable inputs; never stubbed silently)", ""]
    for g, d in card["gaps"]["named"].items():
        L.append(f"- `{g}`: {d} (spot-hours: {card['gaps']['counts'].get(g, 0)})")
    for sname, d in card["gaps"]["substitutions"].items():
        L.append(f"- substitution `{sname}`: {d}")
    return "\n".join(L) + "\n"


def verdict_line(card: dict) -> List[str]:
    return [f"{a}: {r['quantities'][card['primary']]['verdict']['verdict']}" for a, r in card["arms"].items()
            if card["primary"] in r["quantities"]]
