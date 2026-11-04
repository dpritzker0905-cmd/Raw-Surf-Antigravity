"""eval_ratchet.py - CLIMATOLOGY AS A RATCHET, NOT A WALL (owner, 2026-11-03: "I agree with you"). PURE apart from
the baseline file's read and write. Serves nothing.

Beating climatology is NOT required to flip (the served chain loses to it today, so a wall would block every
improvement). Instead, per lead, on the primary quantity's paired items (obs, served f, candidate f, OUT-OF-SAMPLE
climatology; eval_scoring refuses a leaked one, and so does every function here):

  gap(x, L) = CRPS(x, L) - CRPS(climatology, L)          (positive = x loses to climatology at lead L)

  1. NEVER WIDEN THE GAP (leads below LONG_MIN_LEAD_H): a candidate FAILS where its gap is significantly larger than
     served's, i.e. where the moving-block bootstrap CI of the per-target-hour gain (served loss - candidate loss)
     at that lead lies wholly below 0. On common pairs the climatology term cancels, so this is "significantly worse
     than served at this lead", tested PER LEAD with no Holm relief (the flip gate's harm family is Holm-adjusted
     across leads x losses x bands; the ratchet is not).
  2. LOCKED LEADS (the floor): where SERVED beats climatology at a lead in an ELIGIBLE run (controls pass,
     production input parity, out-of-sample climatology) - CI of served vs climatology wholly above 0 AND the one-
     sided DM p-value below alpha after Holm across that quantity's leads AND (D-065) the binding two-way block x
     day CI wholly above 0 over >= 14 days - the lead becomes PENDING; a second
     eligible run on a NON-OVERLAPPING window that qualifies again LOCKS it (two independent windows, so one lucky
     window cannot raise the floor for good). From then on "not worse than climatology" is a HARD rule there: the
     candidate FAILS when its mean CRPS at that lead exceeds climatology's (point estimate, no significance relief),
     unless served itself is below the floor in this window and the candidate improves on served (then a top-
     priority alarm about the served chain, not a block on its repair). Locks are only ever added by code (the
     floor only rises); removing one is a DECISIONS entry by hand. A locked lead the run does not score, or cannot
     test, makes the candidate REFUSED (it cannot bypass the floor).
  3. LEAD DEPENDENCE. Days 0-3 (lead < ALARM_MAX_LEAD_H): served significantly losing to climatology raises a
     TOP-PRIORITY ALARM at the head of the scorecard; it does not block an improving candidate. Days 10-14 (lead >=
     LONG_MIN_LEAD_H): rules 1 and 2 do not apply and no lock is set; the only rule is "not significantly worse than
     climatology" (candidate vs climatology CI wholly below 0 = FAIL). Days 4-9 get rules 1 and 2 without the alarm.
"""
import json
import os
from typing import Dict, List, Optional, Sequence

from services.weather_pipeline import eval_twoway as tw
from services.weather_pipeline import gate_v2_stats as st
from services.weather_pipeline.eval_scoring import LeakedClimatology

SCHEMA = "raw-surf/eval-harness-climatology-ratchet/0"
ALARM_MAX_LEAD_H = 96          # days 0-3
LONG_MIN_LEAD_H = 240          # days 10-14 (and beyond)


def lead_class(lead_h: int) -> str:
    if lead_h >= LONG_MIN_LEAD_H:
        return "long"
    return "short" if lead_h < ALARM_MAX_LEAD_H else "mid"


def _require_oos(items: Sequence[dict]) -> None:
    bad = [i for i in items if i.get("climatology") is not None and not i.get("clim_oos")]
    if bad:
        raise LeakedClimatology(f"{len(bad)} item(s) carry a climatology not marked out-of-sample")


def lead_test(items: Sequence[dict], ref: str, cand: str, cfg) -> dict:
    """Per-target-hour mean of |ref - obs| - |cand - obs| (positive = cand better), its moving-block bootstrap CI and
    the one-sided DM p-values, on the items holding both fields."""
    pp = [dict(i, f_ref=i[ref], f_cand=i[cand]) for i in items if i.get(ref) is not None and i.get(cand) is not None]
    d = st.differential_series(pp, "abs")
    out = {"n": len(pp), "target_hours": len(d), "gain": st.mean(d) if d else None, "ci": None,
           "p_better": None, "p_worse": None, "ref_crps": None, "cand_crps": None}
    if pp:
        out["ref_crps"] = st.mean([abs(i["f_ref"] - i["obs"]) for i in pp])
        out["cand_crps"] = st.mean([abs(i["f_cand"] - i["obs"]) for i in pp])
    if len(d) >= cfg.min_series_len:
        dep = st.dependence(d, cfg.max_block_frac)
        b = st.block_bootstrap(d, dep["block"], cfg.bootstrap_reps, cfg.bootstrap_seed, cfg.ci_level,
                               min_len=cfg.min_series_len)
        dm = st.diebold_mariano(d, dep["hac_lag"], cfg.min_series_len)
        out["ci"] = [b["lo"], b["hi"]] if b else None
        if dm:
            out["p_better"], out["p_worse"] = dm["p_better"], dm["p_worse"]
    return out


def _by_lead(items: Sequence[dict]) -> Dict[int, List[dict]]:
    by: Dict[int, List[dict]] = {}
    for i in items:
        by.setdefault(int(i["lead"]), []).append(i)
    return dict(sorted(by.items()))


def served_state(items: Sequence[dict], cfg) -> Dict[str, dict]:
    """{lead: served vs climatology at that lead + class + significance}. gain > 0 = served better than climatology."""
    _require_oos(items)
    out = {}
    for lead, its in _by_lead(items).items():
        t = lead_test(its, "climatology", "f", cfg)
        ci = t["ci"]
        # D-065: a lock is a "served is better" claim, so it also needs the binding two-way (block x day) CI wholly
        # above 0 over >= 14 days; a lock earned on correlated stations would raise the floor on noise.
        w2 = tw.two_way_ci([dict(i, f_ref=i["climatology"], f_cand=i["f"]) for i in its
                            if i.get("climatology") is not None and i.get("f") is not None],
                           reps=cfg.bootstrap_reps, seed=cfg.bootstrap_seed, level=cfg.ci_level)
        w2 = {"computable": w2["computable"], "ci": w2["ci"], "days": w2["days"], "blocks": w2["blocks"],
              "reason": w2.get("reason", "")}
        out[str(lead)] = dict(t, lead_class=lead_class(lead), two_way=w2,
                              beats_climatology=bool(ci and ci[0] > 0 and w2["computable"] and w2["ci"][0] > 0),
                              loses_to_climatology=bool(ci and ci[1] < 0))
    return out


def alarms(state: Dict[str, dict], quantity: str) -> List[dict]:
    """TOP-PRIORITY alarms: days 0-3 where served significantly loses to climatology. Never a block."""
    return [{"priority": "top", "quantity": quantity, "lead_h": int(lead),
             "message": f"ALARM: served {quantity} LOSES to out-of-sample climatology at lead {lead} h (days 0-3): "
                        f"gain {s['gain']:+.4f} m, CI [{s['ci'][0]:+.4f}, {s['ci'][1]:+.4f}]"}
            for lead, s in state.items() if s["lead_class"] == "short" and s["loses_to_climatology"]]


# ---- the baseline file (the floor) ----------------------------------------------------------------------------
def empty_baseline() -> dict:
    return {"schema": SCHEMA, "locks": {}, "pending": {}, "history": [],
            "rule": "locks are only ever added by eval_ratchet.update_baseline; removing one is a DECISIONS entry"}


def load_baseline(path: Optional[str]) -> dict:
    if not path or not os.path.exists(path):
        return empty_baseline()
    with open(path, encoding="utf-8") as f:
        b = json.load(f)
    if b.get("schema") != SCHEMA:
        raise ValueError(f"{path}: not a ratchet baseline ({b.get('schema')!r})")
    b.setdefault("locks", {})
    b.setdefault("pending", {})
    b.setdefault("history", [])
    return b


def locked_leads(baseline: dict, quantity: str) -> List[int]:
    return sorted(int(k) for k in (baseline.get("locks", {}).get(quantity) or {}))


def would_lock(state: Dict[str, dict], alpha: float = 0.05) -> List[int]:
    """Leads below day 10 where served beats climatology: CI wholly above 0 AND the DM p-value survives Holm across
    the quantity's candidate leads (one run tests several leads; an unadjusted 95% CI would lock on noise)."""
    cand = [k for k, s in state.items() if s["lead_class"] != "long" and s.get("p_better") is not None]
    adj = dict(zip(cand, st.holm([state[k]["p_better"] for k in cand]))) if cand else {}
    return sorted(int(k) for k in cand if state[k]["beats_climatology"] and adj[k] < alpha)


def _overlaps(w1, w2) -> bool:
    return not (w1[1] < w2[0] or w2[1] < w1[0])


def update_baseline(baseline: dict, state: Dict[str, dict], quantity: str, eligible: bool, evidence: dict,
                    alpha: float = 0.05) -> tuple:
    """(new baseline, newly locked leads). A qualifying lead first becomes PENDING; it LOCKS when a second eligible
    run on a window that does not overlap the pending one's qualifies again. Adds only: an existing lock is never
    removed or weakened, whatever this run says. Nothing is added from an ineligible run. evidence["window"] =
    [start, end] as ISO strings (compared as strings)."""
    new = json.loads(json.dumps(baseline))
    if not eligible:
        return new, []
    q = new.setdefault("locks", {}).setdefault(quantity, {})
    pend = new.setdefault("pending", {}).setdefault(quantity, {})
    win = list(evidence.get("window") or [])
    added = []
    for lead in would_lock(state, alpha):
        k = str(lead)
        if k in q:
            continue
        s = state[k]
        rec = {"utc": evidence.get("generated_utc"), "window": win, "served_gain": s["gain"], "ci": s["ci"],
               "p_better": s.get("p_better"), "n": s["n"], "target_hours": s["target_hours"], "evidence": evidence}
        first = next((p for p in pend.get(k, []) if len(win) == 2 and p.get("window")
                      and not _overlaps(p["window"], win)), None)
        if first is None:
            if not any(p.get("window") == win for p in pend.get(k, [])):
                pend.setdefault(k, []).append(rec)
            continue
        q[k] = {"locked_utc": evidence.get("generated_utc"), "served_gain": s["gain"], "ci": s["ci"],
                "n": s["n"], "target_hours": s["target_hours"], "evidence": [first, rec]}
        added.append(lead)
    if added:
        new.setdefault("history", []).append({"utc": evidence.get("generated_utc"), "quantity": quantity,
                                              "added": added, "code": evidence.get("code")})
    return new, added


def save_baseline(path: str, baseline: dict, previous: dict) -> None:
    """Write the baseline, refusing any write that would drop or alter an existing lock (the floor only rises)."""
    for q, leads in (previous.get("locks") or {}).items():
        for lead, rec in leads.items():
            if (baseline.get("locks", {}).get(q) or {}).get(lead) != rec:
                raise ValueError(f"refused: the write would remove or change the lock {q} lead {lead}")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(baseline, f, indent=1, sort_keys=True)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)                       # atomic: a reader sees the old floor or the new one, never half


# ---- the candidate rules --------------------------------------------------------------------------------------
def candidate_rules(pairs: Sequence[dict], baseline: dict, quantity: str, cfg) -> dict:
    """{reasons (FAIL), refusals (REFUSED), warnings, per_lead} for one candidate on its pairs (f_ref = served,
    f_cand = candidate, climatology = the out-of-sample baseline)."""
    _require_oos(pairs)
    items = [dict(i, f=i["f_ref"], cand=i["f_cand"]) for i in pairs]
    locks = set(locked_leads(baseline, quantity))
    reasons, refusals, warnings, per = [], [], [], {}
    by = _by_lead(items)
    for lead in sorted(locks - set(by)):
        refusals.append(f"locked lead {lead} h is not scored in this run: the ratchet floor cannot be checked")
    for lead, its in by.items():
        cls = lead_class(lead)
        widen = lead_test(its, "f", "cand", cfg)             # gain > 0 = candidate better than served
        vs_clim = lead_test(its, "climatology", "cand", cfg)  # gain > 0 = candidate better than climatology
        locked = lead in locks
        per[str(lead)] = {"lead_class": cls, "locked": locked, "candidate_vs_served": widen,
                          "candidate_vs_climatology": vs_clim}
        if cls == "long":
            if vs_clim["ci"] and vs_clim["ci"][1] < 0:
                reasons.append(f"lead {lead} h (days 10-14): significantly worse than climatology "
                               f"(CI {_fmt(vs_clim['ci'])})")
            elif vs_clim["ci"] is None:
                warnings.append(f"lead {lead} h (days 10-14): candidate vs climatology untestable "
                                f"({vs_clim['target_hours']} target hours)")
            continue
        if widen["ci"] and widen["ci"][1] < 0:
            reasons.append(f"lead {lead} h: widens the gap to climatology (candidate significantly worse than served "
                           f"at this lead, gain {widen['gain']:+.4f} m, CI {_fmt(widen['ci'])})")
        elif widen["ci"] is None:
            warnings.append(f"lead {lead} h: never-widen rule untestable ({widen['target_hours']} target hours)")
        if locked:
            if vs_clim["gain"] is None or vs_clim["target_hours"] < cfg.min_series_len:
                refusals.append(f"locked lead {lead} h untestable ({vs_clim['target_hours']} target hours)")
            elif vs_clim["gain"] < 0:
                served_below = lead_test(its, "climatology", "f", cfg)["gain"] < 0
                if served_below and widen["gain"] is not None and widen["gain"] > 0:
                    warnings.append(f"ALARM: lead {lead} h is LOCKED and SERVED is below the climatology floor in "
                                    f"this window; the candidate improves on served (gain {widen['gain']:+.4f} m) but "
                                    f"is still below the floor (gain vs climatology {vs_clim['gain']:+.4f} m)")
                else:
                    reasons.append(f"lead {lead} h is LOCKED and the candidate is worse than climatology there "
                                   f"(gain {vs_clim['gain']:+.4f} m; hard rule, no significance relief)")
    return {"reasons": reasons, "refusals": refusals, "warnings": warnings, "per_lead": per,
            "locked_leads": sorted(locks)}


def apply(verdict: dict, rr: dict) -> dict:
    """Fold the ratchet into a gate verdict: a reason turns PASS into FAIL; a refusal turns PASS into REFUSED.
    INVALID stays INVALID (broken controls outrank everything)."""
    v = dict(verdict, reasons=list(verdict["reasons"]) + rr["reasons"] + rr["refusals"],
             warnings=list(verdict["warnings"]) + rr["warnings"], ratchet=rr)
    if v["verdict"] == "PASS":
        v["verdict"] = "FAIL" if rr["reasons"] else ("REFUSED" if rr["refusals"] else "PASS")
    return v


def _fmt(ci) -> str:
    return f"[{ci[0]:+.4f}, {ci[1]:+.4f}]"
