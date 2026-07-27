import sqlite3
import math
import logging
import os
from typing import List, Dict, Any, Optional, Tuple
from fastmcp import FastMCP
from utils.sqlite_helpers import get_sqlite_connection
# The PRODUCTION rating engine is authoritative (CLAUDE.md). The sim delegates to it rather than
# carrying a second formula — a divergent copy is exactly how this file came to rate a flat ocean
# "Epic". Both imports are dependency-free (no FastAPI/route side effects).
from services.weather_pipeline.surf_rating import rating_score, score_to_level, offshoreness, MS_TO_KT
from services.weather_pipeline.surf_transform import komar_breaker_height
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
from services.conditions_labels import get_conditions_label
# The app's own /api/weather/point, so every catalog spot has a real forecast instead of the three
# hand-tuned ones. Imported at module scope: it pulls urllib/ssl, and a C extension loaded lazily
# inside a tool is what deadlocked this server (see `_warm_hot_path`). Kill: SIM_LIVE_FORECAST=0.
from services.weather_pipeline import sim_forecast

# Setup logger
logger = logging.getLogger("weather_sim_mcp")

# Initialize FastMCP Server for the Weather Simulation System
mcp = FastMCP("WeatherSimulationSystem")

# ── 2026-07-27: THE SIM NOW ANSWERS WITH THE SAME PHYSICS THE APP SERVES ──────────────────────
# `0cae5d74` fixed duplicated physics at the FUNCTION level (height -> komar_breaker_height,
# quality -> rating_score). That still left this file owning the COMPOSITION — the geometry those
# functions are fed and the order effects are applied in — and that is precisely where production
# kept moving (ETOPO shore-normal asset `5a48ad1e` 07-26, depth-limited break cap `bf5c76cd` 07-27).
#
# Measured 2026-07-27 across 8 scenarios at the three catalog spots, this file over-read the height
# the app actually serves at the identical coordinate by a MEDIAN 19.1% (max +39.2%), because it
# ran raw Komar on the offshore Hs with no cross-shelf friction, no swell-angle exposure and no
# breaking cap — against a HARDCODED shore normal 44.9 deg off the ETOPO value production uses
# (Mavericks: 270 here vs 225.1 in the asset, spread 10.5).
#
# Both are now resolved through `surf_point`, the single chain `point_resolution` also calls, so the
# sim tracks production automatically instead of re-diverging on the next physics change.
# Kill: SIM_PRODUCTION_GEOMETRY=0 restores the pre-07-27 raw-Komar behaviour.
def _sim_flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default) != "0"


# 1. Catalog defaults for the three hand-tuned spots. These carry a BASELINE forecast (the
# `base_*` fields), which the 1500+ database spots do not — see `get_weather_forecast`.
MOCK_SPOTS = {
    "Mavericks": {
        "id": 1,
        "name": "Mavericks",
        "region": "California",
        "latitude": 37.4952,
        "longitude": -122.5028,
        # Fallback seaward bearing, used ONLY when the bathymetry chain cannot resolve one (or
        # SIM_PRODUCTION_GEOMETRY=0). It is NOT ground truth: measured against ETOPO 2022 15s this
        # value is 44.9 deg off for Mavericks. The resolved normal wins wherever it exists.
        "orientation": 270,
        "base_swell_height": 3.5,
        "base_swell_period": 16.0,
        "base_swell_direction": 290.0,
        "base_wind_speed": 12.0,
        "base_wind_direction": 95.0,
        # p80 good-day BREAKING height (m) — calibrates surf_rating.size_score to LOCAL expectation.
        # Applied ONLY when RATING_LOCAL_SIZE=1, because that is the flag production gates it on
        # (routes/weather.py:435, spot_ratings.py:344, grid_resolver_surf.py:80). Passing it
        # unconditionally made the sim rate a spot on a curve the app does not currently use.
        # Domain estimates pending real p80 climatology.
        "reference_size_m": 4.0
    },
    "Montara State Beach": {
        "id": 2,
        "name": "Montara State Beach",
        "region": "California",
        "latitude": 37.5458,
        "longitude": -122.5150,
        "orientation": 280,
        "base_swell_height": 1.5,
        "base_swell_period": 12.0,
        "base_swell_direction": 270.0,
        "base_wind_speed": 8.0,
        "base_wind_direction": 85.0,
        "reference_size_m": 1.5
    },
    "Pacifica State Beach": {
        "id": 3,
        "name": "Pacifica State Beach",
        "region": "California",
        "latitude": 37.5956,
        "longitude": -122.5034,
        "orientation": 260,
        "base_swell_height": 1.2,
        "base_swell_period": 11.0,
        "base_swell_direction": 275.0,
        "base_wind_speed": 5.0,
        "base_wind_direction": 90.0,
        "reference_size_m": 1.2
    }
}

# Staged simulation state, keyed by spot name. Kept SEPARATE from MOCK_SPOTS (which used to be
# mutated in place) so the catalog defaults stay a clean baseline and every forecast read can say
# truthfully whether it is showing a default or somebody's staged scenario.
_SIM_OVERRIDES: Dict[str, Dict[str, float]] = {}

# Resolve the database path dynamically relative to the backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DB_PATH = os.path.join(ROOT_DIR, "dev.db")


# 2. Database Helper Methods with Safe Fallbacks
def get_db_connection() -> Optional[sqlite3.Connection]:
    try:
        conn = get_sqlite_connection(DB_PATH)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to SQLite database at {DB_PATH}: {e}")
        return None


def query_spots_from_db(name_query: Optional[str] = None,
                        limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Read the SURF SPOT CATALOG.

    ★ This used to read `condition_reports`, which is the photographer conditions-upload table
    (photographer_id / media_url / expires_at). It holds 0 rows in dev and is near-empty by nature,
    so every call fell through to the three hardcoded catalog spots — the weather simulation system
    could reach 3 of 1547 spots (0.2%) because it was looking in the wrong table. `surf_spots` is
    the catalog, and it has 1547 active rows with coordinates.

    Kill: SIM_SPOT_CATALOG=0 restores the pre-07-27 catalog-of-three behaviour.
    """
    if not _sim_flag("SIM_SPOT_CATALOG"):
        return []
    # The app's LIVE catalogue first — `dev.db` is a snapshot and it has drifted into wrong
    # coordinates, not just missing rows (see `sim_forecast.fetch_catalog`). Filtering here rather
    # than in the fetch keeps the fetch cacheable for the whole process.
    live = sim_forecast.fetch_catalog()
    if live:
        rows = [s for s in live
                if not name_query or name_query.lower() in (s["name"] or "").lower()]
        rows.sort(key=lambda s: s["name"] or "")
        return [dict(s) for s in (rows[:int(limit)] if limit else rows)]
    conn = get_db_connection()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        sql = ("SELECT id, name, region, latitude, longitude FROM surf_spots "
               "WHERE is_active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL")
        params: List[Any] = []
        if name_query:
            sql += " AND LOWER(name) LIKE ?"
            params.append(f"%{name_query.lower()}%")
        sql += " ORDER BY name"
        if limit:
            sql += " LIMIT ?"
            params.append(int(limit))
        rows = cursor.execute(sql, params).fetchall()
        spots = []
        for row in rows:
            spots.append({
                "id": row[0],
                "name": row[1],
                "region": row[2],
                "latitude": float(row[3]),
                "longitude": float(row[4]),
            })
        return spots
    except Exception as e:
        # Was a bare `except: return []`, which made a schema/SQL failure indistinguishable from
        # "no rows" and silently fell back to mock data. Log it — a silent fallback is how the
        # wrong-table bug above survived.
        logger.warning(f"surf_spots query failed ({e}); falling back to the catalog defaults.")
        return []
    finally:
        if conn:
            conn.close()


def resolve_spot(spot_name: str) -> Optional[Dict[str, Any]]:
    """Find a spot by name: hand-tuned catalog first (it carries a baseline forecast), then the
    database. Returns None if neither knows the name."""
    spot = MOCK_SPOTS.get(spot_name)
    if spot:
        return spot
    matches = query_spots_from_db(name_query=spot_name, limit=25)
    exact = [m for m in matches if m["name"].lower() == spot_name.lower()]
    chosen = exact[0] if exact else (matches[0] if len(matches) == 1 else None)
    return dict(chosen) if chosen else None


_GEOMETRY_CACHE: Dict[Any, Any] = {}


def spot_geometry(spot: Dict[str, Any]):
    """Resolved production geometry for a spot, or None when unavailable/disabled.

    Cached per coordinate — the bathymetry lookups are pure and a what-if sweep hits one spot
    repeatedly."""
    if not _sim_flag("SIM_PRODUCTION_GEOMETRY"):
        return None
    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is None or lng is None:
        return None
    key = (round(float(lat), 6), round(float(lng), 6))
    if key not in _GEOMETRY_CACHE:
        try:
            _GEOMETRY_CACHE[key] = resolve_surf_geometry(float(lat), float(lng))
        except Exception as e:
            logger.warning(f"geometry resolution failed for {spot.get('name')}: {e}")
            _GEOMETRY_CACHE[key] = None
    return _GEOMETRY_CACHE[key]


def shore_normal_for(spot: Dict[str, Any]) -> Optional[float]:
    """THE one seaward bearing for this spot — resolved bathymetry, else the catalog fallback.

    Every consumer in this module (wind class, swell alignment, the delegated rating, the height
    exposure factor) reads it from here. `2851a598` already fixed one two-reference-frame bug in
    this file (wind class keyed off `optimal_wind_dir` while the score keyed off `orientation`);
    `swell_alignment_pct` still had the same defect against `optimal_swell_dir` — it reported 100%
    alignment for a Mavericks swell the engine was scoring at 42% — so both are gone and there is
    one frame."""
    geo = spot_geometry(spot)
    if geo is not None and geo.shore_normal_deg is not None:
        return float(geo.shore_normal_deg)
    o = spot.get("orientation")
    return float(o) if o is not None else None


def reference_size_for(spot: Dict[str, Any]) -> Optional[float]:
    """Local size reference, gated on the SAME flag production gates it on. Off (the default) means
    the global 1.2 m curve — exactly what the app is serving today."""
    if os.environ.get("RATING_LOCAL_SIZE", "0") != "1":
        return None
    return spot.get("reference_size_m")


# 3. Core Physics and Weather Calculation Engine
def calculate_surf_rating(
    spot: Dict[str, Any],
    swell_h: float,
    swell_p: float,
    swell_dir: float,
    wind_spd: float,
    wind_dir: float
) -> Dict[str, Any]:
    """Breaking wave height and 0-100 surf quality for a spot under a given weather vector.

    Delegates BOTH the physics and its composition to production (`surf_point.estimate_surf_at` ->
    `surf_transform.estimate_surf`, and `surf_rating.rating_score`), so the number this returns is
    the number the app would show at that coordinate.
    """
    shore_normal = shore_normal_for(spot)
    geo = spot_geometry(spot)

    # 1. Nearshore breaking height — the FULL production chain, not just Komar.
    # Raw `komar_breaker_height(Hs, Tp)` skips cross-shelf bottom friction, the swell-angle
    # exposure factor, sub-grid magnets and the depth-limited breaking cap. Measured 2026-07-27
    # that omission over-read the served height by a median 19.1% (max +39.2%).
    regime = "estimate"
    breaking_height = None
    if geo is not None:
        try:
            breaking_height, regime = estimate_surf_at(
                float(spot["latitude"]), float(spot["longitude"]),
                swell_h, swell_p, swell_from_deg=swell_dir, geometry=geo)
        except Exception as e:
            logger.warning(f"estimate_surf_at failed for {spot.get('name')}: {e}")
            breaking_height = None
    if breaking_height is None:
        # No geometry (kill switch, missing coords, open-ocean/unknown regime) -> the previous
        # deep-water-only estimate. Never a crash, never a silent zero for a real swell.
        breaking_height = komar_breaker_height(swell_h, swell_p)
        if breaking_height is None:      # non-physical input (h<=0 or Tp<=0) -> flat
            breaking_height, regime = 0.0, "calm"
        elif geo is None:
            regime = "deep_water_estimate"

    # 2. Wind CLASS — derived from the SAME reference frame the delegated score uses, so the label
    # persisted to condition_reports.wind_conditions cannot contradict the score. Thresholds are the
    # exact equivalents of the old angular ones (wind_diff < 45 deg <=> offshoreness > cos45).
    _off = offshoreness(wind_dir, shore_normal)
    if wind_spd < 3.0:
        wind_label = "Glassy"
    elif _off is None:
        wind_label = "Sideshore"          # unknown geometry -> the neutral class
    elif _off > 0.7071:
        wind_label = "Offshore"
    elif _off < -0.7071:
        wind_label = "Onshore"
    else:
        wind_label = "Sideshore"

    # 3. Swell alignment — reported against the SAME shore normal (see shore_normal_for).
    if shore_normal is None:
        swell_alignment = 1.0             # unknown geometry fails OPEN, as the height factor does
    else:
        swell_diff = abs((swell_dir - shore_normal + 180) % 360 - 180)
        swell_alignment = max(0.1, math.cos(math.radians(swell_diff)))

    breaking_height_ft = round(breaking_height * 3.28084, 1)  # metres to feet

    # 4. Final Wave Quality Rating (0 to 100) — DELEGATED to the production engine, whose
    # multiplicative size_gate is 0 below the rideability floor, so flat is 0 by construction.
    quality_score = rating_score(
        breaking_height,                      # nearshore BREAKING height, metres
        swell_p,
        wind_spd / MS_TO_KT,                  # engine wants m/s; sim inputs are knots
        wind_from_deg=wind_dir,
        shore_normal_deg=shore_normal,
        swell_from_deg=swell_dir,
        reference_size_m=reference_size_for(spot),
    )
    quality_label = score_to_level(quality_score)

    # 5. `conditions_label` is the app's SIZE ladder, not a quality verdict. Every other writer
    # emits "Waist High"/"Chest High"/…, and SpotHubConditionsTab.js keys a colour map on those
    # exact strings — an off-vocabulary value silently renders grey. The verdict travels in its own
    # `quality_label` field instead of overloading this one.
    return {
        "breaking_height_ft": breaking_height_ft,
        "surf_regime": regime,
        "quality_rating": quality_score,
        "quality_label": quality_label,
        "conditions_label": get_conditions_label(breaking_height_ft),
        "wind_class": wind_label,
        "swell_alignment_pct": round(swell_alignment * 100, 0),
        "shore_normal_deg": shore_normal,
        "shore_normal_source": geo.shore_normal_src if geo is not None else "catalog_fallback",
    }


def _geometry_payload(spot: Dict[str, Any]) -> Dict[str, Any]:
    """The resolved bathymetry for a spot — what makes the estimate spot-specific."""
    geo = spot_geometry(spot)
    if geo is None:
        return {"resolved": False, "shore_normal_deg": shore_normal_for(spot),
                "shore_normal_source": "catalog_fallback"}
    return {
        "resolved": True,
        "shore_normal_deg": geo.shore_normal_deg,
        "shore_normal_source": geo.shore_normal_src,
        "shelf_depth_m": geo.depth_m,
        "shelf_width_km": round(geo.shelf_width_km, 2) if geo.shelf_width_km else geo.shelf_width_km,
        "break_depth_m": geo.break_depth_m,
        "coastal": geo.coastal,
        "nearshore": geo.nearshore,
        "magnet_factor": geo.magnet_factor,
    }


def _baseline_with_source(spot: Dict[str, Any]
                          ) -> Tuple[Optional[Dict[str, float]], str, Dict[str, Any]]:
    """The spot's baseline weather vector with its provenance.

    Precedence: a staged simulation override, then the app's LIVE forecast, then the hand-tuned
    catalog defaults. The live forecast outranks those defaults deliberately — they are invented
    constants for three spots, and a real forecast at the same coordinate is strictly better. It
    does NOT outrank an override, because an override is the caller's explicit what-if."""
    override = _SIM_OVERRIDES.get(spot.get("name", ""))
    if override:
        return dict(override), "simulated_override", {}

    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is not None and lng is not None:
        live, provenance = sim_forecast.fetch_live_forecast(float(lat), float(lng))
        if live is not None:
            return live, "live_forecast", provenance
    else:
        provenance = {"reason": "spot has no coordinates"}

    if "base_swell_height" not in spot:
        return None, "none", provenance
    return {
        "swell_height_m": spot["base_swell_height"],
        "swell_period_sec": spot["base_swell_period"],
        "swell_direction_deg": spot.get("base_swell_direction", 270.0),
        "wind_speed_knots": spot["base_wind_speed"],
        "wind_direction_deg": spot["base_wind_direction"],
    }, "catalog_default", provenance


def _baseline_for(spot: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """The spot's current baseline weather vector, or None when nothing has established one."""
    return _baseline_with_source(spot)[0]


# 4. FastMCP Tools

@mcp.tool
def get_surf_spots(query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Get surf spots from the catalog with coordinates, regions, and resolved shore orientation.

    Args:
        query: Optional case-insensitive substring to filter spot names.
        limit: Maximum spots to return (the catalog holds ~1547 active spots).
    """
    db_spots = query_spots_from_db(name_query=query or None, limit=max(1, min(int(limit), 500)))
    # Name the real source. `dev.db` has drifted into WRONG COORDINATES (Bethune Beach sits 7 km
    # from where production put it), so "which catalogue answered" is not a detail.
    source = "live_catalog" if sim_forecast.fetch_catalog() else "surf_spots_snapshot"
    if not db_spots:
        source = "catalog_defaults"
        db_spots = [
            {"id": s["id"], "name": s["name"], "region": s["region"],
             "latitude": s["latitude"], "longitude": s["longitude"]}
            for s in MOCK_SPOTS.values()
            if not query or query.lower() in s["name"].lower()
        ]
    out = []
    for s in db_spots:
        # `orientation` used to be hardcoded 270 for every database row. It is now the real seaward
        # bearing from the same chain production uses, so a caller reasoning about swell windows
        # gets the spot's actual aspect.
        out.append({**s, "orientation": shore_normal_for(s),
                    "orientation_source": (spot_geometry(s).shore_normal_src
                                           if spot_geometry(s) is not None else "catalog_fallback")})
    return {"source": source, "returned": len(out), "spots": out}


@mcp.tool
def get_weather_forecast(spot_name: str) -> Dict[str, Any]:
    """Get the active weather, swell, and wind forecast for a specific surf spot.

    Args:
        spot_name: The name of the spot (e.g., 'Mavericks', 'Pipeline').
    """
    spot = resolve_spot(spot_name)
    if not spot:
        return {"error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    baseline, source, provenance = _baseline_with_source(spot)
    payload: Dict[str, Any] = {
        "spot": spot["name"],
        "region": spot.get("region"),
        "coordinates": {"lat": spot["latitude"], "lng": spot["longitude"]},
        "geometry": _geometry_payload(spot),
    }
    if baseline is None:
        # Honest empty rather than a fabricated forecast. simulate_weather_change still works here —
        # it takes the weather as INPUT, so every catalog spot can be simulated.
        payload["forecast"] = None
        payload["baseline_source"] = "none"
        payload["forecast_provenance"] = provenance
        payload["note"] = (
            f"No forecast could be established for this spot ({provenance.get('reason', 'unknown')})"
            ". Use simulate_weather_change() to evaluate a specific weather vector.")
        return payload

    payload["forecast"] = baseline
    payload["baseline_source"] = source
    if provenance:
        payload["forecast_provenance"] = provenance
    payload["wave_simulation"] = calculate_surf_rating(
        spot, baseline["swell_height_m"], baseline["swell_period_sec"],
        baseline["swell_direction_deg"], baseline["wind_speed_knots"],
        baseline["wind_direction_deg"])

    # PARITY: the app served its own breaking height for this coordinate. The sim computed one from
    # the offshore Hs through the production chain. Report both — a silent divergence here is the
    # exact defect `cf2efb48` was written to end, and it is only visible if somebody prints it.
    served = provenance.get("served_surf_height_m") if source == "live_forecast" else None
    if served:
        sim_m = payload["wave_simulation"]["breaking_height_ft"] / 3.28084
        payload["parity"] = {
            "served_surf_height_m": round(float(served), 4),
            "sim_breaking_height_m": round(sim_m, 4),
            "delta_pct": round((sim_m - float(served)) / float(served) * 100, 2),
        }
    return payload


@mcp.tool
def simulate_weather_change(
    spot_name: str,
    wind_speed_knots: float,
    wind_direction_deg: float,
    swell_height_m: float,
    swell_period_sec: float,
    swell_direction_deg: float,
    caller_role: str = "surfer"
) -> Dict[str, Any]:
    """Simulates how changing weather and swell vectors will alter wave quality and surf height.

    Args:
        spot_name: The name of the spot to simulate.
        wind_speed_knots: The simulated wind speed in knots (0.0 to 150.0).
        wind_direction_deg: The simulated wind direction in degrees (0.0 to 360.0).
        swell_height_m: The simulated ocean swell height in meters (0.0 to 50.0).
        swell_period_sec: The simulated swell period in seconds (0.0 to 30.0).
        swell_direction_deg: The simulated swell direction in degrees (0.0 to 360.0).
        caller_role: The role of the calling user (must be 'admin' to mutate).
    """
    # ⚠️ `caller_role` is an ordinary caller-supplied string, NOT authentication. This is a local
    # sandbox gate; it is not the app's auth pattern (that is the JWT get_current_user_id checks).
    if caller_role != "admin":
        return {
            "success": False,
            "error": "Unauthorized: weather simulation overrides require admin role permissions."
        }

    # Verify parameter ranges to prevent database corruption and bad calculations
    for label, value, lo, hi in (
        ("wind speed", wind_speed_knots, 0.0, 150.0),
        ("wind direction", wind_direction_deg, 0.0, 360.0),
        ("swell height", swell_height_m, 0.0, 50.0),
        ("swell period", swell_period_sec, 0.0, 30.0),
        ("swell direction", swell_direction_deg, 0.0, 360.0),
    ):
        if not (lo <= value <= hi):
            unit = {"wind speed": "knots", "wind direction": "degrees", "swell height": "meters",
                    "swell period": "seconds", "swell direction": "degrees"}[label]
            return {
                "success": False,
                "error": (f"Invalid {label}: {value} {unit}. "
                          f"Must be between {lo} and {hi} {unit}.")
            }

    spot = resolve_spot(spot_name)
    if not spot:
        return {"success": False,
                "error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    calc = calculate_surf_rating(
        spot,
        swell_height_m,
        swell_period_sec,
        swell_direction_deg,
        wind_speed_knots,
        wind_direction_deg
    )

    # Persist simulation changes to condition_reports in dev.db if present. NOTE this is a
    # write-only path for this server — nothing here reads those columns back; they are read by the
    # APP (condition_reports routes + 6 frontend surfaces), which is why conditions_label must stay
    # in the size vocabulary.
    conn = get_db_connection()
    db_updated = False
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE condition_reports
                SET wave_height_ft = ?, conditions_label = ?, wind_conditions = ?, updated_at = datetime('now')
                WHERE spot_name = ? AND is_active = 1
                """,
                (calc["breaking_height_ft"], calc["conditions_label"], calc["wind_class"], spot["name"])
            )
            conn.commit()
            if cursor.rowcount > 0:
                db_updated = True
                logger.info(f"SQLite cache updated successfully for spot '{spot['name']}'. {cursor.rowcount} rows affected.")
            else:
                logger.warning(f"No active condition reports found in SQLite for spot '{spot['name']}' to update.")
        except Exception as e:
            logger.error(f"Failed to persist simulated conditions for spot '{spot['name']}' to SQLite: {e}")
        finally:
            conn.close()
    else:
        logger.warning(f"SQLite connection unavailable. Could not persist simulated conditions for spot '{spot_name}'.")

    # Stage the vector as this spot's baseline for subsequent get_weather_forecast reads. Held in a
    # SEPARATE dict rather than mutated into MOCK_SPOTS, so the catalog defaults stay clean and the
    # forecast can report `baseline_source: simulated_override` instead of silently presenting a
    # staged scenario as the spot's normal conditions.
    _SIM_OVERRIDES[spot["name"]] = {
        "swell_height_m": swell_height_m,
        "swell_period_sec": swell_period_sec,
        "swell_direction_deg": swell_direction_deg,
        "wind_speed_knots": wind_speed_knots,
        "wind_direction_deg": wind_direction_deg,
    }

    return {
        "success": True,
        "simulation_type": "weather_vector_override",
        "spot": spot["name"],
        "database_updated": db_updated,
        "geometry": _geometry_payload(spot),
        "input_parameters": {
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg
        },
        "simulated_surf_output": calc
    }


@mcp.tool
def clear_simulation_overrides(spot_name: str = "") -> Dict[str, Any]:
    """Drop staged simulation overrides so forecasts return to catalog defaults.

    Args:
        spot_name: Clear just this spot; empty clears every staged override.
    """
    if spot_name:
        removed = 1 if _SIM_OVERRIDES.pop(spot_name, None) else 0
    else:
        removed = len(_SIM_OVERRIDES)
        _SIM_OVERRIDES.clear()
    return {"success": True, "cleared": removed, "remaining": sorted(_SIM_OVERRIDES)}


# 5. FastMCP Resources

@mcp.resource("data://forecasts/summary")
def get_forecasts_summary() -> str:
    """A global textual summary of active surf conditions across all regions."""
    lines = ["=== DAILY OCEAN CONDITIONS AND FORECAST SUMMARY ==="]
    for s_name, spot in MOCK_SPOTS.items():
        baseline = _baseline_for(spot)
        if baseline is None:
            continue
        calc = calculate_surf_rating(
            spot,
            baseline["swell_height_m"],
            baseline["swell_period_sec"],
            baseline["swell_direction_deg"],
            baseline["wind_speed_knots"],
            baseline["wind_direction_deg"],
        )
        # `conditions_label` is the SIZE ladder — this line used to print it inside "Quality: …",
        # reporting e.g. "Quality: 56.4/100 (Triple Overhead+)" and mixing the two vocabularies the
        # rest of the module works to keep apart. Size and verdict are now named separately.
        lines.append(
            f" - {s_name}: Breaking at {calc['breaking_height_ft']} ft ({calc['conditions_label']}) | "
            f"Quality: {calc['quality_rating']}/100 ({calc['quality_label']}) | "
            f"Wind: {baseline['wind_speed_knots']} kts {calc['wind_class']}"
        )
    return "\n".join(lines)


# 6. FastMCP Prompts

@mcp.prompt("surf_forecast_advisor")
def get_surf_advisor_prompt(spot_name: str) -> str:
    """Prompt template that helps analyze surf and wind parameters to give strategic surf advice."""
    spot = resolve_spot(spot_name) or MOCK_SPOTS["Mavericks"]
    normal = shore_normal_for(spot)
    # Both optimal directions are DERIVED from the one shore normal rather than stored separately.
    # The stored `optimal_wind_dir`/`optimal_swell_dir` fields disagreed with the bearing the engine
    # actually scores against (by 20 deg at Montara, 64.9 deg at Mavericks), so this prompt used to
    # brief the model on parameters the simulation was not using.
    if normal is None:
        return (f"You are a veteran surf forecaster advising a professional surfer about "
                f"'{spot['name']}'. No shore orientation could be resolved for this spot, so treat "
                f"swell-window and wind-direction reasoning as unconstrained and say so explicitly.")
    return f"""You are a veteran surf forecaster and oceanographer advising a professional surfer.

Here are the resolved parameters for the spot '{spot['name']}':
- Shore normal (seaward bearing): {round(normal, 1)}°
- Optimal swell direction: {round(normal, 1)}° (swell arriving head-on)
- Optimal wind direction: {round((normal - 180) % 360, 1)}° (offshore — blowing out to sea)

Analyze the current weather and swell forecast for this spot. Run a physical simulation calculating the wave break height and wind-swell vector alignment. Detail:
1. Expected breaking wave height (ft) and swell-to-beach vector alignment percentage.
2. The offshore/sideshore classification of the wind vector.
3. Your strategic recommendation: Should they surf this spot today, wait for tide changes, or head to another spot in the region? Explain your reasoning with physical principles of bathymetry and wave shoaling.
"""

# 7. Main-thread warm-up — WITHOUT THIS THE SERVER DEADLOCKS ON ITS FIRST TOOL CALL
#
# Measured 2026-07-27 against the real stdio server: `get_surf_spots(query="Mavericks", limit=5)`
# returned NOTHING for 480 s (the MCP client gives up at 1800 s), while the identical call
# in-process took 0.02 s. faulthandler dumps of the live server — byte-identical at 25 s, 50 s and
# 75 s — put the AnyIO worker thread inside `create_module`, loading numpy's `_multiarray_umath` C
# extension, reached from `bathymetry.shelf_depth_at` where `import numpy` is a FUNCTION-level
# import. Loading that DLL from a worker thread under the running stdio event loop never returns.
#
# What the measurements ruled OUT, so nobody re-tries them:
#   * Not slowness — 3.7 s of CPU across 43 minutes of hanging.
#   * Not fastmcp and not sync-vs-async dispatch — a minimal server with a trivial sync tool
#     answers in 0.01 s on this same interpreter.
#   * Not `get_surf_spots` — whichever tool is called FIRST is the one that hangs, and a second
#     request unblocks the first (its response then arrives late, under the earlier id).
#   * Not fixed by importing `bathymetry` — numpy is imported inside the function, not at that
#     module's scope, so importing the module warms nothing.
# Importing numpy on the MAIN thread first makes the identical call return in 0.02 s.
#
# One full rating is run rather than a bare `import numpy` so that EVERY lazy import on the tool
# hot path — the bathymetry grid load, the ETOPO shore-normal asset, the magnet overrides,
# `surf_transform.estimate_surf` — is resolved here too, on the main thread. Measured cost ~0.2 s.
# Kill: SIM_EAGER_WARMUP=0.
def _warm_hot_path() -> bool:
    """Resolve the tool hot path's lazy imports on the MAIN thread. Never raises."""
    if not _sim_flag("SIM_EAGER_WARMUP"):
        return False
    try:
        import time as _time
        _t0 = _time.time()
        calculate_surf_rating(MOCK_SPOTS["Mavericks"], 3.5, 16.0, 290.0, 12.0, 95.0)
        logger.info(f"hot path warmed on the main thread in {_time.time() - _t0:.2f}s")
        return True
    except Exception as e:
        # A failed warm-up must never stop the server booting — it only forfeits the protection.
        logger.warning(f"hot-path warm-up failed ({e}); the first tool call may block.")
        return False


_warm_hot_path()


if __name__ == "__main__":
    mcp.run()
