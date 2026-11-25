"""The tide build's inputs for the MLLW datum tester (gates/tide-mllw-tester-v1.md s10 item 1, s11, s12): its 80 frozen
monitor and reserve keys go into the table's point set, and at those keys the build writes `am_lp`, the long-period part
of the served A (FES Sa, Ssa, Mf, Mm and the long-period equilibrium), so the tester can remove it from both sides.

  am_lp(t) = A(t) - SP(t),  A = arms.fes_eval (the served arm), SP = arms.fes_parts(exclude=LP4).tide (short period)

The advisor's carry (ii): am - am_lp must equal the short-period synthesis (+ M) at a key, from the SAME evaluation.
check() proves it on every build at one key and records the result; a failed check drops am_lp (the tester is then
UNTESTABLE), it never fails the build. Also recorded once per build: each LP4 wave's amplitude at every monitor key
(half its range over a year, from that wave alone), the FES side of s10's amplitude record.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MLLW_STATIONS = HERE.parents[2] / "docs" / "weather-program" / "research" / "tide-mllw-tester-v1-stations.json"
LP4 = ("Sa", "Ssa", "Mf", "Mm")
CHECK_TOL_MM = 1                         # integer-mm rounding on both sides
EVAL_TOL_M = 1e-6


KILL_ENV = "TIDE_MLLW_TESTER_KEYS"


def keys_enabled():
    """The tester's monitor keys are in the build unless TIDE_MLLW_TESTER_KEYS=0 (the advisor's kill, item (d)): they make
    the tide AVAILABLE at cells no spot keys, a user-visible change, so they can be withdrawn without a code change."""
    import os
    return os.environ.get(KILL_ENV, "1") != "0"


def monitor_spots(path=MLLW_STATIONS):
    """[[lat, lng]] of every tester monitor and reserve key, so they are in the table."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return [list(v["key"][i]) for v in doc["strata"].values() for i in v["monitor"] + v["reserve"]]


def monitor_keys(key_str, path=MLLW_STATIONS):
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return sorted({key_str(tuple(v["key"][i])) for v in doc["strata"].values() for i in v["monitor"] + v["reserve"]})


def lp_mm(a, sp):
    """PURE: [int mm or None] of A - SP (no M: the long-period part only)."""
    if a is None or sp is None:
        return None
    return [None if not (math.isfinite(float(x)) and math.isfinite(float(y))) else int(round((float(x) - float(y)) * 1000.0))
            for x, y in zip(a, sp)]


def check(am_mm, lp, sp_levels_mm, a_eval, a_parts_sum):
    """PURE, carry (ii): (ok, detail). am - am_lp == SP + M within CHECK_TOL_MM at every hour, and the served A equals
    fes_parts' tide + lp within EVAL_TOL_M (one evaluation, same constituents and nodal corrections)."""
    worst_mm = max((abs((x - y) - z) for x, y, z in zip(am_mm, lp, sp_levels_mm)
                    if x is not None and y is not None and z is not None), default=None)
    worst_eval = max((abs(float(u) - float(v)) for u, v in zip(a_eval, a_parts_sum)), default=None)
    ok = worst_mm is not None and worst_mm <= CHECK_TOL_MM and worst_eval is not None and worst_eval <= EVAL_TOL_M
    return ok, {"worst_mm": worst_mm, "worst_eval_m": worst_eval, "tol_mm": CHECK_TOL_MM, "tol_eval_m": EVAL_TOL_M}


def build(keys_pts, boxes, times, a_by_key, m_by_key, arms, OR, log):
    """({key: am_lp mm}, check record, {key: {wave: amplitude m}}) at the tester's monitor keys."""
    mkeys = [k for k in monitor_keys(OR.key_str) if k in keys_pts]
    am_lp, check_rec, amps = {}, {"ok": False, "why": "no key with A and M"}, {}
    year = arms.to_np([datetime(2027, 1, 1, tzinfo=timezone.utc) + timedelta(hours=3 * i) for i in range(2920)])
    for k in mkeys:
        la, lo = keys_pts[k]
        box, a = boxes / OR.safe_dir(k), a_by_key.get(k)
        if a is None or not box.exists():
            continue
        try:
            parts = arms.fes_parts(box, la, lo, times, exclude=LP4)
        except Exception as e:                                                   # noqa: BLE001 - per key
            log(f"am_lp {k}: FES parts failed ({type(e).__name__})")
            continue
        if parts is None:
            continue
        sp = parts[0]
        am_lp[k] = lp_mm(a, sp)
        if not check_rec.get("ok") and check_rec.get("key") is None and m_by_key.get(k) is not None:
            full = arms.fes_parts(box, la, lo, times)
            ok, detail = check(OR.levels_mm(a, m_by_key[k]), am_lp[k], OR.levels_mm(sp, m_by_key[k]), a,
                               [t + p for t, p in zip(*full)] if full else [])
            check_rec = dict(detail, ok=ok, key=k)
        try:
            amps[k] = {w: (lambda t: round((float(max(t)) - float(min(t))) / 2.0, 4))(
                arms.fes_parts(box, la, lo, year, only=(w,))[0]) for w in LP4}
        except Exception as e:                                                   # noqa: BLE001 - recorded, not fatal
            amps[k] = {"error": type(e).__name__}
    if not check_rec.get("ok"):
        log(f"am_lp self-check FAILED ({check_rec}): am_lp dropped, the MLLW tester will be UNTESTABLE")
        am_lp = {}
    log(f"am_lp (long-period part, MLLW tester) at {len(am_lp)} of {len(mkeys)} monitor keys; check {check_rec}")
    return am_lp, check_rec, amps
