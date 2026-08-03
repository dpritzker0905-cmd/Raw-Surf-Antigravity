"""Guards for the grid_series vector budget (audit v7 §3, 2026-08-03).

Calibration under test: the budget must bind on every MEASURED MISS and on no MEASURED HIT. Those
figures are live measurements against production on 2026-08-03, not invented fixtures -- see
docs/research/AUDIT-2026-08-03-v7-the-miss-is-the-cost.md §2c. If a future change makes a HIT
decimate, this suite fails and that is the point: the budget is a bound on the fallback, not a
resolution policy.

Every case that expects decimation ASSERTS THE SETUP FIRST (the fixture really is over budget), and
every case that expects no decimation is a KNOWN-PRESENT CONTROL. Both are required: a budget test
that only ever feeds oversized input cannot tell "binds correctly" from "binds always".
"""
import pytest

from services.weather_pipeline.series_vector_budget import (
    DEFAULT_VECTOR_BUDGET,
    apply_vector_budget,
    stamp_coverage,
)


def _frame(cols, rows, hour=0):
    return {
        "hour_offset": hour,
        "cols": cols,
        "rows": rows,
        "vectors": [{"lat": 0.0, "lng": float(i), "speed": 1.0} for i in range(cols * rows)],
    }


def _resp(cols, rows, n_frames, bounds=None):
    return {
        "model": "GFS", "domain": "marine", "layer": "waves",
        "bounds": bounds or {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
        "cols": cols, "rows": rows,
        "frame_count": n_frames,
        "frames": [_frame(cols, rows, h * 3) for h in range(n_frames)],
    }


# ── the measured MISSES: these must be bounded ────────────────────────────────────────────────
@pytest.mark.parametrize("cols,rows,label", [(105, 54, "span-183 wrapped"), (52, 43, "span-80")])
def test_measured_misses_are_decimated(cols, rows, label):
    resp = _resp(cols, rows, 48)
    before = sum(len(f["vectors"]) for f in resp["frames"])
    assert before > DEFAULT_VECTOR_BUDGET, (
        f"SETUP BROKEN: {label} fixture is {before} vectors, not over the {DEFAULT_VECTOR_BUDGET} "
        f"budget — this test would pass without exercising anything"
    )

    out = apply_vector_budget(resp)

    assert out["decimated_stride"] > 1
    assert out["decimated_frames"] == 48
    assert out["vectors_total"] <= DEFAULT_VECTOR_BUDGET
    # The rectangular invariant survives — every downstream transform relies on it.
    for f in out["frames"]:
        assert len(f["vectors"]) == f["cols"] * f["rows"]


# ── the measured HITS: known-present controls, these must NOT be touched ──────────────────────
@pytest.mark.parametrize("cols,rows,label", [
    (5, 5, "span-1"), (20, 10, "span-9.8"), (21, 21, "span-40"),
    (34, 33, "span-41 (1,122/frame — the largest measured HIT)"), (25, 12, "span-360 world"),
])
def test_measured_hits_are_untouched(cols, rows, label):
    resp = _resp(cols, rows, 48)
    before = [len(f["vectors"]) for f in resp["frames"]]
    assert sum(before) <= DEFAULT_VECTOR_BUDGET, f"SETUP BROKEN: {label} should be under budget"

    out = apply_vector_budget(resp)

    assert "decimated_stride" not in out, f"{label} is a HIT and must never be decimated"
    assert [len(f["vectors"]) for f in out["frames"]] == before
    assert out["vectors_total"] == sum(before)


def test_kill_switch_disables_entirely(monkeypatch):
    monkeypatch.setenv("SERIES_VECTOR_BUDGET", "0")
    resp = _resp(105, 54, 48)
    before = sum(len(f["vectors"]) for f in resp["frames"])
    assert before > DEFAULT_VECTOR_BUDGET, "SETUP BROKEN: fixture must be over budget"

    out = apply_vector_budget(resp)

    assert "decimated_stride" not in out
    assert out["vectors_total"] == before


def test_sparse_frame_is_left_alone_not_reshaped():
    """A masked/sparse product (len(vectors) != cols*rows) must be skipped, never reshaped.

    This module may only make a response SMALLER, never WRONG. A grid transform that silently
    reshapes a non-rectangular payload is the recorded 'GRID transforms MUST assert vec==cols*rows'
    landmine.
    """
    resp = _resp(105, 54, 48)
    resp["frames"][0]["vectors"] = resp["frames"][0]["vectors"][:-1]     # one cell masked out
    sparse_len = len(resp["frames"][0]["vectors"])
    assert sparse_len != 105 * 54, "SETUP BROKEN: frame 0 must be non-rectangular"

    out = apply_vector_budget(resp)

    assert len(out["frames"][0]["vectors"]) == sparse_len, "sparse frame was reshaped"
    assert "decimated_stride" not in out["frames"][0]
    assert out["decimated_frames"] == 47, "the other 47 rectangular frames must still be bounded"


def test_no_frames_is_a_noop():
    resp = {"model": "GFS", "frames": []}
    assert apply_vector_budget(resp) == resp


# ── coverage stamping: the tell that was always in the payload ────────────────────────────────
def test_coverage_hit_when_served_bounds_equal_the_request():
    resp = _resp(25, 12, 4, bounds={"west": -86.8623, "south": 25.9723,
                                    "east": -77.0946, "north": 30.8398})
    out = stamp_coverage(resp, "-86.8623,25.9723,-77.0946,30.8398")
    assert out["coverage"] == "hit"


def test_coverage_miss_when_served_bounds_are_inflated():
    """The live span-80 case: requested [-125,0,-45,60], served [-136,-12,-34,72]."""
    resp = _resp(52, 43, 4, bounds={"west": -136.0, "south": -12.0, "east": -34.0, "north": 72.0})
    out = stamp_coverage(resp, "-125,0,-45,60")
    assert out["coverage"] == "miss"


def test_coverage_absent_rather_than_wrong_on_an_unparseable_bbox():
    resp = _resp(25, 12, 2)
    assert "coverage" not in stamp_coverage(resp, "not-a-bbox")
