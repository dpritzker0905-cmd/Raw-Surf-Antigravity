"""/conditions/batch — bounded, parallel, and byte-comparable with the serial route it replaced.

MASTER-AUDIT-11.0 §3.3: the route was uncapped and strictly serial — 250 spot_ids produced 250
serial DB round trips + 250 serial upstream resolutions in ONE unauthenticated request, 95.9x
slower than the gather equivalent, bounded only incidentally by h11's request-head limit. The
bounds adopted are /spot-ratings' own (cap 200, SPOT_RATINGS_CONCURRENCY). Every test here runs
the REAL route handler with fakes injected at its two seams (db, resolver)."""
import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.surf_data import conditions as C                    # noqa: E402


class _Spot:
    def __init__(self, sid):
        self.id, self.latitude, self.longitude = sid, 30.0, -80.0


class _Result:
    def __init__(self, spots):
        self._spots = spots

    def scalars(self):
        return self

    def all(self):
        return self._spots


class _DB:
    """Counts execute() calls and serves every requested id — the single-IN-query pin."""
    def __init__(self):
        self.calls = 0

    async def execute(self, stmt):
        self.calls += 1
        ids = []
        for crit in stmt._where_criteria:
            ids = list(crit.right.value)
        return _Result([_Spot(i) for i in ids])


def _payload(sid):
    return {"current_conditions": {
        "wave_height_ft": 3.2, "wave_direction": 300.0, "wave_period": 12.0,
        "swell_height_ft": 2.8, "label": "Chest high", "updated_at": "2026-08-09T00:00:00Z"}}


async def test_one_db_query_and_bounded_concurrency_not_250_serial_awaits(monkeypatch):
    db = _DB()
    in_flight, peak = [0], [0]

    async def fake_resolve(*, model, lat, lng, forecast_days, spot_id):
        in_flight[0] += 1
        peak[0] = max(peak[0], in_flight[0])
        await asyncio.sleep(0.01)
        in_flight[0] -= 1
        return _payload(spot_id)

    monkeypatch.setattr(C.point_resolution_service, "resolve_spot_conditions", fake_resolve)
    ids = ",".join(f"s{i}" for i in range(40))
    t0 = time.perf_counter()
    out = await C.get_batch_conditions(spot_ids=ids, model="GFS", db=db)
    dt = time.perf_counter() - t0
    assert db.calls == 1, f"expected ONE IN-query, got {db.calls} round trips"
    assert len(out["conditions"]) == 40
    assert peak[0] > 1, "resolutions ran strictly serially — the gather is gone"
    assert peak[0] <= C._BATCH_CONCURRENCY, (
        f"concurrency {peak[0]} exceeded the shared bound {C._BATCH_CONCURRENCY}")
    serial_floor = 40 * 0.01
    assert dt < serial_floor, (
        f"40 x 10 ms resolutions took {dt:.2f}s — not faster than serial, the gather is gone")


async def test_the_cap_is_enforced_and_disclosed(monkeypatch):
    async def fake_resolve(*, spot_id, **k):
        return _payload(spot_id)

    monkeypatch.setattr(C.point_resolution_service, "resolve_spot_conditions", fake_resolve)
    ids = ",".join(f"s{i}" for i in range(C.BATCH_MAX_SPOTS + 37))
    out = await C.get_batch_conditions(spot_ids=ids, model="GFS", db=_DB())
    assert len(out["conditions"]) == C.BATCH_MAX_SPOTS
    assert out["truncated_to"] == C.BATCH_MAX_SPOTS, "truncation must be disclosed, not silent"
    small = await C.get_batch_conditions(spot_ids="s1,s2", model="GFS", db=_DB())
    assert "truncated_to" not in small, "the disclosure key must appear only when it happened"


async def test_response_shape_and_input_order_match_the_serial_implementation(monkeypatch):
    async def fake_resolve(*, spot_id, **k):
        if spot_id == "bad":
            raise RuntimeError("upstream died")
        return _payload(spot_id)

    monkeypatch.setattr(C.point_resolution_service, "resolve_spot_conditions", fake_resolve)
    out = await C.get_batch_conditions(spot_ids="s2,bad,s1", model="GFS", db=_DB())
    assert list(out["conditions"].keys()) == ["s2", "bad", "s1"], "input order must be preserved"
    assert set(out["conditions"]["s1"].keys()) == {
        "wave_height_ft", "wave_direction", "wave_period", "swell_height_ft", "label",
        "updated_at"}, "the per-spot whitelist changed — that is a wire-contract change"
    # ⚠️ CONTRACT CHANGED 2026-08-14 (WS-CAN-0009), deliberately and under an authorized task.
    # This previously asserted `== {"error": "upstream died"}` — i.e. it PINNED THE EXCEPTION TEXT
    # ON THE WIRE as a contract, which is exactly the leak WS-CAN-0009 exists to remove (`str(e)`
    # reaches any client and carries internal paths, driver messages and upstream URLs).
    # What this test protects is unchanged and still asserted above: input ORDER and per-spot SHAPE
    # parity with the serial implementation. The per-id error ENTRY is still part of that contract —
    # a failed spot is still present, in order — only its message is now generic.
    # ⇒ this assertion is STRENGTHENED, not relaxed: it now also proves the text is gone.
    assert out["conditions"]["bad"] == {"error": "Unable to fetch conditions"}, (
        "per-id error entries are part of the serial contract, with a GENERIC message")
    assert "upstream died" not in str(out), (
        "the raw exception text reached the response body again — WS-CAN-0009 regressed")
    empty = await C.get_batch_conditions(spot_ids="", model="GFS", db=_DB())
    assert empty == {"conditions": {}}


def test_the_observation_gate_runs_off_the_event_loop():
    """§3.6: gate_single_model_surface performs an O(N-spots) haversine scan and, on TTL miss, a
    blocking requests.get(timeout=10) — inside an async def. The fix is WHERE it runs, never what
    it computes (the unconditional-cap contract at the call site is untouched)."""
    import inspect
    from services.weather_pipeline.spot_conditions import resolve_spot_conditions_impl
    src = inspect.getsource(resolve_spot_conditions_impl)
    assert "to_thread(" in src and "gate_single_model_surface" in src.split("to_thread(")[1][:80], (
        "the observation gate is back on the event loop")
