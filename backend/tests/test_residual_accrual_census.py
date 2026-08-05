"""Guards for the residual-accrual census — the watcher on the resource the height fix is gated on.

⚠️ THE BUG THESE EXIST TO PREVENT is one this script's first draft actually had: the hot archive
nests the comparison under `residual`, the permanent history segments are FLAT. Reading only the
hot shape reported **0 of 0 buoys ready in every band** against 5,928 real rows — a confident zero
that looked exactly like "retention is dead". A census that cannot tell "schema changed" from
"nothing there" must REFUSE, not report.
"""
import importlib.util
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

_spec = importlib.util.spec_from_file_location(
    "residual_accrual_census", BACKEND / "scripts" / "residual_accrual_census.py")
rac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rac)


def _flat(buoy, obs):
    """A permanent-history row."""
    return {"buoy_id": buoy, "buoy_wvht_m": obs, "model_hs_m": obs + 0.1}


def _nested(buoy, obs):
    """A hot-archive row."""
    return {"buoy_id": buoy, "residual": {"buoy_wvht_m": obs, "model_hs_m": obs + 0.1}}


def test_both_schemas_are_read():
    """★ THE REGRESSION. Either shape alone must not silently read as zero."""
    assert rac._observed(_flat("41070", 0.4)) == 0.4
    assert rac._observed(_nested("41070", 0.4)) == 0.4
    assert rac._observed({"buoy_id": "x"}) is None, "a row with no observation must be None, not 0"


def test_readiness_counts_per_buoy_per_band_not_globally():
    """30 rows spread over three buoys is NOT a fittable site; 30 on one buoy is.
    Counting rows globally is the mistake that would declare a per-site fit ready when it is not."""
    spread = [_flat("a", 0.7) for _ in range(10)] + \
             [_flat("b", 0.7) for _ in range(10)] + \
             [_flat("c", 0.7) for _ in range(10)]
    per, used = rac.readiness(spread)
    assert used == 30
    assert sum(1 for b in per if per[b][(0.5, 1.0)] >= rac.MIN_ROWS_TO_FIT) == 0

    concentrated = [_flat("a", 0.7) for _ in range(30)]
    per2, used2 = rac.readiness(concentrated)
    assert used2 == 30
    assert sum(1 for b in per2 if per2[b][(0.5, 1.0)] >= rac.MIN_ROWS_TO_FIT) == 1


def test_rows_land_in_the_band_of_the_OBSERVED_height():
    """The stratification is on the BUOY value, not the model's — stratifying on the model would
    fold the very bias being measured into the bucketing."""
    per, _ = rac.readiness([_flat("a", 0.4), _flat("a", 0.7), _flat("a", 1.2),
                            _flat("a", 2.0), _flat("a", 4.0)])
    counts = per["a"]
    assert counts[(0.0, 0.5)] == 1 and counts[(0.5, 1.0)] == 1 and counts[(1.0, 1.5)] == 1
    assert counts[(1.5, 2.5)] == 1 and counts[(2.5, 10.0)] == 1


def test_a_mixed_archive_counts_every_row():
    """Real input is mixed: history segments plus a hot-archive tail. Neither may be dropped."""
    per, used = rac.readiness([_flat("a", 0.7), _nested("a", 0.7), _nested("b", 2.0)])
    assert used == 3
    assert per["a"][(0.5, 1.0)] == 2 and per["b"][(1.5, 2.5)] == 1


def test_out_of_range_observations_are_not_silently_bucketed():
    """A negative or absurd height is not evidence; it must not be counted into a band."""
    per, used = rac.readiness([_flat("a", -1.0), _flat("a", 99.0), _flat("a", 0.7)])
    assert used == 1, "only the physical row counts"
    assert rac._band_of(-1.0) is None and rac._band_of(99.0) is None


def test_the_stall_bound_is_longer_than_the_rollup_period():
    """The roll-up runs once per UTC day, so a bound at or under 24 h would page on a normal
    schedule — the false-page failure mode this repo just spent a session removing."""
    assert rac.STALL_HOURS >= 48.0
