"""Forecast skill ledger — our accuracy at LEAD TIME, against reality and against a competitor.

WHY (owner, 2026-07-30): "test against reality and other surf forecast apps' data, to measure if
we're very wrong or near — we are trying to be more accurate than the competition." T+0 residuals
(the calibration loop) cannot answer that: the product a surfer judges is "will Thursday be good",
which is the +24/+48/+72h forecast. Per-lead skill is how the industry scores itself, and like the
residual archive it is unrecoverable — a forecast not recorded when it was made can never be
scored. So every calibration run:

  1. LEDGERS the forecasts being made NOW for +24/+48/+72h at every mapped buoy — ours (the same
     resolver the product serves from) and a competitor lane (Open-Meteo marine, one batched
     multi-coordinate call) — into `calibration/skill/pending.json`.
  2. SCORES pending rows whose target hour has arrived against THIS run's fresh buoy observations
     (truth), appending to monthly `calibration/skill/scored-YYYY-MM.json` segments (append-only,
     deduplicated, never pruned — same contract as the residual history).

The dedupe key keeps the EARLIEST forecast per (source, buoy, target, lead-bucket) — the honest
lead. Summary: per source x lead MAE/bias with n and n_buoys, so "are we near?" is a number, not
an impression. Kill switch FORECAST_SKILL=0; every failure is swallowed (the calibration loop is
never at risk). Rows are ~120 B; pending is capped, scored history is monthly-segmented.
"""
import json
import logging
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SKILL_PENDING_L2_KEY = "calibration/skill/pending.json"
SKILL_SCORED_PREFIX = "calibration/skill/scored-"
LEADS_H = (24, 48, 72)
SCORE_JOIN_TOLERANCE_S = 90 * 60      # obs within 1.5h of the target hour scores it
PENDING_EXPIRY_H = 96                  # unmatched past-target rows drop (buoy gap)
PENDING_MAX_ENTRIES = 10000
OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"

SOURCE_OURS = "raw_surf"
SOURCE_OM = "open_meteo_marine"


def _parse_iso(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _lead_bucket(lead_h: float) -> int:
    return int(round(lead_h / 24.0))


def dedupe_key(row) -> tuple:
    return (row.get("source"), row.get("buoy_id"), row.get("target_time"),
            _lead_bucket(row.get("lead_h") or 0))


def rows_from_calibration_report(report, target_time: str, lead_h: float) -> List[dict]:
    """Our model's forecast rows for one target hour, from a calibrate_spots report resolved AT
    that hour. One row per distinct buoy; buoy obs fields in the report are ignored (they are
    today's sea, not the target's)."""
    rows, seen = [], set()
    for entry in (report or {}).get("spots") or []:
        bid = entry.get("buoy_id")
        res = entry.get("residual") or {}
        hs = res.get("model_hs_m")
        if bid is None or bid in seen or hs in (None, 0.0):
            continue
        seen.add(bid)
        rows.append({"source": SOURCE_OURS, "buoy_id": bid, "target_time": target_time,
                     "lead_h": round(lead_h, 1), "hs_m": hs, "tp_s": res.get("model_tp_s")})
    return rows


def fetch_om_forecast_rows(buoys: Dict[str, tuple], now: datetime,
                           leads_h=LEADS_H, timeout: int = 60) -> List[dict]:
    """The competitor lane: ONE batched multi-coordinate Open-Meteo marine forecast call for every
    mapped buoy, sliced at each lead's target hour. `buoys` maps buoy_id -> (lat, lng)."""
    if not buoys:
        return []
    ids = list(buoys.keys())
    lats = ",".join(f"{buoys[b][0]:.4f}" for b in ids)
    lngs = ",".join(f"{buoys[b][1]:.4f}" for b in ids)
    url = (f"{OM_MARINE}?latitude={lats}&longitude={lngs}"
           f"&hourly=wave_height,swell_wave_period&forecast_days=4&timezone=UTC")
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-skill"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.load(r)
    if isinstance(payload, dict):
        payload = [payload]
    rows = []
    for bid, loc in zip(ids, payload):
        h = (loc or {}).get("hourly") or {}
        times, heights = h.get("time") or [], h.get("wave_height") or []
        periods = h.get("swell_wave_period") or []
        index = {t: i for i, t in enumerate(times)}
        for lead in leads_h:
            target = (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00")
            i = index.get(target)
            if i is None or i >= len(heights) or heights[i] is None:
                continue
            rows.append({"source": SOURCE_OM, "buoy_id": bid,
                         "target_time": target + ":00Z", "lead_h": float(lead),
                         "hs_m": heights[i],
                         "tp_s": periods[i] if i < len(periods) else None})
    return rows


def merge_pending(existing, incoming, now: Optional[datetime] = None,
                  max_entries: int = PENDING_MAX_ENTRIES) -> List[dict]:
    """Append forecasts, keeping the EARLIEST row per dedupe key (the honest lead) and dropping
    rows whose target passed more than PENDING_EXPIRY_H ago (a buoy gap nobody can score)."""
    now = now or datetime.now(timezone.utc)
    horizon = now - timedelta(hours=PENDING_EXPIRY_H)
    out, seen = [], set()
    for row in list(existing or []) + list(incoming or []):
        t = _parse_iso(row.get("target_time"))
        if t is None or t < horizon:
            continue
        key = dedupe_key(row)
        if key in seen:
            continue          # first wins: existing rows precede incoming ⇒ earliest lead kept
        seen.add(key)
        out.append(row)
    out.sort(key=lambda r: (r.get("target_time") or "", r.get("source") or "", r.get("buoy_id") or ""))
    return out[-max_entries:]


def score_pending(pending, report, now: Optional[datetime] = None):
    """Split pending into (still_pending, scored): a row scores when THIS run's report holds a
    buoy observation within tolerance of its target hour."""
    now = now or datetime.now(timezone.utc)
    obs = {}
    for entry in (report or {}).get("spots") or []:
        bid = entry.get("buoy_id")
        res = entry.get("residual") or {}
        bt = _parse_iso(entry.get("buoy_time"))
        if bid is None or bt is None or res.get("buoy_wvht_m") is None:
            continue
        obs.setdefault(bid, []).append((bt, res.get("buoy_wvht_m"), res.get("buoy_dpd_s")))
    still, scored = [], []
    for row in pending or []:
        t = _parse_iso(row.get("target_time"))
        if t is None:
            continue
        candidates = obs.get(row.get("buoy_id")) or []
        best = None
        for bt, wvht, dpd in candidates:
            dt_s = abs((bt - t).total_seconds())
            if dt_s <= SCORE_JOIN_TOLERANCE_S and (best is None or dt_s < best[0]):
                best = (dt_s, bt, wvht, dpd)
        if best is not None:
            scored.append({**row,
                           "obs_time": best[1].isoformat(),
                           "obs_hs_m": best[2], "obs_dpd_s": best[3],
                           "err_m": round((row.get("hs_m") or 0.0) - best[2], 4)})
        elif t > now - timedelta(hours=PENDING_EXPIRY_H):
            still.append(row)
        # else: expired unmatched — dropped
    return still, scored


def skill_summary(scored_rows) -> List[dict]:
    """Per source x lead-bucket: n, n_buoys, bias, MAE — the 'are we near?' table."""
    groups: Dict[tuple, List[dict]] = {}
    for r in scored_rows or []:
        if not isinstance(r.get("err_m"), (int, float)):
            continue
        groups.setdefault((r.get("source"), _lead_bucket(r.get("lead_h") or 0)), []).append(r)
    out = []
    for (source, bucket), rows in sorted(groups.items()):
        errs = [r["err_m"] for r in rows]
        out.append({"source": source, "lead_h": bucket * 24, "n": len(errs),
                    "n_buoys": len({r.get("buoy_id") for r in rows}),
                    "bias_m": round(sum(errs) / len(errs), 4),
                    "mae_m": round(sum(abs(e) for e in errs) / len(errs), 4)})
    return out


async def run_skill_ledger(store, resolver, spots, model: str, report,
                           now: Optional[datetime] = None) -> Optional[dict]:
    """The wired entry point (guarded by the caller): ledger new forecasts, score arrivals.
    Returns {"ledgered": n, "scored": n, "summary": [...]} or None when disabled."""
    if os.environ.get("FORECAST_SKILL", "1") == "0":
        return None
    from services.weather_pipeline.buoy_calibration import (
        calibrate_spots, fetch_ndbc_station_coords, load_calibration_l2, upload_calibration_l2,
    )
    now = now or datetime.now(timezone.utc)
    incoming: List[dict] = []
    for lead in LEADS_H:
        target = (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00:00Z")
        try:
            lead_report = await calibrate_spots(resolver, spots, model, target)
            incoming.extend(rows_from_calibration_report(lead_report, target, lead))
        except Exception as e:
            logger.warning("[forecast-skill] lead +%dh resolve failed (%s)", lead, e)
    try:
        coords = await fetch_ndbc_station_coords()
        buoys = {}
        for entry in (report or {}).get("spots") or []:
            bid = entry.get("buoy_id")
            if bid and bid in coords and bid not in buoys:
                buoys[bid] = coords[bid]
        incoming.extend(fetch_om_forecast_rows(buoys, now))
    except Exception as e:
        logger.warning("[forecast-skill] competitor lane failed (%s)", e)

    pending = load_calibration_l2(SKILL_PENDING_L2_KEY) or []
    pending = merge_pending(pending, incoming, now=now)
    still, scored = score_pending(pending, report, now=now)
    upload_calibration_l2(store, still, SKILL_PENDING_L2_KEY)
    if scored:
        month_groups: Dict[str, List[dict]] = {}
        for r in scored:
            t = _parse_iso(r.get("target_time"))
            month_groups.setdefault(t.strftime("%Y-%m"), []).append(r)
        for month, rows in month_groups.items():
            key = f"{SKILL_SCORED_PREFIX}{month}.json"
            existing = load_calibration_l2(key) or []
            seen = {dedupe_key(r) for r in existing}
            fresh = [r for r in rows if dedupe_key(r) not in seen]
            if fresh:
                upload_calibration_l2(store, existing + fresh, key)
    summary = skill_summary(scored)
    logger.info("[forecast-skill] ledgered=%d scored=%d %s", len(incoming), len(scored),
                summary if summary else "")
    return {"ledgered": len(incoming), "scored": len(scored), "summary": summary}
