import sqlite3
import logging
import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple
from services.weather_pipeline.sim_mcp_shim import FastMCP   # real fastmcp, else an import-only stand-in
from utils.sqlite_helpers import get_sqlite_connection
# The PRODUCTION rating engine is authoritative (CLAUDE.md). The sim delegates to it rather than
# carrying a second formula — a divergent copy is exactly how this file came to rate a flat ocean
# "Epic". The COMPOSITION that feeds it (geometry resolution, the exposure frame, which optional
# factors are passed) now lives in `sim_rating`, next to the other two rating surfaces so a parity
# test can enumerate all three — this file was at 789 of the 800-line ratchet. Re-exported below
# because the suite and `_warm_hot_path` read these names off this module.
from services.weather_pipeline.sim_rating import (      # noqa: F401  (re-exported)
    _GEOMETRY_CACHE, _sim_flag, calculate_surf_rating, conflict_delta,
    geometry_payload as _geometry_payload, reference_size_for, shore_normal_for, spot_geometry,
)
# The app's own /api/weather/point, so every catalog spot has a real forecast instead of the three
# hand-tuned ones. Imported at module scope: it pulls urllib/ssl, and a C extension loaded lazily
# inside a tool is what deadlocked this server (see `_warm_hot_path`). Kill: SIM_LIVE_FORECAST=0.
from services.weather_pipeline import sim_forecast
# ONE identity per spot name. This module used to resolve names itself, hand-tuned table FIRST, so
# `get_weather_forecast("Mavericks")` and `("mavericks")` answered about coordinates 637 m apart —
# see `sim_spots` for the measurement and the precedence that replaced it.
from services.weather_pipeline import sim_spots
# The horizon scan — "which hour", not just "this hour". Kept out of this file because it is the
# scan LOGIC (frame budget, ranking, honest truncation) and this file has twice been blocked at the
# 800-line ratchet; the tool below is the thin wrapper.
from services.weather_pipeline import sim_window
# The SPATIAL scan — "which spot", the other half of the same question. Same reason it lives
# outside: the ranking rules (the geometry gate, the resolving-power margin) are the substance.
from services.weather_pipeline import sim_compare
# The prose surfaces (conditions summary resource + advisor prompt).
from services.weather_pipeline import sim_briefing
# The main-thread warm-up that keeps the stdio server from deadlocking on its first tool call.
from services.weather_pipeline import sim_boot
# What the APP is actually showing, so the forecast tool can check its QUALITY against it and not
# just its HEIGHT. Kill: SIM_OBSERVED=0.
from services.weather_pipeline import sim_observed

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


# 1. Catalog defaults for the three hand-tuned spots. These carry a BASELINE forecast (the
# `base_*` fields), which the 1800+ database spots do not — see `get_weather_forecast`.
# ⚠️ They no longer own IDENTITY: where the app's catalogue knows the name, its id/region/
# coordinates win, and only the `base_*` baseline and `reference_size_m` are grafted on. Kept
# exported under this name because the suite reads it.
MOCK_SPOTS = sim_spots.CATALOG_DEFAULTS

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


# The catalogue read and name resolution both live in `sim_spots` now — the identity rules got long
# enough to deserve their own tests, and this file was 52 lines under the 800 ratchet.
query_spots_from_db = sim_spots.query_spots


def resolve_spot(spot_name: str) -> Optional[Dict[str, Any]]:
    """The ONE spot a caller named, or None when the name is unknown OR ambiguous.

    Tools should prefer `sim_spots.resolve`, which distinguishes those two cases — an ambiguous
    name must not be reported as a missing one. Kept for callers that only need the happy path."""
    return sim_spots.resolve(spot_name).spot



def _baseline_with_source(spot: Dict[str, Any], valid_time: Optional[str] = None
                          ) -> Tuple[Optional[Dict[str, float]], str, Dict[str, Any]]:
    """The spot's baseline weather vector with its provenance.

    Precedence: a staged simulation override, then the app's LIVE forecast, then the hand-tuned
    catalog defaults. The live forecast outranks those defaults deliberately — they are invented
    constants for three spots, and a real forecast at the same coordinate is strictly better. It
    does NOT outrank an override, because an override is the caller's explicit what-if.

    ⚠️ An override is TIMELESS — it is "pretend the weather is this", with no hour attached. So it
    still wins when a `valid_time` is requested, and the caller is TOLD, because a requested hour
    that silently changed nothing would be the worse surprise."""
    override = _SIM_OVERRIDES.get(spot.get("name", ""))
    if override:
        note = ({"note": f"a staged override is masking the requested hour {valid_time}; "
                         f"clear_simulation_overrides() to see the real forecast"}
                if valid_time else {})
        return dict(override), "simulated_override", note

    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is not None and lng is not None:
        live, provenance = sim_forecast.fetch_live_forecast(float(lat), float(lng), valid_time)
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


# The trains-still-describe-the-sea rule (drop on any swell change, keep on wind-only) lives
# beside the baseline producer in `sim_forecast` — this file is at the 800-line ratchet.
_baseline_partitions = sim_forecast.baseline_partitions


def _parse_valid_time(valid_time: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Normalise a requested hour to the top of the hour, or explain why it can't be.

    Returns ``(hour, None)`` on success and ``("", {"error": ...})`` on a malformed value.

    ⚠️ Validate BEFORE dialling. The hour is interpolated into a URL, and a malformed value would
    spend the full timeout to come back empty — indistinguishable from "no data at this spot".
    Shared by both tools that take an hour so they cannot disagree about what one means."""
    hour = (valid_time or "").strip()
    if not hour:
        return "", None
    try:
        parsed = datetime.strptime(hour, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return "", {"error": f"valid_time must be ISO-8601 UTC like '2026-07-29T15:00:00Z', "
                             f"got {valid_time!r}."}
    # The products are HOURLY frames; a sub-hour request silently snaps, so snap it here and say
    # what was actually asked for.
    return parsed.replace(minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%SZ"), None


# 4. FastMCP Tools

@mcp.tool
def get_surf_spots(query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Get surf spots from the catalog with coordinates, regions, and resolved shore orientation.

    Args:
        query: Optional case-insensitive substring to filter spot names.
        limit: Maximum spots to return (the catalog holds ~1818 active spots; the response
            reports `total_matching` so a capped answer is never mistaken for the whole set).
    """
    # ⚠️ THE CAP IS A MEASURED BUDGET, NOT A ROUND NUMBER. Serialised size 2026-07-27:
    # 50 spots = 9.4 KB (~2.4k tokens) · 200 = 37.4 KB (~9.6k) · 500 = 93.5 KB (~24k). An MCP client
    # REJECTS a result of that size rather than showing it, which reads to the caller as "the tool
    # is broken" — so a limit the client cannot receive is not a feature. 200 is the largest round
    # figure that stays comfortably inside a normal budget. Narrow with `query` to see more; the
    # response reports `total_matching` so a truncated answer never looks complete.
    hard_cap = int(os.environ.get("SIM_SPOTS_MAX", "200"))
    requested = max(1, int(limit))
    db_spots = query_spots_from_db(name_query=query or None, limit=min(requested, hard_cap))
    # Name the real source. `dev.db` has drifted into WRONG COORDINATES (Bethune Beach sits 7 km
    # from where production put it), so "which catalogue answered" is not a detail.
    source = sim_spots.catalog_source()
    if not db_spots:
        source = "catalog_defaults"
        db_spots = [
            {"id": s["id"], "name": s["name"], "region": s["region"],
             "latitude": s["latitude"], "longitude": s["longitude"]}
            for s in MOCK_SPOTS.values()
            if not query or query.lower() in s["name"].lower()
        ]
    # ⚠️ RESPONSE SIZE IS A FAILURE MODE. Measured 2026-07-27, `limit=500` serialised to 94.8 KB
    # (~24k tokens) — at or past the point where an MCP client REJECTS the result instead of showing
    # it, which reads to the caller as "the tool is broken". Most of that was noise: an unrounded
    # coast-PCA bearing serialises as `160.25316339457387`, 17 significant digits for a number that
    # is meaningful to about one tenth of a degree. Rounding costs no information and roughly a
    # third of the payload.
    def _tidy(value, places):
        return None if value is None else round(float(value), places)

    out = []
    for s in db_spots:
        # `orientation` used to be hardcoded 270 for every database row. It is now the real seaward
        # bearing from the same chain production uses, so a caller reasoning about swell windows
        # gets the spot's actual aspect.
        geo = spot_geometry(s)
        out.append({**s,
                    "latitude": _tidy(s.get("latitude"), 5),      # 5 dp ~= 1 m; more is noise
                    "longitude": _tidy(s.get("longitude"), 5),
                    "orientation": _tidy(shore_normal_for(s), 1),
                    "orientation_source": (geo.shore_normal_src if geo is not None
                                           else "catalog_fallback")})
    # Count the full match set so a capped answer can never be mistaken for the whole catalogue.
    live = sim_forecast.fetch_catalog()
    total = (sum(1 for s in live if not query or query.lower() in (s["name"] or "").lower())
             if live else None)
    payload = {"source": source, "returned": len(out), "spots": out}
    if total is not None:
        payload["total_matching"] = total
        if total > len(out):
            payload["note"] = (f"showing {len(out)} of {total} matches (cap {hard_cap}) — narrow "
                               f"with `query` to see the rest.")
    return payload


@mcp.tool
def get_weather_forecast(spot_name: str, valid_time: str = "") -> Dict[str, Any]:
    """Get the weather, swell, and wind forecast for a surf spot, now or at a future hour.

    Args:
        spot_name: The name of the spot (e.g., 'Mavericks', 'Pipeline'), or its id.
        valid_time: Optional ISO-8601 UTC hour to forecast, e.g. '2026-07-29T15:00:00Z'.
            Empty means the current hour. The app serves frames out to about 7 days ahead.
    """
    hour, err = _parse_valid_time(valid_time)
    if err:
        return err

    found = sim_spots.resolve(spot_name)
    if found.candidates:
        return sim_spots.ambiguity_error(spot_name, found.candidates)
    spot = found.spot
    if not spot:
        return {"error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    baseline, source, provenance = _baseline_with_source(spot, hour or None)
    payload: Dict[str, Any] = {
        "spot": spot["name"],
        "region": spot.get("region"),
        "requested_valid_time": hour or "now",
        "coordinates": {"lat": spot["latitude"], "lng": spot["longitude"]},
        # WHICH catalogue this identity came from. `catalog_default` means the app did not know the
        # name and a hand-tuned row answered — at ITS coordinates, which is worth seeing.
        "spot_source": found.identity_source,
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
        baseline["wind_direction_deg"], partitions=_baseline_partitions(baseline),
        # ⛔⛔ ARMS THE OBSERVATION GATE, which `calculate_surf_rating` applies only when
        # `valid_time is not None`. Omitted until 2026-08-03: the hour was parsed and used for the
        # BASELINE two lines up, then dropped here, so this tool published Nai Harn as 70.5 `good`
        # while the app served 66.4 `fair_good` — #13's asymmetry, re-opened by a None default.
        # Guarded by GATE_ARG_CALLERS in tests/test_rating_composition_parity.py.
        valid_time=hour or None,
        # I/O already paid — this tool FETCHED the baseline it is rating, and it is the one
        # surface that prints its own parity against the app. Without the lookup it would grade
        # the global 1.2 m curve while the glyph grades locally, and the probe (which does look
        # up) would read GREEN over it — a false green on the path a user actually reads.
        allow_reference_lookup=True,
        # ...and the curve the APP used, off that same response. The lookup above still needs
        # RATING_LOCAL_SIZE in THIS process; this needs nothing but a reachable app.
        served_reference_size_m=sim_forecast.served_reference(provenance))

    # PARITY, both halves. The app serves its own breaking height AND its own quality for this
    # coordinate; the sim computes both from the offshore vector through the production chain. A
    # silent divergence in either is the defect `cf2efb48` was written to end, and it is only
    # visible if somebody prints it. ⚠️ ONLY on this tool — it reports the REAL forecast, so "does
    # this match the app?" has an answer; a what-if describes a sea the app never rated, and
    # `simulate_weather_change`'s all-five path must stay at ZERO HTTP (`576dcbdd`).
    parity = sim_observed.parity(payload["wave_simulation"], spot, provenance, source, hour)
    if parity:
        payload["parity"] = parity
    return payload


@mcp.tool
def simulate_weather_change(
    spot_name: str,
    wind_speed_knots: Optional[float] = None,
    wind_direction_deg: Optional[float] = None,
    swell_height_m: Optional[float] = None,
    swell_period_sec: Optional[float] = None,
    swell_direction_deg: Optional[float] = None,
    caller_role: str = "surfer",
    valid_time: str = "",
) -> Dict[str, Any]:
    """Simulates how changing weather and swell vectors will alter wave quality and surf height.

    OMIT any input to hold the REAL forecast's value for it. That is what makes this a what-if
    rather than a quiz: "what if the wind swung offshore at dawn on Thursday" is one wind field and
    an hour, not five numbers the asker would have to look up and retype — and retyping four of them
    by hand is how a "what-if" quietly becomes a different sea state than the one being asked about.
    When a baseline is in hand the answer carries `baseline_delta`: what changed, and what it did to
    the rating.

    Args:
        spot_name: The name of the spot to simulate.
        wind_speed_knots: Simulated wind speed in knots (0.0 to 150.0). Omit to keep the forecast's.
        wind_direction_deg: Simulated wind direction in degrees (0.0 to 360.0). Omit to keep it.
        swell_height_m: Simulated OFFSHORE swell height in metres (0.0 to 50.0). Omit to keep it.
            ⚠️ This is the offshore significant wave height, the same quantity the model carries —
            NOT the breaking height. The breaking height is what comes BACK, in `breaking_height_ft`.
        swell_period_sec: Simulated swell period in seconds (0.0 to 30.0). Omit to keep it.
        swell_direction_deg: Simulated swell direction in degrees (0.0 to 360.0). Omit to keep it.
        caller_role: The role of the calling user. Any role may run the WHAT-IF; only 'admin' may
            persist it to condition_reports and stage it as the spot's baseline.
        valid_time: Optional ISO-8601 UTC hour to simulate, e.g. '2026-07-31T15:00:00Z'. Empty means
            the current hour. The app serves frames out to about 7 days ahead.
    """
    # ⚠️ `caller_role` is an ordinary caller-supplied string, NOT authentication. This is a local
    # sandbox gate; it is not the app's auth pattern (that is the JWT get_current_user_id checks).
    #
    # THE GATE GUARDS THE MUTATION, NOT THE ARITHMETIC (2026-07-29). It used to return Unauthorized
    # before computing anything, which made the tool's own advertised purpose — "simulates how
    # changing weather and swell vectors will alter wave quality and surf height" — unreachable
    # without also writing to `condition_reports` (read by 4 backend routes + 6 frontend surfaces)
    # and staging an override that OUTRANKS the live forecast on every later read of that spot.
    # There was no way to ask a what-if question. The docstring already said "must be 'admin' to
    # mutate"; the code was stricter than its own contract. Computing is pure — `calculate_surf_rating`
    # touches no DB and no module state — so a non-admin now gets the full answer with
    # `persisted: false`, and every write below stays exactly as gated as it was.
    may_mutate = caller_role == "admin"

    hour, err = _parse_valid_time(valid_time)
    if err:
        return {"success": False, **err}

    # The spot must resolve BEFORE the inputs are checked: an omitted input is filled from that
    # spot's forecast, so there is nothing to validate until we know which spot (and which hour).
    found = sim_spots.resolve(spot_name)
    if found.candidates:
        return {"success": False, **sim_spots.ambiguity_error(spot_name, found.candidates)}
    spot = found.spot
    if not spot:
        return {"success": False,
                "error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    requested = {
        "wind_speed_knots": wind_speed_knots,
        "wind_direction_deg": wind_direction_deg,
        "swell_height_m": swell_height_m,
        "swell_period_sec": swell_period_sec,
        "swell_direction_deg": swell_direction_deg,
    }
    omitted = [k for k, v in requested.items() if v is None]

    # ⚠️ FETCH ONLY WHEN THE ANSWER DEPENDS ON IT. With all five supplied and no hour named, this
    # tool did zero network I/O and must keep doing zero — an unconditional fetch here is the
    # regression `576dcbdd` fixed. Omitting an input, or naming an hour, is the caller opting IN to
    # the forecast-anchored mode and accepting its cost; otherwise we only PEEK the cache, which is
    # a hit whenever get_weather_forecast was already asked about this spot and hour.
    if omitted or hour:
        baseline, baseline_source, provenance = _baseline_with_source(spot, hour or None)
    else:
        peeked = sim_forecast.peek_live_forecast(
            float(spot["latitude"]), float(spot["longitude"])) if spot.get("latitude") is not None else None
        override = _SIM_OVERRIDES.get(spot.get("name", ""))
        if override:
            baseline, baseline_source, provenance = dict(override), "simulated_override", {}
        elif peeked and peeked[0] is not None:
            baseline, baseline_source, provenance = peeked[0], "live_forecast", peeked[1]
        else:
            baseline, baseline_source, provenance = None, "none", {}

    # ⚠️⚠️ THE I/O BUDGET IS THE CALLER'S OPT-IN — **NOT** "do we have a baseline".
    # `allow_reference_lookup` was keyed on `baseline is not None`, described as "the caller has
    # already paid for the fetch". That is false on two of the three branches above: a PEEKED cache
    # hit and a staged `_SIM_OVERRIDES` entry both yield a baseline having paid NOTHING. Measured
    # 2026-08-01 by spying on `load_size_climatology_l2` (the function that actually performs HTTP,
    # with its 600 s TTL left intact — stubbing the cached wrapper inflates the count):
    #
    #     all five inputs, no hour, COLD forecast cache -> 0 HTTP dials   invariant holds
    #     all five inputs, no hour, WARM forecast cache -> 2 HTTP dials   invariant VIOLATED
    #
    # The warm case is the COMMON one on a long-lived server, and it is exactly the flow
    # `test_a_cached_forecast_is_PEEKED_not_refetched` calls "what makes the delta free". It was no
    # longer free. ★ 3rd instance of *a code comment's framing of WHEN a path fires is not
    # evidence* — the comment named one branch and there were three.
    #
    # ★★ AND IT MUST BE THE SAME VALUE ON BOTH SIDES OF THE DELTA. `calc` omitted the flag while
    # `base_calc` passed True, so the what-if graded on the GLOBAL curve and the baseline it is
    # compared against graded on the LOCAL one: measured at Mavericks with a 1.9 m reference,
    # what-if 48.0 vs baseline 31.1, a reported "+16.9 better" contaminated by a size-curve switch
    # the caller never asked for. That is the identical defect the `_whatif_parts` comment below
    # documents for partitions (+12.5 of which +12.5 was the composition switch) — one variable,
    # used by both calls, is what keeps a delta measuring the CALLER'S change.
    _reference_lookup_ok = bool(omitted or hour)
    # ONE VARIABLE, BOTH CALLS — for the same reason as the line above. The served reference is a
    # property of the PLACE, so it is identical for the what-if and its baseline; binding it once
    # makes that structural rather than a coincidence two call sites have to keep agreeing on.
    # Empty on the override branch (a staged sea is not a forecast the app served) -> None -> the
    # flag+blob path, unchanged.
    _served_ref = sim_forecast.served_reference(provenance)

    if omitted and baseline is None:
        # Say WHICH fields could not be filled and WHY, rather than failing with a bare null or —
        # far worse — inventing a calm sea for them. An invented wind is exactly how a blown-out day
        # reads clean.
        return {
            "success": False,
            "error": (f"Cannot fill {', '.join(omitted)} from the forecast: "
                      f"{provenance.get('reason', 'no forecast is available for this spot')}."),
            "hint": "Supply every input explicitly to run a self-contained what-if.",
            "spot": spot["name"],
            "requested_valid_time": hour or "now",
        }

    resolved = {k: (baseline[k] if v is None else v) for k, v in requested.items()}

    # Verify parameter ranges to prevent database corruption and bad calculations. Checked on the
    # RESOLVED values — a forecast-filled field is as capable of being out of range as a typed one.
    for label, key, lo, hi, unit in (
        ("wind speed", "wind_speed_knots", 0.0, 150.0, "knots"),
        ("wind direction", "wind_direction_deg", 0.0, 360.0, "degrees"),
        ("swell height", "swell_height_m", 0.0, 50.0, "meters"),
        ("swell period", "swell_period_sec", 0.0, 30.0, "seconds"),
        ("swell direction", "swell_direction_deg", 0.0, 360.0, "degrees"),
    ):
        value = resolved[key]
        if not (lo <= value <= hi):
            return {
                "success": False,
                "error": (f"Invalid {label}: {value} {unit}. "
                          f"Must be between {lo} and {hi} {unit}."),
                **({"note": f"that value came from the forecast, not from the caller"}
                   if key in omitted else {}),
            }

    wind_speed_knots = resolved["wind_speed_knots"]
    wind_direction_deg = resolved["wind_direction_deg"]
    swell_height_m = resolved["swell_height_m"]
    swell_period_sec = resolved["swell_period_sec"]
    swell_direction_deg = resolved["swell_direction_deg"]

    # DROPPED the moment any swell field differs from the baseline's — the forecast's trains
    # do not describe a hypothetical sea (see _baseline_partitions). Wind-only what-ifs keep
    # them: the swell already in the water is unchanged by a hypothesized wind. Computed ONCE and
    # used for BOTH the what-if and the baseline_delta's base_calc below, so the delta is
    # COMPOSITION-MATCHED: measured 2026-07-30, a +1 cm swell what-if against a windsea-dominated
    # spectral baseline reported +12.5 "better" of which +12.5 was the dropped-trains composition
    # switch and 0.0 was the caller's change.
    _whatif_parts = _baseline_partitions(baseline, resolved)
    calc = calculate_surf_rating(
        spot,
        swell_height_m,
        swell_period_sec,
        swell_direction_deg,
        wind_speed_knots,
        wind_direction_deg,
        partitions=_whatif_parts,
        # SAME permission as `base_calc` below — both sides of `baseline_delta` must grade on the
        # same size curve, and the zero-network what-if must reach neither.
        allow_reference_lookup=_reference_lookup_ok,
        served_reference_size_m=_served_ref,
    )

    # Persist simulation changes to condition_reports in dev.db if present. NOTE this is a
    # write-only path for this server — nothing here reads those columns back; they are read by the
    # APP (condition_reports routes + 6 frontend surfaces), which is why conditions_label must stay
    # in the size vocabulary.
    conn = get_db_connection() if may_mutate else None
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
    elif may_mutate:
        logger.warning(f"SQLite connection unavailable. Could not persist simulated conditions for spot '{spot_name}'.")

    # Stage the vector as this spot's baseline for subsequent get_weather_forecast reads. Held in a
    # SEPARATE dict rather than mutated into MOCK_SPOTS, so the catalog defaults stay clean and the
    # forecast can report `baseline_source: simulated_override` instead of silently presenting a
    # staged scenario as the spot's normal conditions.
    if may_mutate:
        _SIM_OVERRIDES[spot["name"]] = {
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg,
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
        }

    # ── WHAT THE CHANGE DID, not just what the result was ────────────────────────────────────
    # A what-if that reports only its own absolute outcome makes the caller re-derive the answer to
    # the question they actually asked. "12 ft, fair" does not say whether the swung wind HELPED.
    # Computing the baseline's rating is pure arithmetic on a vector already in hand — no extra I/O
    # — and `calculate_surf_rating` caches geometry per coordinate, so the second call reuses the
    # first's bathymetry (CLAUDE.md: resolve geometry ONCE per coordinate and reuse it).
    baseline_delta = None
    if baseline is not None:
        # ⚠️ COMPOSITION-MATCHED: base_calc uses the SAME `_whatif_parts` the what-if used — NOT
        # the baseline's own trains. When a swell what-if drops the trains, both sides of the
        # delta drop them, so the delta measures the CALLER'S change and never the composition
        # switch (which alone measured +12.5 quality on the Mavericks windsea fixture). The
        # baseline's honest spectral rating still lives in get_weather_forecast.
        base_calc = calculate_surf_rating(
            spot, baseline["swell_height_m"], baseline["swell_period_sec"],
            baseline["swell_direction_deg"], baseline["wind_speed_knots"],
            baseline["wind_direction_deg"], partitions=_whatif_parts,
            # ⚠️ NOT `True`. `baseline is not None` is ALSO satisfied by a peeked cache hit and by
            # a staged override, neither of which paid for a fetch — see `_reference_lookup_ok`.
            allow_reference_lookup=_reference_lookup_ok,
            served_reference_size_m=_served_ref)
        changed = {k: {"from": round(float(baseline[k]), 2), "to": round(float(resolved[k]), 2)}
                   for k in requested if abs(float(baseline[k]) - float(resolved[k])) > 1e-9}
        baseline_delta = {
            "baseline_source": baseline_source,
            "held_from_forecast": omitted,
            "changed": changed,
            "breaking_height_ft": {"from": base_calc["breaking_height_ft"],
                                   "to": calc["breaking_height_ft"],
                                   "delta": round(calc["breaking_height_ft"]
                                                  - base_calc["breaking_height_ft"], 1)},
            "quality_rating": {"from": base_calc["quality_rating"], "to": calc["quality_rating"],
                               "delta": round(calc["quality_rating"]
                                              - base_calc["quality_rating"], 1)},
            "quality_label": {"from": base_calc["quality_label"], "to": calc["quality_label"]},
            "verdict": ("no change" if not changed else
                        "better" if calc["quality_rating"] > base_calc["quality_rating"] else
                        "worse" if calc["quality_rating"] < base_calc["quality_rating"] else
                        "same rating"),
        }
        # ⛔ The delta quotes a HEIGHT, so it inherits that height's caveat — BOTH sides, because a
        # what-if can create or clear the conflict. Shape owned by the producer; rationale in
        # docs/runbooks/RATIONALE-2026-08-04-moved-for-the-loc-ratchet.md (08-06 section).
        if (_cd := conflict_delta(base_calc, calc)):
            baseline_delta["directional_conflict"] = _cd
        if _whatif_parts is None and _baseline_partitions(baseline) is not None:
            baseline_delta["composition"] = (
                "total_field on BOTH sides: the what-if changed the swell, so the forecast's "
                "trains were dropped from the delta to isolate the caller's change")
        if baseline_source == "live_forecast" and provenance.get("valid_time"):
            baseline_delta["valid_time"] = provenance["valid_time"]

    return {
        "success": True,
        "simulation_type": "weather_vector_override" if may_mutate else "what_if",
        "spot": spot["name"],
        "requested_valid_time": hour or "now",
        "spot_source": found.identity_source,
        "persisted": may_mutate,
        "database_updated": db_updated,
        **({} if may_mutate else {"note": (
            "What-if only: nothing was written to condition_reports and no override was staged. "
            "Pass caller_role='admin' to persist this vector as the spot's baseline.")}),
        "geometry": _geometry_payload(spot),
        # The RESOLVED vector — what was actually simulated. A forecast-filled field appears here
        # exactly like a typed one, and `baseline_delta.held_from_forecast` names which were which,
        # so the caller can always tell the two apart.
        "input_parameters": {
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg
        },
        "simulated_surf_output": calc,
        **({"baseline_delta": baseline_delta} if baseline_delta else {}),
    }


@mcp.tool
def find_best_window(spot_name: str, hours_ahead: int = 48, step_hours: int = 3,
                     top: int = 5) -> Dict[str, Any]:
    """Scan the forecast horizon for the best hours to surf a spot, ranked by surf quality.

    Answers WHICH hour, not just "how is it at this hour" — previously one tool call per frame with
    the caller doing the ranking. Every hour is scored through the same chain a single-hour answer
    uses, so a window's rating is the number the app would show at that spot and hour.

    Args:
        spot_name: The name of the spot (or its id).
        hours_ahead: How far ahead to look, in hours (the app serves about 7 days).
        step_hours: Spacing between sampled hours. 3 keeps a 2-day scan inside one frame budget.
        top: How many ranked windows to return. The full sampled `series` is returned regardless.
    """
    found = sim_spots.resolve(spot_name)
    if found.candidates:
        return sim_spots.ambiguity_error(spot_name, found.candidates)
    spot = found.spot
    if not spot:
        return {"error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    hours = sim_window.plan_hours(hours_ahead, step_hours)
    out = sim_window.scan(spot, _baseline_with_source, hours, top=top)
    summary = sim_window.summarize(out["best_windows"])
    requested_frames = int(max(1, hours_ahead) // max(1, step_hours)) + 1
    if requested_frames > len(hours):
        # Say that the horizon was TRUNCATED. A ranked answer that quietly covered a third of the
        # range asked for would still read as "the best window in the next N hours".
        out["scanned"]["truncated"] = (
            f"asked for {requested_frames} frames, scanned {len(hours)} "
            f"(SIM_WINDOW_MAX_FRAMES={sim_window.MAX_FRAMES}, a latency budget — every uncached "
            f"frame is two HTTP requests). Raise step_hours to cover the same span in fewer.")
    return {"spot": spot["name"], "spot_source": found.identity_source,
            "coordinates": {"lat": spot["latitude"], "lng": spot["longitude"]},
            "geometry": _geometry_payload(spot),
            **out,
            **({"summary": summary} if summary else {})}


@mcp.tool
def find_best_spot(near: str, radius_km: float = 50.0, valid_time: str = "",
                   top: int = 5) -> Dict[str, Any]:
    """Rank the surf spots around a place to answer WHICH SPOT to surf at a given hour.

    `find_best_window` answers which HOUR at one spot; this answers which SPOT at one hour — the
    question a surfer with several local breaks actually asks. Neighbouring breaks see the same
    offshore sea and differ by their own shore normal and break depth, so this is where the
    per-spot geometry decides the answer instead of sitting behind one number.

    ⛔ A spot with NO resolved shore normal is ranked LAST whatever it scores: with no bearing the
    rating scores every swell as head-on, which measured +8.5 points median (max +88.6) and changed
    the level at 66.7% of spots. The error can only push a score UP, so a blind spot would otherwise
    win the comparison it cannot be judged in. They stay in `series`, labelled.

    Args:
        near: A spot name (or id) to centre on, or a raw "lat,lng" coordinate.
        radius_km: How far around that centre to look.
        valid_time: Optional ISO-8601 UTC hour, e.g. '2026-07-31T15:00:00Z'. Empty means now.
        top: How many ranked spots to return. The full `series` is returned regardless.
    """
    hour, bad = _parse_valid_time(valid_time)
    if bad:
        return bad

    centre = sim_compare.parse_centre(near)
    centre_label = ""
    if centre is None:
        found = sim_spots.resolve(near)
        if found.candidates:
            return sim_spots.ambiguity_error(near, found.candidates)
        if not found.spot:
            return {"error": f"'{near}' is neither a spot in the catalog nor a 'lat,lng' coordinate.",
                    "hint": "Call get_surf_spots(query=...) to search by name."}
        centre = (float(found.spot["latitude"]), float(found.spot["longitude"]))
        centre_label = found.spot["name"]

    radius = max(0.1, min(float(radius_km), sim_compare.MAX_RADIUS_KM))
    # `_grafted` so a candidate that happens to be one of the hand-tuned names is rated identically
    # to the same name asked for directly — identity from the catalogue, extras grafted on.
    rows = [sim_spots._grafted(r) for r in sim_spots.query_spots()]
    spots, total = sim_compare.nearby(rows, centre[0], centre[1], radius,
                                      cap=sim_compare.MAX_SPOTS)
    if not spots:
        return {"error": f"No catalog spot lies within {radius:g} km of {centre_label or near}.",
                "centre": {"lat": centre[0], "lng": centre[1]},
                "hint": "Widen radius_km, or call get_surf_spots(query=...) to find a nearby name."}

    # Daylight needs a concrete instant; the baseline lane keeps the caller's "" (see scan()).
    light_hour = hour or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")
    out = sim_compare.scan(spots, _baseline_with_source, hour, top=top, light_hour=light_hour)
    out["scanned"]["radius_km"] = round(radius, 2)
    out["scanned"]["candidates_in_radius"] = total
    if total > len(spots):
        # Say that the candidate set was CUT, and name the radius at which it would be COMPLETE.
        # "The best spot near you" over half the coast is the spatial twin of a silently-shortened
        # horizon, and "narrow the radius" is only useful advice if it says by how much.
        complete_km = spots[-1].get("distance_km")
        out["scanned"]["truncated"] = (
            f"{total} spots lie within {radius:g} km; the nearest {len(spots)} were scanned "
            f"(SIM_COMPARE_MAX_SPOTS={sim_compare.MAX_SPOTS}, a latency budget — every uncached "
            f"spot is two HTTP requests). This answer is COMPLETE out to {complete_km} km; pass "
            f"radius_km={complete_km} for a set with nothing left out.")
    summary = sim_compare.summarize(out["best_spots"], centre_label)
    return {"centre": {"name": centre_label or None, "lat": centre[0], "lng": centre[1]},
            "requested_valid_time": hour or "now",
            **out,
            **({"summary": summary} if summary else {})}


@mcp.tool
def clear_simulation_overrides(spot_name: str = "") -> Dict[str, Any]:
    """Drop staged simulation overrides so forecasts return to catalog defaults.

    Args:
        spot_name: Clear just this spot (name or id); empty clears every staged override.
    """
    if not spot_name:
        removed = len(_SIM_OVERRIDES)
        _SIM_OVERRIDES.clear()
        return {"success": True, "cleared": removed, "remaining": sorted(_SIM_OVERRIDES)}

    # ⚠️ THE KEY MUST BE RESOLVED THE SAME WAY `simulate_weather_change` STAGED IT. That stages
    # under the RESOLVED name, so a literal pop missed whenever the caller's spelling differed from
    # the catalogue's. Measured 2026-07-28: staging via `simulate_weather_change("mavericks")` then
    # `clear_simulation_overrides("mavericks")` returned `success: true, cleared: 0` and left the
    # override in place — and an override OUTRANKS the live forecast, so every later read of that
    # spot silently returned the staged scenario. A no-op reported as success is worse than a miss.
    keys = [spot_name]
    resolved = sim_spots.resolve(spot_name).spot
    if resolved and resolved["name"] not in keys:
        keys.append(resolved["name"])
    removed = sum(1 for k in keys if _SIM_OVERRIDES.pop(k, None) is not None)
    out = {"success": True, "cleared": removed, "remaining": sorted(_SIM_OVERRIDES)}
    if not removed:
        # Say so explicitly rather than letting `success: true` imply something was cleared.
        out["note"] = f"No staged override was held for '{spot_name}'."
    return out


# 5. FastMCP Resources and 6. Prompts — the BODIES live in `sim_briefing`, this file is the
# transport binding. Both turn resolved state into English for a model to read, both have the same
# failure mode (saying something confident about a spot the catalogue does not carry), and this file
# has now been blocked at the 800-line ratchet three times. The names below stay exported here
# because the suite reads them off this module.
_SUMMARY_REFERENCE = sim_briefing.SUMMARY_REFERENCE
_SUMMARY_MAX = sim_briefing.SUMMARY_MAX
_summary_line = sim_briefing.summary_line


@mcp.resource("data://forecasts/summary")
def get_forecasts_summary() -> str:
    """A textual summary of staged simulations and a sample of live surf conditions."""
    return sim_briefing.forecasts_summary(_SIM_OVERRIDES, _baseline_with_source)


@mcp.prompt("surf_forecast_advisor")
def get_surf_advisor_prompt(spot_name: str) -> str:
    """Prompt template that helps analyze surf and wind parameters to give strategic surf advice."""
    return sim_briefing.advisor_prompt(spot_name)

# 7. Main-thread warm-up — WITHOUT THIS THE SERVER DEADLOCKS ON ITS FIRST TOOL CALL (a numpy C
# extension loaded from an AnyIO worker thread under the running stdio loop never returns; the full
# forensics live in `sim_boot`). ⚠️ THE CALL MUST STAY AT MODULE SCOPE HERE — that is what makes it
# the main thread. Moving it inside a tool restores the deadlock. Name kept for the suite.
_warm_hot_path = sim_boot.warm_hot_path

_warm_hot_path()

# The live catalogue, warmed OFF the request path. The first tool call would otherwise pay the whole
# round trip, and on a cold Render instance (~50 s to wake) that is the difference between an answer
# and a client-side timeout. Non-blocking by construction: a slow or dead app delays nothing here,
# the tools simply fall back to the snapshot until it lands.
sim_forecast.prefetch_catalog_async()


if __name__ == "__main__":
    mcp.run()
