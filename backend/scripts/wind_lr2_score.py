"""wind_lr2_score.py - the one scored look for the long-range wind v2 registration (sections 5-8). Serves nothing.

`score_rows(rows, ...)` is pure over the row table of wind_lr2_rows.build_rows and returns the full result document:
floors, every F1/F3/F1c line with Holm-adjusted p, G1-G6 per arm and tail, controls, the per-tail decision and the
verdict (PASS / FAIL / VOID). It reads no data. The CLI glue that loads the run files and truth is wind_lr2_run.py.
ICON's G4 seam cannot be measured here (no ICON archive); a tail that otherwise passes is reported
PASS_PENDING_ICON_SEAM and is not shippable until the live-run seam read is recorded.
"""
from typing import Dict, List, Optional

import numpy as np

import wind_lr2_rows as W
import wind_lr2_stats as S

REGION_MIN_STATIONS = S.MIN_STATIONS_PER_REGION
P95 = 95.0


def _tail_comparators(tail: str):
    return S.TAIL_CELLS[tail]


def _population(rows) -> np.ndarray:
    return np.asarray(rows["marine"], bool)


def _metric(rows, arm: str, metric: str) -> np.ndarray:
    return W.m1(rows, arm) if metric == "M1" else W.m2(rows, arm)


def line_diff(rows, arm: str, metric: str, comp: str, b: str, errs: Optional[dict] = None):
    """(diff, days, mask) for one F1 line on the primary (marine-exposed) population."""
    m = W.cell_mask(rows, b, _population(rows))
    a = (errs or {}).get((arm, metric)) if errs else None
    a = _metric(rows, arm, metric) if a is None else a
    c = (errs or {}).get((comp, metric)) if errs else None
    c = _metric(rows, comp, metric) if c is None else c
    d = np.where(m, a - c, np.nan)
    return d, rows["vday"], m


def compute_f1(rows, arms, cells=None, reps=S.REPS) -> Dict[tuple, dict]:
    out: Dict[tuple, dict] = {}
    errs: dict = {}
    for arm in list(arms) + [c for c, _ in {x for t in S.TAIL_CELLS.values() for x in t}]:
        for metric in S.METRICS:
            errs[(arm, metric)] = _metric(rows, arm, metric)
    lines = [(a, m, comp, b) for (a, m, comp, b) in S.f1_lines(arms)] if cells is None else cells
    for key in lines:
        a, m, comp, b = key
        d, days, _ = line_diff(rows, a, m, comp, b, errs)
        out[key] = S.paired_line(d, days, reps)
    return S.adjust_family(out)


def compute_f3(rows, arms=S.CAL_ARMS, reps=S.REPS) -> Dict[tuple, dict]:
    out: Dict[tuple, dict] = {}
    pop = _population(rows)
    for arm in arms:
        for b in ("B1", "B2", "B3"):
            m = W.cell_mask(rows, b, pop)
            d = np.where(m, W.m1(rows, arm) - W.m1(rows, "CLIM"), np.nan)
            out[(arm, b)] = S.b3_not_worse(d, rows["vday"], reps) if b == "B3" else S.paired_line(d, rows["vday"], reps)
    return S.adjust_family(out)


# ---------------------------------------------------------------------------------------------- G4 seam
def seam_ok(first_ext: np.ndarray, native_last: np.ndarray, native_changes: np.ndarray) -> dict:
    """EURO seam: p95 over cell-runs of |arm at 246 h - native (HRES) at 240 h| <= p95 of within-native 6 h changes."""
    d = np.abs(np.asarray(first_ext, float) - np.asarray(native_last, float))
    d = d[np.isfinite(d)]
    nc = np.asarray(native_changes, float)
    nc = nc[np.isfinite(nc)]
    if d.size == 0 or nc.size == 0:
        return {"ok": False, "reason": "no seam rows", "n": int(d.size)}
    p_seam, p_nat = float(np.percentile(d, P95)), float(np.percentile(nc, P95))
    return {"ok": bool(p_seam <= p_nat), "p95_seam": p_seam, "p95_native": p_nat, "n": int(d.size)}


def edge_ok(rows, arm: str) -> dict:
    """The arm's own 6 h speed change across 216 h and 264 h (the two steps either side of each edge) must have p95 <=
    p95 of its changes at non-edge leads of the same runs and cells."""
    key = {(r, h, s, l): v for r, h, s, l, v in zip(rows["run"], rows["hour"], rows["st"], rows["lead"], rows[f"{arm}_s"])}
    edge, other = [], []
    for (r, h, s, l), v in key.items():
        nxt = key.get((r, h, s, l + 6))
        if nxt is None or not (np.isfinite(v) and np.isfinite(nxt)):
            continue
        ch = abs(nxt - v)
        (edge if l in (210, 216, 258, 264) else other).append(ch)
    if not edge or not other:
        return {"ok": False, "reason": "no edge rows", "n_edge": len(edge)}
    pe, po = float(np.percentile(edge, P95)), float(np.percentile(other, P95))
    return {"ok": bool(pe <= po), "p95_edge": pe, "p95_other": po, "n_edge": len(edge)}


def g4(rows, arm: str, native_changes: np.ndarray) -> dict:
    m = (rows["lead"] == 246) & _population(rows)
    seam = seam_ok(rows[f"{arm}_s"][m], rows["hres240_s"][m], native_changes)
    edge = edge_ok({k: v[_population(rows)] for k, v in rows.items()}, arm)
    return {"euro_seam": seam, "edges": edge, "ok": bool(seam["ok"] and edge["ok"]),
            "icon_seam": "NOT MEASURABLE HERE: needs >= 10 live ICON runs from stored products"}


# ---------------------------------------------------------------------------------------------- G5 / G6
def halves(rows) -> np.ndarray:
    """True for the first 45 runs by init time, False for the rest (G5 halves are by RUN, not calendar date)."""
    inits = np.unique(rows["init_ts"])
    first = set(inits[: len(inits) // 2].tolist())
    return np.array([t in first for t in rows["init_ts"]])


def g5(rows, f1: Dict[tuple, dict], f3: Dict[tuple, dict], arm: str, tail: str, errs: dict) -> dict:
    """Same sign and a point estimate at least half the pooled size in BOTH halves, for each of the arm's F1 lines of the
    tail and its F3 B1/B2 lines. Descriptive, no p-value."""
    h = halves(rows)
    bad = []

    def check(name, d, days, pooled):
        if not np.isfinite(pooled) or pooled >= 0:
            bad.append(name)
            return
        for tag, sel in (("first", h), ("last", ~h)):
            mean = float(np.nanmean(np.where(sel, d, np.nan))) if np.isfinite(np.where(sel, d, np.nan)).any() else float("nan")
            if not (np.isfinite(mean) and mean < 0 and abs(mean) >= 0.5 * abs(pooled)):
                bad.append(f"{name}:{tag}")
    for comp, b in S.TAIL_CELLS[tail]:
        for m in S.METRICS:
            if (arm, m, comp, b) in f1:
                d, days, _ = line_diff(rows, arm, m, comp, b, errs)
                check(f"{m}:{comp}:{b}", d, days, f1[(arm, m, comp, b)]["mean"])
    if arm in S.CAL_ARMS:
        pop = _population(rows)
        for b in ("B1", "B2"):
            d = np.where(W.cell_mask(rows, b, pop), W.m1(rows, arm) - W.m1(rows, "CLIM"), np.nan)
            check(f"CLIM:{b}", d, rows["vday"], f3[(arm, b)]["mean"])
    return {"ok": not bad, "failed": bad}


def g6(rows, arm: str, tail: str, errs: dict, reps: int = S.REPS) -> dict:
    """No region with enough covered stations is Holm-significantly WORSE than the comparator on M1 in any bin."""
    pop = _population(rows)
    flagged, insufficient = [], []
    for comp, b in S.TAIL_CELLS[tail]:
        regs = sorted({str(r) for r in rows["region"][pop]})
        lines = {}
        for r in regs:
            sel = pop & (rows["region"] == r) & W.cell_mask(rows, b)
            n_st = len(np.unique(rows["st"][sel])) if sel.any() else 0
            if n_st < REGION_MIN_STATIONS:
                insufficient.append(f"{r}:{b}")
                continue
            d = np.where(sel, errs[(arm, "M1")] - errs[(comp, "M1")], np.nan)
            lines[r] = S.b3_not_worse(d, rows["vday"], reps)       # p = one-sided "arm significantly worse"
        for r, v in S.adjust_family(lines).items():
            if v["sig"]:
                flagged.append(f"{r}:{comp}:{b}")
    return {"ok": not flagged, "flagged": flagged, "insufficient": sorted(set(insufficient))}


# ---------------------------------------------------------------------------------------------- controls
def controls(rows, arms=S.CAL_ARMS, reps: int = S.REPS) -> Dict[str, dict]:
    """Registration section 7 on the real row table. Each entry: {'ok': bool, ...}. `reps` defaults to the registered
    B = 10,000 (the same bootstrap as the gates); tests pass a smaller number explicitly."""
    pop = _population(rows)
    out: Dict[str, dict] = {}
    # null: an arm identical to its comparator gives exactly zero with a zero-width CI
    e = W.m1(rows, "GRAND_CAL")
    r = S.paired_line(np.where(pop, e - e, np.nan), rows["vday"], reps)
    out["null"] = {"ok": bool(r["mean"] == 0.0 and r["ci"] == [0.0, 0.0])}
    # shuffled pairing (+7 d truth): the arm must NOT beat CLIM significantly in B1, B2
    sh = {}
    for arm in arms:
        for b in ("B1", "B2"):
            m = W.cell_mask(rows, b, pop)
            d = np.where(m, np.abs(rows[f"{arm}_s"] - rows["o_s_p7"]) - np.abs(rows["CLIM_s"] - rows["o_s_p7"]), np.nan)
            ln = S.paired_line(d, rows["vday"], reps)
            sh[f"{arm}:{b}"] = {"ci": ln["ci"], "n": ln["n"], "leaks": bool(ln["n"] > 0 and ln["ci"][1] < 0)}
    out["shuffled"] = {"ok": not any(v["leaks"] for v in sh.values()), "lines": sh}
    # shifted valid time (+48 h): HIGHER M1 than the unshifted arm in B1 and B2 (point estimate)
    st = {}
    for arm in arms:
        for b in ("B1", "B2"):
            m = W.cell_mask(rows, b, pop) & np.isfinite(rows["o_s_p48"])
            if m.any():
                st[f"{arm}:{b}"] = bool(np.mean(np.abs(rows[f"{arm}_s"][m] - rows["o_s_p48"][m])) >
                                        np.mean(np.abs(rows[f"{arm}_s"][m] - rows["o_s"][m])))
    out["shifted"] = {"ok": bool(st) and all(st.values()), "lines": st}
    # +1 m/s plant: signed-bias difference is +1 with a CI containing 1 and excluding 0, every bin
    pl = {}
    for b in ("B1", "B2", "B3"):
        m = W.cell_mask(rows, b, pop)
        sp = rows["GRAND_CAL_s"]
        d = np.where(m, S.plant_speed(sp) - rows["o_s"] - (sp - rows["o_s"]), np.nan)
        ln = S.paired_line(d, rows["vday"], reps)
        pl[b] = bool(ln["n"] > 0 and ln["ci"][0] <= 1.0 <= ln["ci"][1] and not (ln["ci"][0] <= 0.0 <= ln["ci"][1]))
    out["plant_speed"] = {"ok": all(pl.values()), "bins": pl}
    # direction plants: 30 deg and 60 deg on the same 15% of rows; the 2x plant must be caught (ME shifts by >= 4.5 deg,
    # CI excluding 0); the 1x plant is reported
    fd = W.from_dir(rows["GRAND_CAL_u"], rows["GRAND_CAL_v"])
    res = {}
    for name, deg in (("plant_30", 30.0), ("plant_60", 60.0)):
        pd_, _mask = S.plant_direction(fd, deg)
        err0 = (fd - rows["o_d"] + 180.0) % 360.0 - 180.0
        err1 = (pd_ - rows["o_d"] + 180.0) % 360.0 - 180.0
        ok = pop & (rows["o_s"] >= 3.0)
        ln = S.paired_line(np.where(ok, err1 - err0, np.nan), rows["vday"], reps)
        res[name] = {"mean_shift_deg": ln["mean"], "ci": ln["ci"]}
    c60 = res["plant_60"]
    out["plant_direction"] = {"ok": bool(np.isfinite(c60["mean_shift_deg"]) and c60["mean_shift_deg"] >= 4.5 and c60["ci"][0] > 0.0),
                              "plants": res}
    return out


def fit_test_disjoint(fit_inits: List, test_inits: List) -> dict:
    common = sorted(set(i.date() for i in fit_inits) & set(i.date() for i in test_inits))
    return {"ok": not common, "common": [str(c) for c in common]}


# ---------------------------------------------------------------------------------------------- the one scored look
def score_rows(rows: Dict[str, np.ndarray], native_changes: np.ndarray, kept_runs: int, stations_by_region: Dict[str, int],
               freeze_mismatches: List[str], fit_test: dict, reps: int = S.REPS, control_reps: int = S.REPS) -> dict:
    """The whole registered decision from a row table. Never reads data; deterministic for a given input."""
    doc: dict = {"n_rows": int(len(rows["lead"])), "reps": reps}
    void: List[str] = list(S.check_floors(kept_runs, rows["vday"], stations_by_region))
    void += [f"freeze mismatch: {m}" for m in freeze_mismatches]
    if not fit_test["ok"]:
        void.append(f"FIT/TEST share init dates: {fit_test['common']}")
    ctl = controls(rows, reps=control_reps)
    doc["controls"] = ctl
    void += [f"control {k} misbehaved" for k, v in ctl.items() if not v["ok"]]
    doc["void_reasons"] = void
    errs = {(a, m): _metric(rows, a, m) for a in list(W.CAL_SETS) + ["CLIM_SERVE", "LOOP_PROXY", "GFS", "CLIM"]
            for m in S.METRICS}
    f1 = compute_f1(rows, S.CAL_ARMS, reps=reps)
    f3 = compute_f3(rows, reps=reps)
    doc["f1"] = {"|".join(k): v for k, v in f1.items()}
    doc["f3"] = {"|".join(k): v for k, v in f3.items()}
    seam = {arm: g4(rows, arm, native_changes) for arm in W.GATED}
    doc["g4"] = seam
    decisions: Dict[str, str] = {}
    doc["tails"] = {}
    for tail in ("ICON", "EURO"):
        passed: Dict[str, bool] = {}
        info: dict = {}
        for arm in S.CAL_ARMS:
            g4ok = True if tail == "ICON" else seam[arm]["ok"]      # ICON seam is read forward later (pending)
            g5r = g5(rows, f1, f3, arm, tail, errs)
            g6r = g6(rows, arm, tail, errs, reps)
            passed[arm] = S.tail_passes(arm, tail, f1, f3, g4ok, g5r["ok"], g6r["ok"])
            info[arm] = {"G4": g4ok, "G5": g5r, "G6": g6r, "pass": passed[arm]}
        serve = None
        if S.gate_open_for_clim_serve(passed):
            f1c = compute_f1(rows, [S.SERVE_ARM], cells=S.f1c_lines(tail), reps=reps)
            g4ok = True if tail == "ICON" else seam[S.SERVE_ARM]["ok"]
            g5r, g6r = g5(rows, f1c, {}, S.SERVE_ARM, tail, errs), g6(rows, S.SERVE_ARM, tail, errs, reps)
            serve = all(f1c[k]["sig"] for k in f1c) and g4ok and g5r["ok"] and g6r["ok"]
            info[S.SERVE_ARM] = {"F1c": {"|".join(k): v for k, v in f1c.items()}, "G4": g4ok, "G5": g5r, "G6": g6r, "pass": serve}
        decisions[tail] = S.tail_decision(tail, passed, serve)
        info["decision"] = decisions[tail]
        if tail == "ICON" and decisions[tail] != "NONE":
            info["decision"] = decisions[tail] + "_PENDING_ICON_SEAM"
        doc["tails"][tail] = info
    doc["verdict"] = "VOID" if void else ("PASS" if any(v != "NONE" for v in decisions.values()) else "FAIL")
    return doc
