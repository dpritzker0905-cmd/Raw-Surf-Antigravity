from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import os
import json

router = APIRouter()

CACHE_DIR = Path(__file__).parent.parent / "uploads" / "forecast_cache"

@router.get("/tiles/{layer}")
async def get_marine_tile(layer: str):
    """
    Serves the pre-ingested, cached global grid data for the requested layer.
    Supported layers: 'wind', 'marine'
    """
    if layer not in ["wind", "marine"]:
        raise HTTPException(status_code=400, detail="Invalid layer requested. Must be 'wind' or 'marine'.")

    cache_file = CACHE_DIR / f"{layer}_global.json"
    
    if not cache_file.exists():
        # Fallback empty response if the ingestion task hasn't run yet
        return JSONResponse(status_code=404, content={"error": f"Cache for {layer} not yet available. Please try again shortly."})

    try:
        with open(cache_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"error": f"Cache for {layer} is invalid. Please try again shortly."}
        )

    if not isinstance(payload, list) or len(payload) == 0:
        return JSONResponse(
            status_code=503,
            content={"error": f"Cache for {layer} is empty. Please try again shortly."}
        )

    # Serve the JSON file directly. This allows Nginx/Uvicorn to optimize delivery,
    # and automatically supports gzip middleware for massive compression on the 5MB payload.
    return FileResponse(
        path=str(cache_file),
        media_type="application/json",
        filename=f"{layer}_global.json",
        headers={
            # Inform the browser it can cache this for 3 hours (the ingestion interval)
            "Cache-Control": "public, max-age=10800"
        }
    )
