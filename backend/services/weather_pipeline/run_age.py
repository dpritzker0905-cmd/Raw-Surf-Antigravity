"""run_age.py - the SERVE-SIDE run-age cutoff: how old is the model cycle we serve, per model and layer? (2026-11-24)

WHY (inspection 2026-11-23, finding 4): a stuck model run was served with no label. /api/health/data ages each lane
by the product's INGEST time (`run_time`), so a cycle that stops advancing but is re-ingested every 4 h looks fresh.
The client's "from an older run" words compare the drawn run with the manifest's newest run, which is the same stuck
run. Nothing measured the age of the CYCLE itself.

WHAT: for each (model, domain, layer), the newest VERIFIED cycle (`model_run_time`, status 'known') among the global
products of the served manifest, its age now, and a verdict against the model's cutoff. `/api/weather/capabilities`
(routes/weather.py, off the event loop) carries it on every row as `run_age` (no new request). The map shows run time, source and age always, and says
"older than <cutoff> h" in words past the cutoff. This LABELS; it never withholds data. Refusing a stale run would
itself move served values, which D-090 gates.

Cutoffs (hours since the cycle; cycle + publication delay + our 2-4 h share, inspection item 10, the same bounds as
scripts/frame_set_freshness.py): GFS 18; EURO / ICON / ECMWF_ENS 30; CMEMS 48; anything else 30. Override with
RUN_AGE_CUTOFF_H_<MODEL>. Kill: RUN_AGE_SERVE=0 (rows carry no run_age; the client falls back to its own manifest read).
"""
from __future__ import annotations

import os
import threading
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

CUTOFF_H = {"GFS": 18.0, "EURO": 30.0, "ICON": 30.0, "ECMWF_ENS": 30.0, "CMEMS": 48.0}
DEFAULT_CUTOFF_H = 30.0

_lock = threading.Lock()
_memo: Dict[str, object] = {"manifest_id": None, "newest": {}}


def enabled() -> bool:
    return os.environ.get("RUN_AGE_SERVE", "1") != "0"


def cutoff_h(model: str) -> float:
    m = str(model or "").upper()
    try:
        return float(os.environ.get(f"RUN_AGE_CUTOFF_H_{m}", CUTOFF_H.get(m, DEFAULT_CUTOFF_H)))
    except ValueError:
        return CUTOFF_H.get(m, DEFAULT_CUTOFF_H)


def _utc(v) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _global(p) -> bool:
    region = getattr(p, "region_id", None) or ""
    return region.startswith("global") or getattr(p, "coverage_mode", None) == "global_tile"


def newest_cycles(products) -> Dict[Tuple[str, str, str], dict]:
    """{(MODEL, domain, layer): {cycle, source}}: the newest verified cycle among global products. PURE."""
    out: Dict[Tuple[str, str, str], dict] = {}
    for p in products or []:
        if not _global(p) or getattr(p, "model_run_time_status", None) != "known":
            continue
        cyc = _utc(getattr(p, "model_run_time", None))
        if cyc is None:
            continue
        key = (str(getattr(p, "model", "")).upper(), str(getattr(p, "domain", "") or "").lower(),
               str(getattr(p, "layer", "") or "").lower())
        cur = out.get(key)
        if cur is None or cyc > cur["cycle"]:
            out[key] = {"cycle": cyc, "source": getattr(p, "source_dataset", None) or getattr(p, "upstream_model", None)}
    return out


def describe(entry: Optional[dict], model: str, now: datetime) -> Optional[dict]:
    """The `run_age` field for one row, or None when no verified cycle is known. PURE."""
    if not entry:
        return None
    age = (now - entry["cycle"]).total_seconds() / 3600.0
    cut = cutoff_h(model)
    return {"cycle": entry["cycle"].strftime("%Y-%m-%dT%H:%M:%SZ"), "age_h": round(age, 1), "cutoff_h": cut,
            "stale": age > cut, "source": entry.get("source")}


def _cached_newest(manifest) -> Dict[Tuple[str, str, str], dict]:
    """newest_cycles, recomputed only when the manifest OBJECT changes (ProductStore caches it by file mtime)."""
    with _lock:
        if _memo["manifest_id"] == id(manifest):
            return _memo["newest"]    # type: ignore[return-value]
    newest = newest_cycles(getattr(manifest, "products", None) or [])
    with _lock:
        _memo["manifest_id"], _memo["newest"] = id(manifest), newest
    return newest


def run_age_for_rows(rows, manifest=None, now: Optional[datetime] = None):
    """Each capabilities row with `run_age` added (None when unknown). Never raises; RUN_AGE_SERVE=0 returns rows as is."""
    if not enabled():
        return rows
    try:
        if manifest is None:
            from services.weather_pipeline.store import ProductStore
            manifest = ProductStore().get_manifest()
        newest = _cached_newest(manifest)
    except Exception:                                   # noqa: BLE001 - a label must never break /capabilities
        return rows
    now = now or datetime.now(timezone.utc)
    out = []
    for r in rows:
        key = (str(r.get("model", "")).upper(), str(r.get("domain", "") or "").lower(), str(r.get("layer", "") or "").lower())
        out.append(dict(r, run_age=describe(newest.get(key), key[0], now)))
    return out


def _reset_for_tests() -> None:
    with _lock:
        _memo.update({"manifest_id": None, "newest": {}})
