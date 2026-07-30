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
import re
import sys

# The report uses arrows, stars and box-drawing. A Windows console hands Python a cp1252 stdout,
# which cannot encode any of them, so an unguarded print dies mid-report with a traceback — this
# script did exactly that at its SECOND row. An audit that only runs on the author's terminal is
# not an audit, so make output encoding-proof in two independent layers: ask for real UTF-8, and
# transliterate if that is refused.
_ASCII = {
    "—": "--", "─": "-", "★": "*", "⚠": "!", "️": "",
    "⇒": "=>", "→": "->", "≈": "~", "·": ".", "§": "S",
    "✓": "y", "✗": "n", "×": "x", "≥": ">=", "≤": "<=",
}


class _EncodingProofStdout:
    """Wraps stdout so a console that cannot represent a character degrades it instead of
    aborting the run. Inert when the stream already speaks UTF-8."""

    def __init__(self, stream):
        self._stream = stream

    def write(self, text):
        try:
            return self._stream.write(text)
        except UnicodeEncodeError:
            for uni, plain in _ASCII.items():
                text = text.replace(uni, plain)
            return self._stream.write(text.encode("ascii", "replace").decode("ascii"))

    def __getattr__(self, name):
        return getattr(self._stream, name)


try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except (AttributeError, OSError, ValueError, LookupError):
    pass
sys.stdout = _EncodingProofStdout(sys.stdout)

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
    "RATING_OBS_GATE":    ("0", "Good/Epic require confirmation (the published Surfline rule: their "
                                "model never assigns the top two levels). NOT starved -- the ~14 "
                                "user reports are only ONE path; >=2 of GFS/EURO/ICON agreeing is "
                                "the other and needs no reports. Measured 2026-07-30 on 10,638 live "
                                "spot-hours: 274 capped (2.6%), 79% of good/epic survives, nothing "
                                "at or below fair moves."),
    "RATING_TIDE":        ("0", "Tide state on every rated spot + tide_fit where a best_tide prior "
                                "exists. ⚠️ measured 2026-07-29: 38 of 1,773 active spots (2.14%) "
                                "carry that prior, so the FACTOR moves ~2% of spots -- but the tide "
                                "STATE is attached to every rated spot, so a lane split changes the "
                                "response SHAPE catalogue-wide, not just those 38."),
    "RATING_BREAKER_TYPE": ("0", "Iribarren breaker-type factor."),
    "SURF_PARTITIONS":    ("0", "Spectral: transform each swell train on its own period/bearing."),
    "SURF_HEIGHT_H110":   ("0", "Emit the PUBLISHED surf statistic (H1/10) instead of Hs. "
                                "~21% under-read today. Flip WITH a re-solved size reference."),
    "SURF_BREAK_DEPTH":   ("1", "Use the nearshore break depth for the depth-limited cap."),
    "SURF_TRANSFORM":     ("1", "The whole nearshore transform."),
}

CHECK_RENDER = False
results = []


def check(name, status, detail, source=""):
    results.append({"check": name, "status": status, "detail": detail, "source": source})


# ── 1. FLAGS ────────────────────────────────────────────────────────────────────────────────────

def _workflow_flag(flag):
    """What the INGEST lanes set this flag to, from the workflow files. {} when they leave it alone.

    ⚠️ Reporting only `os.environ` was actively misleading. This audit printed `RATING_TIDE OFF`
    while BOTH ingest lanes had set it to '1' since 2026-07-18 — so every precomputed frame (which
    is authoritative for glyphs) already had tide baked in, and the one command meant to say what is
    true said the opposite. A flag has a value PER LANE, not one value.
    """
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = {}
    for lane in ("forecast-ingest.yml", "precompute.yml"):
        path = os.path.join(root, ".github", "workflows", lane)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(rf"\s+{re.escape(flag)}:\s*'([^']*)'", line)
                if m:
                    out[lane] = m.group(1)
                    break
    return out


_render_cache = {}


def _render_flags():
    """Science flags actually set on the Render service, or None when unreadable.

    ⚠️ OPT-IN (`--render`). This script's contract is zero-credential and zero-network so it can run
    in CI and always answer the same way; reading Render breaks both, so it never happens by default.

    ★ Worth the opt-in, because Render is the SERVE lane and its absence from git is exactly why a
    split hid for 11 days: `RATING_TIDE` is '1' in both ingest workflows and UNSET on Render, so the
    precomputed frames carry tide and the live path does not.
    """
    if "flags" in _render_cache:
        return _render_cache["flags"]
    _render_cache["flags"] = None
    key = os.environ.get("RENDER_API_KEY", "")
    service = os.environ.get("RENDER_SERVICE_ID", "srv-d7fhiu7lk1mc73debje0")
    if not key:
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
        try:
            with open(env_path, encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("RENDER_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip("'\"")
                        break
        except OSError:
            pass
    if not key:
        return None
    try:
        import requests
        resp = requests.get(f"https://api.render.com/v1/services/{service}/env-vars?limit=100",
                            headers={"Authorization": f"Bearer {key}"}, timeout=15)
        if resp.status_code != 200:
            return None
        rows = resp.json()
        out = {}
        for row in rows:
            ev = row.get("envVar", row)
            k = ev.get("key", "")
            if k.startswith(("RATING_", "SURF_")):
                out[k] = ev.get("value")
        _render_cache["flags"] = out
        return out
    except Exception:
        return None


def audit_flags():
    render = _render_flags() if CHECK_RENDER else None
    for flag, (default, why) in SCIENCE_FLAGS.items():
        lanes = _workflow_flag(flag)
        lane_vals = sorted(set(lanes.values()))

        # A flag has a value PER LANE. Reporting one number was how a live split hid for 11 days.
        if CHECK_RENDER:
            serve = (render or {}).get(flag, default if render is not None else None)
            serve_txt = "unreadable" if serve is None else f"serve {serve}"
        else:
            serve = None
            serve_txt = "serve not checked (--render)"

        ingest_txt = ("ingest " + lane_vals[0] if len(lane_vals) == 1
                      else "ingest SPLIT " + ", ".join(f"{k}={v}" for k, v in sorted(lanes.items()))
                      if lane_vals else "ingest default")

        # The comparison that matters: do the lanes that WRITE frames agree with the lane that SERVES
        # them? Disagreement means two surfaces answer the same question differently.
        status = INFO
        note = ""
        if len(lane_vals) > 1:
            status = FAIL
            note = "  <- the two ingest lanes disagree"
        elif lane_vals and serve is not None and lane_vals[0] != serve:
            status = FAIL
            note = (f"  <- LANE SPLIT: ingest writes frames with {flag}={lane_vals[0]}, "
                    f"the serve lane uses {serve}")

        check(f"flag:{flag}", status, f"{ingest_txt} | {serve_txt}{note}  {why}",
              "backend/tests/test_flag_lane_parity.py" if lanes else "env")


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
        # ⛔ DO NOT "FIX" THIS ALONE. Two measured errors of opposite sign very nearly cancel, so the
        # DISPLAYED height is currently within ~1% of correct even though both halves are wrong:
        #   * the transform assumes no refraction. Measured Kr = 0.797 against CDIP instruments
        #     (validate_nearshore_transform.py, 385,651 QC-good swell hours, 10 sites) => we
        #     over-predict nearshore height by 1/0.797 = +25.5%.
        #   * we emit Hs where the standard is H1/10 => we are 1 - 1/1.27 = -21.3% low.
        #   * net displayed / correct = (1/0.797) / 1.27 = 0.988, i.e. -1.2%.
        # Flipping SURF_HEIGHT_H110 by itself multiplies every height by 1.27 and lands +25.5% HIGH.
        # Fixing Kr by itself lands -21.3% LOW. They ship together or not at all.
        kr = 0.797
        net = (1.0 / kr) / SHC.H110_OVER_HS
        check("height_statistic", OPEN,
              f"emitting Hs, not the published H1/10 (x{SHC.H110_OVER_HS}). ⛔ BUT DO NOT FLIP IT "
              f"ALONE: the transform also over-predicts by {100*(1/kr-1):.1f}% (measured Kr={kr} vs "
              f"CDIP), so what we DISPLAY is {net:.3f}x correct ({100*(net-1):+.1f}%) -- accidentally "
              f"right. SURF_HEIGHT_H110 alone = +{100*(1/kr-1):.1f}% too high; a Kr fix alone = "
              f"{100*(1/SHC.H110_OVER_HS-1):.1f}% too low. Ship BOTH, with a re-solved size reference.",
              "backend/scripts/validate_nearshore_transform.py + SURF-FORECASTING-SCIENCE.md §1")
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
    ap.add_argument("--render", action="store_true",
                    help="also read the Render service's env vars (the SERVE lane) and report any "
                         "lane split. Needs RENDER_API_KEY and network, so it is opt-in - without "
                         "it this script stays credential-free and offline.")
    args = ap.parse_args()

    global CHECK_RENDER
    CHECK_RENDER = args.render

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
