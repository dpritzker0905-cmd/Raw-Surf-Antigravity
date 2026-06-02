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
        "wind_waves": ["wind_wave_height", "wind_wave_direction", "wind_wave_period"]
    }

    async def fetch_grid(
        self,
        layer: str,
        bbox: Dict[str, float],
        resolution: float = 0.25,
        forecast_days: int = 3
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Asynchronously fetches a coordinate snap-grid from CMEMS using the existing service.
        Returns a list of shaped coordinate dicts.
        """
        # Step 1: Generate coordinates
        lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        if not lats:
            logger.error(f"[Copernicus Provider] Generated empty grid for bbox: {bbox}")
            return None

        # Verify point limit (Cap at 500 points to keep Render memory happy)
        if len(lats) > 500:
            logger.warning(
                f"[Copernicus Provider] Coordinate count {len(lats)} exceeds safe Render 500 point cap. "
                "Coarsening grid resolution..."
            )
            # Increase resolution step until count falls below 500
            adj_res = resolution
            while len(lats) > 500:
                adj_res += 0.1
                lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, adj_res)
            logger.info(f"[Copernicus Provider] Adjusted resolution to {adj_res:.2f}° ({len(lats)} points)")

        # Map layer to Copernicus variables
        variables = self.LAYER_VARIABLES.get(layer, self.LAYER_VARIABLES["waves"])
        
        # Ensure wave_height is present for grid mask support
        if "wave_height" not in variables:
            variables = list(variables) + ["wave_height"]

        logger.info(
            f"[Copernicus Provider] Running background ingestion for EURO/{layer}. "
            f"Bbox: {bbox} | Coords count: {len(lats)} | Variables: {variables}"
        )

        try:
            import os
            import tempfile
            import json
            import sys
            import asyncio
            from pathlib import Path

            input_fd, input_path_str = tempfile.mkstemp(suffix="_in.json", prefix="cop_fetch_")
            os.close(input_fd)
            output_fd, output_path_str = tempfile.mkstemp(suffix="_out.json", prefix="cop_fetch_")
            os.close(output_fd)

            input_path = Path(input_path_str)
            output_path = Path(output_path_str)

            req_data = {
                "latitudes": lats,
                "longitudes": lons,
                "forecast_days": forecast_days,
                "variables": variables
            }
            with open(input_path, "w") as f:
                json.dump(req_data, f)

            script_path = Path(__file__).parent.parent.parent.parent / "scripts" / "copernicus_downloader.py"
            
            logger.info(f"[Copernicus Provider] Spawning isolated download subprocess: {script_path}")
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(script_path), str(input_path), str(output_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                stdout_str = stdout.decode('utf-8', errors='replace')
                stderr_str = stderr.decode('utf-8', errors='replace')
                logger.error(
                    f"[Copernicus Provider] Subprocess exited with code {process.returncode}.\n"
                    f"Stdout: {stdout_str}\nStderr: {stderr_str}"
                )
                return None

            if not output_path.exists():
                logger.error("[Copernicus Provider] Subprocess exited successfully but output JSON was not created.")
                return None

            with open(output_path, "r") as f:
                results = json.load(f)
            logger.info(f"[Copernicus Provider] Subprocess fetch succeeded, read {len(results)} points.")
            return results

        except Exception as e:
            logger.error(f"[Copernicus Provider] Subprocess execution exception: {e}")
            return None
        finally:
            for path in [input_path, output_path]:
                if 'path' in locals() and path.exists():
                    try: path.unlink()
                    except Exception: pass
