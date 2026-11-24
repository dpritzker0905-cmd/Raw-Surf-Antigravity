"""Publish-time physics check (services/frame_physics_check.py, scripts/frame_physics_report.py): every rule is pinned by a
PLANTED violation it must catch and a clean twin it must pass, and the script is proven report-only (exit 0, nothing written to
the frames tree, the kill switch reads nothing)."""
import json
import math

import numpy as np
import pytest

from services import frame_binary as fb
from services import frame_physics_check as fpc
from scripts import frame_physics_report as fpr

RUN = "2026-11-23T12:00:00Z"
BOUNDS = (-10.0, -10.0, 10.0, 10.0)   # 3 x 3 cells, 10 deg apart


def _plane(v, shape=(3, 3)):
    return np.full(shape, float(v))


def _planes(total=2.0, s1=1.5, s2=0.5, ww=0.8, period=12.0):
    out = {"waves": {"height_m": _plane(total), "period_s": _plane(period)}}
    for layer, v in (("swell_1", s1), ("swell_2", s2), ("wind_waves", ww)):
        out[layer] = {"height_m": _plane(v), "period_s": _plane(period)}
    return out


# ------------------------------------------------------------------ R1 partition <= total

def test_r1_clean_sea_passes():
    row = fpc.check_time("GFS", RUN, _planes())
    assert row["cells_checked"] == 9
    assert row["partition_le_total"]["violations"] == 0


def test_r1_planted_swell_above_total_is_caught_with_its_cell():
    p = _planes()
    p["swell_1"]["height_m"][1, 2] = 4.77            # the rescan's ICON 240 h worst cell: total 0.63, swell 4.77
    p["waves"]["height_m"][1, 2] = 0.63
    row = fpc.check_time("ICON", RUN, p, lat=[-10.0, 0.0, 10.0], lng=[-10.0, 0.0, 10.0])
    r1 = row["partition_le_total"]
    assert r1["violations"] == 1 and r1["rate"] == round(1 / 9, 4)
    w = r1["worst"][0]
    assert (w["row"], w["col"], w["lat"], w["lng"]) == (1, 2, 0.0, 10.0)
    assert w["total_m"] == 0.63 and w["partitions_m"]["swell_1"] == 4.77


def test_r1_tolerance_is_five_centimetres():
    within = fpc.check_time("GFS", RUN, _planes(total=1.0, s1=1.04, s2=0.1, ww=0.1))
    beyond = fpc.check_time("GFS", RUN, _planes(total=1.0, s1=1.06, s2=0.1, ww=0.1))
    assert within["partition_le_total"]["violations"] == 0
    assert beyond["partition_le_total"]["violations"] == 9


# ------------------------------------------------------------------ R2 energy closure

def test_r2_closed_energy_passes():
    # 1.5^2 + 0.5^2 + 0.8^2 = 3.14 <= 1.1 x 4.0
    assert fpc.check_time("GFS", RUN, _planes())["energy_closure"]["violations"] == 0


def test_r2_planted_excess_energy_is_caught_even_when_every_partition_is_below_total():
    # each partition < total (R1 passes), but 1.5^2 + 1.5^2 + 1.5^2 = 6.75 > 1.1 x 2.0^2 = 4.4
    row = fpc.check_time("EURO", RUN, _planes(total=2.0, s1=1.5, s2=1.5, ww=1.5))
    assert row["partition_le_total"]["violations"] == 0
    assert row["energy_closure"]["violations"] == 9
    assert row["energy_closure"]["worst"][0]["total_m"] == 2.0


def test_r2_under_closure_is_reported_never_failed():
    row = fpc.check_time("GFS", RUN, _planes(total=2.0, s1=0.5, s2=0.2, ww=0.2))
    assert row["energy_closure"]["violations"] == 0
    assert row["energy_closure"]["under_closed_lt_half"] == 9


def test_r1_r2_skip_near_calm_cells_and_count_totals_with_no_partition():
    p = _planes()
    p["waves"]["height_m"][0, 0] = 0.1                # below MIN_TOTAL_M: not checked
    p["swell_1"]["height_m"][0, 0] = 3.0
    for layer in ("swell_1", "swell_2", "wind_waves"):
        p[layer]["height_m"][2, 2] = np.nan           # a total with no partition (the rescan's 2,089 EURO cells)
    row = fpc.check_time("EURO", RUN, p)
    assert row["cells_checked"] == 7
    assert row["partition_le_total"]["violations"] == 0
    assert row["total_without_partition"] == 1


def test_r1_r2_grid_mismatch_is_skipped_and_said():
    p = _planes()
    p["swell_1"]["height_m"] = _plane(1.0, (2, 2))
    row = fpc.check_time("EURO", RUN, p)
    assert "partition_le_total" not in row and any("grid mismatch" in s for s in row["skipped"])


# ------------------------------------------------------------------ R3 no valid zero

def test_r3_planted_valid_zero_is_caught_per_layer():
    p = _planes()
    p["waves"]["height_m"][0, 1] = 0.0
    p["waves"]["period_s"][0, 1] = 0.0
    p["swell_1"]["height_m"][2, 0] = 0.0
    p["swell_1"]["period_s"][2, 0] = np.nan            # zero height and no period: also data-shaped nothing
    row = fpc.check_time("ICON", RUN, p)
    z = row["no_valid_zero"]
    assert z["waves"]["zero"] == 1 and z["swell_1"]["zero"] == 1 and z["wind_waves"]["zero"] == 0
    assert z["waves"]["valid"] == 9


def test_r3_masked_cells_and_zero_height_with_a_period_are_not_zeros():
    p = _planes()
    p["waves"]["height_m"][0, 0] = np.nan             # masked (no data): fine
    p["waves"]["height_m"][1, 1] = 0.0                # a calm sea with a real period: not the defect
    row = fpc.check_time("ICON", RUN, p)
    assert row["no_valid_zero"]["waves"] == {"valid": 8, "zero": 0, "rate": 0.0, "class": None}


# ------------------------------------------------------------------ R4 one source and one run per model button

def _index(layer, frames, common=None, run=RUN):
    return {"set": f"EURO/marine/{layer}/global_mid", "run": run, "common_meta": common or {}, "frames": frames}


def _f(vt, run=RUN, src="ecmwf_wam025", est=False, basis=None, path=True):
    meta = {"model_run_time": run, "source_dataset": src}
    if est:
        meta.update(is_estimated=True, estimate_basis={"type": basis} if basis else None)
    return {"valid_time": vt, "is_estimated": est, "path": f"v1/x/{vt}.bin" if path else None, "meta": meta}


def test_r4_one_source_one_run_passes():
    idx = {layer: _index(layer, [_f("2026-11-24T00:00:00Z"), _f("2026-11-24T03:00:00Z")]) for layer in fpc.MARINE_LAYERS}
    p = fpc.provenance("EURO", idx)
    assert p["violation"] is False and p["frames_off_newest_run"] == 0


def test_r4_planted_partitions_from_another_model_and_run_are_caught():
    """Rescan finding 2: EURO partitions = Copernicus MFWAM 00Z, EURO total = ECMWF 12Z."""
    cmems = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    idx = {"waves": _index("waves", [_f("2026-11-24T00:00:00Z")]),
           "swell_1": _index("swell_1", [_f("2026-11-24T00:00:00Z", run="2026-11-23T00:00:00Z", src=cmems)])}
    p = fpc.provenance("EURO", idx)
    assert p["violation"] is True
    assert p["sources"] == {"ecmwf_wam025": ["waves"], cmems: ["swell_1"]}
    assert p["newest_run"] == RUN and p["frames_off_newest_run"] == 1


def test_r4_planted_old_run_interpolation_interleaved_is_caught():
    """Rescan finding 4: native_time_interpolation frames of runs 1-3 days older between fresh 12Z frames."""
    frames = [_f("2026-11-29T12:00:00Z"),
              _f("2026-11-29T15:00:00Z", run="2026-11-20T12:00:00Z", src="estimated_interpolation", est=True,
                 basis="native_time_interpolation"),
              _f("2026-11-29T18:00:00Z")]
    p = fpc.provenance("EURO", {"waves": _index("waves", frames)})
    assert p["violation"] is True
    assert p["sources"] == {"ecmwf_wam025": ["waves"]}   # the interpolation's label is not a second source; its RUN is the defect
    assert p["examples"][0] == {"layer": "waves", "valid_time": "2026-11-29T15:00:00Z", "class": "native_interp",
                                "run": "2026-11-20T12:00:00Z", "newest_run": RUN}


def test_r4_the_locked_tail_blend_is_listed_not_failed():
    frames = [_f("2026-11-24T00:00:00Z"),
              _f("2026-12-05T00:00:00Z", run="2026-11-23T06:00:00Z", src="gfs_blend", est=True,
                 basis="euro_persistence_gfs_icon_blend")]
    p = fpc.provenance("EURO", {"waves": _index("waves", frames)})
    assert p["violation"] is False
    assert p["by_class"]["tail:euro_persistence_gfs_icon_blend"]["frames"] == 1


def test_r4_reads_common_meta_and_ignores_unbuilt_frames():
    frames = [{"valid_time": "2026-11-24T00:00:00Z", "path": "a.bin", "meta": {}},
              _f("2026-11-24T03:00:00Z", run="2026-11-01T00:00:00Z", path=False)]
    p = fpc.provenance("EURO", {"waves": _index("waves", frames, common={"model_run_time": RUN, "source_dataset": "ecmwf_wam025"})})
    assert p["violation"] is False and p["runs"] == {RUN: 1}


# ------------------------------------------------------------------ sampling, roll-up, markdown

def test_sample_times_lead_zero_then_every_step():
    frames = [{"valid_time": f"2026-11-{23 + h // 24:02d}T{12 + h % 24 - (24 if 12 + h % 24 >= 24 else 0):02d}:00:00Z", "path": "p"}
              for h in range(0, 100, 3)]
    idx = {"run": RUN, "frames": frames}
    got = fpc.sample_times(idx, 24, 15)
    leads = [fpc._lead_h(v, RUN) for v in got]
    assert leads[0] == 0 and all(b - a >= 24 for a, b in zip(leads, leads[1:]))
    assert fpc.sample_times(idx, 24, 2) == got[:2]


def test_pick_frame_prefers_authoritative():
    idx = {"frames": [_f("T", est=True, basis="x"), _f("T")]}
    assert fpc.pick_frame(idx, "T")["is_estimated"] is False


def test_summary_and_verdicts_name_the_violating_model():
    bad = fpc.check_time("ICON", RUN, _planes(total=0.63, s1=4.77))
    good = fpc.check_time("GFS", RUN, _planes())
    s = fpc.summarize([], [bad, good])
    v = fpc.verdicts(s)
    assert v["partition_le_total"] == ["ICON"] and v["energy_closure"] == ["ICON"]
    assert s["ICON"]["partition_le_total"]["max_rate"] == 1.0
    md = fpc.markdown({"summary": s, "verdicts": v})
    assert "report-only" in md and "| ICON |" in md


# ------------------------------------------------------------------ the script end to end: real frames, report-only

def _frame(height, period):
    """A real frame through the publisher's own encoder (encode_frame on a stored-product dict); NaN height = masked."""
    rows, cols = height.shape
    vectors = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = fb.node_position(r, c, cols, rows, BOUNDS)
            h = float(height[r, c])
            vectors.append({"lat": lat, "lng": lng, "speed": h if np.isfinite(h) else None, "is_valid": bool(np.isfinite(h)),
                            "direction": 270.0, "period": float(period[r, c])})
    product = {"valid_time": RUN, "model_run_time": RUN, "grid": {"cols": cols, "rows": rows, "vectors": vectors}}
    return fb.gzip_frame(fb.encode_frame(product))


def _publish_tree(root, total, swell):
    """A minimal frames tree as publish_frame_images writes it: latest.json -> indexes -> frames."""
    sets = {}
    for model in ("ICON",):
        for layer, h in (("waves", total), ("swell_1", swell)):
            fpath = f"v1/{model.lower()}/marine/{layer}/global_mid/r/f.bin"
            ipath = f"v1/{model.lower()}/marine/{layer}/global_mid/index/i.json"
            (root / fpath).parent.mkdir(parents=True, exist_ok=True)
            (root / fpath).write_bytes(_frame(h, _plane(10.0)))
            index = {"run": RUN, "common_meta": {"model_run_time": RUN, "source_dataset": "dwd_gwam"},
                     "frames": [{"valid_time": RUN, "is_estimated": False, "path": fpath, "meta": {}}]}
            (root / ipath).parent.mkdir(parents=True, exist_ok=True)
            (root / ipath).write_text(json.dumps(index))
            sets[f"{model}/marine/{layer}/global_mid"] = {"index": ipath}
    (root / "v1").mkdir(exist_ok=True)
    (root / "v1/latest.json").write_text(json.dumps({"sets": sets, "written_at": RUN}))


def _snapshot(root):
    return sorted((str(p.relative_to(root)), p.read_bytes()) for p in root.rglob("*") if p.is_file())


def test_script_end_to_end_catches_a_planted_violation_and_writes_nothing_to_the_frames(tmp_path, monkeypatch):
    frames = tmp_path / "frames"
    total = _plane(1.0)
    total[0, 0] = 0.0                                  # R3: a valid zero ...
    swell = _plane(0.5)
    swell[2, 2] = 3.0                                  # R1 + R2: swell above total
    _publish_tree(frames, total, swell)
    period0 = _plane(10.0)
    period0[0, 0] = 0.0
    (frames / "v1/icon/marine/waves/global_mid/r/f.bin").write_bytes(_frame(total, period0))   # ... with period 0
    before = _snapshot(frames)
    out = tmp_path / "report.json"
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.delenv("FRAME_PHYSICS_CHECK", raising=False)
    assert fpr.main(["--frames-dir", str(frames), "--out", str(out)]) == 0
    assert _snapshot(frames) == before                 # report-only: not one byte of the published tree changed
    rep = json.loads(out.read_text())
    assert rep["frames_read"] == 2
    v = rep["verdicts"]
    assert v["partition_le_total"] == ["ICON"] and v["energy_closure"] == ["ICON"] and v["no_valid_zero"] == ["ICON"]
    assert v["one_source_one_run"] == []
    w = rep["times"][0]["partition_le_total"]["worst"][0]
    assert (w["lat"], w["lng"], w["partitions_m"]["swell_1"]) == (10.0, 10.0, 3.0)
    assert "Frame physics check" in summary.read_text()


def test_script_kill_switch_reads_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("FRAME_PHYSICS_CHECK", "0")
    monkeypatch.setattr(fpr, "_sink_reader", lambda d, b=None: pytest.fail("killed: must not open a sink"))
    out = tmp_path / "r.json"
    assert fpr.main(["--frames-dir", str(tmp_path), "--out", str(out)]) == 0
    assert json.loads(out.read_text()) == {"version": 1, "killed": True}


def test_script_failure_is_reported_never_raised(tmp_path, monkeypatch):
    monkeypatch.delenv("FRAME_PHYSICS_CHECK", raising=False)

    def boom(_d, _b=None):
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    monkeypatch.setattr(fpr, "_sink_reader", boom)
    out = tmp_path / "r.json"
    assert fpr.main(["--out", str(out)]) == 0
    assert "SUPABASE_URL" in json.loads(out.read_text())["error"]


def test_script_frame_cap_bounds_egress(tmp_path, monkeypatch):
    frames = tmp_path / "frames"
    _publish_tree(frames, _plane(1.0), _plane(0.5))
    monkeypatch.setenv("FRAME_PHYSICS_MAX_FRAMES", "1")
    out = tmp_path / "r.json"
    assert fpr.main(["--frames-dir", str(frames), "--out", str(out)]) == 0
    rep = json.loads(out.read_text())
    assert rep["frames_read"] == 1 and rep["frames_capped"] == 1


def test_tolerances_are_the_rescans_and_far_above_the_codec():
    assert fpc.TOL_PARTITION_M >= 50 * fb.TOLERANCE[fb.HEIGHT]
    assert math.isclose(fpc.TOL_ENERGY_FRAC, 0.10) and math.isclose(fpc.MIN_TOTAL_M, 0.25)


def test_workflow_step_is_read_only_and_runs_after_every_raster_step():
    """Advisor limits on #1264: the step holds no service-role key (it reads the PUBLIC bucket anonymously) and is the last
    step of the ingest job, after every raster publish, so it can never take their time."""
    from pathlib import Path
    wf = (Path(__file__).resolve().parents[2] / ".github/workflows/forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    job = wf.split("\n  served-wave-verify-sample:")[0]
    start = job.index("- name: Frame physics check")
    step = job[start:job.index("- name: Upload the frame physics report")]
    assert "SUPABASE_SERVICE_ROLE_KEY" not in step
    assert "--public-base" in step and "continue-on-error: true" in step
    assert "publish_raster_frames.py" not in job[start:]          # no raster step after it
    assert job.rindex("publish_raster_frames.py") < start
