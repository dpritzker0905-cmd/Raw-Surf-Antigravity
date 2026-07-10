"""Wind-lane request gates for the dynamic viewport service (split from viewport_service.py
2026-07-10 — the 800-LOC gate; viewport_service re-imports both, so existing import sites and
tests are unchanged)."""
import os
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException


def wind_global_parity_resolution(resolution: float, is_global_view: bool, domain: str) -> float:
    """Audit #10 (2026-07-10): 10° parity for dynamic GLOBAL wind builds. The stored global_coarse
    wind product is 10° (37x17=629 vectors) but choose_adaptive_resolution(360,165,400) lands on the
    15° tier (25x12=300), so far-horizon extension hours served a visibly coarser field than every
    stored hour. Global wind only — regional tiers unchanged; ~2x upstream/CPU per dynamic global
    build (user-approved 2026-07-10). Kill switch: WIND_GLOBAL_PARITY_10DEG=0."""
    if (is_global_view and domain.lower() == "wind" and resolution > 10.0
            and os.environ.get("WIND_GLOBAL_PARITY_10DEG", "1") != "0"):
        return 10.0
    return resolution


def wind_horizon_fail_fast(model: str, target_dt: datetime, forecast_days: int) -> None:
    """WIND HORIZON FAIL-FAST (2026-07-10, live-measured): the upstream wind fetch covers exactly
    `forecast_days` — a target beyond it CANNOT be served by this build, and today it falls through to
    an unhandled slice error (EURO wind >240h returned naked HTTP 500 on every scrub past day 10 = the
    "wind clears at the 14-day mark" report) or a doomed upstream grind that poisons the rate-limit
    negative cache. Raise a clean 404 no_wind_coverage instead (mirrors marine's no_copernicus_coverage;
    the client's existing fallback handles it identically, just instantly). ICON is EXEMPT — its
    extend_icon_wind_to_14d serves 120→336h from the 5-day base fetch (verified live: +200h/+330h = 200
    in ~2.5s). Truth-consistent: uses the SAME horizon the fetch itself uses — no new horizon source.
    Kill switch: WIND_HORIZON_GATE=0."""
    if model.upper() == "ICON":
        return
    if os.environ.get("WIND_HORIZON_GATE") == "0":
        return
    if target_dt > datetime.now(timezone.utc) + timedelta(hours=forecast_days * 24):
        raise HTTPException(
            status_code=404,
            detail=(f"no_wind_coverage: {model} wind data ends ~{forecast_days * 24}h out; "
                    f"requested {target_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}."),
        )
