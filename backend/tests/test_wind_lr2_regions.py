"""Amendment R1: ALASKA and CARIBBEAN_PR are fixed gated regions of the long-range wind v2 registration. The rule is reproducible
from the committed frozen station list (sha256 pinned), fixed before any fit, score or forecast read, and changes no floor."""
import hashlib
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_fit as F  # noqa: E402
import wind_lr2_runs as R  # noqa: E402
import wind_lr2_stats as S  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIST = os.path.join(ROOT, "docs", "weather-program", "evidence", "wind-long-range-v2", "wind_lr2_stations.json")
LIST_SHA256 = "ec87dc04d27caaab75cb3b021c0620f2acccb3f3d55a168b97394c61393602c8"      # run 45253166505, PR #1240


@pytest.mark.parametrize("name,lat,lon,want", [
    ("Sitka", 57.05, -135.33, "ALASKA"), ("Kodiak", 57.79, -152.41, "ALASKA"), ("Adak (Aleutians)", 51.88, -176.65, "ALASKA"),
    ("Aleutians as 183 E", 51.88, 183.35, "ALASKA"), ("Haida Gwaii", 53.0, -132.0, "ALASKA"),
    ("lat 50.0 exactly is US_PACIFIC (tested first)", 50.0, -130.0, "US_PACIFIC"), ("just north of 50", 50.01, -130.0, "ALASKA"),
    ("west coast Vancouver Island", 49.0, -125.6, "US_PACIFIC"), ("east of 125 W at 55 N", 55.0, -120.0, "OTHER"),
    ("San Juan PR", 18.46, -66.10, "CARIBBEAN_PR"), ("Virgin Islands", 18.34, -64.93, "CARIBBEAN_PR"),
    ("Cozumel", 20.5, -86.8, "CARIBBEAN_PR"), ("Barbados", 13.1, -59.6, "CARIBBEAN_PR"),
    ("Key West stays Atlantic/Gulf", 24.55, -81.80, "US_ATLANTIC_GULF"), ("24.0 N is Atlantic/Gulf", 24.0, -81.8, "US_ATLANTIC_GULF"),
    ("23.99 N is Caribbean", 23.99, -81.8, "CARIBBEAN_PR"), ("Gulf of Mexico west of 90 W", 22.0, -94.0, "OTHER"),
    ("Hawaii unchanged", 21.6, -158.0, "HAWAII"), ("US Pacific unchanged", 34.0, -120.5, "US_PACIFIC"),
    ("Bermuda unchanged", 32.3, -64.75, "US_ATLANTIC_GULF"), ("Great Lakes still excluded", 46.79, -92.10, "GREAT_LAKES")])
def test_new_regions_and_their_boundaries(name, lat, lon, want):
    assert R.region_of(lat, lon) == want, name


def test_regions_list_has_the_five_registered_plus_the_two_fixed_new_ones():
    assert R.REGIONS == ["US_PACIFIC", "US_ATLANTIC_GULF", "HAWAII", "EUROPE_ATLANTIC", "MEDITERRANEAN", "ALASKA", "CARIBBEAN_PR"]
    assert "GREAT_LAKES" in R.EXCLUDED_REGIONS and "BLACK_SEA" not in R.REGIONS


def test_region_assignment_is_reproducible_from_the_committed_frozen_list():
    body = open(LIST, "rb").read()
    assert hashlib.sha256(body).hexdigest() == LIST_SHA256                  # the list the amendment cites, unchanged
    doc = json.loads(body)
    counts = {}
    for kind in ("ndbc", "asos"):
        for s in doc[kind]:
            counts.setdefault((kind, R.region_of(s["lat"], s["lon"])), 0)
            counts[(kind, R.region_of(s["lat"], s["lon"]))] += 1
    by = {}
    for (k, r), n in counts.items():
        by[r] = by.get(r, 0) + n
    assert by == {"US_ATLANTIC_GULF": 223, "US_PACIFIC": 80, "HAWAII": 11, "ALASKA": 120, "CARIBBEAN_PR": 10,
                  "EUROPE_ATLANTIC": 3, "GREAT_LAKES": 76}, by             # the OTHER pool of 130 is exactly ALASKA 120 + CARIBBEAN_PR 10
    assert ("ndbc", "ALASKA") in counts and counts[("ndbc", "ALASKA")] == 107 and counts[("ndbc", "CARIBBEAN_PR")] == 10
    assert not any(r == "OTHER" for (_k, r) in counts)


def test_no_floor_changed_by_the_new_regions():
    assert (S.MIN_STATIONS_PER_REGION, S.MIN_REGIONS_WITH_STATIONS, S.MIN_STATION_COVER) == (10, 3, 0.70)
    assert S.MIN_TEST_RUNS == 80 and S.MIN_VALID_DAYS == 45 and S.MIN_BLOCKS == 9
    ok = {"US_PACIFIC": 12, "US_ATLANTIC_GULF": 30, "ALASKA": 15, "HAWAII": 3}
    import numpy as _np
    days = _np.arange(739000, 739050)
    assert S.check_floors(90, days, ok) == []                               # three sufficient regions: met, Hawaii only "insufficient"
    assert any("regions" in x for x in S.check_floors(90, days, {"US_PACIFIC": 12, "US_ATLANTIC_GULF": 30, "ALASKA": 9}))   # 9 < 10: VOID as registered


def test_a_new_region_gets_its_own_cell_when_it_has_the_data_and_borrows_when_it_does_not():
    rng = np.random.default_rng(3)
    n = 2400
    c_u, c_v = rng.normal(0, 1, n), rng.normal(0, 1, n)
    m_u, m_v = c_u + rng.normal(0, 3, n), c_v + rng.normal(0, 3, n)
    o_u, o_v = c_u + 0.4 * (m_u - c_u) + rng.normal(0, 0.5, n), c_v + 0.4 * (m_v - c_v) + rng.normal(0, 0.5, n)
    day = rng.integers(0, 120, n)
    rows = {"m_u": m_u, "m_v": m_v, "s": np.hypot(m_u, m_v) + 2, "c_u": c_u, "c_v": c_v, "c_s": np.full(n, 5.0), "o_u": o_u,
            "o_v": o_v, "o_s": np.hypot(o_u, o_v), "o_gust": np.hypot(o_u, o_v) * 1.4, "block": day // 5, "day": day,
            "station": rng.integers(0, 40, n), "lead": rng.choice([198, 240, 300], n),
            "region": np.array(["US_PACIFIC"] * 1200 + ["ALASKA"] * 1170 + ["CARIBBEAN_PR"] * 30)}
    regs = F.fit_all(rows, "GRAND_CAL")["bins"]["B2"]["regions"]
    assert regs["ALASKA"]["borrowed"] is False and regs["CARIBBEAN_PR"]["borrowed"] is True
    assert F.coef_at(F.fit_all(rows, "GRAND_CAL"), "ALASKA", 240.0)["alpha"] == pytest.approx(regs["ALASKA"]["alpha"])
