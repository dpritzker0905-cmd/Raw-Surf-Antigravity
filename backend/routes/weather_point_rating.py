"""GET /api/weather/point-rating — the map infobox's surf quality, from the reference chain (A15-05(b)).

Its own module because `routes/weather.py` sits at the 800-line cap. Registered in `routes/__init__.py`
AFTER `routes.weather`, so the module-level import below reads a fully initialised module: the item
model and the point resolver are the ones /spot-ratings serves with, never a copy.
All the logic lives in `services/weather_pipeline/point_rating.py`; see its docstring for why the
answer is the precomputed glyph frame first and `rate_one_spot` + the observation gate otherwise.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from routes.weather import SpotRatingItem, point_resolution_service
from services.weather_pipeline.point_rating import PointRatingAtCapacity, rate_point

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather")


class PointRatingResponse(BaseModel):
    model: str
    valid_time: str                          # the hour ASKED FOR
    source: str                              # "precomputed" | "precomputed_stale" | "live"
    served_valid_time: Optional[str] = None  # the hour a precomputed frame DESCRIBES (None on live)
    # The SAME item shape /spot-ratings serves, declared by the SAME model, so no field the glyph
    # carries can be dropped here by an undeclared key (the class of four recorded misses).
    rating: Optional[SpotRatingItem] = None


@router.get("/point-rating", response_model=PointRatingResponse)
async def get_point_rating(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
):
    """The surf-quality verdict the app shows for (lat, lng) at valid_time."""
    try:
        item, source, served = await rate_point(point_resolution_service, lat, lng, model, valid_time)
    except PointRatingAtCapacity:
        raise HTTPException(status_code=503, detail="point-rating live lane at capacity; retry shortly")
    return PointRatingResponse(model=model, valid_time=valid_time, source=source,
                               served_valid_time=served,
                               rating=SpotRatingItem(**item) if item is not None else None)
