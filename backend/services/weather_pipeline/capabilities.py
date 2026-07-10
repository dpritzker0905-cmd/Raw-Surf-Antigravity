from typing import List, Dict, Any

WEATHER_CAPABILITIES: List[Dict[str, Any]] = [
    # GFS Marine
    {
        "model": "GFS",
        "domain": "marine",
        "layer": "waves",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ncep_gfswave025",
        "source_dataset": "ncep_gfswave025",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 3,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS Wave 0.25 degree global wave model. Serves waves layer.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "marine",
        "layer": "swell_1",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ncep_gfswave025",
        "source_dataset": "ncep_gfswave025",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 3,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS Wave 0.25 degree global wave model. Serves swell_1 layer.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "marine",
        "layer": "swell_2",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ncep_gfswave025",
        "source_dataset": "ncep_gfswave025",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 3,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS Wave 0.25 degree global wave model. Serves swell_2 layer.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "marine",
        "layer": "wind_waves",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ncep_gfswave025",
        "source_dataset": "ncep_gfswave025",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 3,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS Wave 0.25 degree global wave model. Serves wind_waves layer.",
        "fallback_sources": []
    },
    # ICON Marine
    {
        "model": "ICON",
        "domain": "marine",
        "layer": "waves",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gwam",
        "source_dataset": "dwd_gwam",
        "native_horizon_hours": 168,
        "estimated_horizon_hours": 168,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "DWD ICON global wave model (gwam). Serves waves layer.",
        "fallback_sources": []
    },
    {
        "model": "ICON",
        "domain": "marine",
        "layer": "swell_1",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gwam",
        "source_dataset": "dwd_gwam",
        "native_horizon_hours": 168,
        "estimated_horizon_hours": 168,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "DWD ICON global wave model (gwam). Serves swell_1 layer.",
        "fallback_sources": []
    },
    {
        "model": "ICON",
        "domain": "marine",
        "layer": "swell_2",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gwam",
        "source_dataset": "dwd_gwam",
        "native_horizon_hours": 0,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 0,
        "cadence_hours": 0,
        "update_frequency": "12h",
        "supports_grid": False,
        "supports_point": False,
        "supports_viewport_dynamic": False,
        "supports_global": False,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": "DWD ICON global wave model (gwam) does not output native secondary swell wave parameter.",
        "source_docs_note": "Swell 2 is unsupported by ICON gwam.",
        "fallback_sources": []
    },
    {
        "model": "ICON",
        "domain": "marine",
        "layer": "wind_waves",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gwam",
        "source_dataset": "dwd_gwam",
        "native_horizon_hours": 168,
        "estimated_horizon_hours": 168,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "DWD ICON global wave model (gwam). Serves wind_waves layer.",
        "fallback_sources": []
    },
    # EURO Marine
    {
        "model": "EURO",
        "domain": "marine",
        "layer": "waves",
        "provider": "copernicus",
        "upstream_provider": "copernicus",
        "upstream_model": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "source_dataset": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "native_horizon_hours": 240,
        "estimated_horizon_hours": 96,
        "max_forecast_hours": 336,
        "cadence_hours": 3,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF WAM 0.25 degree global wave model. Serves waves layer via Copernicus Marine regional ingestion. Fallback/direct point source is Open-Meteo ecmwf_wam025 API.",
        "fallback_sources": [
            {
                "provider": "open-meteo",
                "upstream_provider": "open-meteo",
                "upstream_model": "ecmwf_wam025",
                "api": "marine",
                "usage": "direct_point_fallback_or_estimate_source"
            }
        ]
    },
    {
        "model": "EURO",
        "domain": "marine",
        "layer": "swell_1",
        "provider": "copernicus",
        "upstream_provider": "copernicus",
        "upstream_model": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "source_dataset": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "native_horizon_hours": 240,
        "estimated_horizon_hours": 96,
        "max_forecast_hours": 336,
        "cadence_hours": 3,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF WAM 0.25 degree global wave model. Serves swell_1 layer via Copernicus Marine regional ingestion. Fallback/direct point source is Open-Meteo ecmwf_wam025 API.",
        "fallback_sources": [
            {
                "provider": "open-meteo",
                "upstream_provider": "open-meteo",
                "upstream_model": "ecmwf_wam025",
                "api": "marine",
                "usage": "direct_point_fallback_or_estimate_source"
            }
        ]
    },
    {
        "model": "EURO",
        "domain": "marine",
        "layer": "swell_2",
        "provider": "copernicus",
        "upstream_provider": "copernicus",
        "upstream_model": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "source_dataset": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "native_horizon_hours": 240,
        "estimated_horizon_hours": 96,
        "max_forecast_hours": 336,
        "cadence_hours": 3,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF WAM 0.25 degree global wave model. Serves swell_2 layer via Copernicus Marine regional ingestion. Fallback/direct point source is Open-Meteo ecmwf_wam025 API.",
        "fallback_sources": [
            {
                "provider": "open-meteo",
                "upstream_provider": "open-meteo",
                "upstream_model": "ecmwf_wam025",
                "api": "marine",
                "usage": "direct_point_fallback_or_estimate_source"
            }
        ]
    },
    {
        "model": "EURO",
        "domain": "marine",
        "layer": "wind_waves",
        "provider": "copernicus",
        "upstream_provider": "copernicus",
        "upstream_model": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "source_dataset": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        "native_horizon_hours": 240,
        "estimated_horizon_hours": 96,
        "max_forecast_hours": 336,
        "cadence_hours": 3,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF WAM 0.25 degree global wave model. Serves wind_waves layer via Copernicus Marine regional ingestion. Fallback/direct point source is Open-Meteo ecmwf_wam025 API.",
        "fallback_sources": [
            {
                "provider": "open-meteo",
                "upstream_provider": "open-meteo",
                "upstream_model": "ecmwf_wam025",
                "api": "marine",
                "usage": "direct_point_fallback_or_estimate_source"
            }
        ]
    },
    # GFS Wind
    {
        "model": "GFS",
        "domain": "wind",
        "layer": "wind",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gfs_seamless",
        "source_dataset": "gfs_seamless",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 1,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS seamless weather model. Serves wind speed and direction.",
        "fallback_sources": []
    },
    # ICON Wind
    {
        "model": "ICON",
        "domain": "wind",
        "layer": "wind",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "dwd_icon",
        "source_dataset": "dwd_icon",
        "native_horizon_hours": 120,
        "estimated_horizon_hours": 216,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "DWD ICON global weather model. Native 5-day (120h) wind forecast; beyond 120h is loop-extrapolated and marked estimated.",
        "fallback_sources": []
    },
    # EURO Wind
    {
        "model": "EURO",
        "domain": "wind",
        "layer": "wind",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ecmwf_ifs",
        "source_dataset": "ecmwf_ifs",
        "native_horizon_hours": 240,
        "estimated_horizon_hours": 96,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF IFS global weather model (open-data = 240h native). Beyond 240h serves GFS-fallback estimates (pre-baked on ingest; labeled gfs_fallback/is_estimated). Audit #9: native was falsely 336 — ECMWF open-data has never exceeded 240h. (fallback_sources stays [] — the locked contract restricts that field to EURO marine.)",
        "fallback_sources": []
    },
    # GFS Weather (Pressure, Precipitation)
    {
        "model": "GFS",
        "domain": "weather",
        "layer": "pressure",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gfs_seamless",
        "source_dataset": "gfs_seamless",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 1,
        "update_frequency": "6h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "GFS seamless weather model. Serves mean sea level pressure.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "weather",
        "layer": "precipitation",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gfs_seamless",
        "source_dataset": "gfs_seamless",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 1,
        "update_frequency": "6h",
        "supports_grid": "point_only",
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": True,
        "unsupported_reason": None,
        "source_docs_note": "Numeric point truth is backend-owned while raster/contour visual remains visual-only.",
        "fallback_sources": []
    },
    # ICON Weather
    {
        "model": "ICON",
        "domain": "weather",
        "layer": "pressure",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "dwd_icon",
        "source_dataset": "dwd_icon",
        "native_horizon_hours": 168,
        "estimated_horizon_hours": 168,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "DWD ICON global weather model. Serves pressure. Native 7-day (168h) pressure forecast; beyond 168h is loop-extrapolated and marked estimated.",
        "fallback_sources": []
    },
    {
        "model": "ICON",
        "domain": "weather",
        "layer": "precipitation",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "dwd_icon",
        "source_dataset": "dwd_icon",
        "native_horizon_hours": 168,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 168,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": "point_only",
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": True,
        "unsupported_reason": None,
        "source_docs_note": "Numeric point truth is backend-owned while raster/contour visual remains visual-only.",
        "fallback_sources": []
    },
    # EURO Weather
    {
        "model": "EURO",
        "domain": "weather",
        "layer": "pressure",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ecmwf_ifs",
        "source_dataset": "ecmwf_ifs",
        "native_horizon_hours": 336,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": True,
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": False,
        "unsupported_reason": None,
        "source_docs_note": "ECMWF IFS global weather model. Serves pressure.",
        "fallback_sources": []
    },
    {
        "model": "EURO",
        "domain": "weather",
        "layer": "precipitation",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "ecmwf_ifs",
        "source_dataset": "ecmwf_ifs",
        "native_horizon_hours": 336,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 336,
        "cadence_hours": 1,
        "update_frequency": "12h",
        "supports_grid": "point_only",
        "supports_point": True,
        "supports_viewport_dynamic": True,
        "supports_global": True,
        "backend_owned": True,
        "frontend_visual_tile_only": True,
        "unsupported_reason": None,
        "source_docs_note": "Numeric point truth is backend-owned while raster/contour visual remains visual-only.",
        "fallback_sources": []
    },
    # Visual-Only/Raster Radar, Satellite, Fog Layers
    {
        "model": "GFS",
        "domain": "weather",
        "layer": "radar",
        "provider": "rainviewer",
        "upstream_provider": "rainviewer",
        "upstream_model": "nowcast_discontinued",
        "source_dataset": "rainviewer_mosaics",
        "native_horizon_hours": 2,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 2,
        "cadence_hours": 0.16,
        "update_frequency": "10m",
        "supports_grid": False,
        "supports_point": False,
        "supports_viewport_dynamic": False,
        "supports_global": True,
        "backend_owned": False,
        "frontend_visual_tile_only": True,
        "unsupported_reason": None,
        "source_docs_note": "Direct frontend RainViewer visual-only layer integration.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "weather",
        "layer": "satellite",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "discontinued",
        "source_dataset": "discontinued",
        "native_horizon_hours": 0,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 0,
        "cadence_hours": 0,
        "update_frequency": "none",
        "supports_grid": False,
        "supports_point": False,
        "supports_viewport_dynamic": False,
        "supports_global": False,
        "backend_owned": False,
        "frontend_visual_tile_only": True,
        "unsupported_reason": "Satellite IR discontinued Jan 2026.",
        "source_docs_note": "Discontinued frontend visual-only layer.",
        "fallback_sources": []
    },
    {
        "model": "GFS",
        "domain": "weather",
        "layer": "fog",
        "provider": "open-meteo",
        "upstream_provider": "open-meteo",
        "upstream_model": "gfs_seamless",
        "source_dataset": "gfs_seamless",
        "native_horizon_hours": 384,
        "estimated_horizon_hours": 0,
        "max_forecast_hours": 384,
        "cadence_hours": 1,
        "update_frequency": "6h",
        "supports_grid": False,
        "supports_point": False,
        "supports_viewport_dynamic": False,
        "supports_global": False,
        "backend_owned": False,
        "frontend_visual_tile_only": True,
        "unsupported_reason": "Fog layer is frontend visual-only raster.",
        "source_docs_note": "Frontend visual-only raster layer.",
        "fallback_sources": []
    }
]

def get_weather_capabilities() -> List[Dict[str, Any]]:
    """Returns the backend-owned capabilities matrix for weather, marine, and wind models."""
    return WEATHER_CAPABILITIES

def validate_capabilities_contract(capabilities: List[Dict[str, Any]]) -> None:
    """Validates the exact shape and semantic contract of capabilities."""
    for idx, row in enumerate(capabilities):
        # 1. fallback_sources is always a list/array
        fallback = row.get("fallback_sources")
        if not isinstance(fallback, list):
            raise ValueError(f"Row {idx} 'fallback_sources' must be a list, got {type(fallback)}")

        # 2. every fallback source has provider, upstream_provider, upstream_model, api, usage
        for fidx, f_source in enumerate(fallback):
            if not isinstance(f_source, dict):
                raise ValueError(f"Row {idx} fallback source index {fidx} must be a dict")
            for key in ["provider", "upstream_provider", "upstream_model", "api", "usage"]:
                if not f_source.get(key):
                    raise ValueError(f"Row {idx} fallback source index {fidx} missing required key '{key}'")

        # 3. For EURO marine rows: fallback_sources must have the explicit OM marine fallback source.
        # All other rows must have fallback_sources: [].
        is_euro_marine = (row.get("model") == "EURO" and row.get("domain") == "marine")
        if is_euro_marine:
            if len(fallback) != 1:
                raise ValueError(f"Row {idx} EURO marine row must have exactly 1 fallback source, got {len(fallback)}")
            f_source = fallback[0]
            if f_source.get("provider") != "open-meteo" or \
               f_source.get("upstream_provider") != "open-meteo" or \
               f_source.get("upstream_model") != "ecmwf_wam025" or \
               f_source.get("api") != "marine" or \
               f_source.get("usage") != "direct_point_fallback_or_estimate_source":
                raise ValueError(f"Row {idx} EURO marine fallback source content mismatch: {f_source}")
        else:
            if len(fallback) != 0:
                raise ValueError(f"Row {idx} non-EURO marine row must have empty fallback_sources, got {len(fallback)}")

        # 4. visual-only rows have backend_owned=false, except hybrid point_only rows
        if row.get("frontend_visual_tile_only") is True:
            if row.get("supports_grid") == "point_only":
                if row.get("backend_owned") is not True:
                    raise ValueError(f"Row {idx} hybrid point-only row must have backend_owned=True")
                if row.get("supports_point") is not True:
                    raise ValueError(f"Row {idx} hybrid point-only row must have supports_point=True")
            else:
                if row.get("backend_owned") is not False:
                    raise ValueError(f"Row {idx} visual-only row must have backend_owned=False")
                if row.get("supports_grid") is not False or row.get("supports_point") is not False:
                    raise ValueError(f"Row {idx} visual-only row must have supports_grid/point=False")

        # 5. backend-owned rows have provider, upstream_provider, upstream_model, source_dataset
        if row.get("backend_owned") is True:
            for key in ["provider", "upstream_provider", "upstream_model", "source_dataset"]:
                if not row.get(key):
                    raise ValueError(f"Row {idx} backend_owned=True missing required key '{key}'")

        # 6. max_forecast_hours, native_horizon_hours, estimated_horizon_hours >= 0
        for key in ["max_forecast_hours", "native_horizon_hours", "estimated_horizon_hours"]:
            val = row.get(key)
            if not isinstance(val, (int, float)):
                raise ValueError(f"Row {idx} key '{key}' must be numeric, got {type(val)}")
            if val < 0:
                raise ValueError(f"Row {idx} key '{key}' cannot be negative, got {val}")
