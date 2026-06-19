import logging
from typing import Dict, List, Any, Optional
from services.copernicus_marine_service import fetch_euro_marine
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

logger = logging.getLogger(__name__)

class CopernicusProvider:
    """
    Copernicus API provider for the Weather Ingestion Pipeline.
    Fetches Copernicus NetCDF subset grids for EURO wave component layers:
    swell_1, swell_2, and wind_waves.
    """
    # Allowed variables mapping for Copernicus
    LAYER_VARIABLES = {
        "waves": ["wave_height", "wave_direction", "wave_period"],
        "swell_1": ["swell_wave_height", "swell_wave_direction", "swell_wave_period"],
        "swell_2": ["secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period"],
        "wind_waves": ["wind_wave_height", "wind_wave_direction", "wind_wave_period"],
        "all_marine": [
            "wave_height", "wave_direction", "wave_period",
            "swell_wave_height", "swell_wave_direction", "swell_wave_period",
            "secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period",
            "wind_wave_height", "wind_wave_direction", "wind_wave_period"
        ]
    }

    async def fetch_grid(
        self,
        layer: str,
        bbox: Dict[str, float],
        resolution: float = 0.25,
        forecast_days: int = 3,
        precomputed_coords: Optional[tuple] = None,
        valid_time: Optional[str] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Asynchronously fetches a coordinate snap-grid from CMEMS using the existing service in-process.
        Returns a list of shaped coordinate dicts.
        """
        # Step 1: Generate coordinates
        if precomputed_coords is not None:
            lats, lons = precomputed_coords
        else:
            import os
            is_render = os.environ.get("RENDER") == "true"
            
            target_resolution = 0.5 if is_render else resolution
            lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, target_resolution)
            if not lats:
                logger.error(f"[Copernicus Provider] Generated empty grid for bbox: {bbox}")
                return None

            # Cap point count: 200 on Render (512MB RAM) to minimize NetCDF size, 500 otherwise
            max_points = 200 if is_render else 500
            if len(lats) > max_points:
                logger.warning(
                    f"[Copernicus Provider] Coordinate count {len(lats)} exceeds safe {max_points} point cap. "
                    "Coarsening grid resolution..."
                )
                adj_res = target_resolution
                while len(lats) > max_points:
                    adj_res += 0.1
                    lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, adj_res)
                logger.info(f"[Copernicus Provider] Adjusted resolution to {adj_res:.2f}° ({len(lats)} points)")

        # Map layer to Copernicus variables
        variables = self.LAYER_VARIABLES.get(layer, self.LAYER_VARIABLES["waves"])
        
        # Ensure wave_height is present for grid mask support
        if "wave_height" not in variables:
            variables = list(variables) + ["wave_height"]

        logger.info(
            f"[Copernicus Provider] Running in-process background ingestion for EURO/{layer}. "
            f"Bbox: {bbox} | Coords count: {len(lats)} | Variables: {variables} | ValidTime: {valid_time}"
        )

        try:
            results = await fetch_euro_marine(
                latitudes=lats,
                longitudes=lons,
                forecast_days=forecast_days,
                variables=variables,
                valid_time=valid_time
            )
            if results:
                logger.info(f"[Copernicus Provider] In-process grid fetch succeeded, read {len(results)} points.")
            return results
        except Exception as e:
            logger.error(f"[Copernicus Provider] In-process grid fetch exception: {e}")
            return None

