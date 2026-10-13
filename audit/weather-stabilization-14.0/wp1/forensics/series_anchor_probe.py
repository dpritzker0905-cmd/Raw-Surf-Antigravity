"""Read-only actual series assembler with fixed time and a controlled resolver; no HTTP."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "backend"))
from services.weather_pipeline import grid_series_helper as series
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

cases = []
for instant in ["2026-09-20T20:29:59Z", "2026-09-20T20:30:00Z", "2026-09-20T20:52:35Z", "2026-09-20T21:00:01Z"]:
    fixed = datetime.fromisoformat(instant.replace("Z", "+00:00"))
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed if tz else fixed.replace(tzinfo=None)

    requested = []
    async def resolve(**kwargs):
        requested.append(kwargs["valid_time"])
        bounds = CoverageBounds(west=-82, south=26, east=-79, north=30)
        vectors = [GridVector(lat=lat, lng=lng, speed=1, u=0, v=1)
                   for lat in [26, 30] for lng in [-82, -79]]
        return NormalizedProduct(model="GFS", domain="marine", layer="waves", provider="controlled",
            product_id="controlled-source-product", run_time=fixed,
            valid_time=datetime.fromisoformat(kwargs["valid_time"].replace("Z", "+00:00")),
            coverage=bounds, grid=NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors),
            value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=[],
            freshness_sec=1800, is_forecast_authoritative=True, is_estimated=False)

    with patch.object(series, "datetime", FixedDatetime), patch.object(series, "_per_hour_timeout", lambda: 1), \
            patch.object(series, "_restore_in_progress", lambda: False):
        result = asyncio.run(series.build_grid_series(resolve, None, "GFS", "marine", "waves",
                            "-82,26,-79,30", "0,3,6,9,12,15,18"))
    for frame in result["frames"]:
        frame["vectors"] = [v.model_dump(mode="json") for v in frame["vectors"]]
    cases.append({"now": instant, "resolver_requests": sorted(requested), "response": result})

out = {"note": "Actual generic series assembler, controlled resolver/clock, no HTTP or production writes.", "cases": cases}
Path(__file__).with_name("series-anchor-backend.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print(json.dumps({"cases": len(cases), "base_times": [c["response"]["base_time"] for c in cases]}, indent=2))
