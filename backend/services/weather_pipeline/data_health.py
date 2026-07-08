"""
data_health.py — proactive data-freshness health check for the decoupled forecast pipeline (2026-07-08).

WHY: every major stability incident in the 3-month ledger (RENDER OOM `669ccc56`, cron-403 `cron-403`,
the forecast-ingest timeout HANG `10a5a4a4`, manifest CDN staleness, the EURO estimates tail regression
`5ee86509`) was discovered REACTIVELY — a human noticed the map was stale or wrong. There is no proactive
signal (the only scheduled monitor, keep-warm.yml, just pings /api/health to avoid Render cold-starts; it
says NOTHING about whether the cron produced fresh data). This module is that signal.

WHAT: `compute_data_health(store)` reads the manifest and, for every model×domain lane that the pipeline is
supposed to keep warm, checks three things that catch the recurring failure classes:
  1. LIVENESS   — the freshest product across all lanes is recent (the cron actually ran).  → cron dead/timing out
  2. PRESENCE   — each expected lane has a global product at all.                            → a lane silently dropped
  3. PARITY     — no lane lags the freshest lane by more than the stale threshold.           → one source degraded
  4. HORIZON    — each lane's products extend far enough ahead.                              → tail-loss (EURO-estimates class)

It is PURE + read-only (no fetch, no mutation) so it is safe to run in the cron tail AND standalone from a
separate monitor workflow against the restored L2 manifest. Thresholds are env-tunable; defaults suit the
3-hourly cron. Never raises — a health check must not break the thing it watches.
"""
import os
from datetime import datetime, timezone
from typing import Optional

# The lanes the decoupled cron is expected to keep warm every cycle (source matrix: runbook §12).
EXPECTED_LANES = [
    ("GFS", "marine"), ("GFS", "wind"), ("GFS", "weather"),
    ("ICON", "marine"), ("ICON", "wind"), ("ICON", "weather"),
    ("EURO", "marine"), ("EURO", "wind"), ("EURO", "weather"),
]

# Model-aware horizon floors (hours). A FIXED floor cry-wolfs: ICON native is only ~5-7d (DWD limit,
# blended to 14d on the frontend), GFS reaches ~14d, EURO ~10-14d (marine estimated, wind/pressure ~10d
# native). These catch a real tail-LOSS per model (e.g. the EURO-estimates regression) without warning on
# each model's NORMAL native horizon. Per-model override: HEALTH_MIN_HORIZON_HOURS_{GFS,EURO,ICON}.
_HORIZON_DEFAULTS = {"GFS": 288.0, "EURO": 192.0, "ICON": 96.0}


def _f(env: str, default: float) -> float:
    try:
        return float(os.environ.get(env, default))
    except (TypeError, ValueError):
        return default


def _coerce_utc(dt) -> Optional[datetime]:
    if not isinstance(dt, datetime):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _is_global(p) -> bool:
    """The always-on global tier (the layer every heatmap + /point depends on); ignore regional pilots
    whose cadence is intentionally slower (WORLDWIDE_REGIONS_PER_CYCLE rotation)."""
    region = (getattr(p, "region_id", None) or "")
    return region.startswith("global") or getattr(p, "coverage_mode", None) == "global_tile"


def compute_data_health(store, now: Optional[datetime] = None) -> dict:
    """Read the manifest and return a health report. Structure:
      {status: ok|warn|critical, generated_at, freshest_run_age_h, lanes: {"GFS/marine": {...}}, alerts: [...]}
    status is the worst per-lane verdict. Never raises (returns status=critical + an alert on failure)."""
    now = _coerce_utc(now) or datetime.now(timezone.utc)
    stale_h = _f("HEALTH_STALE_HOURS", 6.0)        # a lane older than this while others are fresh = degraded
    critical_h = _f("HEALTH_CRITICAL_HOURS", 12.0)  # nothing this fresh anywhere = the cron is down

    def _min_horizon(model: str) -> float:
        return _f(f"HEALTH_MIN_HORIZON_HOURS_{model.upper()}", _HORIZON_DEFAULTS.get(model.upper(), 96.0))

    try:
        manifest = store.get_manifest()
        products = list(getattr(manifest, "products", []) or [])
    except Exception as e:
        return {"status": "critical", "generated_at": now.isoformat(),
                "alerts": [f"could not read manifest: {e!r}"], "lanes": {}}

    # Newest global product per (model, domain).
    lane_state = {}
    for p in products:
        if not _is_global(p):
            continue
        key = (str(getattr(p, "model", "")).upper(), str(getattr(p, "domain", "")).lower())
        rt = _coerce_utc(getattr(p, "run_time", None))
        vt = _coerce_utc(getattr(p, "valid_time_end", None))
        if rt is None:
            continue
        cur = lane_state.get(key)
        if cur is None or rt > cur["run_time"]:
            lane_state[key] = {"run_time": rt, "horizon_end": vt,
                               "source": getattr(p, "source_dataset", None) or getattr(p, "upstream_model", None)}
        elif vt is not None and (cur["horizon_end"] is None or vt > cur["horizon_end"]):
            cur["horizon_end"] = vt

    freshest = max((s["run_time"] for s in lane_state.values()), default=None)
    freshest_age_h = round((now - freshest).total_seconds() / 3600.0, 1) if freshest else None

    alerts = []
    lanes = {}
    status = "ok"

    def _worse(a, b):
        order = {"ok": 0, "warn": 1, "critical": 2}
        return a if order[a] >= order[b] else b

    # LIVENESS: if NOTHING anywhere is fresh, the cron is down — the top-level failure.
    if freshest is None:
        return {"status": "critical", "generated_at": now.isoformat(), "freshest_run_age_h": None,
                "alerts": ["no global products in manifest at all"], "lanes": {}}
    if freshest_age_h > critical_h:
        status = "critical"
        alerts.append(f"cron appears DOWN: freshest global product is {freshest_age_h}h old (> {critical_h}h)")

    for model, domain in EXPECTED_LANES:
        name = f"{model}/{domain}"
        st = lane_state.get((model, domain))
        if st is None:
            lanes[name] = {"verdict": "critical", "reason": "missing"}
            status = _worse(status, "critical")
            alerts.append(f"{name}: lane MISSING from manifest")
            continue
        age_h = round((now - st["run_time"]).total_seconds() / 3600.0, 1)
        lag_h = round((freshest - st["run_time"]).total_seconds() / 3600.0, 1)
        horizon_h = round((st["horizon_end"] - now).total_seconds() / 3600.0, 1) if st["horizon_end"] else None
        verdict, reasons = "ok", []
        if age_h > critical_h:
            verdict = _worse(verdict, "critical"); reasons.append(f"stale {age_h}h")
        elif lag_h > stale_h:
            verdict = _worse(verdict, "warn"); reasons.append(f"lags freshest by {lag_h}h")
        if horizon_h is not None and horizon_h < _min_horizon(model):
            verdict = _worse(verdict, "warn"); reasons.append(f"horizon only {horizon_h}h")
        lanes[name] = {"verdict": verdict, "age_h": age_h, "lag_h": lag_h,
                       "horizon_h": horizon_h, "source": st["source"]}
        if reasons:
            alerts.append(f"{name}: " + ", ".join(reasons))
        status = _worse(status, verdict)

    return {"status": status, "generated_at": now.isoformat(),
            "freshest_run_age_h": freshest_age_h, "lanes": lanes, "alerts": alerts}
