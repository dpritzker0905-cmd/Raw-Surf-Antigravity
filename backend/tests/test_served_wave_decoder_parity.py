"""Decoder parity (gate served-wave-verify-v1 section 4, LongCat's top risk): the client's own `decodeFieldCore`, run in Node
by the sampler's bridge, against `frame_binary`'s decode, on one FROZEN published frame per Tier A set (+ one regional bundle
slice), at 50 fixed nodes per frame: the integer codes equal bit for bit, the decoded floats within frame_binary.TOLERANCE.
A mismatch fails CI. Node is required: on CI a missing `node` FAILS this file, it never skips."""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from services import frame_binary as fb
from services.point_archive import decoder as dec

FRAMES = Path(__file__).parent / "fixtures" / "served_wave_verify" / "frames"
MANIFEST = json.loads((FRAMES / "MANIFEST.json").read_text(encoding="utf-8"))
TIER_A = {"gfs_waves_global_mid.bin", "gfs_swell_1_global_mid.bin", "gfs_swell_2_global_mid.bin",
          "gfs_wind_waves_global_mid.bin", "icon_waves_global_mid.bin", "icon_swell_1_global_mid.bin",
          "icon_wind_waves_global_mid.bin", "euro_waves_global_mid.bin"}

if shutil.which("node") is None:
    if os.environ.get("CI"):
        raise RuntimeError("node is not on PATH in CI: the decoder parity test must run, not skip")
    pytest.skip("node not installed locally", allow_module_level=True)


def fixed_nodes(n, wet, k=50):
    """50 fixed nodes: 40 spread over the wet nodes (data) and 10 over the whole grid (land / missing included)."""
    wet_idx = np.flatnonzero(wet)
    pick = [int(wet_idx[(i * len(wet_idx)) // 40]) for i in range(40)] + [(i * n) // 10 for i in range(10)]
    assert len(pick) == k
    return pick


def test_every_tier_a_set_has_a_frozen_frame():
    assert TIER_A <= set(MANIFEST)
    assert any(v.get("bundle") for v in MANIFEST.values())               # and one regional bundle slice
    for name, meta in MANIFEST.items():
        data = (FRAMES / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == meta["sha256"], name
        if meta.get("sha12"):
            assert hashlib.sha256(data).hexdigest()[:12] == meta["sha12"]


@pytest.mark.parametrize("name", sorted(MANIFEST))
def test_node_decoder_matches_frame_binary(name):
    gz = (FRAMES / name).read_bytes()
    head, planes = fb.decode_plane(gz)
    n = head["cols"] * head["rows"]
    wet = ~np.isnan(planes[fb.HEIGHT].ravel())
    nodes = fixed_nodes(n, wet)
    out = dec.decode_frames([{"gz": gz, "fields": list(dec.WAVE_FIELDS), "nodes": nodes, "mask": True}])[0]
    h = out["header"]
    assert (h["cols"], h["rows"]) == (head["cols"], head["rows"])
    assert (h["bounds"]["west"], h["bounds"]["south"], h["bounds"]["east"], h["bounds"]["north"]) == tuple(head["bounds"])
    assert h["validMs"] == head["valid_epoch"] * 1000 and h["runMs"] == head["run_epoch"] * 1000
    assert np.array_equal(out["mask"], wet)                              # the grid snapshot's mask, every node
    checked = 0
    for fid in dec.WAVE_FIELDS:
        _nb, _lay, _miss, scale, offset = fb.FIELD_SPECS[fid]
        py = planes[fid].ravel()[nodes]
        for want, got in zip(py, out["values"][fid]):
            if np.isnan(want):
                assert got is None
                continue
            assert got is not None
            assert round((got - offset) / scale) == round((want - offset) / scale)     # the integer code, bit for bit
            assert abs(got - want) <= fb.TOLERANCE[fid]
            checked += 1
    assert checked >= 100


def test_decoder_version_is_the_git_blob_sha():
    v = dec.decoder_version()
    assert len(v) == 40
    git = shutil.which("git")
    if git:
        proc = subprocess.run([git, "hash-object", str(dec.DECODER_JS)], capture_output=True, text=True,
                              cwd=dec.REPO_ROOT)
        if proc.returncode == 0:
            assert proc.stdout.strip() == v


def test_bridge_imports_the_decoder_file_unchanged():
    src = (Path(dec.BRIDGE_MJS)).read_text(encoding="utf-8")
    assert "readFileSync(decoderPath)" in src and "data:text/javascript;base64," in src
    assert "decodeFieldCore(buf, fid, MISSING)" in src
    assert dec.DECODER_JS.as_posix().endswith("frontend/src/components/map/ownRasterDecode.js")
