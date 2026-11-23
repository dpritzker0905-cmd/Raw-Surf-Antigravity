"""The ONE point archive's shared parts (gate served-wave-verify-v1 section 0): time / lead rules, the QC module (L-S30), the
immutable writer with SHA256SUMS and verify_archive, and the deterministic cell rule."""
import gzip
from datetime import datetime, timezone

import numpy as np
import pytest

from services.point_archive import cells, core, qc
from services.point_archive.storage import LocalStore
from services.point_archive.writer import ArchiveWriter, archive_prefixes, read_jsonl_gz, verify_archive


# ---- core -----------------------------------------------------------------------------------------------------------
def test_run_stamp_lead_and_paths():
    assert core.run_stamp("2027-01-15T00:00:00Z") == "20270115T0000Z"
    assert core.lead_h("2027-01-15T00:00:00Z", "2027-01-16T06:00:00+00:00") == 30
    with pytest.raises(ValueError):
        core.lead_h("2027-01-15T00:00:00Z", "2027-01-15T00:30:00Z")
    assert core.run_path("served", "GFS", "2027-01-15T06:00:00Z") == "verify/point-archive/v1/served/gfs/20270115T0600Z.jsonl.gz"
    with pytest.raises(ValueError):
        core.run_path("weighting", "gfs", "2027-01-15T06:00:00Z")


def test_lead_bins_are_the_gates_edges():
    assert core.LEAD_BINS == ((0, 24), (24, 48), (48, 72), (72, 120), (120, 168), (168, 240))
    assert [core.lead_bin(h) for h in (0, 23, 24, 47, 167, 168, 239, 240)] == \
        ["[0,24)", "[0,24)", "[24,48)", "[24,48)", "[120,168)", "[168,240)", "[168,240)", None]


# ---- QC (L-S30) -----------------------------------------------------------------------------------------------------
def test_only_mm_is_global_and_numeric_fills_are_per_field():
    assert qc.MISSING_TOKENS == frozenset({"MM"})
    assert qc.check_value("MWD", "99") == (99.0, None)          # a valid 99 deg direction is kept
    assert qc.check_value("WVHT", "99.00") == (None, "range")   # WVHT's own fill
    assert qc.check_value("DPD", "99.00") == (None, "range")
    assert qc.check_value("MWD", "999") == (None, "range")
    assert qc.check_value("WVHT", "MM") == (None, "missing")
    assert qc.check_value("SwD", "WSW") == (247.5, None)
    assert qc.FIELD_RANGES["WVHT"] == (0.0, 30.0) and qc.FIELD_RANGES["DPD"] == (1.0, 40.0)
    assert qc.FIELD_RANGES["MWD"] == (0.0, 360.0)


def _txt(vals):
    head = "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES\n#yr  mo dy hr mn degT m/s  m/s m sec sec degT hPa\n"
    return head + "".join(f"2027 01 15 {h:02d} 00 MM MM MM {v} 10 7 200 MM\n" for h, v in reversed(list(enumerate(vals))))


def test_parse_sorts_oldest_first_and_flags_stuck_after_six_equal():
    rows = qc.parse_stdmet(_txt(["1.0"] * 8))
    assert [r["time"].hour for r in rows] == list(range(8))
    assert [r["qc"].get("hs_m") for r in rows] == [None] * 6 + ["stuck", "stuck"]
    broken = qc.parse_stdmet(_txt(["1.0"] * 4 + ["MM"] + ["1.0"] * 4))
    assert not any(r["qc"].get("hs_m") == "stuck" for r in broken)        # a missing report breaks the run


def test_at_hour_window_and_tie_goes_earlier():
    t = lambda h, m: datetime(2027, 1, 15, h, m, tzinfo=timezone.utc)  # noqa: E731
    rows = [{"time": t(0, 0), "qc": {}}, {"time": t(1, 0), "qc": {}}]
    assert qc.at_hour(rows, t(0, 30))["time"] == t(0, 0)
    assert qc.at_hour(rows, t(0, 20))["time"] == t(0, 0)
    assert qc.at_hour([rows[0]], t(0, 31)) is None


def test_merge_snapshots_later_wins_and_restitches_stuck():
    a = _txt(["1.0", "1.0", "1.0", "1.0"])
    b = "\n".join(_txt(["1.0"] * 8).splitlines()[:2] + _txt(["1.0"] * 8).splitlines()[2:6]) + "\n"   # hours 4..7
    rows = qc.merge_snapshots([("2027-01-15T04:00:00Z", a), ("2027-01-15T08:00:00Z", b)], qc.parse_stdmet)
    assert [r["time"].hour for r in rows] == list(range(8))
    assert [r["qc"].get("hs_m") for r in rows][6:] == ["stuck", "stuck"]


# ---- writer ---------------------------------------------------------------------------------------------------------
def test_run_files_are_immutable_canonical_and_listed(tmp_path):
    w = ArchiveWriter(LocalStore(tmp_path))
    rows = [{"b": 2, "a": 1.5}, {"a": 0}]
    path, h = w.write_run("served", "gfs", "2027-01-15T00:00:00Z", rows)
    data = (tmp_path / path).read_bytes()
    assert gzip.decompress(data) == b'{"a":1.5,"b":2}\n{"a":0}\n'
    assert core.sha256_hex(data) == h
    ArchiveWriter(LocalStore(tmp_path / "again")).write_run("served", "gfs", "2027-01-15T00:00:00Z", rows)
    assert (tmp_path / "again" / path).read_bytes() == data                # same rows -> same bytes (gzip mtime 0)
    with pytest.raises(FileExistsError):
        w.write_run("served", "gfs", "2027-01-15T00:00:00Z", rows)          # re-writing is refused
    assert read_jsonl_gz(data) == [{"a": 1.5, "b": 2}, {"a": 0}]
    sums = (tmp_path / "verify/point-archive/v1/served/gfs/SHA256SUMS").read_text()
    assert sums == f"{h}  20270115T0000Z.jsonl.gz\n"
    assert verify_archive(LocalStore(tmp_path), "verify/point-archive/v1/served/gfs") == []


def test_verify_archive_reports_mismatch_missing_and_unlisted(tmp_path):
    store = LocalStore(tmp_path)
    w = ArchiveWriter(store)
    p1, _ = w.write_run("served", "gfs", "2027-01-15T00:00:00Z", [{"a": 1}])
    p2, _ = w.write_run("served", "gfs", "2027-01-15T06:00:00Z", [{"a": 2}])
    (tmp_path / p1).write_bytes(b"tampered")
    (tmp_path / p2).unlink()
    store.write("verify/point-archive/v1/served/gfs/stray.jsonl.gz", b"x")
    probs = verify_archive(store, "verify/point-archive/v1/served/gfs")
    assert any("20270115T0000Z.jsonl.gz: sha256 mismatch" in p for p in probs)
    assert any("20270115T0600Z.jsonl.gz: listed but missing" in p for p in probs)
    assert any("stray.jsonl.gz: not in SHA256SUMS" in p for p in probs)
    assert archive_prefixes(store) == ["verify/point-archive/v1/served/gfs"]


def test_truth_snapshot_is_immutable_and_hashed(tmp_path):
    w = ArchiveWriter(LocalStore(tmp_path))
    path, h = w.write_truth("46025", "txt", "2027-01-16T06:30:00Z", "#YY\n")
    assert path == "verify/point-archive/v1/truth/46025/46025_20270116T0630Z.txt.gz"
    assert gzip.decompress((tmp_path / path).read_bytes()) == b"#YY\n"
    with pytest.raises(FileExistsError):
        w.write_truth("46025", "txt", "2027-01-16T06:30:00Z", "#YY\n")


# ---- cell rule ------------------------------------------------------------------------------------------------------
GEOM = cells.geometry(5, 5, (-160.0, 15.0, -150.0, 25.0))      # 2.5 deg nodes, row 0 south, column 0 west


def test_nearest_wet_cell_and_tie_break_lower_row_then_column():
    wet = np.ones((5, 5), dtype=bool)
    a = cells.assign(GEOM, wet, 16.25, -158.75)                  # equidistant-ish centre of 4 nodes
    assert a["status"] == "ok" and (a["cell_row"], a["cell_col"]) in ((0, 0), (0, 1), (1, 0), (1, 1))
    # an exact tie on the equator-symmetric grid: lower row wins, then lower column
    g = cells.geometry(3, 3, (-1.0, -1.0, 1.0, 1.0))
    t = cells.assign(g, np.ones((3, 3), dtype=bool), 0.0, -0.5)   # halfway between columns 0 and 1 of row 1
    assert (t["cell_row"], t["cell_col"]) == (1, 0)


def test_land_cells_are_skipped_and_distance_limit_is_enforced():
    wet = np.zeros((5, 5), dtype=bool)
    wet[4, 4] = True                                             # the only wet node: (25, -150)
    a = cells.assign(GEOM, wet, 15.0, -160.0)
    assert a["status"] == "distance_exceeded" and "cell_row" not in a
    near = cells.assign(GEOM, wet, 24.0, -151.0)
    assert near["status"] == "ok" and (near["cell_row"], near["cell_col"]) == (4, 4)
    assert near["limit_km"] == pytest.approx(0.75 * cells.cell_diagonal_km(GEOM, 25.0), abs=1e-3)


def test_domain_box_and_world_wrap():
    assert cells.assign(GEOM, np.ones((5, 5), bool), 30.0, -155.0)["status"] == "out_of_domain"
    world = cells.geometry(181, 83, (-180.0, -80.0, 180.0, 84.0))
    assert cells.in_domain(world, 21.0, 179.9) and cells.in_domain(world, 21.0, -179.9)
    assert not cells.in_domain(world, 85.0, 0.0)


def test_grid_hash_changes_with_mask_and_geometry():
    wet = np.ones((5, 5), dtype=bool)
    h = cells.grid_hash(GEOM, wet)
    wet2 = wet.copy()
    wet2[2, 2] = False
    assert cells.grid_hash(GEOM, wet2) != h
    assert cells.grid_hash(cells.geometry(5, 5, (-160.0, 15.0, -150.0, 25.5)), wet) != h
    assert cells.grid_hash(GEOM, wet.ravel()) == h
