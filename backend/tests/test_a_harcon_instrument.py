"""tide-a-harcon-v1's instrument and scorer (gates/tide-a-harcon-v1.md s2-s6; #1273 L1: vendored inputs, match and
finder_check vendored verbatim, predictions only).

Pins: the vendored files' bytes; the blend rule (s2.3); the candidate set and the leave-one-out donor prefix on the
FROZEN stations; the scorer's precedence (finder -> measurability, never VOID -> identities -> bar); replacement with
donor re-selection; every leg; and a workflow that only a tag starts."""
import hashlib
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_datum"))
import a_harcon_parity as P  # noqa: E402
import a_harcon_score as S  # noqa: E402
import a_harcon_select as SEL  # noqa: E402

REPO = os.path.join(HERE, "..", "..")
STATIONS = os.path.join(REPO, "docs", "weather-program", "research", "tide-a-harcon-v1-stations.json")


def _sha(path):
    return hashlib.sha256(open(path, "rb").read().replace(b"\r\n", b"\n")).hexdigest()


def test_the_vendored_files_are_byte_pinned():
    """Verbatim from #1171's head 1d92f7564: the helpers by function (a_harcon_vendor.py) and finder_check.py whole."""
    d = os.path.join(HERE, "..", "scripts", "tide_datum")
    assert _sha(os.path.join(d, "a_harcon_vendor.py")) == "5898192090e92b226fd945f76c16865026d47c635ea009bf40bd794befde54b2"
    assert _sha(os.path.join(d, "finder_check.py")) == "274899005f0e71d5ca9f5e93b1193f1ed877a6163cfaa95aed4b4b6b5e01cfe9"


def test_the_blend_weight_and_its_identities():
    assert P.weight(0) == 1.0 and P.weight(10.0) == 1.0 and P.weight(17.5) == pytest.approx(0.5)
    assert P.weight(25.0) == 0.0 and P.weight(40) == 0.0 and P.weight(None) == 0.0
    don, fes = [1.0, -2.0, 3.5], [0.5, 0.25, -1.0]
    assert P.blend(0.0, don, fes) == fes and P.blend(1.0, don, fes) == don
    assert P.blend(0.5, don, fes) == pytest.approx([0.75, -0.875, 1.25])


def test_candidates_are_the_frozen_deciding_then_five_reserves_per_stratum():
    doc = json.load(open(STATIONS, encoding="utf-8"))
    c = P.candidates(doc)
    assert len(c) == 50 and [i for i, k in c[:20]] == doc["strata"]["HARBOR_BAY"]["deciding"]
    assert [i for i, k in c[20:25]] == doc["strata"]["HARBOR_BAY"]["reserve"][:5]


def test_every_candidate_has_a_leave_one_out_donor_prefix_ending_outside_the_candidates():
    doc = json.load(open(STATIONS, encoding="utf-8"))
    uni = SEL.universe()
    by = {s["id"]: s for s in uni}
    cand = {i for i, _ in P.candidates(doc)}
    for sid in cand:
        pre = P.donor_prefix(sid, by[sid]["lat"], by[sid]["lng"], uni, cand)
        assert pre and pre[-1]["id"] not in cand and all(d["id"] != sid and d["km"] < 25 for d in pre)
        assert [d["km"] for d in pre] == sorted(d["km"] for d in pre)
    ocean_city = P.donor_prefix("8570280", by["8570280"]["lat"], by["8570280"]["lng"], uni, cand)
    assert ocean_city[0]["id"] == "8570283" and ocean_city[0]["km"] == pytest.approx(0.752, abs=0.001)


def test_the_donor_prefix_rule_on_a_synthetic_universe():
    uni = [{"id": "A", "lat": 30.0, "lng": -80.0}, {"id": "B", "lat": 30.05, "lng": -80.0},
           {"id": "C", "lat": 30.1, "lng": -80.0}, {"id": "D", "lat": 30.5, "lng": -80.0}]
    pre = P.donor_prefix("A", 30.0, -80.0, uni, {"A", "B"})
    assert [d["id"] for d in pre] == ["B", "C"]                 # stops at the first non-candidate
    assert P.donor_prefix("A", 30.0, -80.0, uni[:1] + uni[3:], {"A"}) == []      # D is 55 km away


# ---- the scorer on synthetic runs ------------------------------------------------------------------------------------
def rows(h, t, n=10, matched=None):
    m = n if matched is None else matched
    return [{"height_err_m": h if i < m else None, "time_err_min": t if i < m else None} for i in range(n)]


def held(nd=20, nr=5):
    return {"strata": {k: {"deciding": [f"{p}{i}" for i in range(nd)], "reserve": [f"{p}R{i}" for i in range(nr)]}
                       for k, p in (("HARBOR_BAY", "H"), ("OPEN_COAST", "O"))}}


def station(fes=(0.20, 30.0), har=(0.05, 5.0), donor_km=5.0, donor="X", c2=(0.001, 0.5), dc2=(0.001, 0.5),
            c3=(0.0, 0.0), consts=True, matched=None):
    d = {"id": donor, "km": donor_km, "w": P.weight(donor_km), "has_constants": consts,
         "harcon_tb": rows(*har, matched=matched), "harcon_raw": rows(*har), "c3_w0_max_m": c3[0], "c3_w1_max_m": c3[1],
         "c2_donor": {"rows": rows(*dc2)}}
    return {"fes_tb": rows(*fes), "fes_raw": rows(*fes), "c2_station": {"rows": rows(*c2)}, "donors": [d]}


def run(override=None, oc_har=(0.20, 30.0)):
    per = {}
    for k, p in (("HARBOR_BAY", "H"), ("OPEN_COAST", "O")):
        for i in list(range(20)):
            per[f"{p}{i}"] = station(donor=f"D{p}{i}") if p == "H" else station(har=oc_har, donor=f"D{p}{i}")
        for i in range(5):
            per[f"{p}R{i}"] = station(donor=f"D{p}R{i}") if p == "H" else station(har=oc_har, donor=f"D{p}R{i}")
    per.update(override or {})
    return {"per_station": per, "window_start": "2027-02-01"}


def finder(bad=()):
    ids = [f"{p}{i}" for p in "HO" for i in range(20)] + [f"{p}R{i}" for p in "HO" for i in range(5)]
    return {"gauges": {s: {"hourly": {"median_abs_h_m": 0.05 if s in bad else 0.001}} for s in ids}}


def test_a_clean_improvement_passes_all_nine_legs():
    r = S.score(run(), finder(), held())
    assert r["verdict"] == "PASS", r
    assert all(r["strata"]["HARBOR_BAY"]["legs"].values()) and all(r["strata"]["OPEN_COAST"]["legs"].values())


def test_the_absolute_legs_fail_a_relative_improvement_that_is_still_too_poor():
    per = run({f"H{i}": station(fes=(0.60, 120.0), har=(0.30, 60.0)) for i in range(20)})
    r = S.score(per, finder(), held())
    legs = r["strata"]["HARBOR_BAY"]["legs"]
    assert r["verdict"] == "FAIL" and not legs["a_abs_h"] and not legs["b_abs_t"] and legs["c_rel_h"] and legs["e_wins_h"]


def test_open_coast_non_inferiority_fails_when_harcon_is_worse():
    r = S.score(run(oc_har=(0.40, 60.0)), finder(), held())
    assert r["verdict"] == "FAIL" and not all(r["strata"]["OPEN_COAST"]["legs"].values())


def test_ties_are_not_wins():
    per = run({f"H{i}": station(fes=(0.05, 5.0), har=(0.05, 5.0)) for i in range(20)})
    r = S.score(per, finder(), held())
    assert r["strata"]["HARBOR_BAY"]["quantities"]["wins_h"] == 0 and r["verdict"] == "FAIL"


def test_the_finder_comes_first_and_voids():
    r = S.score(run(), finder(bad=("H3",)), held())
    assert r["verdict"] == "VOID" and "strata" not in r


def test_a_harcon_measurability_loss_fails_its_stratum_and_is_never_void():
    per = run({"H0": station(matched=3), "H1": station(c2=(0.2, 30.0))})       # plus a C2 mismatch: still FAIL
    r = S.score(per, finder(), held())
    assert r["verdict"] == "FAIL" and r["measurability"]["HARBOR_BAY"]["harcon_loss"] == ["H0"]


def test_a_tested_identity_mismatch_voids_before_the_bar():
    for bad in ({"H1": station(c2=(0.2, 30.0))}, {"H1": station(dc2=(0.2, 30.0))}, {"H1": station(c3=(0.01, 0.0))}):
        r = S.score(run(bad), finder(), held())
        assert r["verdict"] == "VOID" and "legs" not in r["strata"]["HARBOR_BAY"], bad


def test_replacement_in_frozen_order_and_donor_reselection():
    # H2 has FES undefined -> replaced by HR0. HR0 was H5's first donor -> H5 re-selects its next donor.
    h5 = station(donor="HR0")
    h5["donors"].append(dict(h5["donors"][0], id="DH5b", km=7.0))
    per = run({"H2": {"fes_undefined": True}, "H5": h5})
    r = S.score(per, finder(), held())
    fin = r["final"]["HARBOR_BAY"]
    assert ["H2", "HR0"] in fin["replaced"] and "HR0" in fin["ids"] and "H2" not in fin["ids"]
    assert r["donors"]["H5"]["id"] == "DH5b" and r["controls"]["c4_loo"]["pass"] and r["verdict"] == "PASS"


def test_a_donor_without_constants_is_a_replacement_and_six_replacements_fail():
    per = run({f"H{i}": station(consts=False) for i in range(6)})
    r = S.score(per, finder(), held())
    assert not r["final"]["HARBOR_BAY"]["measurable"] and r["verdict"] == "FAIL"
    assert r["replacement_causes"]["H0"] == "donor has no constants"


def test_thin_strata_fail_never_void():
    per = run({f"H{i}": dict(station(), fes_tb=rows(0.2, 30.0, matched=2)) for i in range(2)})
    r = S.score(per, finder(), held())
    assert r["measurability"]["HARBOR_BAY"]["n"] == 18 and r["verdict"] == "FAIL"


def test_near_twins_are_reported_never_a_leg():
    r = S.score(run({"O4": station(har=(0.20, 30.0), donor_km=0.752, donor="8570283")}), finder(), held())
    assert r["near_twins"] == ["O4"] and r["verdict"] == "PASS"


def test_the_workflow_only_a_tag_starts_and_it_scores_with_the_vendored_finder():
    wf = open(os.path.join(REPO, ".github", "workflows", "tide-a-harcon.yml"), encoding="utf-8").read()
    assert "tags: ['tide-a-harcon-v1-*']" in wf
    assert "schedule:" not in wf and "workflow_dispatch" not in wf and "branches:" not in wf
    assert "finder_check.py --start 2027-02-01 --days 14 --stations" in wf and "a_harcon_score.py" in wf
    assert "SUPABASE" not in wf and "onrender" not in wf                       # predictions only
