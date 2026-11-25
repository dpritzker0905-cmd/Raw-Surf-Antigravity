"""tide-a-harcon-v2 (gates/tide-a-harcon-v2.md §4-§7, §11, §12): the fixed C2 bars, the 6-min identity, the planted
breaks and their FAIL rule, the pre-flight's PASS/STOP rule and identities-only scope, the half-open disjoint windows,
the scorer's v2 mode, the pre-flight gate on the v2 run, and the workflow."""
import ast
import json
import math
import os
import sys
from datetime import timedelta

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(HERE, "..", "scripts", "tide_datum")
sys.path.insert(0, TD)
sys.path.insert(0, HERE)
import a_harcon_v2 as V2  # noqa: E402
import a_harcon_score as S  # noqa: E402
import a_harcon_v2_preflight_ok as OK  # noqa: E402
import test_a_harcon_instrument as A  # noqa: E402

REPO = os.path.join(HERE, "..", "..")


# ---- the bars and the windows ---------------------------------------------------------------------------------------
def test_the_c2_bars_are_the_gate_texts_fixed_values():
    assert (V2.BAR_H_M, V2.BAR_T_MIN, V2.GRID_MIN) == (0.05, 10.0, 6)
    gate = open(os.path.join(REPO, "docs", "weather-program", "gates", "tide-a-harcon-v2.md"), encoding="utf-8").read()
    assert "median |h| ≤ 0.05 m AND median |t| ≤ 10 min" in gate


def test_the_two_windows_are_half_open_and_share_no_hour():
    pre, v2 = V2.hours_in(V2.PREFLIGHT_START), V2.hours_in(V2.V2_START)
    assert not pre & v2 and len(pre) == len(v2) == 14 * 24
    assert max(pre) + timedelta(hours=1) == min(v2)                       # adjacent, half-open: [07-01, 07-15) | [07-15, ...)
    assert min(v2).isoformat() == "2027-07-15T00:00:00+00:00"


# ---- a synthetic station: M2 + K1 constants and a synthesis like harcon_eval's --------------------------------------
HC = [(1, "M2", 1.0, 40.0, 28.9841042), (2, "K1", 0.3, 120.0, 15.0410686)]


def synth(consts, times):
    t0 = times[0]
    out = []
    for t in times:
        hrs = (t - t0).total_seconds() / 3600.0
        out.append(sum(a * math.cos(math.radians(sp * hrs - g)) for _, _, a, g, sp in consts))
    return out


def truth(consts=HC):
    day0, stop = V2.window(V2.PREFLIGHT_START)
    times = V2.grid(day0, stop)
    from services.weather_pipeline import tide as T
    vals = synth(consts, times)
    ev = T.tide_extrema([t.strftime("%Y-%m-%dT%H:%M") for t in times], vals)
    inside = [v for v, t in zip(vals, times) if day0 <= t < stop]
    mean = sum(inside) / len(inside)
    return [(e["time"], e["type"], e["level_m"]) for e in ev if day0 <= e["time"] < stop], mean, day0, stop


def status(transform=None, shift=0, consts=HC):
    hilo, mean, day0, stop = truth(consts)
    rows = V2.c2_rows(consts, hilo, mean, day0, stop, synth, transform, shift)
    return V2.c2_status(rows)[0] if rows is not None else "untestable"


def test_the_unplanted_identity_passes_on_the_6min_grid():
    assert status() == "pass"


def test_s12_a_zero_match_plus90_break_counts_as_FAIL():
    """+90 deg moves M2 events ~3.1 h, beyond match_events' 3 h window: NOTHING matches, C2 reads 'untestable', and
    under s12 that planted break FAILS C2 (it is NOT a pass that would VOID the run)."""
    hilo, mean, day0, stop = truth()
    rows = V2.c2_rows(HC, hilo, mean, day0, stop, synth, V2.phase_plus90)
    st_, detail = V2.c2_status(rows)
    assert st_ in ("untestable", "mismatch") and V2.plant_fails(st_)
    assert V2.plant_fails("untestable") and V2.plant_fails("mismatch") and not V2.plant_fails("pass")
    only = [(1, "M2", 1.0, 40.0, 28.9841042)]                    # M2-dominated: +90 deg = +3.1 h, past the 3 h window
    hilo, mean, day0, stop = truth(only)
    rows = V2.c2_rows(only, hilo, mean, day0, stop, synth, V2.phase_plus90)
    assert V2.c2_status(rows) == ("untestable", {"matched": 0, "n": len(rows)}) and len(rows) > 20
    assert V2.plant_fails(V2.c2_status(rows)[0])                 # zero matches is a FAIL of the plant, never a pass


@pytest.mark.parametrize("name", list(V2.C5_PLANTS))
def test_every_c5_plant_fails_c2(name):
    f, sh = V2.C5_PLANTS[name]
    assert V2.plant_fails(status(f, sh))


@pytest.mark.parametrize("name", list(V2.PREFLIGHT_PLANTS))
def test_every_preflight_plant_fails_c2_here(name):
    f, sh = V2.PREFLIGHT_PLANTS[name]
    assert V2.plant_fails(status(f, sh))


def test_why_p1_is_plus90_a_sign_flip_at_g_zero_passes():
    """s11: negating G = 0 changes nothing, so a sign-flip plant can PASS C2 (and would VOID a sound run as C5)."""
    zero = [(1, "M2", 1.0, 0.0, 28.9841042)]
    assert status(V2.phase_flip, consts=zero) == "pass"
    assert V2.plant_fails(status(V2.phase_plus90, consts=zero))


def test_dropping_m2_at_an_m2_only_station_leaves_nothing_and_fails():
    only = [(1, "M2", 1.0, 40.0, 28.9841042)]
    assert V2.drop_m2(only) == [] and V2.plant_fails(status(V2.drop_m2, consts=only))


# ---- C5 and the pre-flight verdict -----------------------------------------------------------------------------------
def test_c5_is_void_only_a_plant_that_passes_or_is_missing_fails_it():
    allfail = {n: "mismatch" for n in V2.C5_PLANTS}
    assert V2.c5_verdict({"A": allfail, "B": dict(allfail, P1_phase_plus90="untestable")})["pass"]
    assert not V2.c5_verdict({"A": dict(allfail, P2_amp_x100="pass")})["pass"]
    assert not V2.c5_verdict({"A": {"P1_phase_plus90": "mismatch"}})["pass"]             # a plant missing


def _records(n=300, over=0, miss=None):
    recs = {}
    for i in range(n):
        plants = {k: "mismatch" for k in V2.PREFLIGHT_PLANTS}
        for name, k in (miss or {}).items():
            if i < k:
                plants[name] = "pass"
        recs[f"S{i}"] = {"c2": "mismatch" if i < over else "pass", "plants": plants}
    return recs


def test_preflight_pass_and_every_stop_rule():
    assert V2.preflight_verdict(_records(300, over=3))["status"] == "PASS"                # 1 % over is allowed
    assert V2.preflight_verdict(_records(300, over=4))["status"] == "STOP"
    assert V2.preflight_verdict(_records(299))["status"] == "STOP"
    assert V2.preflight_verdict(_records(300, miss={"ii_phase_flip": 15}))["status"] == "PASS"   # 95 % exactly
    v = V2.preflight_verdict(_records(300, miss={"ii_phase_flip": 16}))
    assert v["status"] == "STOP" and len(v["plants"]["ii_phase_flip"]["misses"]) == 16
    untested = dict(_records(300), X={"c2": "untestable", "plants": {}})
    assert V2.preflight_verdict(untested)["tested"] == 300                                # untestable is not tested


def test_the_preflight_computes_only_identities_never_a_candidate_arm():
    src = open(os.path.join(TD, "a_harcon_v2_preflight.py"), encoding="utf-8").read()
    names = {n.id for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Name)} | \
            {n.attr for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Attribute)}
    forbidden = {"fes_eval", "blend", "weight", "donor_prefix", "subset_wrapped", "download_fes", "legs", "bar",
                 "candidates", "score"}
    assert not names & forbidden, names & forbidden
    imports = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.ImportFrom) and n.module == "a_harcon_parity"]
    assert [a.name for n in imports for a in n.names] == ["truth_at"]                     # the NOAA truth fetch only


# ---- the scorer's v2 mode ----------------------------------------------------------------------------------------
def _v2_run(c2=(0.03, 5.0), c5="mismatch"):
    per = A.run()["per_station"]
    for sid, row in per.items():
        row["c2_station"] = {"rows": A.rows(*c2)}
        for d in row.get("donors") or []:
            d["c2_donor"] = {"rows": A.rows(*c2)}
        row["c5"] = {n: c5 for n in V2.C5_PLANTS}
    return {"per_station": per, "window_start": V2.V2_START, "complete": True}


def test_v2_scores_c2_with_the_fixed_bars_and_v1_does_not():
    run = _v2_run()
    assert S.score(run, A.finder(), A.held(), v2=True)["verdict"] == "PASS"
    assert S.score(run, A.finder(), A.held())["verdict"] == "VOID"                         # v1's 0.01 m bar
    big = _v2_run(c2=(0.08, 5.0))
    assert S.score(big, A.finder(), A.held(), v2=True)["verdict"] == "VOID"                # over 0.05 m: a tested mismatch


def test_v2_a_plant_that_passes_c2_voids_the_run():
    r = S.score(_v2_run(c5="pass"), A.finder(), A.held(), v2=True)
    assert r["verdict"] == "VOID" and not r["controls"]["c5_planted"]["pass"]
    r = S.score(_v2_run(c5="untestable"), A.finder(), A.held(), v2=True)                   # s12: a zero-match plant fails
    assert r["verdict"] == "PASS" and r["controls"]["c5_planted"]["pass"]


# ---- the pre-flight gate on the v2 run ------------------------------------------------------------------------------
def test_the_v2_run_refuses_without_a_recomputable_preflight_pass(tmp_path):
    p = tmp_path / "r.json"
    assert not OK.check(p)[0]
    recs = _records(300)
    p.write_text(json.dumps({"complete": True, "records": recs, "verdict": V2.preflight_verdict(recs)}), encoding="utf-8")
    assert OK.check(p)[0]
    bad = _records(300, over=10)
    p.write_text(json.dumps({"complete": True, "records": bad, "verdict": {"status": "PASS"}}), encoding="utf-8")
    assert not OK.check(p)[0]                                                              # an edited status cannot pass


def test_the_workflow_runs_the_preflight_then_a_gated_v2_run():
    wf = open(os.path.join(REPO, ".github", "workflows", "tide-a-harcon-v2.yml"), encoding="utf-8").read()
    assert "tags: ['tide-a-harcon-v2-preflight-[0-9]*', 'tide-a-harcon-v2-[0-9]*']" in wf
    assert "schedule:" not in wf and "workflow_dispatch" not in wf and "branches:" not in wf
    assert wf.count("a_harcon_v2_preflight_ok.py") == 2                                   # both v2 jobs refuse first
    assert "--c2-grid-min 6 --c5" in wf and "a_harcon_score.py --v2" in wf
    assert "--start 2027-07-15 --days 14 --stations docs/weather-program/research/tide-a-harcon-v2-stations.json" in wf
    pre = wf.split("  download:", 1)[0]
    assert "pyfes" not in pre and "fes_cache" not in pre                                   # the pre-flight never runs FES


def test_v1_defaults_are_unchanged_in_the_instrument():
    src = open(os.path.join(TD, "a_harcon_parity.py"), encoding="utf-8").read()
    assert '"--c2-grid-min", type=int, default=60' in src and '"--c5", action="store_true"' in src
