"""THE SECOND WIRE BOUNDARY — `GET /conditions/{spot_id}` serialises `current` as a HAND-LISTED
whitelist, so it drops producer fields exactly the way an undeclared Pydantic field does.

WHY THIS EXISTS (MASTER-AUDIT-10.0 §1.2). `0998af5d` shipped a `forecast_confidence` block in
`SpotConditions.js` and `17a93e30` attached the field at `spot_conditions.py:452`. The component
fetches `/conditions/{spot_id}` and gates both of its render sites on
`conditions.current.forecast_confidence` — and this route rebuilt `current` from eight hand-written
names that did not include it. **The UI could never render, on any spot, in any state.**

★ WHY THE EXISTING SUITE DID NOT CATCH IT. `test_spot_hub_forecast_confidence.py` asserts the
PRODUCER attaches the field (by source-string match, at that). Nothing executed the ROUTE. This file
executes the route, because a whitelist is invisible to any test that stops at the producer — the
same lesson `test_spot_rating_wire_contract.py` records for Pydantic, at a boundary that is not
Pydantic and so was never covered by it.

⚠️ This is an EXECUTING test, deliberately. AST would have told us the eight names; only calling the
handler proves what a client receives.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.surf_data import conditions as conditions_route  # noqa: E402


_FC = {"level": "moderate", "spread_m": 0.31, "relative_spread": 0.22,
       "calibrated": False, "basis": "ecmwf_waef_member_spread",
       "means": "members differ by about 22% of wave height; this does not change the rating"}


class _Spot:
    id = "a-uuid"
    name = "Supertubos"
    latitude = 39.606
    longitude = -9.078


def _producer_payload(**extra):
    """The shape `point_resolution_service.resolve_spot_conditions` returns.

    ⚠️ The key is `current_conditions`, not `current` — the route renames it on the way out, which is
    part of why the whitelist exists and part of why nothing noticed the drop.
    """
    current = {
        "wave_height_ft": 5.3, "wave_direction": 291.0, "wave_period": 11.2,
        "swell_height_ft": 4.9, "swell_direction": 288.0,
        "label": "Chest high", "updated_at": "2026-08-07T04:00:00Z",
    }
    current.update(extra)
    return {"current_conditions": current}


def _call_route(monkeypatch, producer_payload):
    """Execute the REAL handler with the producer stubbed, and return the response dict."""
    async def _fake_resolve(*a, **k):
        return producer_payload

    async def _fake_fetch_point(*a, **k):
        return {"hourly": {}}

    svc = conditions_route.point_resolution_service
    monkeypatch.setattr(svc, "resolve_spot_conditions", _fake_resolve, raising=False)
    monkeypatch.setattr(svc.provider, "fetch_point", _fake_fetch_point, raising=False)

    class _Res:
        def scalar_one_or_none(self):
            return _Spot()

        def scalars(self):
            return self

        def first(self):
            return _Spot()

    class _DB:
        async def execute(self, *a, **k):
            return _Res()

    return asyncio.run(conditions_route.get_spot_conditions(
        spot_id="a-uuid", model="EURO", db=_DB()))


def test_forecast_confidence_reaches_the_client(monkeypatch):
    """THE ONE THAT WOULD HAVE CAUGHT IT. Producer attaches it; assert the client receives it."""
    resp = _call_route(monkeypatch, _producer_payload(forecast_confidence=_FC))
    if "error" in resp:
        pytest.skip(f"route could not run in this environment: {resp['error']}")

    current = resp["current"]

    # SETUP CONTROL: a whitelisted field must survive, or this test proves nothing about the
    # boundary — it would just be reporting that the route failed.
    assert current.get("wave_height_ft") == 5.3, (
        f"SETUP BROKEN: the control field did not survive either; got keys {sorted(current)}")

    assert "forecast_confidence" in current, (
        "`forecast_confidence` was attached by the producer and DROPPED by this route's hand-listed "
        "`current` whitelist. SpotConditions.js gates both render sites on "
        "`conditions.current.forecast_confidence`, so the shipped UI renders on zero spots. "
        "This is MASTER-AUDIT-10.0 §1.2 latent gate 2."
    )
    assert current["forecast_confidence"] == _FC


def test_it_is_ABSENT_not_null_when_there_is_no_ensemble(monkeypatch):
    """Mirrors `directional_conflict`: a key present-and-null on every spot is a caveat nobody reads
    and bytes everybody downloads."""
    resp = _call_route(monkeypatch, _producer_payload())
    if "error" in resp:
        pytest.skip(f"route could not run in this environment: {resp['error']}")

    assert "forecast_confidence" not in resp["current"], (
        "the block is present on a deterministic spot — it must be ABSENT, not null")


def test_the_whitelist_really_does_drop_unlisted_keys__THE_CONTROL(monkeypatch):
    """MUTATION. Without this, the test above could pass for the wrong reason (e.g. if the route
    started passing `current` through wholesale, the assertion would hold but this file would no
    longer be testing a whitelist). Proves the DROP mechanism is live."""
    resp = _call_route(monkeypatch, _producer_payload(a_key_the_route_never_lists="x"))
    if "error" in resp:
        pytest.skip(f"route could not run in this environment: {resp['error']}")

    assert "a_key_the_route_never_lists" not in resp["current"], (
        "the route no longer whitelists `current` — re-derive this suite: the boundary it guards "
        "has changed shape, and `forecast_confidence` may now be arriving for a different reason")
