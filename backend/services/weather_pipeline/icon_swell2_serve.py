"""Serve ICON swell_2 from its stored derived product (2026-11-13, option B; icon_swell2_ingest.py stores it).

Today /grid and /point answer "unsupported" for ICON swell_2 (the browser blends GFS + EURO itself). With ICON_SWELL2_SERVE=1 they
serve the stored product instead, but ONLY where one covers the asked time (the manifest's +-3 h candidate window); with none they
still answer "unsupported", so they never fall through to a live upstream fetch for a layer ICON does not have.

GUARDED, code default '0': serving it changes what these routes return (from "unsupported" to numbers), so the flip is the owner's
word (given 2026-11-13 20:28 EST: "yes"), made through the runtime manifest (flag-guardrail workflow_dispatch `reenable`) with Render
env left UNSET, armed together with ICON_SWELL2_STORED=1 (a repo variable for the ingest lanes). Real-frame parity: equal to the
mid-zoom map in all 120,184 cells; 924 cells (0.77 %) within 0.4 mm of the world-span map, same direction and period.
"""

def serve_on() -> bool:
    """A GUARDED flag (services/runtime_flags.py): env > runtime manifest > code default '0'. Keep Render env UNSET so the flag
    guardrail and the owner's manifest re-enable can both reach it."""
    from services import runtime_flags
    return runtime_flags.on("ICON_SWELL2_SERVE")


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
