"""ICON swell_2 as a STORED derived product (2026-11-13, move 3, owner decision "Go with B for swell_2").

WHY. ICON/GWAM has no native secondary swell. Since D-003 the map has shown ICON swell_2 as a 60 % GFS + 40 % EURO blend, computed
in the BROWSER on every step (frontend `iconSwell2Blend.js`), so every ICON swell_2 step paid 110-150 ms of blend before the draw and
no server surface (/grid, the frame publisher) could serve it. This module computes the same blend ONCE, server side, so the ingest
can store it as a product like any other and every surface reads one answer.

PARITY. This is a line-by-line port of `blendIconSwell2` (iconSwell2Blend.js) and `blendSubVector` / `blendDirection` /
`blendPeriod` (marineDirectionBlend.js). The canonical input is the WORLD global_mid pair (GFS and EURO on the same lattice), where the
browser blend reduces to a per-node blend. Floats: Python's libm and V8's may differ in the last bit of sin/cos/atan2, so parity is
judged on the encoded frame bytes plus a tight float tolerance (tests/test_icon_swell2_blend.py and
frontend/scripts/icon-swell2-parity.mjs), never on raw doubles. Values are stored unrounded, as the browser keeps them.
"""
import math
import sys

GFS_WEIGHT_BOTH = 0.6
ICON_SWELL2_BLEND_MAX_HOUR = 240   # beyond 240 h the ICON extended path owns it (iconSwell2Blend.ICON_SWELL2_BLEND_MAX_HOUR)
_MIN_RESULTANT = math.sqrt(sys.float_info.epsilon)   # Math.sqrt(Number.EPSILON)


def _finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _valid_height(h):
    return _finite(h) and h >= 0


def _bearing(d):
    if not _finite(d):
        return None
    return math.fmod(math.fmod(d, 360.0) + 360.0, 360.0)   # JS ((d % 360) + 360) % 360: % is fmod for doubles


def _masked(v):
    return (not v) or v.get("isOcean") is False or v.get("is_valid") is False


def blend_direction(heights, directions, weights):
    sum_u = sum_v = amplitude = 0.0
    calm_direction = None
    for h, d0, w in zip(heights, directions, weights):
        d = _bearing(d0)
        if not _finite(w):
            return None
        if w <= 0:
            continue
        if not _valid_height(h):
            return None
        if calm_direction is None and d is not None:
            calm_direction = d
        if h == 0:
            continue
        if d is None:
            return None
        a = h * w
        radians = d * math.pi / 180
        sum_u -= a * math.sin(radians)
        sum_v -= a * math.cos(radians)
        amplitude += a
    if amplitude == 0:
        return calm_direction
    if (not math.isfinite(amplitude) or not math.isfinite(sum_u) or not math.isfinite(sum_v)
            or math.hypot(sum_u, sum_v) / amplitude <= _MIN_RESULTANT):
        return None
    return _bearing(math.atan2(-sum_u, -sum_v) * 180 / math.pi)


def blend_period(periods, weights):
    total = weight_sum = 0.0
    for p, w in zip(periods, weights):
        if _finite(p) and p > 0 and _finite(w) and w > 0:
            total += p * w
            weight_sum += w
    return total / weight_sum if weight_sum > 0 else None


def unavailable_vector():
    return {"u": 0, "v": 0, "speed": 0, "height": 0, "period": 0, "direction": None, "isOcean": False, "is_valid": False}


def _vector_direction(v):
    speed = v.get("speed") or 0
    u, vv = v.get("u"), v.get("v")
    if speed > 0 and ("u" in v or "v" in v) and (
            not _finite(u) or not _finite(vv) or math.hypot(u, vv) / speed <= _MIN_RESULTANT):
        return None
    if "direction" in v:
        return _bearing(v.get("direction"))
    if not _finite(u) or not _finite(vv):
        return None
    return _bearing(math.atan2(-u, -vv) * 180 / math.pi)


def _resolved_vector(height, direction, period):
    if not _valid_height(height) or (height > 0 and direction is None):
        return unavailable_vector()
    d = 0 if direction is None else direction
    radians = d * math.pi / 180
    return {"u": -height * math.sin(radians) if height > 0 else 0, "v": -height * math.cos(radians) if height > 0 else 0,
            "speed": height, "height": height, "period": period, "direction": d, "isOcean": True, "is_valid": True}


def blend_sub_vector(v1, v2, w1, w2):
    a = None if _masked(v1) else v1
    b = None if _masked(v2) else v2
    if not a and not b:
        return unavailable_vector()
    if not a or not b:
        v = a or b
        return _resolved_vector(v.get("speed"), _vector_direction(v), v.get("period") or 0)
    height = (a["speed"] * w1 if w1 > 0 else 0) + (b["speed"] * w2 if w2 > 0 else 0)
    direction = blend_direction([a["speed"], b["speed"]], [_vector_direction(a), _vector_direction(b)], [w1, w2])
    return _resolved_vector(height, direction, blend_period([a.get("period"), b.get("period")], [w1, w2]) or 0)


def _skey(lat, lng):
    # JS Math.round is round-half-up (toward +inf); Python round() is banker's rounding. floor(x + 0.5) matches JS.
    return f"{math.floor(lat * 2 + 0.5)},{math.floor(lng * 2 + 0.5)}"


def blend_vectors(gfs_vectors, euro_vectors):
    """The blended vectors and the weights, as blendIconSwell2 computes them. Returns (vectors, gfs_w, euro_w) or None when the
    anchor grid is empty (the browser's `unsupported`)."""
    gfs_vectors = gfs_vectors or []
    euro_vectors = euro_vectors or []
    gfs_primary = len(gfs_vectors) >= len(euro_vectors)
    primary = gfs_vectors if gfs_primary else euro_vectors
    secondary = euro_vectors if gfs_primary else gfs_vectors
    if not primary:
        return None
    lookup = None
    if secondary:
        lookup = {}
        for sv in secondary:
            key = _skey(sv["lat"], sv["lng"])
            ex = lookup.get(key)
            if ex is None or (sv.get("speed") or 0) > (ex.get("speed") or 0):
                lookup[key] = sv
    both = bool(gfs_vectors) and bool(euro_vectors)
    gfs_w = GFS_WEIGHT_BOTH if both else (1.0 if gfs_vectors else 0.0)
    euro_w = 1.0 - gfs_w
    primary_w = gfs_w if gfs_primary else euro_w
    secondary_w = euro_w if gfs_primary else gfs_w
    out = []
    for pv in primary:
        sv = lookup.get(_skey(pv["lat"], pv["lng"])) if lookup is not None else None
        p_avail = pv.get("isOcean") is not False and pv.get("is_valid") is not False
        s_avail = bool(sv) and sv.get("isOcean") is not False and sv.get("is_valid") is not False
        if p_avail and s_avail and (pv.get("speed") or 0) > 0 and (sv.get("speed") or 0) > 0:
            blended = blend_sub_vector(pv, sv, primary_w, secondary_w)
        else:
            src = sv if (s_avail and (sv.get("speed") or 0) > 0) else (pv if p_avail else None)
            blended = blend_sub_vector(src, None, 1, 0)
        out.append({"lat": pv["lat"], "lng": pv["lng"], **blended})
    return out, gfs_w, euro_w
