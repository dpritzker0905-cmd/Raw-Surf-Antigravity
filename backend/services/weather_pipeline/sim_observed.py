"""sim_observed.py — what the APP is actually showing for this spot, so the sim can check itself.

THE GAP THIS CLOSES. The sim already printed a `parity` block for HEIGHT — served vs computed at
the same coordinate — and was silent on QUALITY. Half the answer was unverified, and quality is the
half where the composition keeps drifting (`9b808d05`: the hub's positional call dropped
`break_depth_m`; Mavericks +62.3, Trestles −42.5).

★★ AND IT IMMEDIATELY FOUND ONE. Measured 2026-07-31 at Moss Landing, GFS 13:00Z:

    served glyph   83.9  good    raw_score 95.9   confirmed 'good'
    sim            95.9  epic

Not a physics difference — the heights agree to 0.59%. The OBSERVATION GATE (`RATING_OBS_GATE`,
Surfline's published rule that a model alone never awards Good or Epic) is applied at three
surfaces — the precompute that writes the glyph payload, the live spot-ratings route, and the map's
rating band — and at NEITHER of the two surfaces a surfer reads as text: the spot hub and this sim.
So the map says good and the sim says epic for the same spot and hour.

⚠️ `tests/test_rating_composition_parity.py` is STRUCTURALLY BLIND to it. That guard AST-extracts
each surface's `rating_score(...)` call and makes every surface declare a position on every optional
input — and the gate is a step AFTER that call, so there is no argument to declare. Same shape as
the marine vortex moving to a tier its guard could not see: ★ a guard that inspects one shape cannot
report a defect of another shape, and the absence of an alarm is not the absence of a defect.

⛔ THIS MODULE DOES NOT RE-DERIVE THE GATE, AND MUST NOT. `confirm` comes from cross-model agreement
over the whole precomputed blob plus fresh user reports — one spot at one hour on one model cannot
reconstruct it, and a sim that guessed would be a second opinion wearing the app's clothes. It READS
the app's published verdict, exactly as `rate_one_spot` reads the response's own partitions.

★ AND IT LEARNS WHETHER THE GATE IS ON BY OBSERVING, NOT BY READING ITS OWN ENV. `RATING_OBS_GATE`
has a value PER LANE — it is '1' on Render and unset in this process, and a flag read locally would
confidently describe the wrong lane (the `RATING_TIDE` split, proven live 2026-07-30). The served
payload carries `raw_score` next to `score`; when they differ the serving lane gated, and that is
evidence rather than configuration.
"""
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

logger = logging.getLogger("weather_sim_mcp")

APP_BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
TIMEOUT_S = float(os.environ.get("SIM_OBSERVED_TIMEOUT_S", "8"))
CACHE_MAX = int(os.environ.get("SIM_OBSERVED_CACHE_MAX", "256"))
CACHE_TTL_S = float(os.environ.get("SIM_OBSERVED_CACHE_TTL_S", "900"))
# The bbox half-width around the spot. Small enough that the nearest rated row is this spot and not
# a neighbour 20 km up the coast; large enough to survive the precompute's own coordinate rounding.
BBOX_PAD_DEG = float(os.environ.get("SIM_OBSERVED_BBOX_PAD", "0.02"))

_cache: Dict[Any, Any] = {}


def enabled() -> bool:
    """Kill switch. 0 restores the pre-2026-07-31 behaviour exactly: HEIGHT parity only."""
    return os.environ.get("SIM_OBSERVED", "1") != "0"


def _remember(key, value):
    _cache[key] = (time.time(), value)
    while len(_cache) > CACHE_MAX:                    # bounded FIFO, oldest first (NOT an LRU)
        _cache.pop(next(iter(_cache)), None)


def _recall(key):
    hit = _cache.get(key)
    if hit is None:
        return None
    ts, value = hit
    if time.time() - ts > CACHE_TTL_S:
        _cache.pop(key, None)
        return None
    return value


def fetch_served_rating(lat: float, lng: float, valid_time: str, model: str = "GFS",
                        spot_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The rating the APP is serving for this coordinate and hour, or None.

    ⚠️ NEVER RAISES AND NEVER BLOCKS THE ANSWER. This is a self-check; a slow or unreachable app must
    cost the caller a missing `parity` block, never a failed forecast — and never a TIMEOUT, which an
    MCP client reports indistinguishably from "the sim is broken" (the `576dcbdd` regression)."""
    if not enabled() or lat is None or lng is None:
        return None
    key = (round(float(lat), 4), round(float(lng), 4), valid_time or "now", model)
    cached = _recall(key)
    if cached is not None:
        return cached or None                          # cached miss is stored as {} -> None

    pad = BBOX_PAD_DEG
    q = urllib.parse.urlencode({
        "bbox": f"{lng - pad},{lat - pad},{lng + pad},{lat + pad}",
        "valid_time": valid_time, "model": model, "limit": 20})
    try:
        req = urllib.request.Request(f"{APP_BASE}/api/weather/spot-ratings?{q}",
                                     headers={"User-Agent": "weather-sim/observed"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            payload = json.load(r)
    except Exception as e:
        logger.debug(f"[sim-observed] served rating unavailable at {lat},{lng}: {e}")
        _remember(key, {})
        return None

    best, best_d = None, None
    for sp in payload.get("spots") or []:
        if sp.get("score") is None:
            continue
        if spot_id is not None and str(sp.get("spot_id")) == str(spot_id):
            best = sp
            break
        la, ln = sp.get("latitude"), sp.get("longitude")
        if la is None or ln is None:
            continue
        d = (la - lat) ** 2 + (ln - lng) ** 2
        if best_d is None or d < best_d:
            best, best_d = sp, d
    if best is None:
        _remember(key, {})
        return None

    out = {
        "spot": best.get("name"),
        "spot_id": best.get("spot_id"),
        "score": best.get("score"),
        "level": best.get("level"),
        "raw_score": best.get("raw_score"),
        "confirmed": best.get("confirmed"),
        "geometry_readiness": best.get("geometry_readiness"),
        "source": payload.get("source"),
        # The hour the frame ACTUALLY describes when the deploy reports it. `valid_time` echoes what
        # was asked for, and the stale ladder can serve a frame up to 6 h away — a parity number
        # taken across that gap is measuring the clock, not the composition.
        "served_valid_time": payload.get("served_valid_time"),
        "frame_offset_hours": payload.get("frame_offset_hours"),
    }
    _remember(key, out)
    return out


def score_parity(sim_score: float, served: Optional[Dict[str, Any]],
                 sim_level: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Compare the sim's quality against the app's, and NAME the cause when they differ.

    A bare delta invites the reader to assume physics. The two known non-physics causes are stated
    explicitly whenever the payload's own fields show them, because "the map says good and the sim
    says epic" needs an answer, not a number."""
    if not served or served.get("score") is None or sim_score is None:
        return None
    out = {
        "served_score": served["score"],
        "served_level": served.get("level"),
        "sim_score": sim_score,
        "sim_level": sim_level,
        "delta": round(float(sim_score) - float(served["score"]), 2),
        "level_differs": bool(sim_level and served.get("level") and sim_level != served["level"]),
        "served_source": served.get("source"),
    }
    if served.get("served_valid_time"):
        out["served_valid_time"] = served["served_valid_time"]
        if served.get("frame_offset_hours"):
            out["frame_offset_hours"] = served["frame_offset_hours"]

    raw = served.get("raw_score")
    gated = raw is not None and served["score"] is not None and float(served["score"]) < float(raw)
    if gated:
        # ⛔ THE OBSERVATION GATE, applied by the serving lane and NOT by this sim. Detected from the
        # payload's own evidence rather than from a local env read — the flag has a value per lane.
        out["observation_gate"] = {
            "active_in_serving_lane": True,
            "confirmed": served.get("confirmed"),
            "ungated_model_score": raw,
            "capped_by": round(float(raw) - float(served["score"]), 2),
            "means": ("the app caps Good/Epic unless the forecast is confirmed — by >=2 models "
                      "agreeing or a fresh user report (Surfline's published rule: a model alone "
                      "never awards Good or Epic). The sim reports the MODEL's own score, so this "
                      "delta is the gate, not a disagreement about the sea."),
        }
        # The gate explains the delta only if the sim matches the UNGATED score.
        out["matches_ungated_model_score"] = abs(float(sim_score) - float(raw)) <= 0.11
    if served.get("geometry_readiness"):
        out["served_geometry_readiness"] = served["geometry_readiness"]
    return out


def parity(wave_simulation: Dict[str, Any], spot: Dict[str, Any], provenance: Dict[str, Any],
           baseline_source: str, hour: str) -> Optional[Dict[str, Any]]:
    """The whole `parity` block — HEIGHT from the provenance the forecast already carried, QUALITY
    from the app's own served rating. None when there is nothing to compare against.

    ⚠️ Only meaningful for a LIVE baseline. A staged override or a catalogue default describes a sea
    the app never rated, so comparing them would manufacture a divergence out of the caller's own
    what-if."""
    served_h = provenance.get("served_surf_height_m") if baseline_source == "live_forecast" else None
    if not served_h:
        return None
    sim_m = wave_simulation["breaking_height_ft"] / 3.28084
    out = {
        "served_surf_height_m": round(float(served_h), 4),
        "sim_breaking_height_m": round(sim_m, 4),
        "delta_pct": round((sim_m - float(served_h)) / float(served_h) * 100, 2),
    }
    observed = fetch_served_rating(spot.get("latitude"), spot.get("longitude"),
                                   provenance.get("valid_time") or hour, spot_id=spot.get("id"))
    quality = score_parity(wave_simulation.get("quality_rating"), observed,
                           wave_simulation.get("quality_label"))
    if quality:
        out["quality"] = quality
    return out
