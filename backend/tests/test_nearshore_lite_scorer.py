"""MOP-lite scorer, controls, hash refusal and the archive (gate sections 5-8). Synthetic rows with known answers."""
import datetime as dt
import os

import numpy as np
import pytest

from services.weather_pipeline.nearshore_lite import archive, scorer
from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite.ray_trace import DepthGrid, trace_target

B = 600
REGIONS = ["US West", "US East"]


def make_rows(lite_noise, chain_noise, n_dates=90, seed=1, with_ca=False):
    rng = np.random.default_rng(seed)
    d0 = dt.date(2027, 1, 15)
    rows = []
    for i in range(n_dates):
        date = (d0 + dt.timedelta(days=i)).isoformat()
        for b in range(10):
            region = REGIONS[b % 2]
            truth = 1.0 + rng.random() * 2.0
            arms = {"CHAIN": truth + rng.normal(0, chain_noise), "LITE": truth + rng.normal(0, lite_noise),
                    "OFFSHORE": truth * 1.2}
            rows.append({"date": date, "buoy": f"b{b}", "region": region, "sheltered": b < 4,
                         "stratum": "FINE" if b < 8 else "COARSE", "obs_hs": truth, "lead_h": 24,
                         "inc_rel_deg": float(b * 10), "arms": arms})
    if with_ca:
        for i in range(n_dates):
            date = (d0 + dt.timedelta(days=i)).isoformat()
            for b in range(3):
                truth = 1.0 + rng.random()
                rows.append({"date": date, "buoy": f"ca{b}", "region": "California", "sheltered": False,
                             "stratum": "FINE", "obs_hs": truth, "lead_h": 24, "inc_rel_deg": 20.0,
                             "arms": {"CHAIN": truth, "LITE": truth, "LITE_EC": truth + rng.normal(0, 0.1),
                                      "MOP": truth + rng.normal(0, 0.1)}})
    return rows


def test_a_better_arm_wins_f1_and_passes():
    rows = make_rows(lite_noise=0.10, chain_noise=0.35)
    res = scorer.pass_rule(rows, REGIONS, B=B)
    assert res["pass"] and res["pooled"] and res["FINE"] and res["sheltered"] and res["both_halves"]
    assert res["f1"]["pooled"]["delta"] < 0 and res["f1"]["pooled"]["p_holm"] < 0.05


def test_an_equal_arm_does_not_pass():
    rows = make_rows(lite_noise=0.30, chain_noise=0.30, seed=3)
    assert scorer.pass_rule(rows, REGIONS, B=B)["pass"] is False


def test_a_worse_arm_is_holm_worse_and_fails():
    rows = make_rows(lite_noise=0.50, chain_noise=0.15, seed=4)
    res = scorer.pass_rule(rows, REGIONS, B=B)
    assert res["pass"] is False and res["no_region_worse"] is False


def test_holm_is_monotone_and_capped():
    adj = scorer.holm([0.01, 0.04, 0.03, 0.5])
    assert adj[0] == pytest.approx(0.04) and adj[2] == pytest.approx(0.09) and adj[1] == pytest.approx(0.09)
    assert max(adj) <= 1.0


def test_bootstrap_is_deterministic_under_the_registered_seed():
    rows = make_rows(0.1, 0.3, n_dates=40)
    a = scorer.paired_bootstrap(rows, "LITE", "CHAIN", B=300)
    b = scorer.paired_bootstrap(rows, "LITE", "CHAIN", B=300)
    assert a == b and scorer.SEED == 20261122 and scorer.BLOCK_DAYS == 7 and scorer.B_DEFAULT == 10000


def test_the_same_rows_feed_every_arm_missing_run_rule():
    rows = make_rows(0.1, 0.3, n_dates=20)
    for r in rows[:10]:
        r["arms"]["LITE"] = None
    r = scorer.paired_bootstrap(rows, "LITE", "CHAIN", B=100)
    assert r["n"] == len(rows) - 10


def test_tost_equivalent_and_not_equivalent():
    rows = [r for r in make_rows(0.1, 0.1, n_dates=60, with_ca=True) if r["region"] == "California"]
    for r in rows:                                    # same error shape, MOP 2% larger: inside the +/-10% margin
        e = r["arms"]["LITE_EC"] - r["obs_hs"]
        r["arms"]["MOP"] = r["obs_hs"] + 1.02 * e
    same = scorer.tost_ratio(rows, B=B)
    assert same["equivalent"] and abs(same["r"]) < 0.10
    for i, r in enumerate(rows):                      # LITE_EC far worse than MOP
        r["arms"]["LITE_EC"] = r["obs_hs"] + 0.5 * (1 if i % 2 else -1)
    bad = scorer.tost_ratio(rows, B=B)
    assert not bad["equivalent"] and bad["worse"]


def test_floors_report_void_when_unmet():
    rows = make_rows(0.1, 0.3, n_dates=30)
    f = scorer.floors(rows, REGIONS)
    assert f["ok"] is False and f["inits"] == 30 and f["buoys"] == 10


def test_controls_null_and_height_plant():
    rows = make_rows(0.1, 0.3, n_dates=60)
    assert scorer.control_null(rows)
    assert scorer.control_height_plants(rows, B=300)["caught_2x"] is True


def test_direction_plant_control_requires_a_significant_rise_in_the_sheltered_subset():
    rows = make_rows(0.1, 0.3, n_dates=60)
    worse = [{**r, "arms": {**r["arms"], "LITE_ROT40": r["arms"]["LITE"] + 0.4}} for r in rows]
    blind = [{**r, "arms": {**r["arms"], "LITE_ROT40": r["arms"]["LITE"]}} for r in rows]
    assert scorer.control_direction_plants(rows, worse, B=300)["direction_aware"] is True
    assert scorer.control_direction_plants(rows, blind, B=300)["direction_aware"] is False      # => VOID


# ---- the hash refusal and the leak rule --------------------------------------------------------------------------
def _frozen(tmp_path):
    x = np.arange(60) * 25.0
    h = np.tile((0.02 * (1250.0 - x))[None, :], (60, 1))
    h[h < 0.5] = np.nan
    t = trace_target(DepthGrid(h, 25.0), 400.0, 750.0, freqs=np.array([0.1, 0.11]))
    d = str(tmp_path / "coef")
    coef.write_target(d, "T1", t, {"stratum": "FINE"})
    coef.write_sums(d)
    return d


def test_the_scorer_refuses_a_coefficient_whose_hash_changed(tmp_path):
    d = _frozen(tmp_path)
    assert "T1" in scorer.verify_frozen_or_refuse(d, ["T1"])
    p = os.path.join(d, "T1.coef.json")
    with open(p, "ab") as f:
        f.write(b" ")
    with pytest.raises(coef.CoefficientHashMismatch):
        scorer.verify_frozen_or_refuse(d, ["T1"])


def test_an_unfrozen_target_is_refused(tmp_path):
    d = _frozen(tmp_path)
    with pytest.raises(coef.CoefficientHashMismatch, match="not frozen"):
        scorer.verify_frozen_or_refuse(d, ["T2"])


def test_coefficient_bytes_are_reproducible(tmp_path):
    d1, d2 = _frozen(tmp_path / "a"), _frozen(tmp_path / "b")
    assert coef.read_sums(d1) == coef.read_sums(d2)


def test_leak_control_flags_a_valid_time_before_the_freeze(tmp_path):
    d = _frozen(tmp_path)
    assert scorer.control_leak(d, ["T1"], "2027-01-15T00:00Z", ["2027-01-16T00:00Z"]) is True
    assert scorer.control_leak(d, ["T1"], "2027-01-15T00:00Z", ["2027-01-14T23:00Z"]) is False


# ---- archive ---------------------------------------------------------------------------------------------------
def test_archive_is_hashed_immutable_and_detects_tampering(tmp_path):
    d = str(tmp_path / "arch")
    rows = [{"target": "T1", "lead_h": h, "partitions": [{"h": 1.0, "tp": 12.0, "dir": 270.0, "kind": "swell"}]}
            for h in range(0, 73)]
    p, h = archive.archive_init(d, "2027-01-15T00:00Z", "GFS", rows)
    assert archive.verify_archive(d) == [] and len(h) == 64
    with pytest.raises(FileExistsError):
        archive.archive_init(d, "2027-01-15T00:00Z", "GFS", rows)
    assert archive.missing_run(d, ["T1"]) == []
    archive.archive_init(d, "2027-01-16T00:00Z", "GFS", rows[:40])                  # a short init
    assert archive.missing_run(d, ["T1"]) == ["20270116T0000Z.json"]
    with open(p, "ab") as f:
        f.write(b" ")
    assert any("mismatch" in x for x in archive.verify_archive(d))


# ---- ship decision on stratified tags (advisor ruling) -----------------------------------------------------------
def _tagged_rows(seam_noise, dm_noise):
    """Tagged buoys sit OUTSIDE the sheltered subset (b < 4) so a bad tag line cannot sink the sheltered line."""
    rows = make_rows(lite_noise=0.10, chain_noise=0.35, seed=7)
    rng = np.random.default_rng(11)
    for r in rows:
        if r["buoy"] in ("b5", "b6"):          # SEAM targets
            r["tags"] = ["SEAM"]
            r["arms"]["LITE"] = r["obs_hs"] + rng.normal(0, seam_noise)
        if r["buoy"] in ("b6", "b7"):          # b6 is multi-tagged; b7 is DATUM_1M only
            r["tags"] = sorted(set(r.get("tags", [])) | {"DATUM_1M"})
            r["arms"]["LITE"] = r["obs_hs"] + rng.normal(0, dm_noise)
    return rows


def test_tag_rule_is_every_tag_better():
    assert scorer.tag_rule(set(), {}) is True
    assert scorer.tag_rule({"SEAM"}, {"SEAM": True}) is True
    assert scorer.tag_rule({"SEAM"}, {"SEAM": False}) is False
    assert scorer.tag_rule({"SEAM", "DATUM_1M"}, {"SEAM": True, "DATUM_1M": False}) is False
    assert scorer.tag_rule({"SEAM"}, {}) is False                 # no line = not better


def test_seam_and_datum_targets_are_scored_but_keep_chain_unless_their_own_line_is_better():
    rows = _tagged_rows(seam_noise=0.60, dm_noise=0.10)           # SEAM line worse than CHAIN, DATUM_1M line better
    res = scorer.ship_decision(rows, REGIONS, B=B)
    assert res["gate_pass"] is True                               # pooled/FINE/sheltered still pass: stratify only
    assert res["ships"]["b0"] is True                             # untagged
    assert res["ships"]["b5"] is False                            # SEAM only, its line is not better
    assert res["ships"]["b7"] is True                             # DATUM_1M only, its line is better
    assert res["ships"]["b6"] is False                            # multi-tagged: SEAM line fails => keeps CHAIN


def test_every_tag_better_ships_the_multi_tagged_target():
    res = scorer.ship_decision(_tagged_rows(seam_noise=0.10, dm_noise=0.10), REGIONS, B=B)
    assert res["ships"]["b5"] and res["ships"]["b6"] and res["ships"]["b7"]


def test_a_gate_that_does_not_pass_ships_nothing():
    rows = make_rows(lite_noise=0.30, chain_noise=0.30, seed=3)
    assert not any(scorer.ship_decision(rows, REGIONS, B=B)["ships"].values())


def test_coarse_stratum_counts_as_a_tag():
    r = {"stratum": "COARSE", "tags": ["SEAM"]}
    assert scorer.row_tags(r) == {"COARSE", "SEAM"}


def test_coarse_plus_seam_target_with_one_tag_merely_not_worse_keeps_chain():
    """b6 is COARSE+SEAM. COARSE line clearly better; SEAM line only EQUAL to CHAIN (not worse, not better) => CHAIN."""
    rows = make_rows(lite_noise=0.10, chain_noise=0.35, seed=21)
    rng = np.random.default_rng(5)
    for r in rows:
        if r["buoy"] in ("b8", "b9"):                       # the COARSE stratum (stratum == COARSE for b >= 8)
            r["arms"]["LITE"] = r["obs_hs"] + rng.normal(0, 0.10)
        if r["buoy"] in ("b8", "b0"):                       # SEAM: b8 (also COARSE) and b0
            r["tags"] = ["SEAM"]
            r["arms"]["LITE"] = r["arms"]["CHAIN"]          # exactly CHAIN: not worse, not better
    res = scorer.ship_decision(rows, REGIONS, B=B)
    assert res["better"]["COARSE"] is True and res["better"]["SEAM"] is False
    assert res["ships"]["b9"] is True                       # COARSE only, better
    assert res["ships"]["b8"] is False                      # COARSE + SEAM: SEAM not better => CHAIN
    assert res["ships"]["b0"] is False                      # SEAM only, not better => CHAIN


def test_a_tag_with_no_targets_has_no_line():
    res = scorer.pass_rule(make_rows(0.1, 0.35, seed=2), REGIONS, B=B)
    assert "SEAM" not in res["f1"] and "DATUM_1M" not in res["f1"] and "COARSE" in res["f1"]


def test_tag_lines_join_the_f1_holm_family():
    rows = _tagged_rows(0.10, 0.10)
    f1 = scorer.pass_rule(rows, REGIONS, B=B)["f1"]
    assert {"SEAM", "DATUM_1M"} <= set(f1) and all("p_holm" in v for v in f1.values())


def test_control_plants_default_to_the_registered_B():
    import inspect
    assert inspect.signature(scorer.control_height_plants).parameters["B"].default == 10000
    assert inspect.signature(scorer.control_direction_plants).parameters["B"].default == 10000


def test_void_is_printed_explicitly():
    void, text = scorer.verdict({"ok": False, "inits": 30}, {"null": True, "direction": False})
    assert void and text.startswith("VOID:") and "direction" in text and "floors unmet" in text
    void, text = scorer.verdict({"ok": True}, {"null": True})
    assert not void and text.startswith("VALID")
