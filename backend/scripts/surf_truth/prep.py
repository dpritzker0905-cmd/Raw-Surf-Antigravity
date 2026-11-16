"""Prepare the private export for the pre-registered fit: validate, exclude, cell, hold out, count the floor.

Every rule here is the registration's (#989): section and amendment item noted beside each. numpy only.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

SCHEMA = "raw-surf/surf-truth-export/1"
FT = 0.3048
HOLDOUT_THRESHOLD = int(0.2 * 2 ** 256)          # fixed threshold, never a quantile (#989 holdout, research lead)
CELL_HOURS = 3
DAYLIGHT = (6, 18)                                 # local solar hours, [start, end)
SESSION_MINUTES = 30                               # amendment 2 / edit 6: the clustering sensitivity window
BUCKETS_FT = {"Flat": (0.0, 0.5), "1-2ft": (1.0, 2.0), "2-3ft": (2.0, 3.0), "3-4ft": (3.0, 4.0),
              "4-6ft": (4.0, 6.0), "6-8ft": (6.0, 8.0), "8ft+": (8.0, None)}


class NotRunnable(RuntimeError):
    """The registered floor (or a precondition) is not met: report it with the counts and fit nothing."""


def _hash_below(text: str) -> bool:
    return int(hashlib.sha256(text.encode()).hexdigest(), 16) < HOLDOUT_THRESHOLD


def spot_held_out(spot_id: str) -> bool:
    return _hash_below(f"{spot_id}:t1-holdout-v1")


def anchor_cell_held_out(spot_id: str, cell_start_iso: str) -> bool:
    return _hash_below(f"{spot_id}{cell_start_iso}:t1-anchor-holdout-v1")


def physical_held_out(reference_id: str) -> bool:
    return _hash_below(f"{reference_id}:t1-physical-holdout-v1")


def load_export(data_path: str, manifest_path: str) -> tuple[list[dict], dict]:
    """Read one manifested export. An export without its manifest is never read (#990: orphans are ignored)."""
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("schema") != SCHEMA:
        raise NotRunnable(f"unknown export schema {manifest.get('schema')!r}")
    with open(data_path, encoding="utf-8") as fh:
        rows = [json.loads(line) for line in fh if line.strip()]
    if len(rows) != manifest.get("rows"):
        raise NotRunnable(f"export has {len(rows)} rows, manifest says {manifest.get('rows')}")
    return rows, manifest


def same_key(manifests: list[dict]) -> None:
    """#990: exports made under two pseudonym keys never mix (every observer key would differ)."""
    prints = {m.get("key_fingerprint") for m in manifests}
    if len(prints) != 1:
        raise NotRunnable(f"exports under {len(prints)} different keys; re-export everything under one key")


EXCLUDING_FLAGS = {"duplicate_media", "no_parent"}


def exclusion_reason(row: dict) -> Optional[str]:
    """#989 Data section (+ amendment 2 H: flagged-but-not-excluded rows enter with a noise multiplier)."""
    if row.get("flow") != "blind_v1":
        return "flow"
    if row.get("forecast_shown_before") is not False:
        return "forecast_shown_before"
    flags = set(row.get("flags") or [])
    if flags & EXCLUDING_FLAGS:
        return sorted(flags & EXCLUDING_FLAGS)[0]
    if row.get("gps_distance_m") is not None and row["gps_distance_m"] > 2000:
        return "gps_over_2km"
    if row.get("exif_age_s") is not None and abs(row["exif_age_s"]) > 10800:
        return "exif_over_3h"
    if row.get("xp_status") == "audit_failed":
        return "audit_failed"
    return None


def flag_class(row: dict) -> str:
    """Amendment 2 H: clean | unverified_location | range_only (noise multiplier classes)."""
    flags = set(row.get("flags") or [])
    if "gps_missing" in flags or ("media_unverified" in flags and row.get("exif_check") != "ok"):
        return "unverified_location"
    if "range_only" in flags:
        return "range_only"
    return "clean"


def entry_interval_m(row: dict) -> tuple[float, Optional[float]]:
    """The entry as an interval in metres of the DECLARED scale (no scale or set factor applied).
    A typed number is read at the rounding width of its precision AS TYPED (amendment 2 F, edit b)."""
    if row.get("height_bucket"):
        lo, hi = BUCKETS_FT[row["height_bucket"]]
        return lo * FT, (None if hi is None else hi * FT)
    value, unit = float(row["height_value"]), row["height_unit"]
    if value == int(value):
        half = 0.5
    elif abs(value * 2 - round(value * 2)) < 1e-9:
        half = 0.25
    else:
        half = 0.05
    lo, hi = max(value - half, 0.0), value + half
    scale = FT if unit == "ft" else 1.0
    return lo * scale, hi * scale


def entry_point_m(row: dict) -> float:
    """The scoring point (definition appended to #989): a typed value as typed; a range at its geometric centre;
    Flat at 0.25 ft; "8ft+" at its floor, 8 ft. Metres of the declared scale."""
    if row.get("height_bucket"):
        b = row["height_bucket"]
        lo, hi = BUCKETS_FT[b]
        if b == "Flat":
            return 0.25 * FT
        if hi is None:
            return lo * FT
        return math.sqrt(lo * hi) * FT
    return float(row["height_value"]) * (FT if row["height_unit"] == "ft" else 1.0)


def local_solar(received_iso: str, lon: float) -> datetime:
    """Local SOLAR time (UTC + lon/15 h). The export carries no time zone; solar time is what daylight and 3-hour
    cells need, and it is the same rule for every spot. Registered here as the cell clock."""
    utc = datetime.fromisoformat(received_iso)
    return (utc + timedelta(hours=lon / 15.0)).replace(tzinfo=None)


@dataclass
class Cell:
    spot_id: str
    start_iso: str        # local solar start of the 3-hour window
    day: str              # spot-day key
    rows: list = field(default_factory=list)


def cell_key(row: dict) -> Optional[tuple]:
    local = local_solar(row["received_at"], row["spot_lon"])
    if not (DAYLIGHT[0] <= local.hour < DAYLIGHT[1]):
        return None
    start = local.replace(minute=0, second=0, microsecond=0, hour=local.hour - local.hour % CELL_HOURS)
    return row["spot_id"], start.isoformat(), local.date().isoformat()


def independent(a: dict, b: dict) -> bool:
    """#989 floor (edit 6): different account AND different device. Session ids do not exist in the export yet, so
    the same-session clustering is a SENSITIVITY (collapse_sessions), not a rule here."""
    return a["observer_key"] != b["observer_key"] and (a.get("device_key") is None or b.get("device_key") is None
                                                       or a["device_key"] != b["device_key"])


def collapse_sessions(rows: list[dict]) -> list[dict]:
    """Sensitivity (amendment 2 / edit 6): same-spot reports within SESSION_MINUTES of each other count as one
    (the earliest kept)."""
    kept: list[dict] = []
    for r in sorted(rows, key=lambda x: (x["spot_id"], x["received_at"])):
        t = datetime.fromisoformat(r["received_at"])
        if kept and kept[-1]["spot_id"] == r["spot_id"] and \
                t - datetime.fromisoformat(kept[-1]["received_at"]) <= timedelta(minutes=SESSION_MINUTES):
            continue
        kept.append(r)
    return kept


@dataclass
class Prepared:
    fit_rows: list
    holdout_cells: list          # Cell objects whose anchor targets are scored
    excluded: dict
    floor: dict


def is_anchor(row: dict) -> bool:
    return row.get("anchor_status_at_obs") == "active"


def scoreable_targets(cell: Cell) -> list[dict]:
    """Amendment 2 A: an anchor report is a scoreable target only if the cell has >= 1 OTHER independent report."""
    out = []
    for target in cell.rows:
        if is_anchor(target) and any(independent(target, o) for o in cell.rows if o is not target):
            out.append(target)
    return out


def prepare(rows: list[dict], spot_class: dict) -> Prepared:
    """Split into fit rows and scored holdout cells, and count the registered floor per spot class.
    `spot_class` maps spot_id -> B2 class; it must come from the REGISTERED B2 scheme, else NOT RUNNABLE."""
    if not spot_class:
        raise NotRunnable("no B2 spot-class scheme registered (#989: the gate is per class)")
    excluded: dict = defaultdict(int)
    kept = []
    for r in rows:
        reason = exclusion_reason(r)
        if reason:
            excluded[reason] += 1
            continue
        key = cell_key(r)
        if key is None:
            excluded["night"] += 1
            continue
        if r["spot_id"] not in spot_class:
            excluded["no_class"] += 1
            continue
        kept.append((key, r))
    cells: dict = {}
    for key, r in kept:
        cells.setdefault(key, Cell(spot_id=key[0], start_iso=key[1], day=key[2])).rows.append(r)

    fit_rows, holdout_cells = [], []
    for cell in cells.values():
        if spot_held_out(cell.spot_id):
            holdout_cells.append(cell)                       # every report here is unseen by the fit
            continue
        if anchor_cell_held_out(cell.spot_id, cell.start_iso) and scoreable_targets(cell):
            holdout_cells.append(cell)                       # anchor targets scored; the rest still conditions
            fit_rows.extend(r for r in cell.rows if not is_anchor(r))
            continue
        fit_rows.extend(cell.rows)

    floor = floor_counts(cells.values(), holdout_cells, spot_class)
    return Prepared(fit_rows=fit_rows, holdout_cells=holdout_cells, excluded=dict(excluded), floor=floor)


def floor_counts(all_cells, holdout_cells, spot_class: dict) -> dict:
    """#989 floor + amendment 2 A and G: >= 30 SCOREABLE cells per class in BOTH fit and holdout, and >= 3 active
    anchors contributing held-out scoreable reports."""
    held = {id(c) for c in holdout_cells}
    per_class: dict = defaultdict(lambda: {"fit": 0, "holdout": 0})
    anchors = set()
    for c in all_cells:
        targets = scoreable_targets(c)
        if not targets:
            continue
        side = "holdout" if id(c) in held else "fit"
        per_class[spot_class[c.spot_id]][side] += 1
        if side == "holdout":
            anchors.update(t["observer_key"] for t in targets)
    runnable = bool(per_class) and all(v["fit"] >= 30 and v["holdout"] >= 30 for v in per_class.values()) \
        and len(anchors) >= 3
    return {"per_class": dict(per_class), "holdout_anchors": len(anchors), "runnable": runnable}
