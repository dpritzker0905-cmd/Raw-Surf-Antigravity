"""Exercise a photographer's per-session price from go-live through a buyer's credit join."""
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from models import CreditTransaction, LiveSession, LiveSessionParticipant, PaymentTransaction, Profile, SurfSpot
from routes.photographer import discovery
from routes.photographer.schemas import GoLiveRequest as PhotographerGoLiveRequest
from routes.explore_discover.spot_details import get_spot_details
from routes.photographer.sessions import get_active_session, go_live
from routes.sessions.pricing import CaptureSessionPricingRequest, get_session_pricing
from routes.surf_spots.live import get_live_photographers, photographer_go_live
from routes.surf_spots.schemas import GoLiveRequest
from routes.surf_spots.spots import get_surf_spot
from services.weather_tier_clamp import SIGNED_OUT
from tests.test_live_session_escrow import bearer, harness


@pytest.mark.parametrize("saved,chosen", [(40, 0), (0, 40), (40, 17.5)])
@pytest.mark.parametrize("start,request_type", [(photographer_go_live, GoLiveRequest), (go_live, PhotographerGoLiveRequest)])
async def test_go_live_rate_survives_discovery_and_join(harness, saved, chosen, start, request_type):
    async with harness.maker() as db:
        db.add(SurfSpot(id="fixture-spot", name="Fixture", latitude=0, longitude=0))
        photographer = await db.get(Profile, "pro")
        photographer.is_shooting = False
        photographer.live_buyin_price = saved
        await db.commit()
        started = await start("pro", request_type(
            spot_id="fixture-spot", price_per_join=chosen,
        ), db=db, current_user_id="pro")
        assert started["live_session_rates"]["buyin_price"] == chosen
        assert photographer.live_buyin_price == saved
        # Editing default prices or creating non-live records cannot reprice a running session.
        photographer.session_price = saved
        db.add_all([
            LiveSession(photographer_id="pro", status="ended", buyin_price=99),
            LiveSession(photographer_id="pro", status="active", session_mode="on_demand", buyin_price=80),
        ])
        await db.commit()
        assert (await get_active_session("pro", db=db)).price_per_join == chosen
        directory = await get_live_photographers(spot_id="fixture-spot", db=db)
        assert directory[0].live_buyin_price == chosen
        live = await discovery.get_live_photographers(db=db)
        featured = await discovery.get_featured_photographers(limit=10, db=db)
        for directory_rows in (live, featured):
            assert next(p for p in directory_rows if p["id"] == "pro")["session_price"] == chosen
        map_spot = await get_surf_spot("fixture-spot", user_id=None, user_lat=None, user_lon=None, db=db)
        assert map_spot["active_photographers"][0]["live_buyin_price"] == chosen
        spot = await get_spot_details("fixture-spot", subscription_tier=SIGNED_OUT, model="GFS", db=db)
        assert spot["active_photographers"][0]["live_buyin_price"] == chosen
        quote = await get_session_pricing(CaptureSessionPricingRequest(photographer_id="pro"), db=db, user_id="owner")
        assert quote["entry_fee"] == chosen

    endpoint = "/api/sessions/join?surfer_id=owner"
    payload = {"photographer_id": "pro", "payment_method": "credits", "max_buyin_amount": chosen}
    if chosen > 0:
        for method in ("card", "credits"):
            stale = await harness.client.post(endpoint, headers=bearer("owner"), json={
                **payload, "payment_method": method, "max_buyin_amount": 0,
            })
            assert stale.status_code == 409
        async with harness.maker() as db:
            assert (await db.scalars(select(CreditTransaction))).all() == []
            assert (await db.scalars(select(LiveSessionParticipant))).all() == []
            assert (await db.scalars(select(PaymentTransaction))).all() == []
    response = await harness.client.post(endpoint, headers=bearer("owner"), json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["amount_paid"] == chosen
    async with harness.maker() as db:
        [seat] = (await db.scalars(select(LiveSessionParticipant))).all()
        assert (seat.live_session_id, seat.amount_paid) == (started["live_session_id"], chosen)
        assert (await db.get(Profile, "owner")).credit_balance == 100 - chosen


@pytest.mark.parametrize("request_type", [GoLiveRequest, PhotographerGoLiveRequest])
@pytest.mark.parametrize("invalid", [-1, float("nan"), float("inf")])
def test_go_live_requires_a_finite_nonnegative_price(request_type, invalid):
    with pytest.raises(ValidationError):
        request_type(price_per_join=invalid)
