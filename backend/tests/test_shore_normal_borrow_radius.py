"""
test_shore_normal_borrow_radius.py — the shore normal and the break depth do NOT share a radius.

THE DEFECT THIS PINS
--------------------
`MATCH_RADIUS_KM = 1.0` was the single radius behind BOTH public accessors, because `_nearest`
returns ONE tuple and `shore_normal_at` reads element 2 while `break_depth_at` reads element 4.
They are not the same kind of quantity. A coastline's ORIENTATION is smooth over kilometres; the
depth a wave BREAKS in is a property of one peak's bottom, and a reef and a sandbar 2 km apart are
unrelated.

Measured 2026-08-02 by hold-out over all 1,386 gate-passed entries (borrow the nearest OTHER entry,
grade against the held-out one):

    borrowed at 3 km      shore normal          break depth
    p50 error             4.3 deg               25.7% relative
    bad tail              >45 deg at 0.6%       >2x off at 7.6%

At 1 km the depth is fine (p50 9.1%). So the one constant was calibrated for the DEPTH and starved
the BEARING — which is the #1 Jacobian variable (7.4 rating points at the median coarse error,
28.1 at +45 deg). Live (n=1773, `sim_forecast.fetch_catalog()`): 391 catalogue spots fall back to
the 0.25 deg grid and 91 of them have a
gate-passed entry between 1 and 3 km away.

⚠️ THE ETOPO HOLD-OUT ABOVE IS SELF-CONSISTENCY, and `scripts/validate_shore_normals_osm.py`'s
header says exactly why that cannot detect a systematically wrong bearing. Graded against OSM
coastline winding — which shares nothing with ETOPO — over 113 of the affected spots:

    p50 / mean / >45 deg / >90 deg     COARSE 38.7 / 49.2 / 43.4% / 16.8%
                                     BORROWED 12.6 / 31.7 / 21.2% /  9.7%   better 73.5%

The RANKING held; the MAGNITUDE did not. Quote 12.6, never 4.3. And 30 of 113 got WORSE —
borrowing is not free, it is better on the median and in both tails.

WHY THE SPLIT NEEDS NO SECOND SEARCH
`_nearest`'s docstring records that `shore_normal_at` and `break_depth_at` once carried SEPARATE
copies of the search, and that the 2026-07-29 audit named that a blocker: wiring one and not the
other leaves the depth cap dead while the bearing looks fixed. That invariant is preserved here —
there is still exactly ONE search function, and it already took `max_km`. Only the DEFAULT differs.
"""
import json
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import shore_normal_asset as sna  # noqa: E402

# ~111.19 km per degree of latitude. Distances are asserted against the module's own haversine
# below rather than trusted from this constant — a test whose SETUP silently lands in the wrong
# distance band passes under the very defect it guards (the repo's own 2 dp cache-key scar).
_KM_PER_DEG_LAT = 111.19


@pytest.fixture
def asset(tmp_path, monkeypatch):
    def _write(entries, **extra):
        path = tmp_path / "shore_normals.json"
        path.write_text(json.dumps({"source": "test", "count": len(entries),
                                    "entries": entries, **extra}))
        monkeypatch.setattr(sna, "_ASSET", str(path))
        sna._reset_for_tests()
        return path
    yield _write
    sna._reset_for_tests()


@pytest.fixture
def no_overlay(tmp_path, monkeypatch):
    """Point the overlay at a path that does not exist, so these tests read the asset alone."""
    monkeypatch.setattr(sna, "_OVERLAY", str(tmp_path / "absent_overlay.json"))
    sna._reset_for_tests()


def _at_km(lat, lng, km):
    """A coordinate ``km`` due north, with the separation ASSERTED, not assumed."""
    moved = (lat + km / _KM_PER_DEG_LAT, lng)
    actual = sna._haversine_km(lat, lng, *moved)
    assert abs(actual - km) < 0.02, f"setup landed at {actual:.3f} km, not {km} km"
    return moved


def test_the_two_radii_are_not_the_same_number():
    """The whole point: one constant cannot serve two correlation lengths."""
    assert sna.BEARING_RADIUS_KM > sna.MATCH_RADIUS_KM
    assert sna.MATCH_RADIUS_KM == 1.0, "the depth radius is measured-correct — do not widen it"
    assert sna.BEARING_RADIUS_KM == 3.0


def test_bearing_borrows_from_a_gate_passed_entry_beyond_one_km(asset, no_overlay):
    """THE DEFECT. A gate-passed bearing 2 km away was refused, and the spot fell back to the
    0.25 deg grid — a bearing decided from a 194.6 km window."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0]])
    normal, spread = sna.shore_normal_at(*_at_km(34.0, -120.0, 2.0))
    assert normal == pytest.approx(287.4)
    assert spread == pytest.approx(6.1)


def test_break_depth_does_NOT_borrow_beyond_one_km(asset, no_overlay):
    """THE GUARD AGAINST THE BLUNT FIX. v2 proposed widening `MATCH_RADIUS_KM` itself, which would
    have moved the depth too: 25.7% median error and 7.6% off by more than 2x at 3 km. A depth
    borrowed too shallow caps the breaking height at a number the spot never sees."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0]])
    far = _at_km(34.0, -120.0, 2.0)
    assert sna.shore_normal_at(*far)[0] == pytest.approx(287.4), "bearing must still borrow"
    assert sna.break_depth_at(*far) is None, "depth must NOT borrow at 2 km"


def test_depth_still_borrows_inside_one_km(asset, no_overlay):
    """The depth radius is not disabled — it is unchanged. At 1 km the borrow is p50 9.1% off."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0]])
    assert sna.break_depth_at(*_at_km(34.0, -120.0, 0.4)) == pytest.approx(8.0)


def test_widening_is_inert_for_spots_that_were_already_covered(asset, no_overlay):
    """Nearest-wins means a wider radius can only ADD matches. Measured over the live catalogue:
    0 of the 808 already-covered spots change which entry answers."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0],           # 0.3 km away — the incumbent
           [34.03, -120.0, 111.1, 5.0, 30.0]])        # 2.5 km away — must not take over
    near = _at_km(34.0, -120.0, 0.3)
    assert sna.shore_normal_at(*near)[0] == pytest.approx(287.4)
    assert sna.break_depth_at(*near) == pytest.approx(8.0)


def test_beyond_the_bearing_radius_still_falls_back(asset, no_overlay):
    """The radius moved; it did not disappear. 5 km away is somebody else's coast."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0]])
    assert sna.shore_normal_at(*_at_km(34.0, -120.0, 5.0)) == (None, None)


def test_kill_switch_restores_the_single_one_km_radius(asset, no_overlay, monkeypatch):
    """SHORE_NORMAL_BEARING_RADIUS_KM=1.0 reproduces the pre-change behaviour exactly."""
    asset([[34.0, -120.0, 287.4, 6.1, 8.0]])
    monkeypatch.setenv("SHORE_NORMAL_BEARING_RADIUS_KM", "1.0")
    sna._reset_for_tests()
    assert sna.shore_normal_at(*_at_km(34.0, -120.0, 2.0)) == (None, None)


def test_a_depth_only_overlay_entry_survives_a_borrowed_bearing(asset, tmp_path, monkeypatch):
    """★ THE DISPLACEMENT CASE the split exists to avoid.

    The overlay holds DEPTH-ONLY entries at a spot's own coordinate (normal=None). The committed
    asset outranks the overlay, so widening ONE shared radius would have let an asset entry 2 km
    away answer instead — handing the spot a borrowed depth and DISCARDING a measurement taken at
    its own coordinate. Measured 2026-08-02: that would have hit 3 of the 5 live overlay entries.

    With a per-quantity radius the spot gets BOTH: the bearing borrowed from 2 km, the depth from
    its own coordinate."""
    asset([[34.0, -120.0, 287.4, 6.1, 30.0]])
    spot = _at_km(34.0, -120.0, 2.0)
    ov = tmp_path / "overlay.json"
    ov.write_text(json.dumps({"entries": [[spot[0], spot[1], None, None, 4.2]]}))
    monkeypatch.setattr(sna, "_OVERLAY", str(ov))
    sna._reset_for_tests()

    assert sna.shore_normal_at(*spot)[0] == pytest.approx(287.4), "bearing borrowed from the asset"
    assert sna.break_depth_at(*spot) == pytest.approx(4.2), "depth kept from the spot's OWN entry"


def test_bucket_scan_covers_the_whole_radius_it_is_given(asset, no_overlay):
    """★ THE ADJACENT BREAKAGE a bigger radius introduces, and the trap in testing it.

    `_scan` walked a fixed ±1 spatial-hash bucket (0.1°). One bucket of LONGITUDE shrinks with
    latitude — 5.6 km at 60°, 4.7 km at 65°, 2.9 km at 75° — so a fixed ±1 covers a radius only
    while 2 bucket-widths exceed it. Beyond that an entry lands two buckets away, is never scanned,
    and the spot silently falls back to the coarse bearing: the exact defect this module was
    changed to fix, reappearing where nobody looks.

    ⚠️ MY FIRST VERSION OF THIS TEST PASSED UNDER THE DEFECT. It used 2 km at 75°, where one bucket
    is already 2.88 km — so ±1 covered it and re-hardcoding the span left the test green. A
    separation only exercises a coarser bucketing if it lands OUTSIDE the adjacent cells, which is
    why the bucket indices are asserted below rather than assumed from the distance.

    Written at 10 km / 65° because that combination is REACHABLE: the asset already holds entries
    to 68.27°, and the hold-out that set the 3 km radius also measured 5 km and 10 km as candidates.
    At the shipped 3 km radius a fixed ±1 only fails above ~82°, which is why this is a guard
    against the NEXT radius change rather than a live defect today."""
    lat, base_lng = 65.0, -120.0
    east = (lat, base_lng + 9.7 / (_KM_PER_DEG_LAT * math.cos(math.radians(lat))))
    km = sna._haversine_km(lat, base_lng, *east)
    assert 9.0 < km < 10.0, f"setup landed at {km:.2f} km — outside the radius under test"
    # THE CONTROL: prove the entry really is beyond the adjacent buckets, or this tests nothing.
    assert abs(sna._bucket(*east)[1] - sna._bucket(lat, base_lng)[1]) >= 2, \
        "entry landed in an adjacent bucket — a fixed +/-1 scan would find it and the test is inert"

    asset([[lat, base_lng, 287.4, 6.1, 8.0]])
    assert sna.shore_normal_at(*east, max_km=10.0)[0] == pytest.approx(287.4)
