"""side_paths.py - the surfaces that showed surf WITHOUT the one chain, routed or labelled (Fable audit O4, 2026-11-10).

ONE FORECAST COMPOSITION (CLAUDE.md) says every surface that shows surf height or quality goes through
`surf_point` + `surf_rating`, with `spot_ratings.rate_one_spot` the reference. The audit found three backend side paths
that did not (the fourth, CLI-3, is the client's grid-sample glyph fallback, labelled in `useSpotRatings.js`):

  CMP-5  `/api/conditions/{id}` forecast rows: a DIRECT upstream fetch (`provider.fetch_point`, not even the served
         product), a size with no quality. ROUTED: the rows are now the precomputed `rate_one_spot` frames the glyphs and
         the hub serve (`spot_hub_composition.precomputed_item`, read-only here), each with its rating. A frame that is
         not precomputed is a `no_data` row, never a number from somewhere else. This also removes an upstream fetch
         per request: cheaper on the 1-CPU box, not dearer.
  CMP-6  `/api/surf-conditions` with a target time: Open-Meteo's sea through our geometry, no quality. LABELLED: the
         response says it is an unrated estimate (`rating: null`, `rating_status`, `height_basis`), so the post
         composer cannot pass it off as the app's forecast.
  CMP-7  `_breaking_ft` (hub chain and surf-conditions) FAILED OPEN to the OFFSHORE Hs under `wave_height_ft`, the
         exact number CLAUDE.md forbids as surf. Now it fails CLOSED: no height (`no_data`), the offshore value kept
         under its own name.

Flag SIDE_PATHS_THROUGH_CHAIN (GUARDED, code default ON, D-065); '0' restores all three old behaviours.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services import runtime_flags as _rf

logger = logging.getLogger(__name__)

FLAG = "SIDE_PATHS_THROUGH_CHAIN"
CODE_DEFAULT = "1"
M_TO_FT = 3.28084
PREVIEW_ROWS = 6


def enabled() -> bool:
    try:
        return _rf.flag(FLAG) == "1"
    except Exception:
        return CODE_DEFAULT == "1"


def _ft(m) -> Optional[float]:
    try:
        v = float(m)
    except (TypeError, ValueError):
        return None
    return round(v * M_TO_FT, 1) if v == v and abs(v) != float("inf") else None


def preview_times(now: datetime, n: int = PREVIEW_ROWS, step_h: Optional[int] = None) -> List[str]:
    """The next `n` valid times on the frame grid the glyph precompute rates (the hub's FRAME_STEP_H), from the top of
    the current hour inclusive."""
    from services.weather_pipeline.spot_hub_composition import FRAME_STEP_H, valid_time_str
    step = int(step_h or FRAME_STEP_H)
    base = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    first = base + timedelta(hours=(-base.hour) % step)
    return [valid_time_str(first + timedelta(hours=step * i)) for i in range(n)]


def preview_row(item: Optional[Dict[str, Any]], vt: str, source: Optional[str]) -> Dict[str, Any]:
    """One `/api/conditions` forecast row from a precomputed rate_one_spot item (or a `no_data` row for None)."""
    from services.conditions_labels import get_conditions_label
    if not item or item.get("surf_height_m") is None:
        return {"time": vt, "wave_height_ft": None, "offshore_height_ft": None, "surf_regime": None, "label": None,
                "status": "no_data", "rating": None, "rating_level": None, "source": source}
    ft = _ft(item.get("surf_height_m"))
    level = item.get("level")
    return {"time": vt, "wave_height_ft": ft, "offshore_height_ft": _ft(item.get("offshore_hs_m")),
            "surf_regime": None, "label": get_conditions_label(ft) if ft is not None else None, "status": None,
            "rating": item.get("score"), "rating_level": None if level in (None, "unknown") else level,
            "source": source}


async def rated_preview_rows(spot_id, lat: float, lng: float, model: str, now: Optional[datetime] = None,
                             n: int = PREVIEW_ROWS, load_l2=None) -> List[Dict[str, Any]]:
    """CMP-5: the preview rows as the glyphs serve them. Read-only: one TTL-cached L2 blob read, no resolve."""
    from services.weather_pipeline.spot_hub_composition import precomputed_item
    now = now or datetime.now(timezone.utc)
    if load_l2 is None:
        from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2_cached as load_l2
    try:
        obj = await asyncio.to_thread(load_l2)
    except Exception as e:
        logger.debug(f"[side-paths] ratings blob unavailable for {spot_id}: {e}")
        obj = None
    spot = {"id": spot_id, "latitude": lat, "longitude": lng}
    rows = []
    for vt in preview_times(now, n):
        try:
            item, source, _served = precomputed_item(obj, spot, model, vt, True)
        except Exception as e:
            logger.debug(f"[side-paths] frame {vt} unreadable for {spot_id}: {e}")
            item, source = None, None
        rows.append(preview_row(item, vt, source if item else None))
    return rows


def label_unrated_estimate(result: Dict[str, Any]) -> Dict[str, Any]:
    """CMP-6: say that a height is our transform of Open-Meteo's sea with no quality, so it is not read as the forecast."""
    if not enabled() or result.get("wave_height_ft") is None:
        return result
    result.setdefault("rating", None)
    result["rating_status"] = "not_rated"
    result["height_basis"] = "open_meteo_sea_estimate"
    return result
