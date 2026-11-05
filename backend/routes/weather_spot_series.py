"""GET /api/weather/spot-series/{spot_id}: one spot's CI-rated chart series, tier-trimmed (spot-hub phase 4, 2026-11-04).

The private bucket's proxy: `services/weather_pipeline/spot_series_serve.py` reads the phase-3 shards (cached per
process by an immutable generation key) and sends only the frames `forecast_tier_window` opens for the tier. No rating
happens here; every number is `rate_one_spot`'s, written in CI. Kill switch: SPOT_HUB_CHARTS=0 -> 404 `disabled`.
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/spot-series/{spot_id}")
async def get_spot_series(spot_id: str, model: str = Query("GFS", max_length=8),
                          subscription_tier: str = Query("free", max_length=32)):
    from services.weather_pipeline.spot_series_serve import spot_series_payload
    status, body = await spot_series_payload(spot_id, model, subscription_tier)
    # The rolling window moves with the clock and the series republishes every precompute cycle: 5 minutes at most.
    headers = {"Cache-Control": "public, max-age=300" if status == 200 else "public, max-age=60"}
    return JSONResponse(body, status_code=status, headers=headers)
