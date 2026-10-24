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

WIND frames (2026-10-22, the GFS wind world set; frame_set_wind.py) carry fields 1, 4 and, when the HRRR lane touched the
frame, 5. Height's 1 mm u16 tops out at 65.5, and 10 m wind in knots goes past that:
  4 speed           u16  code 0 = no data (is_valid false), else round(speed / 0.01 kn) + 1   error <= 0.005 kn
  5 lane_weight     u16  code 0 = the HRRR lane did not touch the node, else max(1, round(w * 10000)): the lane's weight
                         (wind_lane._blend `use`), so a crop of the frame rebuilds the /grid lane stamp of the crop
u, v follow from speed and direction by uv_convention 0, as the wind normalizer computes them. The wind texture
(WebGLWindUtils.encodeWindTexture) quantises u, v and speed into 8-bit bytes over the frame's range (0.3-0.5 kn a step).

RASTER frames (2026-10-23, frame_set_raster.py: GFS mean-sea-level pressure from NOAA GRIB) carry ONE scalar field and are
encoded from a numpy plane (encode_plane / decode_plane), not from product vectors:
  6 pressure_hpa    u16  code 0 = no data, else round((hPa - 800) / 0.1) + 1 (descriptor offset 799.9)   error <= 0.05 hPa

Node positions are not stored: lat = south + r * (north - south) / (rows - 1), lng likewise, where the bounds are the
OUTER CELL CENTRES (cell_bounds; what /grid serves). `encode_frame` refuses a product whose lat/lng are not that regular
grid, and `parity` compares every decoded node with its source.
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

HEIGHT, DIRECTION, PERIOD, DIR_CONFIDENCE, SPEED, LANE_WEIGHT, PRESSURE_HPA = 0, 1, 2, 3, 4, 5, 6
FIELD_NAMES = {HEIGHT: "height_m", DIRECTION: "direction_deg", PERIOD: "period_s", DIR_CONFIDENCE: "dir_confidence",
               SPEED: "speed", LANE_WEIGHT: "lane_weight", PRESSURE_HPA: "pressure_hpa"}

# (dtype bytes, layout, missing code, scale, offset). Height's offset -scale makes code 1 = 0 m and leaves 0 for no data;
# speed (knots, the wind products' unit; the index meta carries value_unit) does the same at 0.01.
FIELD_SPECS = {
    HEIGHT: (2, 1, 0, 0.001, -0.001),
    DIRECTION: (2, 1, NO_MISSING, 0.01, 0.0),
    PERIOD: (2, 1, 0xFFFF, 0.01, 0.0),
    DIR_CONFIDENCE: (1, 0, 0xFF, 1.0 / 254.0, 0.0),
    SPEED: (2, 1, 0, 0.01, -0.01),
    LANE_WEIGHT: (2, 1, NO_MISSING, 0.0001, 0.0),
    PRESSURE_HPA: (2, 1, 0, 0.1, 799.9),      # raster frames (frame_set_raster.py): code 1 = 800.0 hPa, 0 = no data
}
DEFAULT_FIELDS = (HEIGHT, DIRECTION, PERIOD, DIR_CONFIDENCE)
WIND_FIELDS = (DIRECTION, SPEED)

FLOAT_SLACK = 1e-9


def _half_step(fid):
    """Half of a field's encoding step, plus float slack: the most round(value / step) can move a value. PURE."""
    return FIELD_SPECS[fid][3] / 2.0 + FLOAT_SLACK


# What the decoded value may differ from the source by, per field: each is HALF ITS OWN ENCODING STEP (FIELD_SPECS
# scale), never a guess (test_frame_parity_tolerance.py pins every one to its step). The one exception is the HRRR lane
# weight, a whole step: max(1, round(w * 10000)) lifts a touched node's code to at least 1.
TOLERANCE = {
    HEIGHT: _half_step(HEIGHT),                  # 1 mm step       -> 0.0005 m
    DIRECTION: _half_step(DIRECTION),            # 0.01 deg step   -> 0.005 deg
    PERIOD: _half_step(PERIOD),                  # 0.01 s step     -> 0.005 s
    DIR_CONFIDENCE: _half_step(DIR_CONFIDENCE),  # 1/254 step      -> 0.0019685 (measured max 0.0019685 over 400k nodes)
    SPEED: _half_step(SPEED),                    # 0.01 kn step    -> 0.005 kn
    LANE_WEIGHT: FIELD_SPECS[LANE_WEIGHT][3] + FLOAT_SLACK,
    PRESSURE_HPA: _half_step(PRESSURE_HPA),      # 0.1 hPa step    -> 0.05 hPa
}
POSITION_TOL_DEG = 1e-6
# Marine u, v rebuilt from the decoded height and direction, against the stored u, v the normalizer computed from the
# UNROUNDED height and direction (normalizer.py: speed 4 dp, direction 2 dp, u and v 4 dp). Per node the error is at most
#   height     half the 1 mm step + the stored speed's 4-dp rounding     0.0005 + 0.00005
#   rounding   the rebuilt and the stored u/v, 4 dp each                  2 * 0.00005
#   direction  half the 0.01-deg step turns (u, v) by that angle          h * radians(0.005)
# ⬇ 2026-10-23: this was a FIXED 0.0012, which dropped the height term. Measured with the real codec over 400,000 nodes
#   (heights 0-20 m, the normalizer's rounding): the error crosses 0.0012 at 10-12 m seas and stays under this bound at
#   every height. The pilots publish of run 40019869501 refused 5 ICON world frames on it (uv 0.0012-0.0016, one node
#   each, big seas), which went unpublished; their dir_confidence (0.001967) was inside its own tolerance.
MARINE_UV_TOL_BASE = 0.0005 + 0.00005 + 2 * 0.00005 + 1e-6
MARINE_UV_TOL_PER_M = math.radians(0.005) + FLOAT_SLACK
# The old fixed tolerance stays as a FLOOR: this change only stops wrongful refusals. Below about 6 m the derived bound is
# tighter than 0.0012, and a stored product whose u/v come from somewhere this budget does not model (a blend) would
# start being refused; only refused frames log their u/v error, so that cannot be measured from a publish log today.
MARINE_UV_TOL_FLOOR = 0.0012 + FLOAT_SLACK   # with float slack, like every tolerance: a 4-dp difference of exactly
#                                             0.0012 can be 0.0012000000000000001 in binary (run 40019869501's first
#                                             refused ICON frame printed uv_max_err 0.0012)
WHY_MAX = 3   # parity() names the failing check for this many bad nodes
# Wind: u, v rebuilt from the 0.01 kn speed and the 2-dp direction, against stored u, v that the normalizer computed from the
# UNROUNDED speed and direction (and rounded to 4 dp): 0.005 kn + 0.005 deg of the speed + both 4-dp roundings, with slack.
WIND_UV_TOL_BASE = 0.006
WIND_UV_TOL_PER_KN = 0.0001


def uv_tolerance(mag, magnitude):
    """How far u, v rebuilt from one decoded node may differ from the stored u, v: marine by height, wind by speed. PURE."""
    if mag == HEIGHT:
        return max(MARINE_UV_TOL_FLOOR, MARINE_UV_TOL_BASE + MARINE_UV_TOL_PER_M * abs(magnitude))
    return WIND_UV_TOL_BASE + WIND_UV_TOL_PER_KN * abs(magnitude)


def magnitude_field(field_ids):
    """The field that carries the vector's magnitude and validity: height (marine) or speed (wind)."""
    return SPEED if SPEED in field_ids else HEIGHT


def _grid_of(product):
    grid = product.get("grid") or {}
    cols, rows = int(grid.get("cols") or 0), int(grid.get("rows") or 0)
    vectors = grid.get("vectors") or []
    if cols < 2 or rows < 2 or len(vectors) != cols * rows:
        raise ValueError(f"grid shape mismatch: cols={cols} rows={rows} vectors={len(vectors)}")
    if cols > 0xFFFF or rows > 0xFFFF:
        raise ValueError(f"grid too large for a v1 frame: {cols}x{rows}")
    return cols, rows, vectors, cell_bounds(vectors)


def cell_bounds(vectors):
    """(west, south, east, north) of the OUTER CELL CENTRES. Not grid.bounds: a STORED product carries the request box
    there (the live global_mid: north 85 while its last row sits at 84; every frame of the first live publish was refused
    for it, runs 39670557729 / 39688997158), and /grid serves bounds recomputed from the cells (filter_grid_to_bbox)."""
    try:
        lats = [float(v["lat"]) for v in vectors]
        lngs = [float(v["lng"]) for v in vectors]
    except (KeyError, TypeError, ValueError):
        raise ValueError("vector lat/lng missing or malformed")
    return min(lngs), min(lats), max(lngs), max(lats)


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
    if fid in (HEIGHT, SPEED):
        if not _valid(vec):
            return 0
        return min(0xFFFF, int(round(float(vec["speed"]) / scale)) + 1)
    if fid == LANE_WEIGHT:
        w = _finite(vec.get("_lane_w"))    # set by frame_set_wind on the vectors it encodes (the lane's weight; None = untouched)
        return 0 if not w or w <= 0 else max(1, min(0xFFFE, int(round(w / scale))))
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



def encode_plane(values, bounds, valid_time, model_run_time, fid):
    """Raw frame bytes for ONE scalar field from a (rows, cols) float array, row 0 = SOUTH, column 0 = WEST, NaN = no data;
    `bounds` = (west, south, east, north), the outer cell centres. The same layout encode_frame writes (header, one
    descriptor, one plane), vectorised: a 720 x 361 raster encodes in milliseconds instead of a per-node loop."""
    import numpy as np
    arr = np.asarray(values, dtype=float)
    rows, cols = arr.shape
    nb, layout, missing, scale, offset = FIELD_SPECS[fid]
    if nb != 2 or missing != 0:
        raise ValueError(f"encode_plane handles u16 fields with code 0 = no data, not field {fid}")
    ok = np.isfinite(arr)
    codes = np.zeros(arr.shape, dtype=np.int64)
    codes[ok] = np.rint((arr[ok] - offset) / scale).astype(np.int64)
    if ok.any() and (codes[ok].min() < 1 or codes[ok].max() > 0xFFFF):
        raise ValueError(f"field {fid}: values outside the u16 range of its quantisation")
    header_bytes = HEADER_FIXED + DESCRIPTOR.size
    head = bytearray(MAGIC)
    head += struct.pack("<HHHHIBBBBI", ENCODING_VERSION, TRANSFORM_VERSION, cols, rows, 1 << fid, 0, 0, 1, 0, header_bytes)
    head += struct.pack("<4d", *bounds)
    head += struct.pack("<2d", _epoch(valid_time), _epoch(model_run_time))
    head += DESCRIPTOR.pack(fid, nb, layout, 0, missing, scale, offset)
    raw = codes.astype("<u2").tobytes()
    plane = raw[0::2] + raw[1::2] if layout == 1 else raw
    return bytes(head) + plane


def decode_plane(data):
    """(header dict, {field id: (rows, cols) float array, NaN = no data}) for a frame; vectorised twin of decode_frame."""
    import numpy as np
    if data[:2] == GZIP_MAGIC:
        data = gzip.decompress(data)
    if data[:4] != MAGIC:
        raise ValueError("not a frame: bad magic")
    enc, _tfm, cols, rows, _mask, _ro, _co, nfields, _uv, header_bytes = struct.unpack_from("<HHHHIBBBBI", data, 4)
    if enc != ENCODING_VERSION:
        raise ValueError(f"unsupported encoding_version {enc}")
    head = {"cols": cols, "rows": rows, "bounds": struct.unpack_from("<4d", data, 24),
            "valid_epoch": struct.unpack_from("<d", data, 56)[0], "run_epoch": struct.unpack_from("<d", data, 64)[0]}
    out, pos, n = {}, header_bytes, cols * rows
    for i in range(nfields):
        fid, nb, layout, _rsv, missing, scale, offset = DESCRIPTOR.unpack_from(data, HEADER_FIXED + i * DESCRIPTOR.size)
        plane = np.frombuffer(data, dtype=np.uint8, count=n * nb, offset=pos)
        if len(plane) != n * nb:
            raise ValueError(f"truncated frame: field {fid}")
        pos += n * nb
        if nb == 1:
            codes = plane.astype(np.int64)
        elif layout == 1:
            codes = plane[:n].astype(np.int64) | (plane[n:].astype(np.int64) << 8)
        else:
            codes = plane.view("<u2").astype(np.int64)
        vals = codes * scale + offset
        if missing != NO_MISSING:
            vals = np.where(codes == missing, np.nan, vals)
        out[fid] = vals.reshape(rows, cols)
    return head, out


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
    the same) differ from the stored u/v by more than uv_tolerance (marine: by height; wind: by speed). Positions were
    checked by encode_frame (check_regular).
    """
    cols, rows, vectors, _bounds = _grid_of(product)
    if (decoded["cols"], decoded["rows"]) != (cols, rows):
        return {"nodes": cols * rows, "bad": cols * rows, "missing_mismatch": 0, "max_abs_err": {}, "uv_max_err": None,
                "shape": "mismatch"}
    f = decoded["fields"]
    mag = magnitude_field(f)
    bad = missing_mismatch = 0
    errs = {FIELD_NAMES[k]: 0.0 for k in f}
    uv_err = 0.0
    why = []   # ⬇ 2026-10-23: WHICH check failed, for the first WHY_MAX bad nodes. A refusal used to print only the
    #            frame's max errors, and run 40019869501's showed dir_confidence 0.001967 (inside its tolerance) while
    #            the u/v check had refused the node; a None-vs-value mismatch printed no number at all.

    def explain(i, vec, fails):
        if len(why) < WHY_MAX:
            why.append({"node": i, "lat": vec.get("lat"), "lng": vec.get("lng"), "height": _finite(vec.get("speed")),
                        "fails": fails})

    for i, vec in enumerate(vectors):
        fails = []
        valid = _valid(vec)
        got_h = f[mag][i] if mag in f else None
        if valid != (got_h is not None):
            missing_mismatch += 1
            bad += 1
            explain(i, vec, [f"validity: source {'data' if valid else 'no data'}, frame "
                             f"{'data' if got_h is not None else 'no data'}"])
            continue
        for fid, values in f.items():
            got, name = values[i], FIELD_NAMES[fid]
            if fid in (HEIGHT, SPEED):
                want = float(vec["speed"]) if valid else None
            elif fid == LANE_WEIGHT:
                want = _finite(vec.get("_lane_w")) or 0.0
            elif fid == DIRECTION:
                want = (_finite(vec.get("direction")) or 0.0) % 360.0
                if got is not None and want is not None:
                    d = abs(got - want) % 360.0
                    err = min(d, 360.0 - d)
                    errs[name] = max(errs[name], err)
                    if err > TOLERANCE[fid]:
                        fails.append(f"{name}: err {err:.7f} > {TOLERANCE[fid]:.7f}")
                    continue
            elif fid == PERIOD:
                want = _finite(vec.get("period"))
            else:
                want = _finite(vec.get("dir_confidence"))
            if (want is None) != (got is None):
                fails.append(f"{name}: source {want!r}, frame {got!r}")
                continue
            if want is not None:
                err = abs(got - want)
                errs[name] = max(errs[name], err)
                if err > TOLERANCE[fid]:
                    fails.append(f"{name}: err {err:.7f} > {TOLERANCE[fid]:.7f}")
        if valid and mag in f and DIRECTION in f:
            rad = math.radians(f[DIRECTION][i])
            sign = 1.0 if decoded.get("uv_convention") == 1 else -1.0
            u, v = round(sign * f[mag][i] * math.sin(rad), 4), round(sign * f[mag][i] * math.cos(rad), 4)
            su, sv = _finite(vec.get("u")) or 0.0, _finite(vec.get("v")) or 0.0
            tol = uv_tolerance(mag, f[mag][i])
            if su or sv:  # stored 0/0 means "derive from direction", which the renderer does the same way
                e = max(abs(u - su), abs(v - sv))
                uv_err = max(uv_err, e)
                if e > tol:
                    fails.append(f"uv: err {e:.7f} > {tol:.7f} at {FIELD_NAMES[mag]} {f[mag][i]}")
        if fails:
            bad += 1
            explain(i, vec, fails)
    out = {"nodes": len(vectors), "bad": bad, "missing_mismatch": missing_mismatch,
           "max_abs_err": {k: round(v, 6) for k, v in errs.items()}, "uv_max_err": round(uv_err, 6)}
    if why:
        out["why"] = why
    return out
