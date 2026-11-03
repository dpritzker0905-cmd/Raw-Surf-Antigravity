"""spot_series.py: per-spot forecast SERIES for the hub charts, produced in CI (spot-hub phase 3, 2026-11-03, DARK).

WHY. The owner asked for "our own logic to generate our own forecasting charts that work in the rating color codes"
(2026-11-03 ~03:41Z). A chart needs ~57 rated frames per spot per model. On the 1-CPU serve box that is ~3 s of
CPU per cold spot view (54 ms a frame, CI run 41491110869), so the series is rated in CI (`spot-series.yml`), sharded,
and published as static objects. The serve box does none of it.

THE CHAIN. Every frame is `spot_ratings.rate_one_spot`, the reference implementation, on the SAME frame plan the hub
uses (`spot_hub_composition.frame_plan`: 3-hourly to +72 h, then local 06/12/18 solar day-parts to +336 h), through
the SAME recording resolver, so the chart and the hub cannot sample or rate a frame differently. The observation gate
is the glyph precompute's own (`rating_confirmation.apply_gate_to_frames`: cross-model agreement + fresh reports),
applied once all three models are in, exactly as `precompute.yml` gates the glyph frames. Nothing is re-derived.

THE OBJECT. Per model, 64 hash shards (`shard_of`: md5 of the spot id, the same stable hash `_persist_inputs` uses);
each shard is gzipped JSON, COLUMNAR per spot (integers compress far better than repeated keys):
    t   hours after `base_time`              h   breaking height, cm (rate_one_spot's surf_height_m)
    s   gated score x10 (null = no rating)    r   ungated score x10
    l   gated level index into `levels`      lo / hi  min / max level index across the models that rated the frame
    w   wind kt (rounded)                    wd  wind word index into `wind_words`
    sw  primary swell, cm                    td  tide height, cm (MSL model estimate; only where the rating had one)
⚠️ `td` exists only where `rate_one_spot` resolved a tide (RATING_TIDE, `tide_norm_at` = +72 h today). Days beyond are
null, not interpolated: a tide curve to +8 days is a separate owner decision (research: harmonic fit = false precision).

TIER. The shards hold the full 14 days. The CLIENT must show only `LayerAccessResolver.resolveForecastWindow`'s window.
⚠️ Anonymous CDN access to a 14-day shard exposes 14 days to a free user, as the map's static frames already do. An
owner decision, stated in the PR. The bucket is private: anonymous reads would also need an owner-approved storage
policy for this prefix (today only `spot_ratings/latest.json` has one).

PUBLISH is gated by the repo variable `SPOT_SERIES_PUBLISH` (default '0') in the workflow, and nothing reads the
objects yet (phase 4 builds the chart).
"""
import asyncio
import gzip
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SCHEMA = "raw-surf/spot-series/1"
N_SHARDS = 64
L2_PREFIX = "spot_series/v1"
HORIZON_H = 336
LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]
WIND_WORDS = ["offshore", "cross-shore", "onshore"]
COLS = ["t", "h", "s", "r", "l", "lo", "hi", "w", "wd", "sw", "td"]
_CONCURRENCY = 8


def shard_of(spot_id: Any) -> int:
    """Stable across processes and runs (md5, never hash(): PYTHONHASHSEED randomises str hashing)."""
    return int(hashlib.md5(str(spot_id).encode("utf-8")).hexdigest()[:8], 16) % N_SHARDS


def job_shards(job: int, jobs: int) -> List[int]:
    return [s for s in range(N_SHARDS) if s % max(1, jobs) == job]


def shard_key(model: str, shard: int) -> str:
    return f"{L2_PREFIX}/{model.upper()}/{shard:02d}.json.gz"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def _parse(vt: str) -> datetime:
    return datetime.fromisoformat(vt.replace("Z", "+00:00"))


def spot_times(lng: float, base: datetime, horizon_h: int = HORIZON_H) -> List[datetime]:
    """The hub's "now" frame, then the hub's frame plan. ONE plan for hub and chart."""
    from services.weather_pipeline.spot_hub_composition import current_valid_time, frame_plan
    now = current_valid_time(base)
    return [now] + frame_plan(lng, base, horizon_h)


async def rate_spot_series(resolver, spots: List[Dict[str, Any]], model: str, base: datetime,
                           horizon_h: int = HORIZON_H, ref_map: Optional[Dict[str, float]] = None,
                           concurrency: int = _CONCURRENCY) -> Dict[str, Any]:
    """{spot_id: {"off": utc offset, "rows": [frame_row, ...]}} for one model, UNGATED (the gate needs every model).
    Each frame is `rate_one_spot` through the hub's recording resolver; a frame that raises is an unknown row."""
    from services.weather_pipeline.spot_hub_composition import (
        _RecordingResolver, frame_row, solar_utc_offset_hours)
    from services.weather_pipeline.spot_ratings import rate_one_spot
    sem = asyncio.Semaphore(max(1, concurrency))
    ref_map = ref_map or {}

    async def one(sp, at):
        vt = _iso(at)
        async with sem:
            rec = _RecordingResolver(resolver)
            try:
                item = await rate_one_spot(rec, sp, model, vt, reference_size_m=ref_map.get(str(sp["id"])))
            except Exception as e:   # one frame must not cost the spot
                logger.debug(f"[spot-series] {model} {sp.get('id')} {vt} failed: {e}")
                return {"valid_time": vt, "surf_height_m": None, "score": None, "level": "unknown"}
            row = frame_row(item, vt, "live", None, rec.marine, rec.wind)
            row["raw_score"] = item.get("score")
            return row

    async def spot(sp):
        rows = await asyncio.gather(*[one(sp, t) for t in spot_times(sp["longitude"], base, horizon_h)])
        return str(sp["id"]), {"off": solar_utc_offset_hours(sp["longitude"]), "rows": list(rows)}

    return dict(await asyncio.gather(*[spot(sp) for sp in spots]))


def gate_models(by_model: Dict[str, Dict[str, Any]], reports_by_spot=None) -> int:
    """Apply the glyph precompute's observation gate across models IN PLACE (rows gain gated score/level).
    Returns the number of capped spot-frames. Reuses `apply_gate_to_frames` on a frames-shaped VIEW of the rows.
    Gated on RATING_OBS_GATE exactly as `run_spot_ratings_precompute` gates the glyph frames; off, the level is the
    ungated score's."""
    import os
    from services.weather_pipeline.surf_rating import score_to_level
    if os.environ.get("RATING_OBS_GATE", "0") != "1":
        for spots in by_model.values():
            for rec in spots.values():
                for row in rec["rows"]:
                    if row.get("raw_score") is not None:
                        row["score"], row["level"] = row["raw_score"], score_to_level(row["raw_score"])
        return 0
    from services.weather_pipeline.rating_confirmation import apply_gate_to_frames
    frames: Dict[Any, Dict[str, Any]] = {}
    for model, spots in by_model.items():
        for sid, rec in spots.items():
            for row in rec["rows"]:
                fr = frames.setdefault((model, row["valid_time"]),
                                       {"model": model, "valid_time": row["valid_time"], "spots": []})
                entry = {"spot_id": sid, "score": row.get("raw_score"), "raw_score": None, "_row": row}
                fr["spots"].append(entry)
    flat = list(frames.values())
    n = apply_gate_to_frames(flat, reports_by_spot or {})
    for fr in flat:
        for e in fr["spots"]:
            if e.get("score") is None:
                continue                      # nothing to gate: the row keeps its own 'unknown'
            row = e["_row"]
            row["score"], row["level"] = e["score"], e.get("level") or score_to_level(e["score"])
            row["confirmed"] = e.get("confirmed")
    return n


def _lvl(level) -> Optional[int]:
    return LEVELS.index(level) if level in LEVELS else None


def _cm(m) -> Optional[int]:
    return int(round(m * 100)) if isinstance(m, (int, float)) else None


def _x10(s) -> Optional[int]:
    return int(round(s * 10)) if isinstance(s, (int, float)) else None


def bands(by_model: Dict[str, Dict[str, Any]]) -> Dict[tuple, tuple]:
    """(spot_id, valid_time) -> (lo, hi) level index across the models that rated that frame (the +-1-level band)."""
    acc: Dict[tuple, List[int]] = {}
    for spots in by_model.values():
        for sid, rec in spots.items():
            for row in rec["rows"]:
                li = _lvl(row.get("level"))
                if li is not None:
                    acc.setdefault((sid, row["valid_time"]), []).append(li)
    return {k: (min(v), max(v)) for k, v in acc.items()}


def columnar(rows: List[Dict[str, Any]], base: datetime, band: Dict[tuple, tuple], sid: str) -> Dict[str, list]:
    cols: Dict[str, list] = {c: [] for c in COLS}
    for row in rows:
        lo_hi = band.get((sid, row["valid_time"]), (None, None))
        tide = row.get("tide") if isinstance(row.get("tide"), dict) else None
        ww = row.get("wind_word")
        for c, v in (("t", int((_parse(row["valid_time"]) - base).total_seconds() // 3600)),
                     ("h", _cm(row.get("surf_height_m"))), ("s", _x10(row.get("score"))),
                     ("r", _x10(row.get("raw_score"))), ("l", _lvl(row.get("level"))),
                     ("lo", lo_hi[0]), ("hi", lo_hi[1]),
                     ("w", int(round(row["wind_kt"])) if isinstance(row.get("wind_kt"), (int, float)) else None),
                     ("wd", WIND_WORDS.index(ww) if ww in WIND_WORDS else None),
                     ("sw", _cm(row.get("primary_swell_hs_m"))),
                     ("td", _cm(tide.get("height_m")) if tide else None)):
            cols[c].append(v)
    return cols


def build_shards(by_model: Dict[str, Dict[str, Any]], base: datetime, generated_at: Optional[datetime] = None
                 ) -> Dict[str, bytes]:
    """{L2 key: gzipped bytes} for every model x hash shard that holds a spot, plus `index.json`."""
    generated_at = generated_at or datetime.now(timezone.utc)
    band = bands(by_model)
    out: Dict[str, bytes] = {}
    index = {"schema": SCHEMA, "base_time": _iso(base), "generated_at": generated_at.isoformat(),
             "models": sorted(by_model), "n_shards": N_SHARDS, "levels": LEVELS, "wind_words": WIND_WORDS,
             "cols": COLS, "frame_plan": "now, 3-hourly to +72 h, then local 06/12/18 solar day-parts to +336 h",
             "tier": "holds 14 days; clients show only LayerAccessResolver.resolveForecastWindow's window",
             "shards": {}}
    for model, spots in sorted(by_model.items()):
        per: Dict[int, Dict[str, Any]] = {}
        for sid, rec in spots.items():
            per.setdefault(shard_of(sid), {})[sid] = {"off": rec["off"],
                                                       **columnar(rec["rows"], base, band, sid)}
        for shard, members in sorted(per.items()):
            body = {"schema": SCHEMA, "model": model, "shard": shard, "base_time": _iso(base),
                    "levels": LEVELS, "wind_words": WIND_WORDS, "cols": COLS, "spots": members}
            raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
            gz = gzip.compress(raw, compresslevel=9, mtime=0)
            out[shard_key(model, shard)] = gz
            index["shards"].setdefault(model, {})[f"{shard:02d}"] = {"spots": len(members), "bytes_gz": len(gz),
                                                                       "bytes_raw": len(raw)}
    out[f"{L2_PREFIX}/index.json"] = json.dumps(index, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return out


def summarize(objects: Dict[str, bytes]) -> Dict[str, Any]:
    gz = [len(v) for k, v in objects.items() if k.endswith(".json.gz")]
    return {"objects": len(objects), "shards": len(gz), "bytes_gz_total": sum(gz),
            "bytes_gz_max": max(gz) if gz else 0, "bytes_gz_mean": round(sum(gz) / len(gz)) if gz else 0}


def dump_model_rows(path: str, model: str, base: datetime, rows: Dict[str, Any], meta: Dict[str, Any]) -> None:
    """One rate job's ungated rows as a gzipped JSON artifact (the assemble job reads every model's)."""
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"schema": SCHEMA + "/rows", "model": model, "base_time": _iso(base), "meta": meta,
                   "spots": rows}, fh, separators=(",", ":"))


def load_model_rows(path: str) -> Dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def timed(fn):
    """(result, seconds) of an async callable, for the step summary."""
    async def wrap(*a, **k):
        t0 = time.monotonic()
        res = await fn(*a, **k)
        return res, round(time.monotonic() - t0, 1)
    return wrap


def base_time_from(arg: Optional[str]) -> datetime:
    """The ONE base all matrix jobs share (so every model rates the same frames). Default: the top of this hour."""
    if arg:
        return _parse(arg).replace(minute=0, second=0, microsecond=0)
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def horizon_for(model: str) -> int:
    """14 days clamped by the model's capability row (capabilities.py is the only horizon source)."""
    from services.forecast_tier_window import tier_horizon_hours
    return min(HORIZON_H, tier_horizon_hours("premium", model))


def frames_per_spot(lng: float, base: datetime, model: str) -> int:
    return len(spot_times(lng, base, horizon_for(model)))
