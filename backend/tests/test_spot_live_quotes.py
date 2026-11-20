"""A buyer sees the same live buy-in in discovery, gallery pricing and the funded join."""
import pytest
from sqlalchemy import select

from models import LiveSessionParticipant, Profile, SurfSpot
from routes.explore_discover.spot_details import get_spot_details
from routes.gallery.collections_roster import build_photographer_pricing
from services.weather_tier_clamp import SIGNED_OUT
from tests.test_live_session_escrow import bearer, harness


@pytest.mark.parametrize("live,legacy,expected", [
    (0, 40, 0), (40, 15, 40), (None, 17, 17), (None, 0, 0), (None, None, 25),
])
async def test_spot_quote_matches_join(harness, live, legacy, expected):
    async with harness.maker() as db:
        spot = SurfSpot(id="test-spot", name="Test spot", latitude=0, longitude=0)
        db.add(spot)
        await db.flush()
        photographer = await db.get(Profile, "pro")
        photographer.current_spot_id = spot.id
        photographer.live_buyin_price = live
        photographer.session_price = legacy
        await db.commit()
        details = await get_spot_details(spot.id, subscription_tier=SIGNED_OUT, model="GFS", db=db)
        [listed] = details["active_photographers"]
        assert (listed["live_buyin_price"], listed["session_price"]) == (live, legacy)
        assert build_photographer_pricing(photographer)["live_session"]["buyin_price"] == expected

    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "credits", "max_buyin_amount": expected},
    )
    assert response.status_code == 200, response.text
    assert response.json()["amount_paid"] == expected
    async with harness.maker() as db:
        [seat] = (await db.scalars(select(LiveSessionParticipant))).all()
        assert seat.surfer_id == "owner"
        assert (await db.get(Profile, "owner")).credit_balance == 100 - expected
