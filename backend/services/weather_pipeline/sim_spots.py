"""sim_spots.py — ONE identity per spot name, for the weather simulation server.

WHY THIS EXISTS
---------------
`weather_sim_mcp.resolve_spot` consulted a hardcoded three-row table BEFORE the app's own
catalogue, so a hand-tuned entry won whenever its key matched exactly. Measured 2026-07-28 against
the running MCP server:

    get_weather_forecast("Mavericks")  ->  37.4952,-122.5028  region "California"    2.347  m
    get_weather_forecast("mavericks")  ->  37.4915,-122.5083  region "Half Moon Bay" 2.3521 m

The same spot, asked twice, at coordinates 637 m apart, with different regions and different
forecasts — the CAPITALISATION of the argument decided which one answered. `Pacifica State Beach`
was worse: the app's catalogue carries no such row at all (it has `Pacifica - Linda Mar`, 2.5 km
away), so that name returned a confident forecast for a coordinate production does not recognise
as a spot.

This is the defect `913b4af7` fixed for the drifted `dev.db` snapshot — a stale local catalogue
outranking the live one — surviving in the three rows that fix did not cover.

AND RESOLUTION SILENTLY GUESSED
-------------------------------
Measured over the live catalogue (1818 active rows, 2026-07-28):

  * **5 names are carried by TWO active rows each** — `Miramar` twice, **9098 km apart**, plus
    `Crescent Beach` (511 km), `FORMOSA` (902 km), `São Lourenço` (1372 km) and
    `Playa de las Americas` (1.11 km). The old code took `exact[0]`, so one of the two answered by
    list order and the caller was never told a choice had been made.
  * **A name matching several rows with no exact hit reported "not found in the catalog"** — while
    `get_surf_spots` returned the matches. `Pacifica` matches 2 rows and the forecast tool reported
    neither, then advised the caller to run the search that had already succeeded.

CONTRACT
  * The app's live catalogue is the AUTHORITY on identity — id, name, region, coordinates.
  * The hand-tuned defaults contribute a BASELINE forecast and a local size reference, never a
    LOCATION. They answer alone only when the catalogue does not know the name (i.e. offline).
  * An ambiguous name returns its CANDIDATES. This module never guesses between them, and never
    reports "not found" for a name that matched something.
  * A spot `id` always resolves directly — the escape hatch for a name two rows share.
  * Never raises. Identity is required for every tool, so a failure here must degrade to the
    offline defaults rather than break the caller.
"""
import logging
import os
import unicodedata
from typing import Any, Dict, List, NamedTuple, Optional

from utils.sqlite_helpers import get_sqlite_connection
from services.weather_pipeline import sim_forecast

logger = logging.getLogger(__name__)

# backend/services/weather_pipeline/sim_spots.py -> backend -> repo root
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DB_PATH = os.path.join(ROOT_DIR, "dev.db")

# How many candidates an ambiguous answer lists. A broad query (`query="beach"`) matches hundreds,
# and a response the client rejects for size is not an answer — the same budget lesson the
# `SIM_SPOTS_MAX` cap records.
CANDIDATE_CAP = 10


# ── The hand-tuned defaults ───────────────────────────────────────────────────────────────────
# Formerly `weather_sim_mcp.MOCK_SPOTS`, and still exported under that name there. These carry a
# BASELINE forecast (`base_*`), which no catalogue row does — that is their remaining job now that
# the live forecast outranks them and the live catalogue owns identity.
#
# ⚠️ Their coordinates are an OFFLINE FALLBACK IDENTITY ONLY. Where the live catalogue knows the
# name, its coordinates win (see `resolve`). Measured drift from production, 2026-07-28:
#     Mavericks             637 m
#     Montara State Beach   361 m
#     Pacifica State Beach  NOT IN THE CATALOGUE — nearest is `Pacifica - Linda Mar`, 2.5 km
CATALOG_DEFAULTS: Dict[str, Dict[str, Any]] = {
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

# The ONLY keys that travel from a hand-tuned default onto a live catalogue row.
# ⚠️ `orientation` is deliberately absent. It is a bearing measured for a DIFFERENT coordinate
# (and 44.9 deg wrong at Mavericks even there), so it has no claim to being the live row's
# fallback. Where ETOPO cannot resolve a normal, the honest answer is None — which
# `calculate_surf_rating` already handles by failing open and saying so.
_GRAFTED_KEYS = ("base_swell_height", "base_swell_period", "base_swell_direction",
                 "base_wind_speed", "base_wind_direction", "reference_size_m")


# Every apostrophe-like character a spot name is written with: ASCII, the Hawaiian ʻokina (U+02BB),
# its modifier-letter twin, both curly quotes, backtick and acute accent. They are REMOVED rather
# than unified, because the catalogue stores `Hookipa` while the correct Hawaiian spelling is
# `Ho'okipa` — unifying them to one character still fails to match. Measured 2026-07-29 across all
# 1,773 rows: removal and unification produce IDENTICAL collision counts (4 total, 1 newly
# ambiguous), so removal is strictly better at no cost.
_APOSTROPHES = "'ʻʼ‘’`´"


def normalize_name(name: Optional[str]) -> str:
    """Case-, whitespace-, accent- and apostrophe-insensitive key for a spot name.

    ⚠️ Deliberately NOT `find_missing_spots.names_match`. That matcher is the duplicate GATE and is
    intentionally loose (it keeps `Jaws (Peahi)` matching `Peahi`); a caller naming a spot wants
    the row they named, so this is strict. Same lesson as `af7d95c1`: the duplicate gate stays
    loose, an identity lookup stays strict — different jobs, different thresholds.

    ★ Folding accents and apostrophes does NOT loosen that. It matches the same name written
    differently, never two different names — `Nazaré` typed as `Nazare`, `Ho'okipa` stored as
    `Hookipa`. 129 of 1,773 catalogue rows (7.3%) carry a character a caller has no easy way to
    type: 96 with accents, 33 with apostrophes. Before this, `Nazare` and `Ho'okipa` both returned
    "not found" for spots the catalogue holds, which is the catalogue reporting the opposite of
    what it contains.

    ⚠️ Measured before shipping, because folding CAN merge rows: across all 1,773 names total
    collisions stay at 4, and exactly one name becomes newly ambiguous — `SÃO LOURENÇO` vs
    `São Lourenço`, two active rows of the same name that differ only in Unicode composition form.
    That is a duplicate the resolver SHOULD flag, and `resolve` already answers ambiguity with
    candidates rather than a coin flip. NFKD is what catches it; casefold alone does not.
    """
    text = " ".join((name or "").split())
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    for mark in _APOSTROPHES:
        text = text.replace(mark, "")
    return text.casefold()


def _default_for(name: Optional[str]) -> Optional[Dict[str, Any]]:
    """The hand-tuned default whose key matches `name`, or None.

    ⚠️ Derived on every call rather than cached in a module-level index. `CATALOG_DEFAULTS` is a
    public, mutable dict (`weather_sim_mcp.MOCK_SPOTS`), and a frozen index desynced from it the
    moment anything added an entry — which is another two-sources-of-truth bug, the very shape this
    module exists to remove. Three entries; the scan costs nothing.
    """
    needle = normalize_name(name)
    for key, value in CATALOG_DEFAULTS.items():
        if normalize_name(key) == needle:
            return value
    return None


class Resolution(NamedTuple):
    """spot: the resolved row, or None.
    candidates: the rows a caller must choose between (non-empty only when spot is None).
    identity_source: which catalogue answered — never a detail, see the module docstring."""
    spot: Optional[Dict[str, Any]]
    candidates: List[Dict[str, Any]]
    identity_source: str


def catalog_source() -> str:
    """Name the catalogue that is actually answering."""
    return "live_catalog" if sim_forecast.fetch_catalog() else "surf_spots_snapshot"


def query_spots(name_query: Optional[str] = None,
                limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Read the SURF SPOT CATALOG.

    ★ This used to read `condition_reports`, which is the photographer conditions-upload table
    (photographer_id / media_url / expires_at). It holds 0 rows in dev and is near-empty by nature,
    so every call fell through to the three hardcoded catalog spots — the weather simulation system
    could reach 3 of 1547 spots (0.2%) because it was looking in the wrong table. `surf_spots` is
    the catalog, and it has 1818 active rows with coordinates.

    Kill: SIM_SPOT_CATALOG=0 restores the pre-07-27 catalog-of-three behaviour.
    """
    if os.environ.get("SIM_SPOT_CATALOG", "1") == "0":
        return []
    # The app's LIVE catalogue first — `dev.db` is a snapshot and it has drifted into wrong
    # coordinates, not just missing rows (see `sim_forecast.fetch_catalog`). Filtering here rather
    # than in the fetch keeps the fetch cacheable for the whole process.
    live = sim_forecast.fetch_catalog()
    if live:
        needle = normalize_name(name_query) if name_query else None
        rows = [s for s in live
                if not needle or needle in normalize_name(s["name"])]
        rows.sort(key=lambda s: s["name"] or "")
        return [dict(s) for s in (rows[:int(limit)] if limit else rows)]
    return _query_snapshot(name_query, limit)


def _query_snapshot(name_query: Optional[str],
                    limit: Optional[int]) -> List[Dict[str, Any]]:
    """The `dev.db` fallback, used only when the live catalogue is unreachable."""
    conn = None
    try:
        conn = get_sqlite_connection(DB_PATH)
    except Exception as e:
        logger.error(f"Failed to connect to SQLite database at {DB_PATH}: {e}")
        return []
    try:
        cursor = conn.cursor()
        # ⚠️ The name filter is applied in PYTHON, not in SQL. SQLite's LOWER()/LIKE are
        # accent-blind to `normalize_name`'s folding, so `LIKE '%nazare%'` misses the row stored as
        # `Nazaré` — this path would answer "not found" for a name the LIVE path resolves. One
        # matcher, both paths: the alternative is the same name meaning two different things
        # depending on whether the catalogue happened to be reachable.
        sql = ("SELECT id, name, region, latitude, longitude FROM surf_spots "
               "WHERE is_active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL "
               "ORDER BY name")
        rows = [{"id": r[0], "name": r[1], "region": r[2],
                 "latitude": float(r[3]), "longitude": float(r[4])}
                for r in cursor.execute(sql).fetchall()]
        if name_query:
            needle = normalize_name(name_query)
            rows = [r for r in rows if needle in normalize_name(r["name"])]
        return rows[:int(limit)] if limit else rows
    except Exception as e:
        # Was a bare `except: return []`, which made a schema/SQL failure indistinguishable from
        # "no rows" and silently fell back to mock data. Log it — a silent fallback is how the
        # wrong-table bug above survived.
        logger.warning(f"surf_spots query failed ({e}); falling back to the catalog defaults.")
        return []
    finally:
        if conn:
            conn.close()


def _grafted(row: Dict[str, Any]) -> Dict[str, Any]:
    """A live catalogue row plus the hand-tuned EXTRAS for that name — never its location."""
    out = dict(row)
    default = _default_for(row.get("name"))
    if default:
        for key in _GRAFTED_KEYS:
            if key in default:
                out.setdefault(key, default[key])
    return out


def _by_id(spot_id: str) -> Optional[Dict[str, Any]]:
    """Exact id lookup — the escape hatch for a name two active rows share."""
    for row in (sim_forecast.fetch_catalog() or []):
        if str(row.get("id")) == spot_id:
            return dict(row)
    return None


def candidate_view(row: Dict[str, Any]) -> Dict[str, Any]:
    """What a caller needs to tell two candidates apart — including the `id` that resolves them."""
    return {"id": row.get("id"), "name": row.get("name"), "region": row.get("region"),
            "latitude": row.get("latitude"), "longitude": row.get("longitude")}


def resolve(spot_name: str) -> Resolution:
    """Find the ONE spot a caller named. See the module docstring for the precedence and why."""
    query = (spot_name or "").strip()
    if not query:
        return Resolution(None, [], "none")

    # 1. An id is unambiguous by construction, so it outranks every name rule.
    if "-" in query and len(query) >= 32:
        row = _by_id(query)
        if row:
            return Resolution(_grafted(row), [], catalog_source())

    # 2. The app's catalogue owns identity. Cap the scan: a broad substring can match hundreds, and
    #    beyond the candidate cap the extra rows change no decision made below.
    matches = query_spots(name_query=query, limit=200)
    needle = normalize_name(query)
    exact = [m for m in matches if normalize_name(m["name"]) == needle]

    if len(exact) == 1:
        return Resolution(_grafted(exact[0]), [], catalog_source())
    if len(exact) > 1:
        # ⚠️ 5 names are carried by two active rows each — `Miramar` 9098 km apart. Picking
        # `exact[0]` here is a coin flip presented as an answer.
        return Resolution(None, [candidate_view(m) for m in exact[:CANDIDATE_CAP]],
                          catalog_source())
    if len(matches) == 1:
        return Resolution(_grafted(matches[0]), [], catalog_source())
    if len(matches) > 1:
        return Resolution(None, [candidate_view(m) for m in matches[:CANDIDATE_CAP]],
                          catalog_source())

    # 3. Nothing in the catalogue — the hand-tuned defaults are all that is left. This is the
    #    OFFLINE path (and the only one that may answer with a default's coordinates).
    default = _default_for(needle)
    if default:
        return Resolution(dict(default), [], "catalog_default")
    return Resolution(None, [], catalog_source())


def ambiguity_error(spot_name: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The shared 'name one of these' payload.

    ★ It reports the matches instead of "not found". A tool that has the rows in hand and answers
    "not found" is not merely unhelpful — it states the opposite of what it just observed.
    """
    same_name = len({normalize_name(c["name"]) for c in candidates}) == 1
    if same_name:
        detail = (f"The catalogue carries {len(candidates)} active spots named "
                  f"'{candidates[0]['name']}'. Pass the `id` of the one you mean.")
    else:
        detail = (f"'{spot_name}' matches {len(candidates)} spots. Name one exactly, or pass its "
                  f"`id`.")
    return {"error": "ambiguous_spot_name", "detail": detail, "candidates": candidates}
