"""Artifact archive for the long-range wind v2 evidence: every file and its sha256 go to the bucket's calibration/ prefix."""
import hashlib
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_archive as A  # noqa: E402


def _tree(tmp_path):
    (tmp_path / "wind-lr2-runs-test-0").mkdir()
    (tmp_path / "wind-lr2-runs-test-0" / "2026120100.npz").write_bytes(b"run-data")
    (tmp_path / "wind-lr2-snapshot-9").mkdir()
    (tmp_path / "wind-lr2-snapshot-9" / "41001.txt").write_text("obs")
    return str(tmp_path)


def test_every_file_is_uploaded_with_its_sha256_and_a_sums_file(tmp_path):
    src, put_calls, log = _tree(tmp_path), {}, []
    items = A.archive(src, "calibration/wind-lr2/777", lambda k, d, c: put_calls.__setitem__(k, d), log.append)
    assert sorted(put_calls) == ["calibration/wind-lr2/777/SHA256SUMS", "calibration/wind-lr2/777/wind-lr2-runs-test-0/2026120100.npz",
                                 "calibration/wind-lr2/777/wind-lr2-snapshot-9/41001.txt"]
    assert items[0]["sha256"] == hashlib.sha256(b"run-data").hexdigest() or items[1]["sha256"] == hashlib.sha256(b"run-data").hexdigest()
    sums = put_calls["calibration/wind-lr2/777/SHA256SUMS"].decode()
    assert f"{hashlib.sha256(b'obs').hexdigest()}  wind-lr2-snapshot-9/41001.txt" in sums
    assert any(hashlib.sha256(b"run-data").hexdigest() in line for line in log)          # the hashes are in the job log


def test_prefix_must_stay_under_calibration():
    with pytest.raises(ValueError):
        A.plan(".", "elsewhere/x")
    with pytest.raises(ValueError):
        A.plan(".", "calibration/../x")


def test_an_upload_failure_stops_the_job_without_echoing_the_response(tmp_path):
    def boom(k, d, c):
        raise RuntimeError("upload x: HTTP 409")
    with pytest.raises(RuntimeError, match="HTTP 409"):
        A.archive(_tree(tmp_path), "calibration/wind-lr2/1", boom, lambda s: None)
