"""
grid_series — the overall deadline must actually BOUND the response, not just gate new work.

THE DEFECT THIS PINS. `OVERALL_DEADLINE` (20 s) was chosen to sit under `NETLIFY_PROXY_WINDOW_S`
(26 s), and the comment above it states exactly why:

    "a build that runs past it is a TOTAL loss (the client sees 'Fetch failed' and caches zero
     frames) even though partial frames were ready ... The deadline must sit UNDER the window with
     headroom for in-flight per-hour builds (~1s each measured) + transfer"

But the per-hour BOUND is `PER_HOUR_TIMEOUT` = 10 s (16 s during an L2 restore), not ~1 s. The
deadline was only ever checked BEFORE starting an hour, so an hour that passed that check at
t=19.9 s could still run until t=29.9 s — past the 26 s proxy window, producing precisely the total
loss the deadline exists to prevent.

⭐ THE CLASS: **the headroom was sized against the TYPICAL cost instead of against the BOUND it
exists to contain.** A margin computed from an average cannot contain a worst case.

⭐ IT RECONCILES WITH PRODUCTION. Live telemetry 2026-09-21: `GET /api/weather/grid_series`
p90 = **37,516 ms** against a 20 s deadline and a 26 s window, with 148 of 299 calls over 10 s. A
deadline that is exceeded at p90 by 17 s is not bounding anything. Worst case under the old code —
hour 0 at the cold budget (16 s) plus a gather wave starting just under the deadline and running a
full 10 s — lands at ~30 s before transfer, which is the observed shape.

⚠️ AND IT REPRODUCES IN BOTH SERVICE STATES, which is why this is not a symptom of something else.
The same day, the backend was found saturated (4.6% 5xx, 11.4% of all requests over 10 s, memory at
85.3% of its cgroup limit) on a 14-hour-old process. A restart cleared that entirely — 0.0% 5xx,
p50 25 ms, 0.3% over 10 s, under HIGHER load — and `grid_series` still read **p90 33,446 ms with 21
of 81 calls over 10 s**. ⭐⭐ A DEFECT THAT SURVIVES THE THING THAT FIXED EVERYTHING AROUND IT IS ITS
OWN DEFECT: the saturation and this deadline were separate causes that happened to be measured in
one sitting, and only the second reading could tell them apart.

These tests drive `_build_one`'s timeout arithmetic directly with an injected clock. They do NOT
measure real latency; no local backend or provider exists. What they prove is that no hour can be
granted a budget that runs past the deadline, and — the control — that an hour with plenty of time
left still gets its full normal budget.
"""
import pytest

from services.weather_pipeline import grid_series_helper as gsh


def _budget(remaining: float, per_hour: float) -> float:
    """
    The arithmetic the route performs inside the semaphore: an hour may have, at most, the time
    actually left before the deadline. Mirrored here so the property can be tested without standing
    up a provider, a store and an event loop — and pinned against the module's real constants below
    so it cannot drift into testing a private copy of the rule.
    """
    return min(per_hour, remaining)


class TestTheBoundItself:
    def test_a_late_hour_is_clamped_to_what_is_left(self):
        # The exact defect: 0.1 s left on the clock must not buy a 10 s budget.
        assert _budget(0.1, gsh.PER_HOUR_TIMEOUT) == pytest.approx(0.1)

    def test_an_early_hour_keeps_its_full_budget(self):
        """THE CONTROL. Without it, an implementation that always returned a tiny budget — which
        would truncate every series — would pass the test above."""
        assert _budget(20.0, gsh.PER_HOUR_TIMEOUT) == gsh.PER_HOUR_TIMEOUT

    def test_the_cold_restore_budget_is_preserved_at_the_start_of_a_request(self):
        """
        The first hour is built serially at t≈0, so it still gets PER_HOUR_TIMEOUT_COLD in full
        during an L2 restore. That mattered enough to have its own root-cause note
        (2026-07-06: the first mid-tier series after a restart returned frame_count:0), so the
        clamp must not quietly claw it back.
        """
        assert _budget(gsh.OVERALL_DEADLINE, gsh.PER_HOUR_TIMEOUT_COLD) == gsh.PER_HOUR_TIMEOUT_COLD

    @pytest.mark.parametrize("remaining", [0.0, -0.5, -30.0])
    def test_no_budget_at_or_past_the_deadline(self, remaining):
        assert _budget(remaining, gsh.PER_HOUR_TIMEOUT) <= 0


class TestTheWorstCaseNowFitsTheProxyWindow:
    """
    The whole point of the deadline is to keep the RESPONSE inside Netlify's ~26 s cut, because
    overrunning it loses every frame rather than some.
    """

    def test_the_old_worst_case_overran_the_proxy_window(self):
        """
        Reproduces the defect arithmetically, so this file documents what was wrong rather than
        only asserting what is now right. An hour starting at deadline-epsilon used to receive a
        full PER_HOUR_TIMEOUT regardless of the clock.
        """
        old_worst = gsh.OVERALL_DEADLINE + gsh.PER_HOUR_TIMEOUT
        assert old_worst > gsh.NETLIFY_PROXY_WINDOW_S, (
            "if this no longer overruns, the constants moved and this defect's premise changed"
        )

    def test_the_clamped_worst_case_fits(self):
        # With the clamp, no hour can be granted time past the deadline, so the build cannot exceed
        # OVERALL_DEADLINE — leaving the window's remaining margin for transfer.
        clamped_worst = gsh.OVERALL_DEADLINE + _budget(0.0, gsh.PER_HOUR_TIMEOUT)
        assert clamped_worst <= gsh.OVERALL_DEADLINE
        assert clamped_worst < gsh.NETLIFY_PROXY_WINDOW_S

    def test_there_is_real_transfer_headroom_left(self):
        """A bound that exactly equals the window leaves nothing for sending the bytes."""
        assert gsh.NETLIFY_PROXY_WINDOW_S - gsh.OVERALL_DEADLINE >= 5.0


class TestTheConstantsStillHoldTheRelationshipsThisDependsOn:
    """
    Every argument above is an inequality between four constants. If one moves without the others,
    the reasoning silently stops applying — so pin the relationships, not the values.
    """

    def test_the_deadline_sits_under_the_proxy_window(self):
        assert gsh.OVERALL_DEADLINE < gsh.NETLIFY_PROXY_WINDOW_S

    def test_the_cold_budget_stays_under_the_deadline(self):
        # Its own comment requires this: a larger value "would push the whole response past the
        # proxy cut during every restore".
        assert gsh.PER_HOUR_TIMEOUT_COLD < gsh.OVERALL_DEADLINE

    def test_the_per_hour_bound_is_nowhere_near_the_typical_cost_the_headroom_assumed(self):
        """
        The root of the defect, kept as an executable statement: the deadline's headroom note cites
        "~1s each measured" while the bound is an order of magnitude larger. Anyone who tightens
        OVERALL_DEADLINE towards the window in future needs to see this.
        """
        assert gsh.PER_HOUR_TIMEOUT >= 10 * 1.0


def test_the_route_really_clamps_rather_than_calling_the_bare_timeout():
    """
    ⭐ THE LOAD-BEARING TEST. Everything above exercises arithmetic that lives in THIS file; it
    would all pass against a route that still granted `_per_hour_timeout()` unconditionally. This
    asserts the call site itself takes the remaining time into account.
    """
    import inspect
    src = inspect.getsource(gsh._build_grid_series_impl)
    assert "_remaining = deadline - time.monotonic()" in src, (
        "the per-hour budget must be computed from the clock, not from the constant alone"
    )
    assert "min(_per_hour_timeout(), _remaining)" in src, (
        "the per-hour timeout must be clamped to the time actually left before the deadline"
    )


@pytest.mark.parametrize("stage", ["first_hour", "later_hours", "euro_fastpath", "openmeteo_fastpath"])
def test_cancelled_series_propagates_without_starting_fallback(monkeypatch, stage):
    """Cancel the real builder, not a copied rule; abandoned pages must stop fan-out."""
    import asyncio
    from services.weather_pipeline import regional_tile_first

    async def scenario():
        entered = asyncio.Event()
        calls = []
        active = set()

        async def resolve(**kwargs):
            calls.append(kwargs["valid_time"])
            if stage.endswith("fastpath") or (stage == "later_hours" and len(calls) == 1):
                return None
            key = kwargs["valid_time"]
            active.add(key)
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                active.remove(key)

        async def fastpath(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()

        async def no_coverage(*args, **kwargs):
            return False

        monkeypatch.setenv("EURO_SERIES_LIVE_COPERNICUS", "1" if stage == "euro_fastpath" else "0")
        monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1" if stage == "openmeteo_fastpath" else "0")
        monkeypatch.setattr(gsh, "_build_euro_marine_series", fastpath)
        monkeypatch.setattr(gsh, "_build_openmeteo_marine_series", fastpath)
        monkeypatch.setattr(gsh, "has_stored_series_coverage", no_coverage)
        monkeypatch.setattr(gsh, "live_lane_cannot_beat_stored", no_coverage)
        monkeypatch.setattr(regional_tile_first, "skips_live_series", lambda *args: False)
        model = "EURO" if stage == "euro_fastpath" else "GFS"
        hours = "0,243" if stage == "euro_fastpath" else "0,1,2,3,4,5"
        task = asyncio.create_task(gsh.build_grid_series(
            resolve, object() if stage.endswith("fastpath") else None,
            model, "marine", "waves", "-82,26,-78,30", hours))
        try:
            await asyncio.wait_for(entered.wait(), 3)
            before = len(calls)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 3)
            await asyncio.sleep(0)
            assert len(calls) == before, "cancellation started more resolver work"
            assert task.cancelled()
            assert not active, "resolver cleanup must finish before the cancelled page returns"
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", [TimeoutError, RuntimeError])
def test_series_fastpath_failure_still_uses_per_hour_fallback(monkeypatch, failure):
    """Ordinary provider errors/timeouts are recoverable; caller cancellation is not."""
    import asyncio
    from services.weather_pipeline import regional_tile_first

    async def scenario():
        calls = []

        async def resolve(**kwargs):
            calls.append(kwargs["valid_time"])
            return None

        async def fastpath(*args, **kwargs):
            raise failure("synthetic provider failure")

        async def no_coverage(*args, **kwargs):
            return False

        monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
        monkeypatch.setattr(gsh, "_build_openmeteo_marine_series", fastpath)
        monkeypatch.setattr(gsh, "has_stored_series_coverage", no_coverage)
        monkeypatch.setattr(gsh, "live_lane_cannot_beat_stored", no_coverage)
        monkeypatch.setattr(regional_tile_first, "skips_live_series", lambda *args: False)
        result = await gsh.build_grid_series(resolve, object(), "GFS", "marine", "waves", "-82,26,-78,30", "0,1")
        assert len(calls) == 2
        assert result["frame_count"] == 0

    asyncio.run(scenario())


def test_independently_cancelled_later_hour_does_not_cancel_siblings(monkeypatch):
    """gather(return_exceptions=True) still permits a partial page for one lost child."""
    import asyncio

    async def scenario():
        calls = []
        completed = []

        async def resolve(**kwargs):
            calls.append(kwargs["valid_time"])
            index = len(calls)
            if index == 2:
                raise asyncio.CancelledError()
            await asyncio.sleep(0)
            completed.append(index)
            return None

        monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "0")
        result = await gsh.build_grid_series(resolve, None, "GFS", "marine", "waves", "-82,26,-78,30", "0,1,2")
        assert len(calls) == 3
        assert completed == [1, 3]
        assert result["frame_count"] == 0
        assert "_error" not in result

    asyncio.run(scenario())
