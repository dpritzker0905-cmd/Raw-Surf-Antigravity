"""scored_rows_analysis.py - the arithmetic of the ONE-OFF scalar-height gate (commitment 1335). PURE, stdlib only.

WHY. The Forecast Accuracy Monitor prints the paired served-vs-`raw_surf:GFS_SCALAR` table by lead only. Whether the
scalar-height flip (`SAMPLER_SCALAR_HEIGHT`, D-001: flips only on the owner's word with evidence) loses on any coast or
in any forecast-height band, how much of its gain is bias and how much is spread, and why the built CONSENSUS shadow
reads high at +48/+72 h, all need the scored rows. This module turns those rows into AGGREGATES and nothing else.

AGGREGATES ONLY (the repo is public, so is every Actions log and step summary). A cell with fewer than `MIN_CELL_N`
pairs is dropped at birth: the returned structure holds `{"suppressed": True}` for it, not its n and not its numbers,
and the renderer prints `n<10`. No function here returns, and `render_report` never prints, a row, a buoy id, a target
time or a per-pair value. The only identifiers in the output are the six coasts, the four forecast-height bands and a
handful of provenance classes (tier, frame, cycle).

PAIRING is the ledger's own (`forecast_skill.head_to_head`): the same (buoy, target, lead bucket) AND the same verifying
observation (time and height). The pooled per-lead numbers are pinned to `head_to_head` to the digit by a test.

SIGN. Everything is `reference minus candidate` for MAE: positive means the candidate (the scalar lane) is closer.
"""
import math
from collections import defaultdict
from typing import Dict, List, Sequence

from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.skill_attribution import STALE_CYCLE_H
from services.weather_pipeline.skill_consensus import region_of

SERVED, SCALAR = fs.SOURCE_OURS, "raw_surf:GFS_SCALAR"
CONTROL, MARINE = fs.SOURCE_OM_GFS, fs.SOURCE_OM
MEMBERS = ("raw_surf", "raw_surf:ICON", "raw_surf:EURO")
SHADOW = "raw_surf:CONSENSUS"
KEEP = frozenset({SERVED, SCALAR, CONTROL, MARINE, SHADOW} | set(MEMBERS))

MIN_CELL_N = 10          # a smaller cell is never kept, never printed (aggregates only)
GATE_MIN_N = 100         # a cell must hold this many pairs to decide the gate
GATE_MAX_LOSS_M = 0.005  # the scalar may not lose to the served lane by more than this in any such cell
MISMATCH_SHARE = 0.01    # more than 1% of pairs with scalar < served means the two lanes are not one product
SAME_VALUE = 1e-9


def fc_band(hs_m) -> str:
    """The forecast-height band of the SERVED lane's own forecast (not the observation: banding by the observation
    regresses to the mean and cannot attribute bias; audit 2026-09-30 section 3.6). Edges are the ledger's."""
    for lo, hi, label in fs.OBS_BANDS:
        if lo <= hs_m < hi:
            return "fc " + label
    return "fc ?"


def _usable(row) -> bool:
    return fs._finite_number(row.get("err_m")) and fs._finite_number(row.get("hs_m"))


def _key(row) -> tuple:
    return (row.get("buoy_id"), row.get("target_time"), fs._lead_bucket(row.get("lead_h") or 0))


def _index(rows, sources) -> Dict[str, dict]:
    by = {s: {} for s in sources}
    for r in rows:
        s = r.get("source")
        if s in by and _usable(r):
            by[s][_key(r)] = r
    return by


def _same_obs(*rows) -> bool:
    times = [fs._parse_iso(r.get("obs_time")) for r in rows]
    heights = [r.get("obs_hs_m") for r in rows]
    return (all(t is not None for t in times) and len(set(times)) == 1
            and all(fs._finite_number(h) for h in heights) and len(set(heights)) == 1)


def paired(rows, a: str = SERVED, b: str = SCALAR) -> list:
    """[(key, row_a, row_b)] on the same (buoy, target, lead bucket) AND the same verifying observation."""
    by = _index(rows, (a, b))
    return [(k, ra, by[b][k]) for k, ra in by[a].items() if k in by[b] and _same_obs(ra, by[b][k])]


def _mean(xs):
    return sum(xs) / len(xs)


def cell_stats(pairs: Sequence) -> dict:
    """Everything one cell reports, for pairs [(row_reference, row_candidate)]. `delta` = MAE reference - MAE candidate."""
    n = len(pairs)
    ea = [a["err_m"] for a, _ in pairs]
    eb = [b["err_m"] for _, b in pairs]
    d = [b["hs_m"] - a["hs_m"] for a, b in pairs]
    bias_a, bias_b = _mean(ea), _mean(eb)
    mae_a, mae_b = _mean([abs(x) for x in ea]), _mean([abs(x) for x in eb])
    deb_a, deb_b = _mean([abs(x - bias_a) for x in ea]), _mean([abs(x - bias_b) for x in eb])
    shift = _mean(d)
    wins_a = sum(1 for x, y in zip(ea, eb) if abs(x) < abs(y))
    wins_b = sum(1 for x, y in zip(ea, eb) if abs(y) < abs(x))
    gain = mae_a - mae_b
    return {
        "n": n, "mae_ref": mae_a, "mae_cand": mae_b, "delta": gain,
        "ref_wins": wins_a / n, "cand_wins": wins_b / n, "ties": (n - wins_a - wins_b) / n,
        "unchanged": sum(1 for v in d if abs(v) <= SAME_VALUE) / n,
        "violations": sum(1 for v in d if v < -SAME_VALUE) / n,
        "bias_ref": bias_a, "bias_cand": bias_b, "shift": shift,
        "rmse_ref": math.sqrt(_mean([x * x for x in ea])), "rmse_cand": math.sqrt(_mean([x * x for x in eb])),
        # the exact split of the gain: with both lanes DEBIASED (spread only), and what is left (the bias part)
        "gain_spread": deb_a - deb_b, "gain_bias": gain - (deb_a - deb_b),
        # the same mean shift applied UNIFORMLY to every reference error: what a pure offset would have bought
        "gain_uniform": mae_a - _mean([abs(x + shift) for x in ea]),
    }


def cell(pairs: Sequence, min_n: int = MIN_CELL_N) -> dict:
    """`cell_stats`, or `{"suppressed": True}` (nothing else, not even n) when the cell is below the floor."""
    return {"suppressed": True} if len(pairs) < max(min_n, MIN_CELL_N) else cell_stats(pairs)


def _lead(key) -> int:
    return key[2] * 24


def tables(rows, min_n: int = MIN_CELL_N) -> dict:
    """{dimension: {(group, lead_or_"all"): cell}} for the served-vs-scalar pairs, by pooled / coast / forecast band."""
    dims = {"pooled": lambda p: "all sea", "coast": lambda p: region_of(p[0][0]),
            "band": lambda p: fc_band(p[1]["hs_m"])}
    out: Dict[str, dict] = {}
    pairs = paired(rows, SERVED, SCALAR)
    for dim, group_of in dims.items():
        groups: Dict[tuple, list] = defaultdict(list)
        for p in pairs:
            groups[(group_of(p), _lead(p[0]))].append((p[1], p[2]))
            groups[(group_of(p), "all")].append((p[1], p[2]))
        out[dim] = {k: cell(v, min_n) for k, v in sorted(groups.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1])))}
    return out


def halves(rows, min_n: int = MIN_CELL_N) -> dict:
    """Pooled per lead for the first and second half of the paired target-time range (a replication check)."""
    pairs = [(p, fs._parse_iso(p[1].get("target_time"))) for p in paired(rows, SERVED, SCALAR)]
    pairs = [(p, t) for p, t in pairs if t is not None]
    if not pairs:
        return {}
    lo, hi = min(t for _, t in pairs), max(t for _, t in pairs)
    mid = lo + (hi - lo) / 2
    out = {}
    for name, keep in (("first half", lambda t: t < mid), ("second half", lambda t: t >= mid)):
        groups: Dict[int, list] = defaultdict(list)
        for p, t in pairs:
            if keep(t):
                groups[_lead(p[0])].append((p[1], p[2]))
        out[name] = {lead: cell(v, min_n) for lead, v in sorted(groups.items())}
    return out


def gate(tab: dict, min_n: int = GATE_MIN_N, max_loss: float = GATE_MAX_LOSS_M) -> dict:
    """The gate: no cell (pooled, coast, forecast band; each lead and all leads) holding >= min_n pairs where the scalar
    lane's MAE exceeds the served lane's by more than max_loss. REFUSED, never YES, when no cell reaches min_n or when
    the two lanes are not one product (more than MISMATCH_SHARE of pairs with scalar < served)."""
    checked, violators = [], []
    for dim in ("pooled", "coast", "band"):
        for (group, lead), c in tab.get(dim, {}).items():
            if c.get("suppressed") or c["n"] < min_n:
                continue
            row = {"dim": dim, "group": group, "lead": lead, "n": c["n"], "delta": c["delta"]}
            checked.append(row)
            if c["delta"] < -max_loss:
                violators.append(row)
    overall = tab.get("pooled", {}).get(("all sea", "all"), {"suppressed": True})
    mismatch = (not overall.get("suppressed")) and overall["violations"] > MISMATCH_SHARE
    if not checked:
        verdict, why = "REFUSED", f"no cell reached n >= {min_n}"
    elif mismatch:
        verdict, why = "REFUSED", f"{overall['violations']:.1%} of pairs have scalar < served: not one product"
    elif violators:
        verdict, why = "NO", f"{len(violators)} of {len(checked)} cells lose by more than {max_loss:.3f} m"
    else:
        verdict, why = "YES", f"none of {len(checked)} cells loses by more than {max_loss:.3f} m"
    nearest = sorted(checked, key=lambda r: r["delta"])[:6]
    return {"verdict": verdict, "why": why, "min_n": min_n, "max_loss": max_loss, "cells_checked": len(checked),
            "violators": violators, "nearest": nearest}


def three_way(rows, ref: str, min_n: int = MIN_CELL_N) -> dict:
    """Per lead, on keys where served, scalar and `ref` all scored the same observation: how far the scalar lane closes
    the served-vs-ref gap. {lead: cell or {"suppressed"}}."""
    by = _index(rows, (SERVED, SCALAR, ref))
    groups: Dict[int, list] = defaultdict(list)
    for k, s in by[SERVED].items():
        c, r = by[SCALAR].get(k), by[ref].get(k)
        if c is not None and r is not None and _same_obs(s, c, r):
            groups[_lead(k)].append((s, c, r))
    out = {}
    for lead, v in sorted(groups.items()):
        if len(v) < max(min_n, MIN_CELL_N):
            out[lead] = {"suppressed": True}
            continue
        s, c, r = (_mean([abs(t[i]["err_m"]) for t in v]) for i in range(3))
        out[lead] = {"n": len(v), "mae_served": s, "mae_scalar": c, "mae_ref": r,
                     "served_minus_ref": s - r, "scalar_minus_ref": c - r,
                     "scalar_wins_vs_ref": sum(1 for t in v if abs(t[1]["err_m"]) < abs(t[2]["err_m"])) / len(v),
                     "closed": (s - c) / (s - r) if s - r > 1e-6 else None}
    return out


def _pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def _frame(row) -> str:
    off = row.get("frame_off_h")
    return "unknown" if not fs._finite_number(off) else ("on_frame" if abs(off) < 0.01 else "snapped")


def _cycle(row) -> str:
    age = row.get("cycle_age_h")
    return "unknown" if not fs._finite_number(age) else ("stale" if age >= STALE_CYCLE_H else "fresh")


def _worst(states, bad) -> str:
    return "unknown" if "unknown" in states else (bad if bad in states else states[0])


def construction(rows, min_n: int = MIN_CELL_N) -> dict:
    """The built CONSENSUS shadow against the ledger's computed equal mean of its three members, on keys where all four
    lanes scored the same observation, grouped by the three hypotheses for the +48/+72 h defect: (1) BUILD-time versus
    PASS-time members (cycle age), (2) the tier each member answered from, (3) frame snapping. {(dim, group, lead): cell}."""
    by = _index(rows, MEMBERS + (SHADOW,))
    groups: Dict[tuple, list] = defaultdict(list)
    for k, s in by[SHADOW].items():
        got = [by[m].get(k) for m in MEMBERS]
        if any(g is None for g in got) or not _same_obs(s, *got):
            continue
        equal = _mean([g["hs_m"] for g in got])
        icon, euro = by["raw_surf:ICON"][k], by["raw_surf:EURO"][k]
        features = {
            "all": "all", "coast": region_of(k[0]), "shadow tier": s.get("tier") or "unknown",
            "member tiers": f"EURO={euro.get('tier') or 'unknown'} ICON={icon.get('tier') or 'unknown'}",
            "frames": f"shadow={_frame(s)} members={_worst([_frame(icon), _frame(euro)], 'snapped')}",
            "cycles": f"shadow={_cycle(s)} members={_worst([_cycle(icon), _cycle(euro)], 'stale')}",
        }
        item = (s["hs_m"] - equal, s["hs_m"] - s["obs_hs_m"], equal - s["obs_hs_m"])
        for dim, group in features.items():
            groups[(dim, group, _lead(k))].append(item)
    out = {}
    for (dim, group, lead), v in sorted(groups.items()):
        if len(v) < max(min_n, MIN_CELL_N):
            out[(dim, group, lead)] = {"suppressed": True}
            continue
        diff = [abs(x[0]) for x in v]
        out[(dim, group, lead)] = {
            "n": len(v), "signed_mean": _mean([x[0] for x in v]), "abs_median": _pct(diff, 0.5), "abs_p90": _pct(diff, 0.9),
            "mae_shadow": _mean([abs(x[1]) for x in v]), "mae_equal": _mean([abs(x[2]) for x in v]),
            "bias_shadow": _mean([x[1] for x in v]), "bias_equal": _mean([x[2] for x in v])}
    return out


# ---- rendering: markdown tables, aggregates only ------------------------------------------------------------------
def _f(x, nd=3, sign=False) -> str:
    if x is None:
        return "-"
    return f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}"


def _p(x) -> str:
    return "-" if x is None else f"{100 * x:.0f}%"


def _lead_label(lead) -> str:
    return "all" if lead == "all" else f"+{lead} h"


def _table(header: Sequence[str], body: Sequence[Sequence[str]]) -> List[str]:
    return ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)] + ["| " + " | ".join(r) + " |" for r in body]


def render_pairs(tab: dict) -> List[str]:
    head = ["cell", "lead", "n paired", "served MAE", "scalar MAE", "served - scalar", "served wins", "scalar wins",
            "ties", "scalar = served", "mean shift"]
    body = []
    for dim in ("pooled", "coast", "band"):
        for (group, lead), c in tab.get(dim, {}).items():
            if c.get("suppressed"):
                body.append([group, _lead_label(lead), "n<10"] + ["-"] * 8)
                continue
            body.append([group, _lead_label(lead), str(c["n"]), _f(c["mae_ref"]), _f(c["mae_cand"]), _f(c["delta"], 3, True),
                         _p(c["ref_wins"]), _p(c["cand_wins"]), _p(c["ties"]), _p(c["unchanged"]), _f(c["shift"], 3, True)])
    return _table(head, body)


def render_gate(g: dict) -> List[str]:
    lines = [f"**GATE: {g['verdict']}** - {g['why']}. Rule: no pooled, coast or forecast-height-band cell (each lead and all "
             f"leads) with n >= {g['min_n']} where the scalar lane's MAE exceeds the served lane's by more than "
             f"{g['max_loss']:.3f} m. Cells checked: {g['cells_checked']}.", "",
             "Deciding cells (violators, or if none the six closest to the line):", ""]
    return lines + _table(["cell", "lead", "n paired", "served - scalar (m)"],
                          [[f"{r['dim']}: {r['group']}", _lead_label(r["lead"]), str(r["n"]), _f(r["delta"], 4, True)]
                           for r in (g["violators"] or g["nearest"])])


def render_split(tab: dict) -> List[str]:
    head = ["cell", "lead", "n", "bias served", "bias scalar", "mean shift", "gain total", "gain, spread only",
            "gain, bias part", "gain if the shift were uniform", "structure / uniform"]
    body = []
    for dim in ("pooled", "coast", "band"):
        for (group, lead), c in tab.get(dim, {}).items():
            if c.get("suppressed") or (dim != "pooled" and lead != "all"):
                continue
            uni = c["gain_uniform"]
            body.append([group, _lead_label(lead), str(c["n"]), _f(c["bias_ref"], 3, True), _f(c["bias_cand"], 3, True),
                         _f(c["shift"], 3, True), _f(c["delta"], 4, True), _f(c["gain_spread"], 4, True),
                         _f(c["gain_bias"], 4, True), _f(uni, 4, True),
                         "-" if abs(uni) < 1e-4 else f"{c['delta'] / uni:.1f}x"])
    return _table(head, body)


def render_halves(h: dict) -> List[str]:
    body = []
    for name, per_lead in h.items():
        for lead, c in per_lead.items():
            body.append([name, _lead_label(lead)] + (["n<10"] + ["-"] * 3 if c.get("suppressed") else
                        [str(c["n"]), _f(c["delta"], 4, True), _p(c["ref_wins"]), _p(c["cand_wins"])]))
    return _table(["half of the target range", "lead", "n paired", "served - scalar", "served wins", "scalar wins"], body)


def render_three_way(name: str, t: dict) -> List[str]:
    if not t:
        return [f"No keys where served, scalar and {name} all scored the same observation."]
    body = []
    for lead, c in t.items():
        body.append([_lead_label(lead)] + (["n<10"] + ["-"] * 7 if c.get("suppressed") else
                    [str(c["n"]), _f(c["mae_served"]), _f(c["mae_scalar"]), _f(c["mae_ref"]), _f(c["served_minus_ref"], 3, True),
                     _f(c["scalar_minus_ref"], 3, True), _p(c["scalar_wins_vs_ref"]), _p(c["closed"])]))
    return _table(["lead", "n", "served MAE", "scalar MAE", "reference MAE", "served - ref", "scalar - ref",
                   "scalar wins vs ref", "share of the gap the scalar closes"], body)


def render_construction(con: dict, leads=(24, 48, 72), per_dim: int = 10) -> List[str]:
    body = []
    for lead in leads:
        by_dim: Dict[str, list] = defaultdict(list)
        for (dim, group, ld), c in con.items():
            if ld == lead:
                by_dim[dim].append((group, c))
        for dim, items in by_dim.items():
            items.sort(key=lambda gc: -(gc[1].get("n") or 0))
            for group, c in items[:per_dim]:
                body.append([_lead_label(lead), dim, group] + (["n<10"] + ["-"] * 7 if c.get("suppressed") else
                            [str(c["n"]), _f(c["signed_mean"], 3, True), _f(c["abs_median"]), _f(c["abs_p90"]),
                             _f(c["mae_shadow"]), _f(c["mae_equal"]), _f(c["bias_shadow"], 3, True),
                             _f(c["bias_equal"], 3, True)]))
    return _table(["lead", "grouped by", "group", "n", "shadow - equal (signed mean)", "abs median", "abs p90",
                   "shadow MAE", "equal MAE", "shadow bias", "equal bias"], body)


def render_report(info: dict, rows, min_n: int = GATE_MIN_N, max_loss: float = GATE_MAX_LOSS_M) -> str:
    """The whole report as markdown. `info` carries the counts the loader knows (rows read, window)."""
    tab = tables(rows)
    out = ["# Scored rows gate (ONE-OFF, read-only, aggregates only)", "",
           f"Window: targets {info.get('since', '?')} .. {info.get('until', 'now')}. Rows read: {info.get('rows_read', '?')}; "
           f"in window and in a graded lane: {len(rows)}. Cells below n=10 print `n<10`.", "",
           "## Gate", ""] + render_gate(gate(tab, min_n, max_loss)) + ["", "## Served vs raw_surf:GFS_SCALAR, paired", ""]
    out += render_pairs(tab)
    out += ["", "## Bias versus spread, and structure versus a uniform shift", "",
            "gain total = served MAE - scalar MAE. gain, spread only = the gain with both lanes debiased (mean error removed). "
            "gain, bias part = the remainder. gain if uniform = what shifting every served forecast by the same mean shift "
            "would have bought; structure / uniform > 1 means the shift lands where the errors are.", ""]
    out += render_split(tab)
    out += ["", "## Replication: first and second half of the target range", ""] + render_halves(halves(rows))
    for name, src in (("Open-Meteo same-model control (ncep_gfswave025)", CONTROL), ("Open-Meteo marine (best_match)", MARINE)):
        out += ["", f"## Served, scalar and {name}, same keys", ""] + render_three_way(name, three_way(rows, src))
    out += ["", "## Built CONSENSUS shadow vs the computed equal mean (+24 h is the control; +48/+72 h the defect)", ""]
    return "\n".join(out + render_construction(construction(rows))) + "\n"
