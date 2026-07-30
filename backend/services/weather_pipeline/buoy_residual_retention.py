"""Permanent retention of forecast↔observation pairs — monthly append-only history segments.

WHY THIS EXISTS (2026-07-30 strategy, phase 5): the hot residual archive
(`calibration/buoy_residual_archive.json`) is deliberately a ROLLING window — its 20,000-entry cap
is a bandwidth budget (the object is downloaded and re-uploaded on every CI run), which makes it
~14 days deep. But those rows are the product's only forecast↔buoy pairs, and every day not
retained is unrecoverable — the pairs are Surfline's 35-year advantage, built forward. Correcting
the thin height bands (2.5–10 m: 8 independent buoys) needs seasons of data, not a fortnight.

THE SHAPE: once per UTC day (first calibration run inside the roll-up window), the hot archive's
rows are merged into per-month segments under `calibration/history/residuals-YYYY-MM.json`.
Segments are append-only — no age pruning, no entry cap — and are touched at most a few times a
day, so their growth (~7.5 MB/month at 59 buoys hourly) never rides the hourly budget. The merge
dedupes on (buoy_id, buoy_time), so re-running is idempotent and a missed day costs nothing while
the hot window is deeper than a day (it is ~14 days deep).

Kill switch: BUOY_RESIDUAL_RETENTION=0. Window: BUOY_RESIDUAL_RETENTION_WINDOW_H (default 6 —
"roll up on runs in the first N UTC hours of the day"; the crons run every ~3-4h, so a narrower
window can miss a day, and firing twice is a cheap no-op).
"""
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

RESIDUAL_HISTORY_PREFIX = "calibration/history/residuals-"
# Effectively-unbounded arguments for merge_residual_archive: history NEVER prunes.
_HISTORY_MAX_AGE_DAYS = 365 * 100
_HISTORY_MAX_ENTRIES = 10 ** 9


def history_key_for_month(month: str) -> str:
    return f"{RESIDUAL_HISTORY_PREFIX}{month}.json"


def should_roll_up(now: Optional[datetime] = None, window_h: Optional[int] = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if window_h is None:
        try:
            window_h = int(os.environ.get("BUOY_RESIDUAL_RETENTION_WINDOW_H", "6"))
        except ValueError:
            window_h = 6
    return now.hour < window_h


def group_rows_by_month(rows) -> Dict[str, List[dict]]:
    """Rows keyed by the YYYY-MM of their observation time. The hot window spans ~14 days, so a
    roll-up near month start correctly back-fills the PREVIOUS month's segment too. Unparseable
    times are dropped (the hot merge already refuses them, so this is belt-and-braces)."""
    from services.weather_pipeline.buoy_calibration import _parse_iso
    grouped = defaultdict(list)
    for row in rows or []:
        t = _parse_iso(row.get("buoy_time"))
        if t is None:
            continue
        grouped[t.strftime("%Y-%m")].append(row)
    return dict(grouped)


def roll_up_history(store, hot_rows, now: Optional[datetime] = None) -> Dict[str, dict]:
    """Merge the hot archive's rows into their monthly segments. Uploads only segments that gained
    rows. Returns {month: {"before": n, "after": n}} for what was touched."""
    from services.weather_pipeline.buoy_calibration import (
        load_calibration_l2, upload_calibration_l2, merge_residual_archive,
    )
    now = now or datetime.now(timezone.utc)
    result: Dict[str, dict] = {}
    for month, rows in sorted(group_rows_by_month(hot_rows).items()):
        key = history_key_for_month(month)
        existing = load_calibration_l2(key) or []
        merged = merge_residual_archive(
            existing, rows, now=now,
            max_age_days=_HISTORY_MAX_AGE_DAYS, max_entries=_HISTORY_MAX_ENTRIES,
        )
        if len(merged) > len(existing):
            upload_calibration_l2(store, merged, key)
            result[month] = {"before": len(existing), "after": len(merged)}
    return result


def maybe_roll_up_history(store, hot_rows, now: Optional[datetime] = None) -> Optional[dict]:
    """The wired entry point: gated, windowed, and NEVER raises — retention is an enrichment of an
    already-working calibration loop, and a Storage hiccup here must not cost the report or the
    hot archive (same contract as the archive block itself)."""
    if os.environ.get("BUOY_RESIDUAL_RETENTION", "1") == "0":
        return None
    now = now or datetime.now(timezone.utc)
    if not should_roll_up(now):
        return None
    try:
        touched = roll_up_history(store, hot_rows, now=now)
        if touched:
            logger.info("[buoy-calibration] residual history rolled up: %s",
                        {m: f"{v['before']}->{v['after']}" for m, v in touched.items()})
        return touched
    except Exception as e:
        logger.warning("[buoy-calibration] residual history roll-up skipped (%s); "
                       "hot archive and report unaffected.", e)
        return None
