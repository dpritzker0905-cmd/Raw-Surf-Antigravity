"""Static forecast frames: one stored product -> a versioned little-endian binary frame (step 2b, 2026-10-20).

Why: the world-view wave field the browser asks the 1-CPU Render box for (`/grid`, about 2.3 MB of JSON per frame,
built on demand) is a stored product that never changes once written. Leading forecast maps publish such frames once
per model run as immutable files on a CDN and let the browser decode them, so the server does no work per view. This
module is the codec: pure functions, no I/O. `scripts/publish_frame_images.py` builds frames from the ingest runner's
local product files and uploads them; `frontend/src/components/map/staticFrameCodec.js` is the decoder's twin.

Layout (all little-endian; the frame is gzipped at publish and uploaded WITHOUT a Content-Encoding header):

  offset  size  field
  0       4     magic b"RSWF"
  4       2     encoding_version (u16) = ENCODING_VERSION: this byte layout
  6       2     transform_version (u16) = TRANSFORM_VERSION: how a product becomes these fields
  8       2     width  = grid cols (u16)
  10      2     height = grid rows (u16)
  12      4     field_mask (u32): bit i set = field id i present (ids below)
  16      1     row_order: 0 = row 0 is the SOUTH edge (the stored product's own order)
  17      1     col_order: 0 = column 0 is the WEST edge
  18      1     field_count
  19      1     uv_convention: how u, v follow from height h and direction d. 0 = u = -h sin d, v = -h cos d
                (the ingest normalizer: direction is where waves come FROM); 1 = u = +h sin d, v = +h cos d
                (the offline harness's synthetic store). The decoder rebuilds u, v this way, as the renderer reads them.
  20      4     header_bytes (u32): where the first plane starts
  24      32    west, south, east, north (f64): the outermost cell CENTRES (the product's grid.bounds)
  56      8     valid_time, epoch seconds (f64)
  64      8     model_run_time, epoch seconds (f64; NaN = unknown)
  72      24*n  one descriptor per field, in field-id order:
                  u8 id, u8 dtype (1 = u8, 2 = u16), u8 layout (0 = plain, 1 = byte-shuffled), u8 reserved,
                  u32 missing code (0xFFFFFFFF = none), f64 scale, f64 offset    value = code * scale + offset
  then one plane per field, width * height codes in row-major order. A byte-shuffled u16 plane stores every low byte
  first and then every high byte (it compresses about 10% better under gzip).

Fields (v1 quantisation, measured on a live world frame 2026-10-20: 55.5 KB gzipped vs 285 KB for the JSON):
  0 height_m        u16  code 0 = no data (is_valid false), else round(height / 1 mm) + 1    error <= 0.5 mm
  1 direction_deg   u16  round(direction / 0.01 deg)                                         exact (source: 2 dp)
  2 period_s        u16  round(period / 0.01 s); 65535 = null                                exact (source: 2 dp)
  3 dir_confidence  u8   round(conf * 254); 255 = null                                       error <= 0.002
The renderer's own texture is coarser than every step above (WebGLMarineTextureEncoder: height in 3.9-6.3 cm bytes,
direction as 8-bit unit-vector components, period in 0.078 s bytes).

Node positions are not stored: lat = south + r * (north - south) / (rows - 1), lng likewise. `encode_frame` refuses a
product whose stored lat/lng are not that regular grid, and `parity` compares every decoded node with its source.
"""
from __future__ import annotations

import gzip
import hashlib
import math
import struct
from datetime import datetime, timezone

MAGIC = b"RSWF"
ENCODING_VERSION = 1
TRANSFORM_VERSION = 1
HEADER_FIXED = 72
DESCRIPTOR = struct.Struct("<BBBBIdd")  # 24 bytes
NO_MISSING = 0xFFFFFFFF
GZIP_MAGIC = b"\x1f\x8b"

HEIGHT, DIRECTION, PERIOD, DIR_CONFIDENCE = 0, 1, 2, 3
FIELD_NAMES = {HEIGHT: "height_m", DIRECTION: "direction_deg", PERIOD: "period_s", DIR_CONFIDENCE: "dir_confidence"}

# (dtype bytes, layout, missing code, scale, offset). Height's offset -scale makes code 1 = 0 m and leaves 0 for no data.
FIELD_SPECS = {
    HEIGHT: (2, 1, 0, 0.001, -0.001),
    DIRECTION: (2, 1, NO_MISSING, 0.01, 0.0),
    PERIOD: (2, 1, 0xFFFF, 0.01, 0.0),
    DIR_CONFIDENCE: (1, 0, 0xFF, 1.0 / 254.0, 0.0),
}
DEFAULT_FIELDS = (HEIGHT, DIRECTION, PERIOD, DIR_CONFIDENCE)

# What the decoded value may differ from the source by, per field (half a step, plus float slack).
TOLERANCE = {HEIGHT: 0.0005 + 1e-9, DIRECTION: 0.005 + 1e-9, PERIOD: 0.005 + 1e-9, DIR_CONFIDENCE: 0.5 / 254 + 1e-9}
POSITION_TOL_DEG = 1e-6
UV_TOL = 0.0012  # u, v rebuilt from the decoded height and direction: 1 mm height step plus 4-dp rounding


def _grid_of(product):
    grid = product.get("grid") or {}
    cols, rows = int(grid.get("cols") or 0), int(grid.get("rows") or 0)
    vectors = grid.get("vectors") or []
    bounds = grid.get("bounds") or {}
    if cols < 2 or rows < 2 or len(vectors) != cols * rows:
        raise ValueError(f"grid shape mismatch: cols={cols} rows={rows} vectors={len(vectors)}")
    if cols > 0xFFFF or rows > 0xFFFF:
        raise ValueError(f"grid too large for a v1 frame: {cols}x{rows}")
    try:
        b = tuple(float(bounds[k]) for k in ("west", "south", "east", "north"))
    except (KeyError, TypeError, ValueError):
        raise ValueError(f"grid bounds missing or malformed: {bounds!r}")
    return cols, rows, vectors, b


def node_position(r, c, cols, rows, bounds):
    west, south, east, north = bounds
    return south + r * (north - south) / (rows - 1), west + c * (east - west) / (cols - 1)


def check_regular(product):
    """Raise ValueError unless every vector sits on the regular grid its bounds and shape imply (row 0 = south)."""
    cols, rows, vectors, bounds = _grid_of(product)
    for r in range(rows):
        for c in range(cols):
            vec = vectors[r * cols + c]
            lat, lng = node_position(r, c, cols, rows, bounds)
            if abs(float(vec["lat"]) - lat) > POSITION_TOL_DEG or abs(float(vec["lng"]) - lng) > POSITION_TOL_DEG:
                raise ValueError(f"vector {r * cols + c} at ({vec['lat']}, {vec['lng']}) is off the regular grid "
                                 f"({lat}, {lng}); a v1 frame cannot carry it")


def _finite(x):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _valid(vec):
    """A node is data when the product says so AND it carries a usable height (the same rule as frame_image)."""
    h = _finite(vec.get("speed"))
    return bool(vec.get("is_valid", True)) and h is not None and h >= 0


def field_code(fid, vec):
    """The integer code one vector stores for one field."""
    _nb, _layout, missing, scale, offset = FIELD_SPECS[fid]
    if fid == HEIGHT:
        if not _valid(vec):
            return 0
        return min(0xFFFF, int(round(float(vec["speed"]) / scale)) + 1)
    if fid == DIRECTION:
        d = _finite(vec.get("direction"))
        return int(round((d % 360.0) / scale)) % 36000 if d is not None else 0
    if fid == PERIOD:
        p = _finite(vec.get("period"))
        return missing if p is None else max(0, min(0xFFFE, int(round(p / scale))))
    if fid == DIR_CONFIDENCE:
        c = _finite(vec.get("dir_confidence"))
        return missing if c is None else max(0, min(254, int(round(c / scale))))
    raise ValueError(f"unknown field id {fid}")


def _epoch(ts):
    if not ts:
        return float("nan")
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return float("nan")


def uv_convention(vectors):
    """0 when stored u, v read u = -h sin d (production), 1 when u = +h sin d; decided by the first node that
    carries a usable, non-zero u/v and height. parity() then checks EVERY node against the convention chosen."""
    for vec in vectors:
        h, d = _finite(vec.get("speed")), _finite(vec.get("direction"))
        u, v = _finite(vec.get("u")), _finite(vec.get("v"))
        if not _valid(vec) or not h or d is None or u is None or v is None or (abs(u) < 1e-3 and abs(v) < 1e-3):
            continue
        rad = math.radians(d)
        minus = abs(u + h * math.sin(rad)) + abs(v + h * math.cos(rad))
        plus = abs(u - h * math.sin(rad)) + abs(v - h * math.cos(rad))
        return 1 if plus < minus else 0
    return 0


def _plane_bytes(codes, nbytes, layout):
    if nbytes == 1:
        return bytes(codes)
    raw = struct.pack(f"<{len(codes)}H", *codes)
    return raw[0::2] + raw[1::2] if layout == 1 else raw


def encode_frame(product, fields=DEFAULT_FIELDS):
    """Raw (uncompressed) frame bytes for one stored product dict. Raises ValueError on an unencodable grid."""
    check_regular(product)
    cols, rows, vectors, bounds = _grid_of(product)
    fields = tuple(sorted(set(fields)))
    mask = 0
    for fid in fields:
        mask |= 1 << fid
    header_bytes = HEADER_FIXED + DESCRIPTOR.size * len(fields)
    head = bytearray(MAGIC)
    head += struct.pack("<HHHHIBBBBI", ENCODING_VERSION, TRANSFORM_VERSION, cols, rows, mask, 0, 0, len(fields),
                        uv_convention(vectors), header_bytes)
    head += struct.pack("<4d", *bounds)
    head += struct.pack("<2d", _epoch(product.get("valid_time")), _epoch(product.get("model_run_time")))
    planes = []
    for fid in fields:
        nb, layout, missing, scale, offset = FIELD_SPECS[fid]
        head += DESCRIPTOR.pack(fid, nb, layout, 0, missing, scale, offset)
        planes.append(_plane_bytes([field_code(fid, v) for v in vectors], nb, layout))
    assert len(head) == header_bytes
    return bytes(head) + b"".join(planes)


def gzip_frame(raw):
    """Deterministic gzip (mtime 0), so an unchanged frame always has the same bytes."""
    return gzip.compress(raw, compresslevel=9, mtime=0)


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def decode_frame(data):
    """Inverse of encode_frame (gzip accepted). Returns {header..., 'fields': {id: [value or None, ...]}}."""
    if data[:2] == GZIP_MAGIC:
        data = gzip.decompress(data)
    if data[:4] != MAGIC:
        raise ValueError("not a frame: bad magic")
    enc, tfm, cols, rows, mask, row_order, col_order, nfields, uv_conv, header_bytes = struct.unpack_from("<HHHHIBBBBI", data, 4)
    if enc != ENCODING_VERSION:
        raise ValueError(f"unsupported encoding_version {enc}")
    west, south, east, north = struct.unpack_from("<4d", data, 24)
    valid_epoch, run_epoch = struct.unpack_from("<2d", data, 56)
    n = cols * rows
    out = {"encoding_version": enc, "transform_version": tfm, "cols": cols, "rows": rows, "field_mask": mask,
           "row_order": row_order, "col_order": col_order, "uv_convention": uv_conv, "bounds": (west, south, east, north),
           "valid_epoch": valid_epoch, "run_epoch": run_epoch, "fields": {}}
    pos = header_bytes
    for i in range(nfields):
        fid, nb, layout, _rsv, missing, scale, offset = DESCRIPTOR.unpack_from(data, HEADER_FIXED + i * DESCRIPTOR.size)
        size = n * nb
        plane = data[pos:pos + size]
        if len(plane) != size:
            raise ValueError(f"truncated frame: field {fid} needs {size} bytes, has {len(plane)}")
        pos += size
        if nb == 1:
            codes = list(plane)
        elif layout == 1:
            codes = [plane[k] | (plane[n + k] << 8) for k in range(n)]
        else:
            codes = list(struct.unpack(f"<{n}H", plane))
        out["fields"][fid] = [None if (missing != NO_MISSING and c == missing) else c * scale + offset for c in codes]
    return out


def parity(product, decoded):
    """Compare a decoded frame with its source product, node by node.

    Returns {nodes, bad, missing_mismatch, max_abs_err: {field: err}, uv_max_err}. A node is bad when validity differs,
    a field differs by more than its TOLERANCE, or u/v rebuilt from the decoded height and direction (the client does
    the same) differ from the stored u/v by more than UV_TOL. Positions were checked by encode_frame (check_regular).
    """
    cols, rows, vectors, _bounds = _grid_of(product)
    if (decoded["cols"], decoded["rows"]) != (cols, rows):
        return {"nodes": cols * rows, "bad": cols * rows, "missing_mismatch": 0, "max_abs_err": {}, "uv_max_err": None,
                "shape": "mismatch"}
    f = decoded["fields"]
    bad = missing_mismatch = 0
    errs = {FIELD_NAMES[k]: 0.0 for k in f}
    uv_err = 0.0
    for i, vec in enumerate(vectors):
        node_bad = False
        valid = _valid(vec)
        got_h = f[HEIGHT][i] if HEIGHT in f else None
        if valid != (got_h is not None):
            missing_mismatch += 1
            bad += 1
            continue
        for fid, values in f.items():
            got = values[i]
            if fid == HEIGHT:
                want = float(vec["speed"]) if valid else None
            elif fid == DIRECTION:
                want = (_finite(vec.get("direction")) or 0.0) % 360.0
                if got is not None and want is not None:
                    d = abs(got - want) % 360.0
                    err = min(d, 360.0 - d)
                    errs[FIELD_NAMES[fid]] = max(errs[FIELD_NAMES[fid]], err)
                    node_bad |= err > TOLERANCE[fid]
                    continue
            elif fid == PERIOD:
                want = _finite(vec.get("period"))
            else:
                want = _finite(vec.get("dir_confidence"))
            if (want is None) != (got is None):
                node_bad = True
                continue
            if want is not None:
                err = abs(got - want)
                errs[FIELD_NAMES[fid]] = max(errs[FIELD_NAMES[fid]], err)
                node_bad |= err > TOLERANCE[fid]
        if valid and HEIGHT in f and DIRECTION in f:
            rad = math.radians(f[DIRECTION][i])
            sign = 1.0 if decoded.get("uv_convention") == 1 else -1.0
            u, v = round(sign * f[HEIGHT][i] * math.sin(rad), 4), round(sign * f[HEIGHT][i] * math.cos(rad), 4)
            su, sv = _finite(vec.get("u")) or 0.0, _finite(vec.get("v")) or 0.0
            if su or sv:  # stored 0/0 means "derive from direction", which the renderer does the same way
                e = max(abs(u - su), abs(v - sv))
                uv_err = max(uv_err, e)
                node_bad |= e > UV_TOL
        bad += node_bad
    return {"nodes": len(vectors), "bad": bad, "missing_mismatch": missing_mismatch,
            "max_abs_err": {k: round(v, 6) for k, v in errs.items()}, "uv_max_err": round(uv_err, 6)}
