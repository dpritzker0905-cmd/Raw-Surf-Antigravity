"""runtime_flags.py - the ONE place a guarded served-number flag is read (D-065, default-ON with guardrails).

WHY: the owner, 2026-11-04 ~01:41Z: "Yes we need logic in place and systems where we make fixes by default so they
are visible and on, and have a checker or filter to see if its working or not. Not starting with something built and
dark or off". Fixes now ship ON; the post-ship guardrail (`scripts/flag_guardrail.py`) must be able to turn one OFF
without a Render env change or a deploy. It does that by writing a small JSON manifest into the existing
`weather-products` bucket, and every guarded read goes through `flag()` below.

PRECEDENCE (one rule, both ways):
  1. an EXPLICIT environment value (Render env, a workflow `env:` line) is a hard override, ON or OFF. An empty string
     counts as unset, so a lane can hand a flag to the manifest with `FLAG: ''`;
  2. else the runtime manifest `control/flags.json` (state "on" -> "1", "off" -> "0");
  3. else the code default the caller passes (the same default `_RATING_FLAGS` documents).

COST: the manifest is read at most once per TTL (default 300 s, `RUNTIME_FLAGS_TTL_S`) per process. The first read in
a process blocks for at most `RUNTIME_FLAGS_TIMEOUT_S` (default 2 s); every later refresh runs in a background thread
while readers keep the cached copy, so a request never waits on storage after the first.

FAIL-SAFE: an unreadable, malformed or absent manifest never raises. A reader keeps the LAST GOOD manifest for up to
`RUNTIME_FLAGS_MAX_STALE_S` (default 6 h); past that only its 'off' entries are kept (an outage never resurrects a
killed fix) and everything else falls back to the code default, as it does when no manifest was ever read.
`RUNTIME_FLAGS_MANIFEST=0` disables the manifest entirely
(tests, local runs); with no `SUPABASE_URL` it is never contacted.

WRITER: only the guardrail workflow (`.github/workflows/flag-guardrail.yml`), with its existing CI secrets named
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. No value of either appears in this repository.
"""
import logging
import os
import threading
import time
from typing import Callable, Dict, Optional

logger = logging.getLogger(__name__)

MANIFEST_KEY = "control/flags.json"
SCHEMA = "raw-surf/runtime-flags/1"
STATES = {"on": "1", "off": "0"}
ENTRY_KEYS = ("state", "reason", "set_by", "set_at", "evidence")

# GUARDED: the served-number flags whose every read goes through `flag()`, with their CODE DEFAULT (the single source;
# `_RATING_FLAGS` must document the same default, `tests/test_runtime_flags.py` pins both and that no module reads one
# of these names straight from os.environ). Default '1' = shipped ON under D-065; '0' = held OFF because the filter or a
# sanity rule showed it worse (the reason is in the registry and in DECISIONS D-065). The guardrail watches all of them.
GUARDED = {
    "SURF_TIDE_DEPTH": "1",             # D-065: not worse (inert in the 10-day replay window), ON
    "CONSENSUS_DIRECTION_VECTOR": "1",  # D-065: +5.6 deg [4.9, 6.3] better vs NDBC MWD held out, ON
    "RATING_OBS_GATE": "1",             # D-065: ON in every lane since 2026-07-30; the code default now agrees
    "RATING_LOCAL_SIZE": "1",           # D-065: ON in every lane; the code default now agrees
    "SURF_EXPOSURE_RECONCILED": "0",    # D-065: WORSE (hs_station MAE +0.0093 m, CI [0.0076, 0.0113]); fix in progress
    "RATING_BREAKER_TYPE": "0",         # D-065: read by the glyph path only, so ON splits ONE FORECAST COMPOSITION
    "ALERTS_FORECAST_WINDOWS": "0",     # D-065: up to 5 alerts/day before the cap fix (claude/alerts-dedupe-cap)
    "SURF_BIGHT_HS_CONSENSUS": "1",     # #707: hs_station +0.099 m [two-way 0.038, 0.182]; round-7 history +0.155, ON
    "SPOT_HUB_RATE_ONE_SPOT": "1",      # spot-hub phase 2 (#710): the hub on rate_one_spot; kill '0' = the old chain
    "SURF_NEARSHORE_MOP": "1",          # CDIP MOP nearshore sea at California spots: nearshore judge 86/86 runs better,
                                        # MAE 0.250 -> 0.096 m at CDIP buoys (2026-10-09..11-04), ON; kill '0'
    "WEATHER_ACCOUNT_RATE_LIMIT": "1",  # #782/#783: per-account 429 on clamped reads + /frame-urls; acts only once a switch is on
    "WEATHER_TIER_CLAMP": "0",          # O5 (#TBD): server tier clamp. Held OFF until the client sends its token
                                        # (weatherAuthFetch.js) - ON earlier refuses every paying user (accounts only)
    "MANIFEST_PRUNE_TOMBSTONES": "1",   # ING-1: a pruned manifest entry stays pruned across lanes (593/18,466 dangling
                                        # 2026-11-11); moves manifest membership only, filter NO_CHANGE; kill '0'
    "SHORE_NORMAL_MOP_CALIBRATED": "0",  # HELD OFF (D-065 WORSE): MOP says better (held-out MSE 0.0234 -> 0.0046, 77 spots)
                                         # but the nearshore arm's hb_proxy says WORSE, +0.0385 m MAE [0.0234, 0.0589]
    "SURF_SEA_INPUTS_EVERY_CALLER": "1",  # CMP-2: hub/conditions/surf-conditions/sim take /point's tide (+MOP) via
                                          # sea_inputs; parity 20 spots x 3 h to 1e-6; accuracy NOT measured
                                          # (filter primary hs_station: NO_CHANGE); kill '0'
    "LOCATION_TIME_FIELD": "0",         # location_time phase 1 (#762): civil zone + civil day rows. Held OFF until
                                        # the D-065 prerequisites (SCOREBOARD row, history filter) land; tier-safe
    "RATING_BREAK_DEPTH_FROM_GEOMETRY": "1",  # CMP-3: the rating reads the break depth the height's cap used; offline filter NO_CHANGE
    "SIDE_PATHS_THROUGH_CHAIN": "1",    # O4: /api/conditions preview rows = precomputed rate_one_spot frames (rated);
                                        # _breaking_ft fails CLOSED (never offshore Hs as surf); /api/surf-conditions
                                        # target-time height labelled an unrated estimate; kill '0'
    "RATING_BAND_ONE_CHAIN": "1",       # CMP-1: map rating band = estimate_surf_at on cached geometry + break depth;
                                        # band level == glyph level at 4,101 of 4,197 asset spot-seas, 0 unexplained
}

# FIX_VERSION: bump a flag's version in the PR that changes its fix. The guardrail's 'off' records the version it
# judged; a new version clears that 'off' so the changed fix runs and is judged afresh (the no-flap rule's only
# automatic way back on; the other is the owner's word).
FIX_VERSION = {name: "2026-11-04" for name in GUARDED}

_lock = threading.Lock()
_cache: Dict[str, object] = {"flags": None, "read_at": 0.0, "good_at": 0.0, "refreshing": False, "error": None}
_fetcher: Optional[Callable[[], Optional[dict]]] = None      # tests inject; None = the bucket


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def ttl_s() -> float:
    return _f("RUNTIME_FLAGS_TTL_S", 300.0)


def validate(doc) -> Dict[str, dict]:
    """{flag: entry} for the well-formed entries of a manifest document; raises ValueError on a wrong shape.
    An entry whose state is not on/off is DROPPED (that flag falls through to its code default), never guessed."""
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("flags"), dict):
        raise ValueError("not a runtime-flags manifest")
    out = {}
    for name, e in doc["flags"].items():
        if isinstance(e, dict) and str(e.get("state", "")).lower() in STATES:
            out[str(name)] = dict(e, state=str(e["state"]).lower())
    return out


def _fetch_bucket() -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{MANIFEST_KEY}?cb={int(time.time() * 1000)}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key, "Cache-Control": "no-cache"},
                        timeout=_f("RUNTIME_FLAGS_TIMEOUT_S", 2.0))
    if resp.status_code in (400, 404):
        return {"schema": SCHEMA, "flags": {}}           # no manifest yet = nothing overridden (a good read)
    resp.raise_for_status()
    return resp.json()


def _refresh() -> None:
    try:
        doc = (_fetcher or _fetch_bucket)()
        flags = validate(doc) if doc is not None else None
        with _lock:
            now = time.time()
            _cache["read_at"] = now
            if flags is not None:
                _cache["flags"], _cache["good_at"], _cache["error"] = flags, now, None
            else:
                _cache["error"] = "manifest not configured"
    except Exception as e:                               # noqa: BLE001 - fail safe, recorded
        with _lock:
            _cache["read_at"], _cache["error"] = time.time(), f"{type(e).__name__}: {e}"[:200]
        logger.warning(f"[runtime-flags] manifest unreadable, keeping last good / code default: {e}")
    finally:
        with _lock:
            _cache["refreshing"] = False


def _manifest() -> Dict[str, dict]:
    if os.environ.get("RUNTIME_FLAGS_MANIFEST", "1") == "0":
        return {}
    now = time.time()
    with _lock:
        fresh = now - float(_cache["read_at"]) < ttl_s()
        first = _cache["read_at"] == 0.0
        start = not fresh and not _cache["refreshing"]
        if start:
            _cache["refreshing"] = True
    if start:
        if first:
            _refresh()                                   # the one blocking read per process, bounded by the timeout
        else:
            threading.Thread(target=_refresh, name="runtime-flags-refresh", daemon=True).start()
    with _lock:
        flags, good_at = _cache["flags"], float(_cache["good_at"])
    if flags is None:
        return {}
    if time.time() - good_at > _f("RUNTIME_FLAGS_MAX_STALE_S", 6 * 3600.0):
        # Past the staleness bound only the KILLS survive (Reflection review 2026-11-04): a storage outage must not
        # resurrect a fix the guardrail turned off; an 'on' entry falls back to the code default.
        return {k: e for k, e in flags.items() if e["state"] == "off"}
    return flags


def resolve(name: str, default: str) -> dict:
    """{value, source: env|manifest|default, entry}: the effective value of `name` and where it came from."""
    v = os.environ.get(name)
    if v is not None and v != "":
        return {"value": v, "source": "env", "entry": None}
    e = _manifest().get(name)
    if e is not None:
        return {"value": STATES[e["state"]], "source": "manifest", "entry": e}
    return {"value": default, "source": "default", "entry": None}


def flag(name: str, default: Optional[str] = None) -> str:
    """The effective string value of a flag (env > manifest > code default). The code default of a GUARDED flag is
    `GUARDED[name]`; pass `default` only for a flag outside GUARDED (then it is a drop-in for os.environ.get)."""
    if default is None:
        default = GUARDED[name]
    return resolve(name, default)["value"]


def on(name: str) -> bool:
    """True when a guarded boolean flag is effectively '1'."""
    return flag(name) == "1"


def status() -> dict:
    with _lock:
        return {"read_at": _cache["read_at"], "good_at": _cache["good_at"], "error": _cache["error"],
                "entries": len(_cache["flags"] or {}), "ttl_s": ttl_s(), "key": MANIFEST_KEY}


def _reset_for_tests(fetcher: Optional[Callable[[], Optional[dict]]] = None) -> None:
    global _fetcher
    with _lock:
        _cache.update({"flags": None, "read_at": 0.0, "good_at": 0.0, "refreshing": False, "error": None})
    _fetcher = fetcher
