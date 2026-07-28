"""Unit tests for the nearshore-transform validation instrument (scripts/validate_nearshore_transform.py).

The tool's job is to be a check that CAN go red. These pin the pure logic — pair discovery, the CSV
parser and the physics helpers — so the instrument itself cannot rot into a silent pass.
"""
import importlib.util
import os

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "validate_nearshore_transform",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "scripts", "validate_nearshore_transform.py"))
vnt = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(vnt)


# ── THE CSV TRAP ────────────────────────────────────────────────────────────────────────────────
# CDIP's station name contains an UNQUOTED comma, so every data row has one more field than the
# header. Indexing by header position read waveDp as the QC flag and discarded 100% of rows while
# reporting success — a silent-empty failure, the exact shape this tool exists to avoid.
_REAL_CSV = (
    'time,station,latitude[unit="degrees_north"],longitude[unit="degrees_east"],'
    'waveHs[unit="meter"],waveTp[unit="second"],waveDp[unit="degreeT"],waveFlagPrimary\n'
    "2024-01-10T00:00:00Z,TORREY PINES OUTER, CA BUOY - 100p1,32.931,-117.391,1.02,14.285714,236.0,1\n"
    "2024-01-10T00:30:00Z,TORREY PINES OUTER, CA BUOY - 100p1,32.931,-117.391,1.07,13.333333,262.71875,1\n"
)


def test_parse_csv_survives_the_unquoted_comma_in_the_station_name():
    got = vnt.parse_csv(_REAL_CSV)
    assert len(got) == 2, "the unquoted comma shifted the columns again"
    hs, tp, dp = got["2024-01-10T00:00:00Z"]
    assert hs == pytest.approx(1.02)          # NOT the latitude, NOT the longitude
    assert tp == pytest.approx(14.285714)
    assert dp == pytest.approx(236.0)


def test_parse_csv_drops_everything_but_qc_flag_1():
    rows = _REAL_CSV.replace(",236.0,1\n", ",236.0,4\n")      # 4 = bad
    assert vnt.parse_csv(rows) == {k: v for k, v in vnt.parse_csv(rows).items()}
    assert "2024-01-10T00:00:00Z" not in vnt.parse_csv(rows)
    assert len(vnt.parse_csv(rows)) == 1                        # the untouched second row survives


def test_parse_csv_tolerates_junk_without_raising():
    assert vnt.parse_csv("") == {}
    assert vnt.parse_csv("time,station\n") == {}
    assert vnt.parse_csv("time,station\nshort,row\n") == {}


# ── PAIR DISCOVERY ──────────────────────────────────────────────────────────────────────────────
def test_find_pairs_matches_shallow_to_nearest_deep_within_range():
    meta = {
        "deepA": {"depth_m": 500.0, "lat": 32.93, "lng": -117.39},
        "deepB": {"depth_m": 300.0, "lat": 40.00, "lng": -124.00},   # far away
        "nearA": {"depth_m": 17.0, "lat": 32.96, "lng": -117.28},
        "shelf": {"depth_m": 60.0, "lat": 32.95, "lng": -117.30},    # neither deep nor shallow
        "orphan": {"depth_m": 20.0, "lat": -33.9, "lng": 151.3},     # no deep station near
    }
    pairs = vnt.find_pairs(meta)
    assert [p["near"] for p in pairs] == ["nearA"]
    assert pairs[0]["deep"] == "deepA"
    assert 0 < pairs[0]["sep_km"] < vnt.MAX_SEP_KM
    assert "shelf" not in [p["near"] for p in pairs]   # 60 m is neither classification


def test_find_pairs_is_empty_without_candidates():
    assert vnt.find_pairs({}) == []
    assert vnt.find_pairs({"a": {"depth_m": 500.0, "lat": 0, "lng": 0}}) == []


def test_haversine_is_sane():
    assert vnt.haversine_km(0, 0, 0, 0) == pytest.approx(0.0)
    # 1 degree of latitude is ~111 km anywhere.
    assert vnt.haversine_km(0, 0, 1, 0) == pytest.approx(111.19, abs=0.5)


# ── PHYSICS HELPERS ─────────────────────────────────────────────────────────────────────────────
def test_snell_kr_is_one_at_normal_incidence_and_never_focuses():
    """Straight-parallel-contour refraction can only SPREAD energy. This is precisely why it cannot
    explain the measurements: one validated site focuses to Kr = 1.03."""
    assert vnt.snell_kr(0.0, 14.0, 17.0) == pytest.approx(1.0, abs=1e-9)
    prev = 1.0
    for theta in (10, 20, 30, 45, 60, 80):
        kr = vnt.snell_kr(theta, 14.0, 17.0)
        assert 0.0 < kr <= 1.0 + 1e-9, f"Snell focused at {theta} deg: {kr}"
        assert kr <= prev + 1e-9, "Kr must fall as incidence grows"
        prev = kr


def test_snell_kr_degenerate_inputs_return_none_not_garbage():
    for args in ((30.0, None, 17.0), (30.0, 14.0, None), (30.0, 0.0, 17.0), (30.0, 14.0, -5.0)):
        assert vnt.snell_kr(*args) is None


def test_implied_kr_uses_only_matched_qc_good_swell_hours():
    near = {"t1": (0.80, 13.0, 260.0), "t2": (0.50, 8.0, 250.0), "t3": (1.00, 14.0, 245.0)}
    deep = {"t1": (1.00, 13.0, 262.0), "t2": (0.60, 8.0, 251.0), "t4": (2.00, 15.0, 240.0)}
    out = vnt.implied_kr_samples(near, deep, 17.0)
    # t2 is short-period (excluded), t3/t4 are unmatched -> exactly one usable sample.
    assert len(out) == 1
    kr, direction, tp = out[0]
    assert direction == 262.0 and tp == 13.0
    from services.weather_pipeline.surf_transform import shoaling_coefficient
    assert kr == pytest.approx((0.80 / 1.00) / shoaling_coefficient(13.0, 17.0))


def test_implied_kr_skips_flat_and_degenerate_hours():
    near = {"t": (0.5, 14.0, 260.0)}
    assert vnt.implied_kr_samples(near, {"t": (0.05, 14.0, 260.0)}, 17.0) == []   # deep below MIN_HS
    assert vnt.implied_kr_samples({"t": (0.0, 14.0, 260.0)}, {"t": (1.0, 14.0, 260.0)}, 17.0) == []


def test_the_instrument_can_actually_go_red():
    """A perfect model would imply Kr == 1. Feed it a nearshore height that is exactly the shoaled
    offshore height and it must report 1.0; feed it a 25% deficit and it must report ~0.75."""
    from services.weather_pipeline.surf_transform import shoaling_coefficient
    ks = shoaling_coefficient(14.0, 17.0)
    perfect = vnt.implied_kr_samples({"t": (1.0 * ks, 14.0, 260.0)}, {"t": (1.0, 14.0, 260.0)}, 17.0)
    assert perfect[0][0] == pytest.approx(1.0)
    deficit = vnt.implied_kr_samples({"t": (0.75 * ks, 14.0, 260.0)}, {"t": (1.0, 14.0, 260.0)}, 17.0)
    assert deficit[0][0] == pytest.approx(0.75)
