"""The second-mirror sameness control compares the mirror with values HELD from S3 and never passes on an error."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr_mirror_check as M  # noqa: E402


class _Resp:
    def __init__(self, status, content=b""):
        self.status_code, self.content = status, content


class _Session:
    def __init__(self, resp):
        self.resp = resp

    def get(self, url, headers=None, timeout=None):
        return self.resp


def test_equal_values_pass_and_nan_equals_nan():
    a = np.array([1.5, np.nan, -2.25], dtype=np.float32)
    assert M.same_values(a, a.copy())
    assert M.max_abs_diff(a, a.copy()) == 0.0


def test_one_ulp_is_a_difference():
    a = np.array([1.5, 2.0], dtype=np.float32)
    b = a.copy()
    b[1] = np.nextafter(b[1], np.float32(3))
    assert not M.same_values(a, b)
    assert M.max_abs_diff(a, b) > 0


def test_shape_mismatch_is_a_difference():
    assert not M.same_values(np.zeros((51, 3)), np.zeros((50, 3)))


def test_missing_held_key_does_not_complete():
    with pytest.raises(KeyError):
        M.value_rows({"ens_10u_180": np.zeros(2)}, {"ens_10u_336": np.zeros(2)})


def test_value_rows_flag_the_differing_key():
    held = {"ens_10u_180": np.zeros(2, np.float32), "hres_10u_240": np.ones(2, np.float32)}
    got = {"ens_10u_180": np.zeros(2, np.float32), "hres_10u_240": np.full(2, 1.5, np.float32)}
    rows = {k: ok for k, ok, _ in M.value_rows(held, got)}
    assert rows == {"ens_10u_180": True, "hres_10u_240": False}


def test_index_row_against_the_hand_measurement(monkeypatch):
    monkeypatch.setattr(M.ef, "_get", lambda s, url, **kw: s.get(url))
    _label, expected, got = M.index_row(_Session(_Resp(200, b"x" * 10)))
    assert expected == f"{M.HAND_INDEX_BYTES} bytes {M.HAND_INDEX_SHA256}"
    assert got != expected                       # different bytes never match the recorded measurement


def test_throttled_index_read_raises(monkeypatch):
    monkeypatch.setattr(M.ef, "_get", lambda s, url, **kw: s.get(url))
    with pytest.raises(RuntimeError):
        M.index_row(_Session(_Resp(503)))


def test_find_held_searches_merged_artifacts(tmp_path):
    with pytest.raises(FileNotFoundError):
        M.find_held(str(tmp_path))
    (tmp_path / "sub").mkdir()
    p = tmp_path / "sub" / "2026100200.npz"
    np.savez_compressed(p, x=np.zeros(1))
    assert M.find_held(str(tmp_path)) == str(p)


def test_no_held_file_exits_not_completed(tmp_path, capsys):
    assert M.main(["--cache", str(tmp_path), "--prior", str(tmp_path)]) == 2
    assert "NOT COMPLETED" in capsys.readouterr().out


def test_recorded_hash_is_a_whole_sha256():
    # The log first carried this hash with its leading "b" lost to sha256sum's Windows escape ("\b42b..."): 63 chars.
    assert len(M.HAND_INDEX_SHA256) == 64 and all(c in "0123456789abcdef" for c in M.HAND_INDEX_SHA256)
