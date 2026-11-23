"""currents-skill-v1 collector, truth readers and archive (registration sections 2, 3, 9): fake servers, synthetic files."""
import gzip
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
sys.path.insert(0, BACKEND)

import currents_skill_archive as AR  # noqa: E402
import currents_skill_collect as C  # noqa: E402
import currents_skill_truth as T  # noqa: E402
from services import frame_binary as fb  # noqa: E402


# ---- frames -------------------------------------------------------------------------------------------------------------
def _bucket():
    files, frames = {}, []
    for h in (0, 6, 12, 186):
        raw = fb.encode_planes({fb.SPEED: np.full((3, 3), 1.0), fb.DIRECTION: np.full((3, 3), 90.0)}, (0, 0, 1, 1),
                               "2026-12-01T00:00:00Z", "2026-12-01T00:00:00Z", 1)
        path = f"v1/cmems/marine/currents/global_0p25/20261201T000000Z/f{h}.bin"
        files[path] = gzip.compress(raw)
        frames.append({"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "meta": {"forecast_hour": h}})
    frames[2]["sha256"] = "0" * 64                                          # a frame whose bytes do not match its index
    index = {"run": "2026-12-01T00:00:00Z", "frames": frames}
    files["v1/cmems/idx.json"] = json.dumps(index).encode()
    latest = {"sets": {"CMEMS/marine/currents/global_0p25": {"index": "v1/cmems/idx.json", "previous_index": None}}}
    files["v1/latest.json"] = json.dumps(latest).encode()
    base = "https://example.invalid/storage/v1/object/public/weather-frames/"

    def get(url, timeout=None):
        return files[url[len(base):]]
    return base, get


def test_copy_frames_checks_every_sha_and_marks_unpublished_sets_absent(tmp_path):
    base, get = _bucket()
    man = C.Manifest(str(tmp_path))
    rep = C.copy_frames(base, get, man, log=lambda s: None)
    assert rep["CMEMS_025"][0]["frames"] == 2 and rep["CMEMS_025"][0]["bad"] == [12]      # f186 is past MAX_HOUR (180)
    assert rep["GIOPS_025"][0]["status"] == "ABSENT" and rep["RTOFS_025"][0]["status"] == "ABSENT"
    got = C.load_arm_frames(str(tmp_path), "CMEMS_025", "20261201T000000Z")
    assert sorted(got) == [0, 6]
    body = man.save()
    for f in body["files"]:
        assert hashlib.sha256(open(tmp_path / f["path"], "rb").read()).hexdigest() == f["sha256"]
    assert C.MAX_HOUR == 180 and set(C.ARM_SETS) == {"CMEMS_025", "GIOPS_025", "RTOFS_025"}


def test_frames_base_needs_the_url_by_name(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        C.frames_base()
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co/")
    assert C.frames_base() == "https://x.supabase.co/storage/v1/object/public/weather-frames/"


# ---- native ---------------------------------------------------------------------------------------------------------------
class FakeArco:
    SURFACE = 49

    def __init__(self):
        self.calls = []

    def times(self):
        base = datetime(2026, 12, 1, tzinfo=timezone.utc)
        from datetime import timedelta
        return {base + timedelta(hours=h): h // 6 for h in range(0, 241, 6)}

    def _zarray(self, name):
        return {"chunks": [1, 1, 512, 2048]}

    def _chunk(self, name, key):
        self.calls.append(key)
        t, _lev, y, x = (int(k) for k in key.split("."))
        rr, cc = np.meshgrid(np.arange(512) + 512 * y, np.arange(2048) + 2048 * x, indexing="ij")
        val = rr * 10000.0 + cc + (0.5 if name == "vo" else 0.0) + t * 1e8
        val[(rr == 1325) & (cc == 600)] = 9.97e36                           # one land cell
        return val.ravel()


def test_native_subset_reads_only_the_box_chunks_and_keeps_the_grid():
    src = FakeArco()
    cyc = datetime(2026, 12, 1, tzinfo=timezone.utc)
    sub = C.native_subset(src, cyc, (30.0, 50.0, -130.0, -115.0), [6, 12])
    assert sub["lat"][0] == pytest.approx(30.0) and sub["lon"][0] == pytest.approx(-130.0)
    r, c = int(round((30.0 + 80) * 12)), int(round((-130 + 180) * 12))
    assert sub["u"][0, 0, 0] == pytest.approx(r * 10000.0 + c + 1e8)                 # step index 1 (6 h)
    assert sub["v"][1, 0, 0] == pytest.approx(r * 10000.0 + c + 0.5 + 2e8)
    assert np.isnan(sub["u"][0, 1325 - r, 600 - c])
    assert {k.split(".", 2)[2] for k in src.calls} <= {"2.0", "3.0"}                 # rows 1320..1560 -> chunks 2, 3; col 0


# ---- HF radar ---------------------------------------------------------------------------------------------------------------
def test_hfr_url_uses_0_360_longitudes_where_the_mirror_does():
    u = C.hfr_url("uswc", datetime(2026, 12, 1, tzinfo=timezone.utc), datetime(2026, 12, 1, 23, tzinfo=timezone.utc))
    assert "ucsdHfrW6_Lon0360.nc?water_u[(2026-12-01T00:00:00Z):1:(2026-12-01T23:00:00Z)]" in u and "(230.0):1:(245.0)" in u
    assert "number_of_sites" in u and "hdop" in u
    assert "(-70.5):1:(-61.0)" in C.hfr_url("usprvi", datetime(2026, 12, 1, tzinfo=timezone.utc),
                                            datetime(2026, 12, 2, tzinfo=timezone.utc))
    assert [r for r, v in C.REGIONS.items() if v[3]] == ["uswc", "usegc", "ushi"]          # usprvi is reported only


def _part(h0, n=3):
    hours = np.arange(h0, h0 + n, dtype=np.int64)
    u = np.full((n, 2, 3), np.nan)
    u[:, 0, 0] = 0.2
    u[:, 1, 2] = 0.4
    v = np.where(np.isfinite(u), 0.1, np.nan)
    hd = np.where(np.isfinite(u), 1.0, np.nan)
    si = np.where(np.isfinite(u), 2.0, np.nan)
    hd[:, 1, 2] = 2.0                                                              # cell (1, 2) fails the hdop rule
    si[1, 0, 0] = 1.0                                                              # one hour of cell (0, 0) has one site
    return hours, np.array([30.0, 30.5]), np.array([-120.0, -119.5, -119.0]), u, v, hd, si


def test_sparse_snapshot_round_trip_and_the_validity_rule(tmp_path):
    snap = C.sparse_snapshot([_part(100), _part(102)])                            # overlap at hour 102: kept once
    assert list(snap["hours"]) == [100, 101, 102, 103, 104] and list(snap["cell"]) == [0, 5]
    p = tmp_path / "hfr" / "s1" / "hfr_uswc_s1.npz"
    p.parent.mkdir(parents=True)
    np.savez_compressed(p, **snap)
    tr = T.load_region("uswc", str(tmp_path))
    assert tr.u.shape == (5, 2, 3)
    assert np.isnan(tr.u[:, 1, 2]).all()                                           # hdop 2.0 > 1.25
    assert np.isnan(tr.u[1, 0, 0]) and tr.u[0, 0, 0] == pytest.approx(0.2)         # sites 1 < 2
    # cell (0, 0) is valid at 100, 102, 104 (one site at 101 and 103)
    assert list(T.qualifying_cells(tr, [100, 101, 102, 104])) == [0]               # 3 of 4 hours = 75% >= 70%
    assert list(T.qualifying_cells(tr, [100, 101, 102, 103, 104])) == []           # 3 of 5 = 60%


# ---- drifters -----------------------------------------------------------------------------------------------------------------
def _drifter_nc(path, platform="4401234", n=40, start_day=27365.0, drogue=None):
    import netCDF4
    with netCDF4.Dataset(path, "w") as ds:
        ds.platform_code = platform
        ds.createDimension("TIME", n)
        t = ds.createVariable("TIME", "f8", ("TIME",))
        t.units = "days since 1950-01-01T00:00:00Z"
        t[:] = start_day + np.arange(n) / 24.0 + 0.004                             # ~6 minutes after each hour
        for name, val in (("LATITUDE", 31.0 + 0.001 * np.arange(n)), ("LONGITUDE", np.full(n, -118.0))):
            ds.createVariable(name, "f4", ("TIME",))[:] = val
        q = np.ones(n, dtype="i1")
        q[5] = 4                                                                   # one bad position
        ds.createVariable("POSITION_QC", "i1", ("TIME",))[:] = q
        ds.createVariable("TIME_QC", "i1", ("TIME",))[:] = np.ones(n, dtype="i1")
        if drogue is not None:
            ds.createVariable("DROGUE", "i1", ("TIME",))[:] = np.full(n, drogue, dtype="i1")


def test_drifter_reader_qc_binning_and_the_20h_smoothing_rule(tmp_path):
    d = tmp_path / "x" / "drifters" / "s"
    d.mkdir(parents=True)
    _drifter_nc(str(d / "a.nc"), drogue=1)
    tracks = T.load_tracks(str(tmp_path))
    assert len(tracks) == 1 and tracks[0].drogue == "drogued" and tracks[0].platform == "4401234"
    tr = tracks[0]
    h0 = int(round(27365.0 * 24 + T.EPOCH_1950_H))
    assert len(tr.hourly) == 39 and (h0 + 5) not in tr.hourly                       # the bad fix is gone, no interpolation
    s = tr.smoothed(h0 + 20)
    assert s is not None and s[0] == pytest.approx(31.0 + 0.001 * 20, abs=1e-4)
    assert tr.smoothed(h0 + 5) is None                                             # hours -7..17: 17 of 25 present


def test_drifter_command_and_credentials_by_name(tmp_path, monkeypatch):
    cmd = C.drifter_command("/o", "monthly")
    assert cmd[:4] == ["copernicusmarine", "get", "--dataset-id", C.DRIFTER_DATASET] and "*monthly*" in cmd
    monkeypatch.delenv("COPERNICUSMARINE_SERVICE_USERNAME", raising=False)
    with pytest.raises(RuntimeError, match="by name"):
        C.collect_drifters(str(tmp_path), C.Manifest(str(tmp_path)))
    monkeypatch.setenv("COPERNICUSMARINE_SERVICE_USERNAME", "u")

    class Res:
        returncode = 1
    with pytest.raises(RuntimeError, match="exited 1"):
        C.collect_drifters(str(tmp_path), C.Manifest(str(tmp_path)), run=lambda *a, **k: Res())


# ---- archive ----------------------------------------------------------------------------------------------------------------
def test_archive_then_download_and_verify(tmp_path):
    src = tmp_path / "src" / "currents-skill-daily-1" / "frames-run"
    src.mkdir(parents=True)
    (src / "MANIFEST.json").write_text("{}")
    (src / "f006.bin").write_bytes(b"frame")
    store = {}
    AR.archive(str(tmp_path / "src"), "calibration/currents-skill/9-1", lambda k, d, c: store.__setitem__(k, d), lambda s: None)
    assert list(store)[-1] == "calibration/currents-skill/9-1/SHA256SUMS"
    store["calibration/currents-skill/10-1/x.bin"] = b"no sums"                    # an archive that never finished
    probs = AR.download("calibration/currents-skill", str(tmp_path / "dl"), lambda p: sorted(store), lambda k: store[k])
    assert probs == {"10-1": ["INCOMPLETE: no SHA256SUMS"], "9-1": []}
    with pytest.raises(ValueError):
        AR.download("elsewhere", str(tmp_path / "dl"), lambda p: [], lambda k: b"")


def test_archive_prefix_and_key_rules(tmp_path):
    with pytest.raises(ValueError):
        AR.plan(".", "calibration/../x")
    (tmp_path / "bad name.txt").write_text("x")
    with pytest.raises(ValueError, match="outside"):
        AR.plan(str(tmp_path), "calibration/currents-skill/1-1")
