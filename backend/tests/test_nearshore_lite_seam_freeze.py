"""MOP-lite: datum conversion, the seam check at source joins, composition strata, and the freeze ORDER (gate 1a)."""
import numpy as np
import pytest

from services.weather_pipeline.nearshore_lite import bathy_compose as bc
from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite import datum, freeze, seam
from services.weather_pipeline.nearshore_lite.ray_trace import DepthGrid


# ---- datum -----------------------------------------------------------------------------------------------------
def test_lat_to_msl_adds_the_msl_height_above_the_datum():
    conv = datum.resolve("EMODNET", "tile1", "LAT", offset_m=1.2, method="emodnet-tide-model", version="2025")
    assert datum.to_msl(np.array([10.0, 20.0]), conv).tolist() == [11.2, 21.2]
    assert conv.tags == []


def test_unresolved_datum_is_tagged_not_silently_msl():
    conv = datum.resolve("CRM", "vol3", "MLLW", offset_m=None)
    assert conv.tags == [datum.DATUM_1M] and conv.method == "none" and conv.msl_above_native_m is None
    assert datum.to_msl(np.array([10.0]), conv).tolist() == [10.0]      # passed through, tag carries the warning


def test_egm2008_and_msl_are_identity():
    assert datum.resolve("CRM", "v", "EGM2008").msl_above_native_m == 0.0
    assert datum.resolve("GEBCO", "GEBCO_2024", "MSL").msl_above_native_m == 0.0


# ---- seam ------------------------------------------------------------------------------------------------------
def test_matching_sources_are_not_a_seam():
    a = np.full((20, 20), 12.0)
    row = seam.check_join("t1", "CUDEM|CRM", "CUDEM,CRM", a, a + 0.1)
    assert row.tag == "" and row.p95_m == pytest.approx(0.1) and row.n_cells == 400


def test_a_one_and_a_half_metre_step_in_shallow_water_is_a_seam():
    a = np.full((20, 20), 12.0)
    b = a.copy()
    b[:, 10:] += 1.5                                             # half the overlap off by 1.5 m
    row = seam.check_join("t2", "CUDEM|GEBCO", "CUDEM,GEBCO", a, b)
    assert row.tag == seam.SEAM and row.p95_m == pytest.approx(1.5)


def test_water_deeper_than_30_m_does_not_count():
    a = np.full((20, 20), 45.0)
    row = seam.check_join("t3", "j", "s", a, a + 5.0)
    assert row.n_cells == 0 and row.tag == ""


def test_median_over_report_is_flagged_but_does_not_tag():
    a = np.full((20, 20), 12.0)
    row = seam.check_join("t4", "j", "s", a, a + 0.5)
    assert row.median_over_report is True and row.tag == ""      # registered trigger is p95 > 1.0 m only


def test_non_overlapping_sources_are_compared_across_the_join():
    fine = np.full((10, 10), np.nan)
    coarse = np.full((10, 10), np.nan)
    fine[:, :5] = 10.0
    coarse[:, 5:] = 12.0                                          # no overlap; a 2 m step across the join
    f, c = seam.edge_pairs(fine, coarse)
    assert len(f) > 0
    row = seam.check_join("t5", "j", "s", f, c)
    assert row.tag == seam.SEAM and row.p95_m == pytest.approx(2.0)


def test_seam_table_is_byte_stable_and_hashed():
    rows = [seam.check_join("b", "j", "s", np.full((5, 5), 10.0), np.full((5, 5), 10.0)),
            seam.check_join("a", "j", "s", np.full((5, 5), 10.0), np.full((5, 5), 12.0))]
    t1, h1 = seam.to_csv(rows)
    t2, h2 = seam.to_csv(list(reversed(rows)))
    assert t1 == t2 and h1 == h2
    assert t1.splitlines()[1].startswith("a,")
    assert seam.target_tags(rows) == {"a": seam.SEAM}


# ---- composition and strata ------------------------------------------------------------------------------------
def test_finest_source_wins_and_gebco_nearby_makes_a_target_coarse():
    nan = np.full((40, 40), np.nan)
    cudem, gebco = nan.copy(), np.full((40, 40), 30.0)
    cudem[:, :30] = 10.0
    depth, which, names, st = bc.compose({"CUDEM": cudem, "GEBCO": gebco}, dx_m=100.0, target_xy=(500.0, 2000.0))
    assert depth[0, 0] == 10.0 and depth[0, 35] == 30.0 and names == ["CUDEM", "GEBCO"]
    assert st == bc.COARSE                                        # GEBCO cells begin 2.5 km east of the target (< 5 km)
    far = bc.stratum(which, 100.0, (100.0, 2000.0), radius_m=1000.0)
    assert far == bc.FINE


# ---- freeze order ----------------------------------------------------------------------------------------------
def _target(tmp_path):
    x = np.arange(60) * 25.0
    h = np.tile((0.02 * (1250.0 - x))[None, :], (60, 1))
    h[h < 0.5] = np.nan
    return {"id": "T1", "grid": DepthGrid(h, 25.0), "xy": (400.0, 750.0), "stratum": "FINE",
            "datum_records": [datum.resolve("CUDEM", "t", "NAVD88", 0.1, "vdatum", "VDatum 4.7").as_dict()],
            "sources": ["CUDEM"], "tile_sha256": {"t": "0" * 64}}


def test_no_coefficient_is_frozen_before_the_seam_table_exists(tmp_path):
    with pytest.raises(freeze.FreezeOrderError, match="seam table is not committed"):
        freeze.freeze_targets(str(tmp_path / "c"), [_target(tmp_path)], str(tmp_path / "missing.csv"), "0" * 64)
    assert not (tmp_path / "c").exists()


def test_freeze_requires_the_committed_seam_hash_and_records_it(tmp_path):
    rows = [seam.check_join("T1", "j", "s", np.full((5, 5), 10.0), np.full((5, 5), 10.0))]
    p, sha = freeze.commit_seam_table(str(tmp_path / "s"), rows)
    with pytest.raises(freeze.FreezeOrderError, match="sha256"):
        freeze.freeze_targets(str(tmp_path / "c"), [_target(tmp_path)], p, "f" * 64)
    freeze.freeze_targets(str(tmp_path / "c"), [_target(tmp_path)], p, sha)
    tab = coef.load_verified(str(tmp_path / "c"), "T1")
    assert tab.meta["seam_table_sha256"] == sha and tab.meta["stratum"] == "FINE"
    assert tab.meta["datum_records"][0]["version"] == "VDatum 4.7"


def test_a_target_without_a_datum_record_is_refused(tmp_path):
    rows = [seam.check_join("T1", "j", "s", np.full((5, 5), 10.0), np.full((5, 5), 10.0))]
    p, sha = freeze.commit_seam_table(str(tmp_path / "s"), rows)
    t = _target(tmp_path)
    t["datum_records"] = []
    with pytest.raises(freeze.FreezeOrderError, match="datum"):
        freeze.freeze_targets(str(tmp_path / "c"), [t], p, sha)
