"""Per-time-step field images (one-field proof, 2026-10-19).

Leading forecast maps serve a finite set of PRECOMPUTED bytes per model x run x layer x valid time from a static host and let the GPU
do the rest; Raw Surf builds JSON series pages per viewport on demand on one CPU (docs/weather-program, scrub architecture plan). This
module turns one stored product (the exact JSON the /grid route serves) into a compact image a browser decodes without the server:

  R,G  = wave height, uint16 big-endian: 0 = no data (is_valid false), else round(height / SCALE) + 1   (SCALE = 1 mm, max 65.5 m)
  B    = direction, round(direction / 360 * 255)                                                        (1.41 deg steps)
  A    = 255 always (an alpha below 255 lets browsers premultiply and corrupt R,G,B)

Row 0 is the NORTH edge (image convention); stored products list rows from the south. Column 0 is the west edge.
An 8-bit RGBA PNG, never a 16-bit one: browsers flatten 16-bit PNGs to 8 bits when decoding.
Pure functions; no I/O. publish_frame_images.py does the storage.
"""
import io
import math

SCALE_M = 0.001
MAX_CODE = 65535
ENCODING = "rg_u16_height_mm_plus1__b_dir_u8__a255"


def _grid_of(product):
    grid = product.get("grid") or {}
    cols, rows = int(grid.get("cols") or 0), int(grid.get("rows") or 0)
    vectors = grid.get("vectors") or []
    if cols <= 0 or rows <= 0 or len(vectors) != cols * rows:
        raise ValueError(f"grid shape mismatch: cols={cols} rows={rows} vectors={len(vectors)}")
    return grid, cols, rows, vectors


def height_code(vec):
    """The uint16 code for one stored vector (0 = no data)."""
    if not vec.get("is_valid", True):
        return 0
    h = vec.get("speed")
    if h is None or not math.isfinite(float(h)) or float(h) < 0:
        return 0
    return min(MAX_CODE, int(round(float(h) / SCALE_M)) + 1)


def encode_rgba(product):
    """(bytes RGBA, width, height): row 0 = north."""
    grid, cols, rows, vectors = _grid_of(product)
    out = bytearray(cols * rows * 4)
    for r in range(rows):                       # stored row r counts from the south
        img_row = rows - 1 - r
        for c in range(cols):
            vec = vectors[r * cols + c]
            code = height_code(vec)
            d = vec.get("direction") or 0.0
            i = (img_row * cols + c) * 4
            out[i] = code >> 8
            out[i + 1] = code & 0xFF
            out[i + 2] = int(round((float(d) % 360.0) / 360.0 * 255.0)) if code else 0
            out[i + 3] = 255
    return bytes(out), cols, rows


def encode_png(product):
    """(png bytes, meta): meta is what a client needs to decode, plus the source identity."""
    from PIL import Image  # pillow is a backend dependency
    rgba, w, h = encode_rgba(product)
    buf = io.BytesIO()
    Image.frombytes("RGBA", (w, h), rgba).save(buf, format="PNG", optimize=True)
    grid = product["grid"]
    meta = {
        "encoding": ENCODING, "scale_m": SCALE_M, "width": w, "height": h,
        "bounds": grid.get("bounds"), "row0": "north",
        "model": product.get("model"), "layer": product.get("layer"), "region_id": product.get("region_id"),
        "valid_time": product.get("valid_time"), "run_time": product.get("run_time"),
        "model_run_time": product.get("model_run_time"), "product_id": product.get("product_id"),
        "value_unit": product.get("value_unit", "m"),
    }
    return buf.getvalue(), meta


def decode_heights(rgba, width, height):
    """Inverse of encode_rgba for the height channel: list of rows from the SOUTH (stored order), None = no data."""
    rows = []
    for stored_r in range(height):
        img_row = height - 1 - stored_r
        row = []
        for c in range(width):
            i = (img_row * width + c) * 4
            code = (rgba[i] << 8) | rgba[i + 1]
            row.append(None if code == 0 else (code - 1) * SCALE_M)
        rows.append(row)
    return rows


def parity(product, rgba, width, height):
    """Compare decoded heights with the product's own values: {nodes, missing_match, max_abs_err_m, bad}."""
    _grid, cols, rows, vectors = _grid_of(product)
    dec = decode_heights(rgba, width, height)
    bad, max_err, nodes = 0, 0.0, 0
    for r in range(rows):
        for c in range(cols):
            vec, got = vectors[r * cols + c], dec[r][c]
            want = None if height_code(vec) == 0 else float(vec["speed"])
            nodes += 1
            if (want is None) != (got is None):
                bad += 1
                continue
            if want is not None:
                err = abs(want - got)
                max_err = max(max_err, err)
                if err > SCALE_M / 2 + 1e-9:
                    bad += 1
    return {"nodes": nodes, "max_abs_err_m": round(max_err, 6), "bad": bad}
