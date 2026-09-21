"""
memory_trace — the instrument for "does the degradation track process uptime?"

WHY IT EXISTS. 2026-09-21: a 13h42m-old backend showed 4.6% 5xx, 11.4% of requests over 10 s and
85.3% of its cgroup memory limit. A restart cleared all of it — 0.0% 5xx, p50 25 ms, 0.3% over
10 s — **under higher load** (0.64 req/s vs 0.37). That points at process lifetime rather than
load, but it rests on two snapshots of two DIFFERENT processes, which is not a growth series and
cannot become one. ⭐ Comparing a 4-hour process to a 14-hour process shows they differ; it cannot
show that either GREW, because they never shared a starting point.

⚠️ THESE TESTS DO NOT DETECT A LEAK. There is none to detect locally — no traffic, no scheduler, no
production workload. They prove the INSTRUMENT is trustworthy: that it records, that it bounds its
own footprint, that a broken probe costs one gauge rather than the sample, and — the one that
matters — that it reports growth only when growth actually happened.

⭐⭐ THE INSTRUMENT IS THE DELIVERABLE HERE, AND AN INSTRUMENT MUST BE VERIFIED AGAINST A KNOWN
ANSWER BEFORE IT IS POINTED AT AN UNKNOWN ONE. A leak detector that reports growth for a flat
series would send the next session hunting a cache that never moved.
"""
import pytest

from services import memory_trace


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("MEMORY_TRACE", raising=False)
    memory_trace._reset_for_test()
    yield
    memory_trace._reset_for_test()


class TestItRecords:
    def test_a_sample_carries_uptime_rss_and_the_gauges(self):
        memory_trace.register_gauge("thing", lambda: 7)
        s = memory_trace.sample()
        assert s is not None
        assert s["uptime_s"] >= 0
        assert s["sizes"]["thing"] == 7
        assert len(memory_trace.history()) == 1

    def test_rss_is_a_number_or_None_but_never_zero_as_a_stand_in(self):
        s = memory_trace.sample()
        assert s["rss_mb"] is None or s["rss_mb"] > 0, (
            "0.0 would read as 'a process using no memory' — unmeasured must stay None"
        )


class TestItCannotItselfLeak:
    def test_history_is_capped(self):
        # The instrument runs on the box it measures. A history that grew without bound would BE
        # the leak it was installed to find.
        for _ in range(memory_trace.MAX_SAMPLES + 50):
            memory_trace.sample()
        assert len(memory_trace.history()) == memory_trace.MAX_SAMPLES

    def test_the_cap_spans_the_window_the_degradation_was_seen_in(self):
        # 5-minute cadence × MAX_SAMPLES must cover the ~14 h in which the box degraded, or the
        # series would age out before it could show the slope.
        hours = memory_trace.MAX_SAMPLES * 5 / 60
        assert hours >= 14, f"history spans only {hours:.1f}h; the degradation took ~14h"

    def test_the_oldest_samples_are_dropped_not_the_newest(self):
        memory_trace.register_gauge("n", lambda: len(memory_trace.history()))
        for _ in range(memory_trace.MAX_SAMPLES + 5):
            memory_trace.sample()
        first = memory_trace.history()[0]["sizes"]["n"]
        assert first > 0, "a fixed-length ring must evict from the LEFT, keeping recent history"


class TestItFailsSafe:
    def test_a_throwing_gauge_costs_one_value_not_the_sample(self):
        memory_trace.register_gauge("bad", lambda: (_ for _ in ()).throw(RuntimeError("probe")))
        memory_trace.register_gauge("good", lambda: 3)
        s = memory_trace.sample()
        assert s["sizes"]["bad"] is None
        assert s["sizes"]["good"] == 3, "a broken probe must not poison its neighbours"

    def test_the_kill_switch_stops_sampling(self, monkeypatch):
        memory_trace.sample()
        assert len(memory_trace.history()) == 1      # control: it WAS recording
        monkeypatch.setenv("MEMORY_TRACE", "0")
        assert memory_trace.sample() is None
        assert len(memory_trace.history()) == 1, "nothing may be appended while disabled"

    def test_registering_the_real_gauges_never_raises(self):
        """
        Every default gauge imports a production module by name. A rename must cost ONE missing
        gauge, never a failed startup — this runs inside start_scheduler().
        """
        memory_trace.register_default_gauges()
        s = memory_trace.sample()
        assert s is not None
        assert s["sizes"], "the default registration produced no gauges at all"

    def test_the_default_set_includes_both_suspects_and_controls(self):
        memory_trace.register_default_gauges()
        names = set(memory_trace.sample()["sizes"])
        for suspect in ("geometry_cache", "catalog_cache", "depth_cache", "negative_cache"):
            assert suspect in names, f"{suspect} is an unbounded cache and must be watched"
        controls = [n for n in names if n.endswith("_CONTROL")]
        assert controls, (
            "without a bounded control, a growing gauge cannot be distinguished from 'everything "
            "grows here' — and an all-flat result could not be read as 'look somewhere else'"
        )


class TestTheSummaryTellsTheTruth:
    def test_it_refuses_to_state_a_rate_from_one_point(self):
        memory_trace.sample()
        out = memory_trace.growth_summary()
        assert "rss_mb_per_hour" not in out
        assert out["samples"] == 1
        assert "note" in out, "it must say WHY it is not answering, not just omit the answer"

    def test_a_flat_gauge_is_not_reported_as_growing(self):
        """⭐ THE CONTROL THAT MATTERS. A detector that flags a flat series would send the next
        session hunting a cache that never moved."""
        memory_trace.register_gauge("flat", lambda: 42)
        memory_trace.sample()
        memory_trace.sample()
        assert memory_trace.growth_summary()["growing"] == {}

    def test_a_climbing_gauge_is_reported_with_its_rate(self):
        seq = iter([100, 200])
        memory_trace.register_gauge("climber", lambda: next(seq))
        memory_trace.sample()
        memory_trace.sample()
        growing = memory_trace.growth_summary()["growing"]
        assert "climber" in growing
        assert growing["climber"]["first"] == 100
        assert growing["climber"]["last"] == 200
        assert growing["climber"]["per_hour"] > 0

    def test_a_SHRINKING_gauge_is_also_surfaced(self):
        # An eviction path that suddenly starts discarding far more than it should is a defect too,
        # and a summary that only looked for growth would be blind to it.
        seq = iter([500, 100])
        memory_trace.register_gauge("shrinker", lambda: next(seq))
        memory_trace.sample()
        memory_trace.sample()
        assert memory_trace.growth_summary()["growing"]["shrinker"]["per_hour"] < 0

    def test_the_raw_series_is_available_for_judging_the_summary(self):
        memory_trace.register_gauge("g", lambda: 1)
        memory_trace.sample()
        memory_trace.sample()
        h = memory_trace.history()
        assert len(h) == 2 and all("uptime_s" in s and "sizes" in s for s in h), (
            "growth_summary() is two endpoints; the series is what lets a reader disagree with it"
        )
