"""Serve ICON swell_2 from its stored derived product (2026-11-13, option B; icon_swell2_ingest.py stores it).

Today /grid and /point answer "unsupported" for ICON swell_2 (the browser blends GFS + EURO itself). With ICON_SWELL2_SERVE=1 they
serve the stored product instead, but ONLY where one covers the asked time (the manifest's +-3 h candidate window); with none they
still answer "unsupported", so they never fall through to a live upstream fetch for a layer ICON does not have.

DARK by default: serving it changes what these routes return (from "unsupported" to numbers), so the flip is the owner's word
through the director (D-065), with a not-worse read and a SCOREBOARD row, armed together with ICON_SWELL2_STORED=1.
"""
import os


def serve_on() -> bool:
    return os.environ.get("ICON_SWELL2_SERVE", "0") == "1"


def is_icon_swell2(model, layer) -> bool:
    return str(model or "").upper() == "ICON" and str(layer or "").lower() == "swell_2"


def stored_covers(manifest, domain, target_dt) -> bool:
    """True when a stored ICON swell_2 product covers target_dt (the same +-3 h candidate search every other layer uses)."""
    from services.weather_pipeline.grid_resolver_selection import find_candidates
    authoritative, estimated = find_candidates(manifest, "ICON", domain, "swell_2", target_dt)
    return bool(authoritative or estimated)


def refuse(manifest, domain, target_dt) -> bool:
    """The routes' question: answer "unsupported" for this ICON swell_2 ask? Yes unless serving is on AND a stored product covers it."""
    if not serve_on():
        return True
    try:
        return not stored_covers(manifest, domain, target_dt)
    except Exception:
        return True   # fail closed: today's answer
