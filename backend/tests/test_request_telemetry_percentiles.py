"""The telemetry must not print a bound as though it were a measurement.

⭐ WRITTEN AFTER IT FOOLED ITS OWN AUTHOR (2026-08-10). Production reported
`GET /api/photographers/featured  n=5  p50=85778.1  p90=85778.1  p99=85778.1` and I read it to
the owner as "every request ~86 s" and "users are hitting 86-second responses right now". Both
wrong, two different ways:
  1. The percentile had landed in the OVERFLOW bucket, where the code returned `max_ms`. All that
     was actually known is "p50 >= 10000". A live call to the same route took 1.02 s.
  2. The snapshot is CUMULATIVE since process start, so it carries a stall from 47 minutes earlier
     and is not a current-latency reading at all.
The module's own docstring said "read high, never low" and I still read it as exact. A number that
requires a docstring to interpret will be misread; the payload has to say it itself.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.request_telemetry as t                      # noqa: E402

TOP = t.BUCKET_BOUNDS_MS[-1]                                 # 10000 ms


def _fresh():
    t._routes.clear()


def _route(snap, needle):
    return next(r for r in snap["top_routes"] if needle in r["route"])


def test_an_overflow_percentile_is_MARKED_not_printed_as_a_measurement():
    _fresh()
    for ms in (TOP + 2000.0, TOP + 10000.0, 85778.1):        # 3 of 5 over the top bound
        t.record("GET", "/slow", 200, ms)
    for _ in range(2):
        t.record("GET", "/slow", 200, 4.0)
    r = _route(t.snapshot(), "/slow")
    assert r["p50_ge_ms"] == float(TOP), (
        "an overflow percentile must declare its LOWER BOUND -- without this the printed "
        "p50 is max_ms wearing a percentile's name")
    assert r["over_%dms" % TOP] == 3, (
        "the reader needs the COUNT over the bound to tell one outlier from a systemic stall")
    assert r["max_ms"] == 85778.1


def test_a_clean_route_carries_NO_markers_so_the_marker_means_something():
    _fresh()
    for _ in range(20):
        t.record("GET", "/fast", 200, 8.0)
    r = _route(t.snapshot(), "/fast")
    assert "p50_ge_ms" not in r and "p99_ge_ms" not in r
    assert not any(k.startswith("over_") for k in r), (
        "a marker that appears on healthy rows is noise, and noise gets ignored")


def test_a_percentile_never_exceeds_the_observed_MAX():
    """The second defect, found while proving the first: five 8 ms requests reported
    p50 = p90 = p99 = 10.0 beside max = 8.0 -- a percentile above the maximum, which reads as a
    bug and undermines trust in the rest of the payload."""
    _fresh()
    for _ in range(5):
        t.record("GET", "/fast", 200, 8.0)
    r = _route(t.snapshot(), "/fast")
    for k in ("p50_ms", "p90_ms", "p99_ms"):
        assert r[k] <= r["max_ms"], "%s (%s) exceeds max_ms (%s)" % (k, r[k], r["max_ms"])
    assert r["p99_ms"] == 8.0


def test_percentiles_still_READ_HIGH_within_a_bucket():
    """The upper-bound property is deliberate and must survive the min() cap: a 6 ms request sits
    in the <=10 ms bucket and is reported at its own max, never rounded DOWN to a smaller bound."""
    _fresh()
    t.record("GET", "/x", 200, 6.0)
    t.record("GET", "/x", 200, 9.0)
    r = _route(t.snapshot(), "/x")
    assert r["p99_ms"] >= 9.0


def test_the_note_says_cumulative_and_says_what_the_marker_means():
    _fresh()
    t.record("GET", "/x", 200, 1.0)
    note = t.snapshot()["note"].lower()
    assert "cumulative" in note, "the reader must know this is history, not a live reading"
    assert "ge_ms" in note or ">=" in note
    assert "not a measurement" in note or "merely max_ms" in note


def test_the_totals_block_marks_overflow_too():
    """The owner-facing summary reads `total`, so a marker only on per-route rows would leave the
    headline number exactly as misleading as before."""
    _fresh()
    for ms in (TOP + 5000.0, TOP + 6000.0, TOP + 7000.0):
        t.record("GET", "/slow", 200, ms)
    total = t.snapshot()["total"]
    assert total["p50_ge_ms"] == float(TOP)
    assert total["over_%dms" % TOP] == 3
