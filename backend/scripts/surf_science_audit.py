"""SURF SCIENCE AUDIT — the whole forecast chain's health in one command.

WHY THIS EXISTS
---------------
Every finding in this project has had to be re-derived from scratch by whoever looked next, because
the evidence lived in commit messages, handoff docs and chat logs rather than in something you can
RUN. Three separate sessions rediscovered that Florida reads low. Two rediscovered that a flag was
off. One (mine) reported a number that was the answer to a different question.

This is the antidote: a single deterministic command that prints what is true right now — which
flags are live, whether the owner's calibration anchors pass, and which known defects are still
open. It takes no arguments, needs no credentials, and makes no network calls, so it can run in CI
or on a laptop and always answers the same way.

    python backend/scripts/surf_science_audit.py
    python backend/scripts/surf_science_audit.py --json     # machine-readable

★ EVERY CHECK CITES ITS SOURCE — a commit, a measurement, or a line in
`docs/research/SURF-FORECASTING-SCIENCE.md`. A check that cannot say where its expectation came
from is an opinion, and does not belong here.

⚠️ This audits the SCIENCE (the scoring function and its calibration). It does not audit data
freshness or ingest health — that is `/admin/surf-forecast/status`.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.conditions_labels import get_conditions_label            # noqa: E402
from services.weather_pipeline import surf_height_convention as SHC    # noqa: E402
from services.weather_pipeline import surf_rating as SR                # noqa: E402
from services.weather_pipeline.local_size_preview import anchor_report  # noqa: E402

FT = 0.3048
OK, FAIL, OPEN, INFO = "PASS", "FAIL", "OPEN", "info"

# Flags that change the SCIENCE (not ingest/plumbing), with why they matter.
SCIENCE_FLAGS = {
    "RATING_LOCAL_SIZE":  ("0", "Grades size against the SPOT's own good day instead of a global "
                                "1.2 m. Fixes 4ft==10ft saturation AND the owner's '4 ft is not "
                                "epic' anchor."),
    "RATING_OBS_GATE":    ("0", "Good/Epic require an observation (the published Surfline rule). "
                                "⚠️ starved: ~14 usable observations exist in production."),
    "RATING_TIDE":        ("0", "Tide-fit factor. ⚠️ only 1.0% of spots carry the best_tide prior."),
    "RATING_BREAKER_TYPE": ("0", "Iribarren breaker-type factor."),
    "SURF_PARTITIONS":    ("0", "Spectral: transform each swell train on its own period/bearing."),
    "SURF_HEIGHT_H110":   ("0", "Emit the PUBLISHED surf statistic (H1/10) instead of Hs. "
                                "~21% under-read today. Flip WITH a re-solved size reference."),
    "SURF_BREAK_DEPTH":   ("1", "Use the nearshore break depth for the depth-limited cap."),
    "SURF_TRANSFORM":     ("1", "The whole nearshore transform."),
}

results = []


def check(name, status, detail, source=""):
    results.append({"check": name, "status": status, "detail": detail, "source": source})


# ── 1. FLAGS ────────────────────────────────────────────────────────────────────────────────────

def audit_flags():
    for flag, (default, why) in SCIENCE_FLAGS.items():
        val = os.environ.get(flag, default)
        check(f"flag:{flag}", INFO, f"{'ON ' if val != '0' else 'OFF'}  {why}", "env")


# ── 2. THE OWNER'S CALIBRATION ANCHORS ──────────────────────────────────────────────────────────

def audit_anchors():
    live_ref = None if os.environ.get("RATING_LOCAL_SIZE", "0") == "0" else 0.75
    rep = anchor_report(live_ref)
    label = "global 1.2 m" if live_ref is None else f"local {live_ref} m"
    status = OK if rep["passed"] == rep["total"] else FAIL
    check("owner_anchors", status,
          f"{rep['passed']}/{rep['total']} pass at the LIVE reference ({label})",
          "backend/tests/test_owner_calibration_anchors.py")
    for a in rep["anchors"]:
        if not a.get("pass"):
            check(f"  anchor:{a['anchor']}", FAIL,
                  f"{a['displayed_ft']} ft @ {a['period_s']}s -> {a['score']} {a['level']}; "
                  f"owner expects {'/'.join(a['owner_expects'])}", "owner statement")
    if live_ref is None:
        alt = anchor_report(0.75)
        if alt["passed"] > rep["passed"]:
            check("owner_anchors:remedy", OPEN,
                  f"a local reference would pass {alt['passed']}/{alt['total']} "
                  f"(vs {rep['passed']} today) — flip RATING_LOCAL_SIZE",
                  "backend/scripts/calibration_solver.py")


# ── 3. DYNAMIC RANGE — does size still carry information above the reference? ────────────────────

def audit_dynamic_range():
    ref = None if os.environ.get("RATING_LOCAL_SIZE", "0") == "0" else 0.75
    scores = {ft: SR.compute_surf_rating(ft * FT, 9.0, 2.0, 270.0, 90.0, 90.0,
                                         reference_size_m=ref)[0]
              for ft in (4, 6, 8, 10, 12)}
    distinct = len(set(scores.values()))
    if distinct == 1:
        check("dynamic_range", FAIL,
              f"4/6/8/10/12 ft ALL score {list(scores.values())[0]} — size_score has saturated and "
              f"carries no information above ~3.9 ft",
              "docs/runbooks/ANALYSIS-2026-07-29-the-rating-has-a-dynamic-range-problem.md")
    else:
        check("dynamic_range", OK,
              f"size still discriminates across 4-12 ft ({distinct} distinct scores: "
              f"{list(scores.values())})", "same")


# ── 4. HEIGHT STATISTIC — are we emitting what we claim to? ─────────────────────────────────────

def audit_height_statistic():
    d = SHC.describe()
    if d["surf_height_statistic"] == "H1/10":
        check("height_statistic", OK,
              "emitting H1/10, the published surf standard", d["standard_reference"])
    else:
        check("height_statistic", OPEN,
              "emitting Hs (mean of the highest THIRD) but labelling it on a FACE-height ladder and "
              f"grading it as surf; the standard is H1/10 = {SHC.H110_OVER_HS}x Hs "
              f"(~{100*(1-1/SHC.H110_OVER_HS):.0f}% under-read). Flip SURF_HEIGHT_H110 WITH a "
              "re-solved size reference.", "docs/research/SURF-FORECASTING-SCIENCE.md §1")
    # The ladder itself should match the industry face scale — cheap, and it has been wrong before.
    expect = [(1.5, "Ankle High"), (2.5, "Knee High"), (3.5, "Waist High"), (4.5, "Chest High"),
              (5.5, "Head High"), (7.0, "Overhead"), (12.0, "Double Overhead")]
    bad = [(ft, get_conditions_label(ft), want) for ft, want in expect
           if get_conditions_label(ft) != want]
    check("size_ladder", OK if not bad else FAIL,
          "matches the industry face-height scale" if not bad else f"drifted: {bad}",
          "docs/research/SURF-FORECASTING-SCIENCE.md §2")


# ── 5. THE VETOES — can each factor that must say NO actually say it? ────────────────────────────

def audit_vetoes():
    """★ Three separate defects were the same shape: an ADDITIVE term with a floor cannot veto.
    Each fix made a factor MULTIPLY. This re-checks all three are still able to reach ~0."""
    base = dict(tp_s=12.0, wind_speed_ms=2.0, wind_from_deg=270.0, shore_normal_deg=90.0,
                swell_from_deg=90.0)
    clean = SR.rating_score(1.2, **base)
    cases = [
        ("wind_gate", SR.rating_score(1.2, tp_s=12.0, wind_speed_ms=20.0, wind_from_deg=90.0,
                                      shore_normal_deg=90.0, swell_from_deg=90.0),
         "a 40 kt onshore gale"),
        ("period_gate", SR.rating_score(1.2, tp_s=3.0, wind_speed_ms=2.0, wind_from_deg=270.0,
                                        shore_normal_deg=90.0, swell_from_deg=90.0),
         "a 3-second ripple"),
        ("swell_exposure", SR.rating_score(1.2, tp_s=12.0, wind_speed_ms=2.0, wind_from_deg=270.0,
                                           shore_normal_deg=90.0, swell_from_deg=270.0),
         "swell from behind the beach"),
    ]
    for name, score, desc in cases:
        ratio = score / clean if clean else 0.0
        check(f"veto:{name}", OK if ratio < 0.55 else FAIL,
              f"{desc}: {clean:.1f} -> {score:.1f} ({100*ratio:.0f}% of clean)",
              "the three-veto arc: 817379da / 3304c909 / f76f8f36")


# ── 6. STRUCTURAL CEILINGS — facts about the functional form, not tuning ─────────────────────────

def audit_ceilings():
    epic_lo = next(s / 10.0 for s in range(0, 1001) if SR.score_to_level(s / 10.0) == "epic")
    tp_epic = None
    for tp in [t / 2 for t in range(8, 40)]:
        if 100.0 * (SR.W_WIND + SR.W_PERIOD * SR.period_quality(tp)) >= epic_lo:
            tp_epic = tp
            break
    check("ceiling:epic_needs_period", INFO,
          f"epic starts at {epic_lo}; with PERFECT wind and ANY size it is unreachable below "
          f"Tp ~{tp_epic} s. A short-period coast tops out below epic by construction.",
          "backend/scripts/calibration_solver.py step 1")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    audit_flags()
    audit_anchors()
    audit_dynamic_range()
    audit_height_statistic()
    audit_vetoes()
    audit_ceilings()

    if args.json:
        print(json.dumps({"results": results}, indent=2))
        return 0

    print("=" * 108)
    print("SURF SCIENCE AUDIT")
    print("=" * 108)
    width = max(len(r["check"]) for r in results) + 2
    for r in results:
        tag = {OK: "[PASS]", FAIL: "[FAIL]", OPEN: "[OPEN]", INFO: "[    ]"}[r["status"]]
        print(f"{tag} {r['check']:<{width}} {r['detail']}")
        if r["source"] and r["status"] in (FAIL, OPEN):
            print(f"       {'':<{width}} source: {r['source']}")

    n_fail = sum(1 for r in results if r["status"] == FAIL)
    n_open = sum(1 for r in results if r["status"] == OPEN)
    print("=" * 108)
    print(f"{n_fail} failing · {n_open} open · "
          f"{sum(1 for r in results if r['status'] == OK)} passing")
    if n_fail:
        print("\n⇒ FAILING checks are the rating disagreeing with the owner's stated calibration,")
        print("  or a defect with a measured fix. Start there.")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
