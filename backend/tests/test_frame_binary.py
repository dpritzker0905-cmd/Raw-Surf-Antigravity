"""Static frame codec (step 2b, 2026-10-20): services/frame_binary.py.

Pins the byte layout (a golden frame the browser decoder's Jest test decodes too: staticFrameCodec.test.js carries the
same base64), the quantisation and its tolerances, missing values, the u/v convention byte, and the parity gate that
refuses a frame before upload. Pure; no I/O.
"""
import base64
import copy
import gzip
import math
import struct

import pytest

from services import frame_binary as fb

# Generated once from GOLDEN_PRODUCT with encode_frame (2026-10-20). The browser test decodes these exact bytes.
GOLDEN_B64 = (
    "UlNXRgEAAQAEAAMADwAAAAAABACoAAAAAAAAAAAAWUAAAAAAAAAkwAAAAAAA4FpAAAAAAAAAAAAAAADAq7XaQQAAAKiWtdpBAAIBAAAAAAD8qfHSTWJQP/yp"
    "8dJNYlC/AQIBAP////97FK5H4XqEPwAAAAAAAAAAAgIBAP//AAB7FK5H4XqEPwAAAAAAAAAAAwEAAP8AAAAIBAKBQCBwPwAAAAAAAAAAz+MAAwEABukA0gEA"
    "AQQAMAAADf0ABwAAT58AUAAAWpEA0jAAEYwARgAAI2kABHUAF0IA2v8AwwEAeCsAAQQAB/8AAgAABQIA/X////7/QAD/vh//"
)
_VALS = [
    (0.4617, 44.31, 2.79, 0.9971), (1.25, 359.99, 10.9, 0.5), None, (12.2905, 180.0, 20.1, None),
    (0.0, 0.0, None, 1.0), None, (3.3333, 90.5, 7.07, 0.25), (65.0, 270.25, 0.01, 0.0),
    None, (2.0005, 12.34, 14.0, 0.75), (0.0004, 300.0, 5.55, 0.123), None,
]


def _vec(lat, lng, v, sign=-1.0):
    if v is None:
        return {"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0, "gust": None,
                "value": None, "is_valid": False, "dir_confidence": None}
    h, d, p, k = v
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(sign * h * math.sin(rad), 4),
            "v": round(sign * h * math.cos(rad), 4), "period": p, "gust": None, "value": None, "is_valid": True,
            "dir_confidence": k}


def _product(vals=_VALS, cols=4, rows=3, sign=-1.0):
    vecs = [_vec(-10.0 + r * 5.0, 100.0 + c * 2.5, vals[r * cols + c], sign) for r in range(rows) for c in range(cols)]
    return {"valid_time": "2026-10-20T00:00:00Z", "model_run_time": "2026-10-19T18:00:00Z",
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": 100.0, "south": -10.0, "east": 107.5, "north": 0.0},
                     "vectors": vecs}}


def test_golden_layout_is_byte_exact():
    """The layout is a contract with the browser decoder: any change here must change staticFrameCodec.js too."""
    assert fb.encode_frame(_product()) == base64.b64decode(GOLDEN_B64)


def test_header_fields_and_round_trip_within_tolerance():
    raw = fb.encode_frame(_product())
    assert raw[:4] == b"RSWF"
    d = fb.decode_frame(raw)
    assert (d["encoding_version"], d["transform_version"], d["cols"], d["rows"]) == (1, 1, 4, 3)
    assert d["field_mask"] == 0b1111 and d["row_order"] == 0 and d["col_order"] == 0 and d["uv_convention"] == 0
    assert d["bounds"] == (100.0, -10.0, 107.5, 0.0)
    assert d["valid_epoch"] == 1792454400.0 and d["run_epoch"] == 1792432800.0
    report = fb.parity(_product(), d)
    assert report["bad"] == 0 and report["max_abs_err"]["height_m"] <= 0.0005 and report["max_abs_err"]["period_s"] == 0
    h = d["fields"][fb.HEIGHT]
    assert h[7] == pytest.approx(65.0) and h[4] == pytest.approx(0.0) and h[3] == pytest.approx(12.29, abs=0.0006)


def test_missing_values_stay_missing_not_zero():
    d = fb.decode_frame(fb.encode_frame(_product()))
    h, p, c = d["fields"][fb.HEIGHT], d["fields"][fb.PERIOD], d["fields"][fb.DIR_CONFIDENCE]
    assert [i for i, x in enumerate(h) if x is None] == [2, 5, 8, 11]     # is_valid false
    assert h[4] == pytest.approx(0.0)                                      # valid 0 m is data, not missing
    assert p[4] is None and p[2] == pytest.approx(0.0)                     # null period vs a land cell's stored 0.0
    assert c[3] is None and c[4] == pytest.approx(1.0)


def test_gzip_is_deterministic_and_decode_accepts_it():
    raw = fb.encode_frame(_product())
    gz = fb.gzip_frame(raw)
    assert gz[:2] == fb.GZIP_MAGIC and gz == fb.gzip_frame(raw) and gzip.decompress(gz) == raw
    assert fb.decode_frame(gz)["cols"] == 4


def test_parity_refuses_a_single_corrupted_node():
    raw = bytearray(fb.encode_frame(_product()))
    header = struct.unpack_from("<I", raw, 20)[0]
    raw[header + 6] ^= 0x07                                  # low byte of node 6's height (byte-shuffled plane)
    assert fb.parity(_product(), fb.decode_frame(bytes(raw)))["bad"] == 1


def test_parity_refuses_validity_flip_and_inconsistent_uv():
    p = _product()
    d = fb.decode_frame(fb.encode_frame(p))
    flipped = copy.deepcopy(p)
    flipped["grid"]["vectors"][2]["is_valid"] = True
    flipped["grid"]["vectors"][2]["speed"] = 1.0
    assert fb.parity(flipped, d)["missing_mismatch"] == 1
    skewed = copy.deepcopy(p)
    skewed["grid"]["vectors"][6]["u"] += 0.5                 # stored u/v no longer follow from height + direction
    assert fb.parity(skewed, d)["bad"] == 1


def test_uv_convention_byte_follows_the_source():
    toward = _product(sign=+1.0)                             # the offline harness's synthetic store
    d = fb.decode_frame(fb.encode_frame(toward))
    assert d["uv_convention"] == 1 and fb.parity(toward, d)["bad"] == 0
    assert fb.uv_convention(_product()["grid"]["vectors"]) == 0


def test_off_grid_vectors_are_refused():
    p = _product()
    p["grid"]["vectors"][5]["lat"] += 0.01
    with pytest.raises(ValueError, match="off the regular grid"):
        fb.encode_frame(p)
    bad_shape = _product()
    bad_shape["grid"]["vectors"].pop()
    with pytest.raises(ValueError, match="shape mismatch"):
        fb.encode_frame(bad_shape)


def test_decoder_refuses_bad_magic_version_and_truncation():
    raw = fb.encode_frame(_product())
    with pytest.raises(ValueError, match="magic"):
        fb.decode_frame(b"XXXX" + raw[4:])
    with pytest.raises(ValueError, match="encoding_version"):
        fb.decode_frame(raw[:4] + struct.pack("<H", 2) + raw[6:])
    with pytest.raises(ValueError, match="truncated"):
        fb.decode_frame(raw[:-3])


def test_codes_saturate_instead_of_wrapping():
    huge = _product()
    huge["grid"]["vectors"][0]["speed"] = 70.0               # above the u16 millimetre ceiling (65.534 m)
    huge["grid"]["vectors"][0]["period"] = 900.0
    vec = huge["grid"]["vectors"][0]
    assert fb.field_code(fb.HEIGHT, vec) == 0xFFFF and fb.field_code(fb.PERIOD, vec) == 0xFFFE
    vec["direction"] = -0.004                                 # wraps into [0, 360)
    assert fb.field_code(fb.DIRECTION, vec) == 0
