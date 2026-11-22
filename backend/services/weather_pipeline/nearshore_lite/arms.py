"""The test arms at a buoy (CHAIN_SERVED, CHAIN_PART, LITE, OFFSHORE), each fed from ONE accessor.

`partition_inputs(row)` is the only place LITE and CHAIN_PART read their partitions; `total_input(row)` feeds CHAIN_SERVED. `input_hash` lets a test (and the scorer) assert the two
arms received byte-identical inputs. Both arms score the SAME form (advisor A2): per partition Hs x refraction x chain shoaling to
the buoy depth, quadrature sum, NO breaking cap.
"""
import hashlib
import json
import math

from .coefficients import lite_buoy_hs


def partition_inputs(row):
    """The row's partitions as plain canonical dicts, or [] when none. The single read point for BOTH arms."""
    out = []
    for p in row.get("partitions") or []:
        if isinstance(p, dict):
            out.append({"h": p.get("h"), "tp": p.get("tp"), "dir": p.get("dir"), "kind": p.get("kind")})
    return out


def total_input(row):
    """The TOTAL-field train production rates today, from the archived `total` (a single swell-kind train), or []."""
    t = row.get("total")
    if not isinstance(t, dict) or not t.get("h") or not t.get("tp"):
        return []
    return [{"h": t["h"], "tp": t["tp"], "dir": t.get("dir"), "kind": "swell"}]


def input_hash(parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def chain_buoy_hs(parts, buoy_depth_m, shore_normal_deg=None):
    """Today's chain constants at a buoy. Per partition Hs x Ks(Tp, depth) x exposure x REFRACTION_KR, quadrature, no cap."""
    from services.weather_pipeline import surf_transform as st
    e = 0.0
    for p in parts:
        if not p["h"] or not p["tp"] or p["h"] <= 0 or p["tp"] <= 0:
            continue
        h = float(p["h"]) * st.shoaling_coefficient(p["tp"], buoy_depth_m) * st._height_exposure_factor(p["dir"], shore_normal_deg)
        e += (h * st.REFRACTION_KR) ** 2
    return math.sqrt(e) if e > 0 else None


def arms_at_buoy(row, table, buoy_depth_m, shore_normal_deg=None, spy=None):
    """The arms (advisor ruling, pre-data amendment to #1148 section 3):
      CHAIN_SERVED  GATED comparator: today's chain on the TOTAL field, as production serves it, no cap at the buoy depth;
      CHAIN_PART    REPORTED: the registered partitioned chain, to separate the partition effect from the refraction effect;
      LITE          the ray-traced factor on the SAME partitions as CHAIN_PART (partitions where they resolve, else the total train);
      OFFSHORE      the boundary partitions summed.
    LITE and CHAIN_PART read `partition_inputs(row)` ONCE, here, and get the same object; CHAIN_SERVED reads `total_input(row)`.
    `spy(parts)` lets a test see the partition object."""
    from services.weather_pipeline import surf_transform as st
    parts = partition_inputs(row)
    total = total_input(row)
    if spy is not None:
        spy(parts)
    off = math.sqrt(sum(float(p["h"]) ** 2 for p in parts if p["h"] and p["h"] > 0)) if parts else None
    return {"CHAIN_SERVED": chain_buoy_hs(total, buoy_depth_m, shore_normal_deg),
            "CHAIN_PART": chain_buoy_hs(parts, buoy_depth_m, shore_normal_deg),
            "LITE": lite_buoy_hs(table, parts, buoy_depth_m, st.shoaling_coefficient),
            "OFFSHORE": off, "input_hash": input_hash(parts), "total_hash": input_hash(total)}
