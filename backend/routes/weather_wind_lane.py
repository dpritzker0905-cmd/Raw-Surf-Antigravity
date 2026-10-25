"""GET /api/weather/wind_lane: the HRRR lane this box blends into GFS wind RIGHT NOW (2026-10-23).

wind_lane.box_state(): key, cycle, horizon, feather, taper and the last refresh error's type; no I/O, no lane load. The static wind
frames' client re-reads it with the lane pointer and serves a lane-window hour only when the box holds the frames' own lane (#468's
live read found the box on a 19 h old cycle the pointer no longer named). Cached 60 s at the edge and in the browser.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/wind_lane")
async def get_wind_lane():
    from services.weather_pipeline.wind_lane import box_state
    return JSONResponse(box_state(), headers={"Cache-Control": "public, max-age=60"})
