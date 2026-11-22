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


def test_sums_file_is_written_last_and_a_missing_one_means_incomplete(tmp_path):
    order = []
    A.archive(_tree(tmp_path), "calibration/wind-lr2/777-1", lambda k, d, c: order.append(k), lambda s: None)
    assert order[-1] == "calibration/wind-lr2/777-1/SHA256SUMS" and order.count("calibration/wind-lr2/777-1/SHA256SUMS") == 1
    dl = tmp_path / "dl"
    dl.mkdir()
    (dl / "a.txt").write_text("x")
    assert A.verify(str(dl)) == ["INCOMPLETE: no SHA256SUMS"]                    # never read as evidence
    (dl / "SHA256SUMS").write_text(A.sha256_of(str(dl / "a.txt")) + "  a.txt" + chr(10))
    assert A.verify(str(dl)) == []
    (dl / "a.txt").write_text("changed")
    assert A.verify(str(dl)) == ["sha256 differs a.txt"]
    (dl / "b.txt").write_text("y")
    assert "unlisted b.txt" in A.verify(str(dl))


def test_object_keys_are_restricted_to_a_safe_alphabet(tmp_path):
    (tmp_path / "bad name$.txt").write_text("x")
    with pytest.raises(ValueError, match="outside"):
        A.plan(str(tmp_path), "calibration/wind-lr2/1-1")
    with pytest.raises(ValueError):
        A.plan(".", "calibration/wind lr2/1")
