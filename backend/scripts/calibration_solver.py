"""CALIBRATION SOLVER — can the rating actually satisfy the owner's anchors?

WHY THIS EXISTS
---------------
The owner states calibration targets in plain language:

    "FL 2-3 ft clean = FAIR"                                    (2026-07-12)
    "a clean offshore 3-4 ft could read fair-good or good"      (2026-07-29)
    "We need pumping 6-8ft or 8-10ft surf in FL to be EPIC"     (2026-07-29)

Every previous attempt — mine included — answered these ONE AT A TIME, by computing a score and
eyeballing whether it looked right. That is how you ship a change that fixes one anchor and breaks
another without noticing. The anchors are a CONSTRAINT SYSTEM and the only honest question is
whether a feasible solution exists at all.

★★★ THE MOST IMPORTANT THING THIS TOOL CAN TELL YOU IS "NO". A solver that always returns a number
is useless; if the anchors are jointly unsatisfiable under the current functional form, that is the
finding, and no amount of parameter tuning will fix it.

WHAT IT SOLVES OVER
-------------------
Under CLEAN conditions (light dead-offshore wind, head-on swell) every gate is 1.0 and the composite
collapses to just two terms:

    score = 100 · size_score(h, R) · (W_WIND·1.0 + W_PERIOD·period_quality(Tp))
                  \\____ size ____/   \\_________ blend, a function of Tp alone _________/

so the free parameter is the size reference R. The solver sweeps R, and separately reports the
CEILING the blend imposes, which no value of R can lift.

⚠️ UNITS ARE THE WHOLE GAME. The owner's feet are what the APP DISPLAYS. If the displayed number
changes convention (Hs -> H1/10, see docs/research/SURF-FORECASTING-SCIENCE.md §1) then the same
anchor points at a different physical wave, so the solver takes the convention as an explicit input
and reports the answer under each. Getting this backwards silently inverts the result.

Usage:
    python backend/scripts/calibration_solver.py
    python backend/scripts/calibration_solver.py --convention h110
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import surf_rating as SR   # noqa: E402

FT = 0.3048
# Rayleigh: the mean of the highest tenth over the mean of the highest third. Accurate to -1.8% at
# the break point (Goda 2010); narrows inside SATURATED surf, so it applies where the depth cap is
# not binding. See the research catalogue §1a.
H110_OVER_HS = 1.27

# The 7 levels and their score windows, read from the engine so they cannot drift out of sync.
LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]


def level_window(name):
    """[lo, hi) score range that maps to `name`, discovered from the engine itself."""
    lo = hi = None
    for s in range(0, 1001):
        v = s / 10.0
        if SR.score_to_level(v) == name:
            if lo is None:
                lo = v
            hi = v
    return (lo, hi)


# THE OWNER'S ANCHORS. Feet are DISPLAYED surf height. Tp is the realistic Florida period for that
# swell — a 6-8 ft Florida day is a hurricane/nor'easter swell, not a 9 s windswell, so pinning them
# all at one period would be a strawman.
# ⚠️⚠️ EACH ANCHOR BELONGS TO A SPOT, AND SPOTS DO NOT SHARE A REFERENCE — that is the entire point
# of local calibration. An earlier version of this solver swept ONE global R across all of them and
# "proved" the anchors were unsatisfiable; it had simply required Florida and Pipeline to be the
# same beach. The `spot` column is load-bearing.
ANCHORS = [
    # (label, spot, displayed_ft, Tp_s, acceptable levels)
    ("FL 2-3 ft clean",           "FL", 2.5,  9.0, {"fair"}),
    ("FL 3-4 ft clean",           "FL", 3.5,  9.0, {"fair_good", "good"}),
    ("FL 4 ft is NOT epic",       "FL", 4.0,  9.0, {"fair", "fair_good", "good"}),
    ("FL 6-8 ft pumping",         "FL", 7.0, 11.0, {"epic"}),
    ("FL 8-10 ft pumping",        "FL", 9.0, 12.0, {"epic"}),
    # The counter-anchor: the same small day at a big-wave coast must NOT be good.
    ("2.5 ft at a big-wave spot", "BIG", 2.5, 14.0, {"very_poor", "poor", "poor_fair"}),
]
BIG_WAVE_REF = 2.5      # Pipeline-class p80, per the owner's original calibration note


def clean_score(h_m, tp_s, ref):
    """The composite under clean conditions — every gate 1.0, so size x blend is all that is left."""
    return 100.0 * SR.size_score(h_m, ref) * (
        SR.W_WIND * 1.0 + SR.W_PERIOD * SR.period_quality(tp_s))


def displayed_to_engine_m(ft, convention):
    """Convert a DISPLAYED foot value into the metres the engine's size_score consumes."""
    if convention == "hs":            # today: the displayed number IS the engine's Hs
        return ft * FT
    if convention == "h110":          # corrected: display is H1/10, engine still reasons in Hs
        return ft * FT / H110_OVER_HS
    raise ValueError(convention)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--convention", choices=["hs", "h110", "both"], default="both")
    args = ap.parse_args()

    print("=" * 104)
    print("CALIBRATION SOLVER — is there a size reference R that satisfies every owner anchor?")
    print("=" * 104)
    windows = {n: level_window(n) for n in LEVELS}
    print("level windows (read from the engine):")
    for n in LEVELS:
        lo, hi = windows[n]
        print(f"    {n:<11} [{lo:>5.1f} .. {hi:>5.1f}]")

    # ── THE CEILING NO REFERENCE CAN LIFT ───────────────────────────────────────────────────────
    print("\n" + "=" * 104)
    print("STEP 1 — THE BLEND CEILING.  size_score maxes at 1.0, so score <= 100 x blend(Tp).")
    print("=" * 104)
    epic_lo = windows["epic"][0]
    print(f"{'Tp':>5}{'period_q':>11}{'blend':>9}{'max score':>12}{'best reachable level':>24}")
    tp_for_epic = None
    for tp in (5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18):
        pq = SR.period_quality(float(tp))
        blend = SR.W_WIND * 1.0 + SR.W_PERIOD * pq
        mx = 100.0 * blend
        if tp_for_epic is None and mx >= epic_lo:
            tp_for_epic = tp
        print(f"{tp:>5}{pq:>11.3f}{blend:>9.3f}{mx:>12.1f}{SR.score_to_level(mx):>24}")
    print(f"\n  ==> EPIC (>= {epic_lo}) is UNREACHABLE below Tp ~ {tp_for_epic} s, at ANY wave size,")
    print("      with PERFECT wind. This is a property of the functional form, not of tuning.")

    # ── SWEEP THE REFERENCE ─────────────────────────────────────────────────────────────────────
    for convention in (["hs", "h110"] if args.convention == "both" else [args.convention]):
        print("\n" + "=" * 104)
        print(f"STEP 2 — SWEEP THE SIZE REFERENCE R.  displayed-height convention = {convention.upper()}"
              + ("  (today)" if convention == "hs" else "  (corrected to the published standard)"))
        print("=" * 104)
        fl_anchors = [a for a in ANCHORS if a[1] == "FL"]
        big_anchors = [a for a in ANCHORS if a[1] == "BIG"]

        print(f"{'R_FL (m)':>9}" + "".join(f"{a[0][:17]:>19}" for a in fl_anchors) + f"{'  met':>8}")
        best = []
        for i in range(0, 41):
            R = None if i == 0 else 0.30 + 0.05 * (i - 1)
            cells, met = [], 0
            for label, _spot, ft, tp, ok_levels in fl_anchors:
                s = clean_score(displayed_to_engine_m(ft, convention), tp, R)
                lvl = SR.score_to_level(s)
                ok = lvl in ok_levels
                met += 1 if ok else 0
                cells.append(f"{s:>6.1f} {lvl[:9]:<9}{'*' if ok else ' '}")
            rlabel = "global" if R is None else f"{R:.2f}"
            line = f"{rlabel:>9}" + "".join(f"{c:>19}" for c in cells) + f"{met:>5}/{len(fl_anchors)}"
            best.append((met, R, line))
            if R is None or abs((R * 100) % 20) < 1e-6:
                print(line)

        feasible = [t for t in best if t[0] == len(fl_anchors)]
        if feasible:
            lo = min(t[1] for t in feasible if t[1] is not None) if any(
                t[1] is not None for t in feasible) else None
            hi = max(t[1] for t in feasible if t[1] is not None) if any(
                t[1] is not None for t in feasible) else None
            print(f"\n  ✅ FEASIBLE: {len(feasible)} reference values satisfy ALL "
                  f"{len(fl_anchors)} Florida anchors"
                  + (f", R in [{lo:.2f} .. {hi:.2f}] m" if lo is not None else " (global)"))
            for t in feasible[:1] + ([feasible[len(feasible) // 2]] if len(feasible) > 2 else []):
                print("     " + t[2].strip())
        else:
            top = sorted(best, key=lambda t: -t[0])[0]
            print(f"\n  ⛔ NO reference satisfies all {len(fl_anchors)} Florida anchors "
                  f"(best {top[0]}). Failures at R="
                  f"{'global' if top[1] is None else f'{top[1]:.2f}'}:")
            for label, _spot, ft, tp, ok in fl_anchors:
                s = clean_score(displayed_to_engine_m(ft, convention), tp, top[1])
                lvl = SR.score_to_level(s)
                if lvl not in ok:
                    print(f"      FAIL  {label:<24} {ft:>4.1f} ft @ {tp:>4.1f} s -> "
                          f"{s:>5.1f} {lvl:<10} (want {'/'.join(sorted(ok))})")

        print(f"\n  counter-anchor, big-wave spot at its OWN reference R={BIG_WAVE_REF}:")
        for label, _spot, ft, tp, ok in big_anchors:
            s = clean_score(displayed_to_engine_m(ft, convention), tp, BIG_WAVE_REF)
            lvl = SR.score_to_level(s)
            print(f"      {'PASS' if lvl in ok else 'FAIL'}  {label:<26} -> {s:>5.1f} {lvl}"
                  f"   (want {'/'.join(sorted(ok))})")

    # ── WHAT WOULD IT TAKE ──────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 104)
    print("STEP 3 — WHAT WOULD MAKE THE EPIC ANCHOR REACHABLE IN FLORIDA?")
    print("=" * 104)
    print("  The blend is 0.60*wind + 0.40*period with period graded ABSOLUTELY against a 15 s")
    print("  ideal. Florida's best swells run 10-12 s, so its blend ceiling is:")
    for tp in (10, 11, 12):
        blend = SR.W_WIND + SR.W_PERIOD * SR.period_quality(float(tp))
        print(f"      Tp {tp:>2} s -> blend {blend:.3f} -> max score {100*blend:>5.1f} "
              f"({SR.score_to_level(100*blend)})")
    print("\n  Option A — grade period RELATIVE to the spot (the same principle as local size).")
    print("      If Florida's own p80 period counted as a 'fully working' period:")
    for pq_local in (0.60, 0.75, 0.90, 1.00):
        blend = SR.W_WIND + SR.W_PERIOD * pq_local
        print(f"      period_q {pq_local:.2f} -> blend {blend:.3f} -> max {100*blend:>5.1f} "
              f"({SR.score_to_level(100*blend)})")
    print("\n  Option B — re-weight the blend toward size (W_WIND/W_PERIOD are "
          f"{SR.W_WIND}/{SR.W_PERIOD} today).")
    print("  Option C — leave EPIC globally absolute and accept that Florida tops out at GOOD.")
    print("      ⚠️ This is a PRODUCT decision, not a physics one, and it contradicts the owner's")
    print("      stated anchor. It is listed so the choice is explicit rather than accidental.")


if __name__ == "__main__":
    main()
