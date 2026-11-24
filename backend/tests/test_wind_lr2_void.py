"""VOID by construction (owner ruling 2026-11-23, "Accept unscored"): the eligibility count, the VOID trigger, the descriptive-only form,
the stamp on every output, and a document that can never be read as a verdict or shipped. Offline."""
import copy
import hashlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wind_lr2_gust as G  # noqa: E402
import wind_lr2_run as RUN  # noqa: E402
import wind_lr2_stats as S  # noqa: E402
import wind_lr2_void as VD  # noqa: E402
from tests.test_wind_lr2_gust_scorer import _table  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EVID = os.path.join(ROOT, "docs", "weather-program", "evidence", "wind-long-range-v2")
GATES = os.path.join(ROOT, "docs", "weather-program", "gates")


def _inputs():
    st = json.load(open(os.path.join(EVID, "wind_lr2_stations.json"), encoding="utf-8"))
    return st["ndbc"] + st["asos"], json.load(open(os.path.join(EVID, "wind_lr2_pairing.json"), encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ the eligibility count
def test_the_committed_count_table_is_reproducible_from_the_committed_inputs(tmp_path):
    assert VD.main(["counts", "--stations", os.path.join(EVID, "wind_lr2_stations.json"), "--pairing", os.path.join(EVID, "wind_lr2_pairing.json"),
                    "--out-md", str(tmp_path / "c.md"), "--out-json", str(tmp_path / "c.json")]) == 0
    for name, committed in (("c.md", "eligibility-counts.md"), ("c.json", "eligibility-counts.json")):
        assert (tmp_path / name).read_bytes() == open(os.path.join(EVID, committed), "rb").read(), committed


def test_the_exact_void_trigger_and_the_inputs_it_cites():
    st, pair = _inputs()
    el = VD.eligibility(VD.count_table(st, pair))
    assert el["void"] and el["wind"]["n"] == 2 and el["gust"]["n"] == 2 and el["gated_regions"] == 7 and el["min_regions"] == 3
    assert el["wind"]["regions_at_or_above_floor"] == ["US_PACIFIC", "US_ATLANTIC_GULF"]
    assert el["trigger"].startswith("2 of 7 gated regions have >= 10 marine-exposed stations") and el["trigger"].endswith("the threshold is 3")
    doc = json.load(open(os.path.join(EVID, "eligibility-counts.json"), encoding="utf-8"))
    assert doc["inputs"]["stations_sha256"] == hashlib.sha256(open(os.path.join(EVID, "wind_lr2_stations.json"), "rb").read()).hexdigest()
    assert doc["inputs"]["pairing_sha256"] == hashlib.sha256(open(os.path.join(EVID, "wind_lr2_pairing.json"), "rb").read()).hexdigest()
    assert doc["order_of_operations"][0].startswith("eligibility count") and doc["order_of_operations"][-1].startswith("holdout")


def test_three_qualifying_regions_would_not_void_and_the_floors_are_the_registered_ones():
    assert (S.MIN_STATIONS_PER_REGION, S.MIN_REGIONS_WITH_STATIONS) == (10, 3)
    rows = [{"region": r, "gated": True, "raw_ndbc": 20, "raw_asos": 0, "marine_ndbc": n, "marine_asos": 0, "gust_eligible_marine_ndbc": n}
            for r, n in (("A", 10), ("B", 11), ("C", 12), ("D", 9))]
    assert not VD.eligibility(rows)["void"]
    rows[2]["marine_ndbc"] = 9
    assert VD.eligibility(rows)["void"]
    rows[2].update(marine_ndbc=40, gust_eligible_marine_ndbc=9)                    # wind qualifies, gust does not: still VOID overall
    assert VD.eligibility(rows)["wind"]["void"] is False and VD.eligibility(rows)["gust"]["void"] and VD.eligibility(rows)["void"]


def test_the_count_table_treats_every_region_the_same_and_highlights_none():
    st, pair = _inputs()
    text = VD.render_table(VD.count_table(st, pair))
    lines = text.strip().splitlines()
    assert len(lines) == 2 + 10                                                       # header, rule, the 7 gated + 3 reported regions
    assert len({ln.count("|") for ln in lines}) == 1                                  # same columns in every row
    assert all("**" not in ln and "<" not in ln for ln in lines)                       # no emphasis, no markup on any row
    md = open(os.path.join(EVID, "eligibility-counts.md"), encoding="utf-8").read()
    for region in VD.REPORT_REGIONS:
        assert f"| {region} |" in md


# ------------------------------------------------------------------------------------------------ the stamp
def _score_doc():
    rows = _table(n_days=30, n_st=12)
    gust = G.gust_verdict(rows, {"ICON": {"GRAND_CAL": True, "AIGEFS_CAL": False}, "EURO": {"GRAND_CAL": False, "AIGEFS_CAL": False}},
                          __import__("numpy").zeros(0), {"A": 12, "B": 12, "C": 12}, reps=100, control_reps=100)
    line = {"mean": -0.4, "ci": [-0.6, -0.2], "p": 0.01, "n": 900, "days": 40, "p_adj": 0.02, "sig": True}
    return {"n_rows": 900, "reps": 100, "verdict": "PASS", "void_reasons": [], "f1": {"GRAND_CAL|M1|LOOP_PROXY|B1": dict(line)},
            "f3": {"GRAND_CAL|B1": dict(line)}, "g4": {"GRAND_CAL": {"ok": True}},
            "controls": {"null": {"ok": True}}, "station_coverage": {"S1": {"wind": 0.9, "gust": 0.8, "ok_wind": True, "ok_gust": True}},
            "tails": {"ICON": {"GRAND_CAL": {"pass": True, "G5": {"ok": True}}, "decision": "GRAND_CAL_PENDING_ICON_SEAM"}},
            "gust": gust}


def _keys(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from _keys(v)
    elif isinstance(x, list):
        for v in x:
            yield from _keys(v)


def test_a_void_document_has_no_decision_pass_significance_or_ship_field_anywhere():
    before = _score_doc()
    assert VD.DECISION_KEYS & set(_keys(before))                                        # the fixture really contains them
    d = VD.descriptive(before)
    body = {k: v for k, v in d.items() if k not in ("verdict", "ships")}               # the two header fields are the only places they remain
    assert not (VD.DECISION_KEYS & set(_keys(body)))
    assert d["verdict"] == VD.STATUS and d["status"] == VD.STATUS and d["void"] is True and d["descriptive_only"] is True and d["ships"] is False
    assert set(d["tails"]) <= {"_void"} and set(d["gust"]["tails"]) <= {"_void"}           # no per-tail content survives, only the stamp
    assert d["f1"]["GRAND_CAL|M1|LOOP_PROXY|B1"]["mean"] == -0.4 and d["f1"]["GRAND_CAL|M1|LOOP_PROXY|B1"]["ci"] == [-0.6, -0.2]     # numbers stay
    assert before["verdict"] == "PASS"                                                  # the input was not mutated


def test_every_top_level_section_is_stamped():
    d = VD.descriptive(_score_doc())
    sections = [k for k, v in d.items() if isinstance(v, dict) and k not in ("tails",)]
    assert sections and all(d[k].get("_void") is True for k in sections), [k for k in sections if not d[k].get("_void")]
    assert all(d["gust"][k].get("_void") is True for k, v in d["gust"].items() if isinstance(v, dict))


def test_a_void_run_writes_only_stamped_files_with_the_token_in_every_name(tmp_path):
    st, pair = _inputs()
    table = VD.count_table(st, pair)
    el = VD.eligibility(table)
    out = tmp_path / "report.json"
    paths = RUN.write_score_report(_score_doc(), str(out), table, el)
    names = sorted(os.listdir(tmp_path))
    assert names == ["report.VOID.json", "report.VOID.md"] and sorted(os.path.basename(p) for p in paths) == names
    assert not out.exists()                                                             # the plain, unstamped name is never written
    j = json.load(open(tmp_path / "report.VOID.json", encoding="utf-8"))
    assert j["status"] == VD.STATUS and j["verdict"] == VD.STATUS and j["ships"] is False
    assert not (VD.DECISION_KEYS & set(_keys({k: v for k, v in j.items() if k not in ("verdict", "ships")})))
    assert j["eligibility"]["void"] is True and j["eligibility_table"]["rows"] and j["eligibility_table"]["_void"] is True
    md = (tmp_path / "report.VOID.md").read_text(encoding="utf-8")
    assert md.startswith(f"# {VD.STATUS}") and VD.NOTICE in md and "no skill conclusion, positive or negative" in md
    assert all(f"## {k}" in md for k in ("f1", "f3", "controls", "station_coverage", "gust"))
    assert all(VD.TOKEN in n for n in names)


def test_a_non_void_run_would_still_write_the_registered_report(tmp_path):
    doc = _score_doc()
    rows = [{"region": r, "gated": True, "raw_ndbc": 20, "raw_asos": 0, "marine_ndbc": 11, "marine_asos": 0, "gust_eligible_marine_ndbc": 11} for r in "ABC"]
    paths = RUN.write_score_report(doc, str(tmp_path / "report.json"), rows, VD.eligibility(rows))
    assert [os.path.basename(p) for p in paths] == ["report.json"] and json.load(open(tmp_path / "report.json", encoding="utf-8"))["verdict"] == "PASS"


def test_a_void_document_is_refused_by_every_shipping_check_even_after_a_round_trip(tmp_path):
    st, pair = _inputs()
    table = VD.count_table(st, pair)
    RUN.write_score_report(_score_doc(), str(tmp_path / "r.json"), table, VD.eligibility(table))
    stamped = json.load(open(tmp_path / "r.VOID.json", encoding="utf-8"))
    with pytest.raises(VD.NotShippable):
        VD.assert_shippable(stamped)
    with pytest.raises(VD.NotShippable):
        VD.assert_shippable({"verdict": "VOID"})
    assert VD.assert_shippable({"verdict": "PASS"}) == {"verdict": "PASS"}
    assert VD.descriptive(_score_doc())["ships"] is False


def test_cmd_score_counts_eligibility_before_any_truth_and_writes_only_through_the_report_writer():
    text = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_run.py"), encoding="utf-8").read()
    body = text[text.index("def cmd_score"):text.index("def cmd_pair")]
    assert body.index("load_stations(") < body.index("VD.count_table(") < body.index("VD.eligibility(") < body.index("truth_fn_for(")
    assert body.index("doc = SC.score_rows(") < body.index("write_score_report(doc, a.out")
    assert "json.dump" not in body                                                    # no other writer of the report in the score command
    writer = text[text.index("def write_score_report"):text.index("def cmd_score")]
    assert writer.index("VD.write_outputs") < writer.index("json.dump")                # the VOID branch comes first and returns


def test_the_workflow_uploads_the_stamped_markdown_and_the_registration_records_the_status():
    wf = open(os.path.join(ROOT, ".github", "workflows", "wind-lr2-analyse.yml"), encoding="utf-8").read()
    assert "wlr2/*.VOID.md" in wf and "wlr2/*.json" in wf
    reg = open(os.path.join(GATES, "wind-long-range-v2.md"), encoding="utf-8").read()
    note = reg[reg.index("## Status note, 2026-11-23: VOID by construction, accepted by the owner before TEST"):]
    assert "**\"Accept unscored (Recommended)\"**" in note and "2 of 7 gated regions have >= 10 marine-exposed stations; the floor requires 3" in note
    assert "no second amendment is made, nothing ships from this test" in note and "separately registered exploratory test" in note
    desc = open(os.path.join(GATES, "wind-long-range-v2-descriptive-only.md"), encoding="utf-8").read()
    for needle in ("Nothing about skill, in either direction", "No pass or fail per line", "VOID_BY_CONSTRUCTION", "report.VOID.json", "assert_shippable"):
        assert needle in desc
