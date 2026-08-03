"""THE WIRE CONTRACT — a field is not shipped until a test asserts it survives serialisation.

WHY THIS EXISTS (2026-08-03). `6da4c16e` added `limiter` / `limiter_f` to `rate_one_spot`'s returned
dict and shipped 138 lines of guards for `rating_factors`. The code deployed correctly — `/api/health`
reported the SHA — and the field was **absent from every response for hours**, because
`SpotRatingItem` is a Pydantic model and **Pydantic drops undeclared keys**. Nothing tested the wire.

That is the same defect this repo already recorded as `e8b38e42`: *"the geometry provenance envelope
was served and dropped at the render boundary."* The producer was guarded; the BOUNDARY was not.

★ THE CONTROL IS THE POINT. `test_an_undeclared_field_is_dropped` proves the MECHANISM is live, so a
  future reader cannot dismiss these as testing nothing. If Pydantic's behaviour ever changed, that
  control goes red and this whole suite's premise is re-examined.
"""
import pytest

from routes.weather import SpotRatingItem, SpotRatingsResponse

# The keys `rate_one_spot` actually returns, and which therefore have to survive the boundary.
# Kept as an explicit list rather than introspected from the producer: an introspected list would
# agree with the producer by construction and could never catch a field being dropped.
PROVENANCE_FIELDS = [
    "limiter", "limiter_f",          # 6da4c16e — which factor removed the most
    "geometry_readiness",            # what the forecast RAN ON
    "run_time", "wind_run_time",     # which model RUN produced it
    "confirmed", "raw_score",        # the observation gate's audit trail
]


def _item(**over):
    base = dict(spot_id="a-uuid", name="Irita", latitude=33.5, longitude=134.3,
                score=64.2, level="fair_good", confidence="medium",
                surf_height_m=2.908, period_s=14.6, why="~9.5 ft surf, 15s period, 6kt offshore wind",
                limiter="size_gate", limiter_f=0.6438,
                geometry_readiness="degraded", run_time="2026-08-03T06:00:00Z",
                wind_run_time="2026-08-03T05:00:00Z", confirmed=None, raw_score=64.2)
    base.update(over)
    return base


@pytest.mark.parametrize("field", PROVENANCE_FIELDS)
def test_every_provenance_field_survives_serialisation(field):
    """The one that would have caught it: build from the producer's dict, dump, assert present."""
    src = _item()
    assert field in src, f"SETUP BROKEN: {field} not in the fixture the producer returns"

    dumped = SpotRatingItem(**src).model_dump()

    assert field in dumped, (
        f"'{field}' was DROPPED at the response boundary — declare it on SpotRatingItem. "
        f"This is the e8b38e42 defect: a producer that returns it and a model that does not know it."
    )
    assert dumped[field] == src[field]


def test_an_undeclared_field_is_dropped__THE_CONTROL():
    """KNOWN-FAILING CONTROL: proves the drop mechanism is real and still active.

    Without this, the parametrised test above could pass on a model that accepted everything, and
    would then be testing nothing at all."""
    dumped = SpotRatingItem(**_item(a_field_nobody_declared="value")).model_dump()
    assert "a_field_nobody_declared" not in dumped, (
        "Pydantic no longer drops undeclared keys — the premise of this suite has changed, and the "
        "boundary guards above must be re-derived rather than trusted."
    )


def test_the_limiter_reaches_the_wire_through_the_FULL_response_model():
    """The item model is not the boundary the client sees — the response wraps it. Assert through
    the whole envelope, because a list[Model] field re-validates its members."""
    resp = SpotRatingsResponse(model="GFS", valid_time="2026-08-03T20:00:00Z", count=1,
                               source="live", spots=[SpotRatingItem(**_item())])
    spot = resp.model_dump()["spots"][0]
    assert spot["limiter"] == "size_gate"
    assert spot["limiter_f"] == pytest.approx(0.6438)


def test_a_frame_without_a_limiter_still_validates():
    """Older precomputed frames simply omit it — the field must be Optional, not required, or every
    pre-deploy blob 500s the endpoint."""
    src = _item()
    del src["limiter"]
    del src["limiter_f"]
    item = SpotRatingItem(**src)
    assert item.limiter is None and item.limiter_f is None
