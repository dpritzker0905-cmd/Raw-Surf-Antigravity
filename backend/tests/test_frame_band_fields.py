"""One-byte BAND fields (2026-11-16, lever A of #928's 4G gate; log sections 12 / 12b): services/frame_binary.py.

Pins the code exactly (k = floor(v / step) + 1 for 0 <= v < 254 x step, 255 = saturated, 0 = no data), the decode through the
GENERIC descriptor (scale = step, offset = -step / 2 -> the band centre), the error bound (half a step on unsaturated cells), that a
decoded cell value never leaves its source value's palette band (every LUT breakpoint is a multiple of the step from 0), and
the saturation count.
"""
import numpy as np
import pytest

from services import frame_binary as fb

BOUNDS = (0.0, 0.0, 1.0, 1.0)
T = "2026-11-16T00:00:00Z"


def _roundtrip(fid, values, cols=None):
    flat = np.asarray(values, dtype=float).ravel()
    arr = flat.reshape(-1, cols) if cols else flat.reshape(1, -1)   # a frame is at most 65535 cells wide (u16 cols)
    raw = fb.encode_planes({fid: arr}, BOUNDS, T, T)
    _h, f = fb.decode_plane(raw)
    codes = np.frombuffer(raw[-arr.size:], dtype=np.uint8)
    return codes, f[fid].ravel()


@pytest.mark.parametrize("fid,step", [(fb.GUST_KN_BAND, 0.5), (fb.CURRENT_KN_BAND, 0.02)])
def test_the_code_exactly(fid, step):
    last = 254 * step - step / 100          # the last unsaturated value
    vals = [0.0, step / 2, step, last, 254 * step, 1000 * step, np.nan]
    codes, got = _roundtrip(fid, vals)
    assert list(codes) == [1, 1, 2, 254, 255, 255, 0]
    assert got[0] == pytest.approx(step / 2) and got[3] == pytest.approx(253 * step + step / 2)
    assert np.isnan(got[6])
    assert fb.FIELD_SPECS[fid] == (1, 0, 0, step, -step / 2) and fb.TOLERANCE[fid] == pytest.approx(step / 2 + step * 1e-3)
    # the shader's index epsilon: a value within 0.001 step under an edge takes the next band, as the client LUT draws it
    edge_codes, _ = _roundtrip(fid, [step - step * 5e-4, step - step * 2e-3])
    assert list(edge_codes) == [2, 1]


@pytest.mark.parametrize("fid,step", [(fb.GUST_KN_BAND, 0.5), (fb.CURRENT_KN_BAND, 0.02)])
def test_error_at_most_half_a_step_and_the_band_never_changes(fid, step):
    v = np.linspace(0.0, 254 * step - 1e-6, 200000)
    _codes, got = _roundtrip(fid, v, cols=1000)
    assert np.max(np.abs(got - v)) <= step / 2 + step * 1e-3 + 1e-9
    lut = lambda x: np.floor(x / step + 1e-3)   # noqa: E731  the client shader's LUT index (ownRasterLayer.js)
    assert np.array_equal(lut(got), lut(v))     # the SAME palette entry for every cell value


def test_saturation_is_counted_and_negative_values_refused():
    assert fb.band_saturated(fb.GUST_KN_BAND, [0.0, 126.9, 127.0, 140.0, np.nan]) == 2
    assert fb.band_saturated(fb.SPEED, [500.0]) == 0
    with pytest.raises(ValueError, match="non-negative"):
        fb.encode_planes({fb.GUST_KN_BAND: np.array([[-0.1]])}, BOUNDS, T, T)
