"""The ONE frozen buoy list (gate served-wave-verify-v1 sections 0.1, 2a and 3). PURE.

The list file is `docs/weather-program/gates/served-wave-verify-v1-buoys.json`; `buoy_list_hash` = SHA-256 of its canonical
JSON (core.canon of the parsed file), and every record carries it with `buoy_list_version`. A change is a new version.

Regional box rule (section 2a): per (model, set), a buoy's box is the regional box whose bounds contain it; if several do, the
one where the buoy lies farthest from the box edge (km: the shortest distance to any of the four edges, longitude scaled by
cos(lat)); ties go to the lexically smallest region_id. A buoy in no box has Tier A only (`no_regional_tier`).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from services.point_archive import core

REPO_ROOT = Path(__file__).resolve().parents[3]
LIST_PATH = REPO_ROOT / "docs" / "weather-program" / "gates" / "served-wave-verify-v1-buoys.json"
KM_PER_DEG = 111.32
REQUIRED = ("id", "wmo_id", "lat", "lon", "depth_m", "region", "sheltered", "source", "exam_only", "purposes", "stratum")


def load(path=LIST_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def list_hash(doc):
    return core.sha256_hex(core.canon(doc).encode("utf-8"))


def stations(doc, purpose="served"):
    return [s for s in doc["stations"] if purpose in s["purposes"]]


def validate(doc):
    """[] when the list obeys the gate's structural rules; else the problems."""
    problems, ids, wmos = [], set(), set()
    for s in doc.get("stations", []):
        miss = [k for k in REQUIRED if k not in s]
        if miss:
            problems.append(f"{s.get('id')}: missing {miss}")
            continue
        if s["id"] in ids:
            problems.append(f"{s['id']}: duplicate id")
        if s["wmo_id"] in wmos:
            problems.append(f"{s['id']}: duplicate WMO id {s['wmo_id']}")
        ids.add(s["id"])
        wmos.add(s["wmo_id"])
        if s["source"] == "cdip" and not s["exam_only"]:
            problems.append(f"{s['id']}: CDIP must be exam_only")
        if s["source"] not in ("ndbc", "cdip"):
            problems.append(f"{s['id']}: source {s['source']!r}")
        if s["depth_m"] is None or (s["depth_m"] < 20 and s["stratum"] != "nearshore"):
            problems.append(f"{s['id']}: depth {s['depth_m']} < 20 m outside the nearshore stratum")
        if not set(s["purposes"]) <= set(core.PURPOSES) or "served" not in s["purposes"]:
            problems.append(f"{s['id']}: purposes {s['purposes']}")
        if not (-90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180):
            problems.append(f"{s['id']}: position")
    return problems


def _edge_km(lat, lon, b):
    c = math.cos(math.radians(lat))
    return min((lat - b["south"]) * KM_PER_DEG, (b["north"] - lat) * KM_PER_DEG,
               (lon - b["west"]) * KM_PER_DEG * c, (b["east"] - lon) * KM_PER_DEG * c)


def contains(b, lat, lon):
    return b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]


def pick_box(lat, lon, boxes):
    """region_id of the box for one buoy among boxes {region_id: bounds dict}, or None."""
    inside = [(-_edge_km(lat, lon, b), rid) for rid, b in boxes.items() if contains(b, lat, lon)]
    return min(inside)[1] if inside else None


def assign_boxes(station_rows, boxes_by_set):
    """{station_id: {"<MODEL>/<layer>": region_id}} for boxes_by_set {"<MODEL>/<layer>": {region_id: bounds}}; a set with
    no containing box is left out of a station's map."""
    out = {}
    for s in station_rows:
        m = {}
        for set_key, boxes in sorted(boxes_by_set.items()):
            rid = pick_box(float(s["lat"]), float(s["lon"]), boxes)
            if rid:
                m[set_key] = rid
        out[s["id"]] = m
    return out
