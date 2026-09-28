"""The shadow A/B can replay SURF_NEARSHORE_MOP (roadmap stage 4) -- and still refuses when it cannot.

The flag feeds `estimate_surf_at(nearshore=...)` a sea from the MOP ingest's blob, which no persisted rating
input carries, so the replay used to REFUSE it as inert. It now reads MOP's sea from an archived ingest run
through `mop_serving.sea_from_blob` (the lookup serving uses), at the frame's requested hour, for the
candidate arm only. These pin: the run chosen is the one the server held when the frames were rated; a
covered spot moves to exactly the height serving would give it and an uncovered one never moves; the
effect is reported over the rows that carry a MOP sea; and with no archive the harness still refuses."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import science_shadow_ab as AB                              # noqa: E402
from services.weather_pipeline import mop_serving as SERVE              # noqa: E402
from services.weather_pipeline.surf_point import (                       # noqa: E402
    estimate_surf_at, resolve_surf_geometry)
from services.weather_pipeline.surf_rating import compute_surf_rating   # noqa: E402

VT = "2026-09-28T06:00:00Z"
PIPELINE = (21.665, -158.051)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for k in ("SURF_NEARSHORE_MOP", "SURF_REFRACTION_KR", "SURF_TIDE_DEPTH", "SURF_HEIGHT_H110",
              "RATING_LOCAL_SIZE", "SURF_PARTITIONS", "RATING_TIDE", "SHADOW_AB_MOP_DIR"):
        monkeypatch.delenv(k, raising=False)
    SERVE._reset_for_test()
    yield monkeypatch
    SERVE._reset_for_test()


def _covered():
    """A covered California spot whose geometry resolves (the replay needs both)."""
    for lat, lng, sid in SERVE._spot_index():
        g = resolve_surf_geometry(lat, lng)
        if g.shore_normal_deg is not None and g.depth_m:
            return lat, lng, sid, g
    pytest.skip("no covered spot with geometry (assets unavailable)")


def _blob(sid, generated_at="2026-09-28T05:00:00+00:00", hs=(0.6, 1.2)):
    return {"generated_at": generated_at, "grids": {"G": {"run": "2026-09-28T00:00:00Z"}},
            "spots": {sid: {"grid": "G", "times": ["2026-09-28T03:00:00Z", "2026-09-28T09:00:00Z"],
                            "hs": list(hs), "tp": [14.0, 14.0], "dp": [270.0, 270.0], "depth_m": 9.5}},
            "stations": {}}


def _row(lat, lng, g, offshore=1.5, tp=13.0, swell_from=None, spot_id="s"):
    """Built THROUGH the production functions so the baseline reproduces."""
    swell_from = g.shore_normal_deg if swell_from is None else swell_from
    wind_from = (g.shore_normal_deg + 180.0) % 360.0
    h, _ = estimate_surf_at(lat, lng, offshore, tp, swell_from, geometry=g)
    score, level = compute_surf_rating(h, tp, 2.0, wind_from_deg=wind_from, shore_normal_deg=g.shore_normal_deg,
                                       swell_from_deg=swell_from, break_depth_m=g.break_depth_m)
    return {"spot_id": spot_id, "name": spot_id, "latitude": lat, "longitude": lng, "score": score,
            "level": level, "surf_height_m": round(h, 3), "period_s": tp,
            "inputs": {"offshore_hs_m": offshore, "swell_from_deg": swell_from, "wind_ms": 2.0,
                       "wind_from_deg": wind_from, "shore_normal_deg": g.shore_normal_deg,
                       **({"break_depth_m": g.break_depth_m} if g.break_depth_m is not None else {})}}


def test_the_run_replayed_is_the_one_the_server_held_when_the_frames_were_rated():
    a = {"generated_at": "2026-09-28T00:10:00+00:00"}
    b = {"generated_at": "2026-09-28T06:10:00+00:00"}
    c = {"generated_at": "2026-09-28T12:10:00+00:00"}
    junk = {"generated_at": "not a time"}
    assert AB.latest_blob_at([c, a, junk, b], "2026-09-28T11:00:00+00:00") is b
    assert AB.latest_blob_at([c, a, b], "2026-09-28T06:10:00Z") is b, "a blob written AT the cutoff was held"
    assert AB.latest_blob_at([c, b], "2026-09-28T01:00:00Z") is None, "never a run written after the frames"
    assert AB.latest_blob_at([a, c, b], None) is c, "no cutoff known: the newest"
    assert AB.latest_blob_at([], None) is None


def test_a_covered_spot_moves_to_exactly_what_serving_gives_it_and_nothing_else_moves():
    lat, lng, sid, g = _covered()
    ca = _row(lat, lng, g, spot_id="ca")
    pipe_g = resolve_surf_geometry(*PIPELINE)
    pipe = _row(*PIPELINE, pipe_g, offshore=2.0, tp=14.0, swell_from=315.0, spot_id="pipe")
    blob = _blob(sid)
    rep = AB.replay_frames([{"valid_time": VT, "spots": [ca, pipe]}], {"SURF_NEARSHORE_MOP": "1"},
                           mop=AB.MopArchive(blob))
    assert rep["rows_replayable"] == 2 and rep["disqualified"] == 0
    by = {m["spot_id"]: m for m in rep["biggest_upgrades"] + rep["biggest_downgrades"]}
    sea = SERVE.sea_from_blob(blob, lat, lng, VT)
    assert sea and sea["hs"] == pytest.approx(0.9), "06Z sits halfway between the 03Z and 09Z steps"
    want, _ = estimate_surf_at(lat, lng, 1.5, 13.0, g.shore_normal_deg, geometry=g, nearshore=sea)
    assert by["ca"]["cand_height_m"] == pytest.approx(round(want, 3))
    assert by["ca"]["cand_height_m"] != by["ca"]["surf_height_m"] and by["ca"]["mop_hs_m"] == 0.9
    assert by["pipe"]["delta"] == 0.0 and by["pipe"]["cand_height_m"] == by["pipe"]["surf_height_m"]
    assert rep["mop"]["rows_with_sea"] == 1 and rep["mop"]["runs"] == ["2026-09-28T00:00:00Z"]
    assert rep["dep_subset"]["input"] == "mop_sea" and rep["dep_subset"]["rows"] == 1
    # The height's own move, over the ONE row that can move (the unmoved Pipeline row would dilute it to x1).
    ratio = by["ca"]["cand_height_m"] / by["ca"]["surf_height_m"]
    assert rep["height_ratio"]["n"] == 1 and rep["height_ratio"]["median"] == pytest.approx(ratio, abs=2e-3)


def test_an_hour_the_run_does_not_cover_keeps_the_parametric_chain():
    lat, lng, sid, g = _covered()
    rep = AB.replay_frames([{"valid_time": "2026-09-29T06:00:00Z", "spots": [_row(lat, lng, g)]}],
                           {"SURF_NEARSHORE_MOP": "1"}, mop=AB.MopArchive(_blob(sid)))
    m = (rep["biggest_upgrades"] + rep["biggest_downgrades"])[0]
    assert m["delta"] == 0.0 and rep["mop"]["rows_with_sea"] == 0, "never extrapolated past the run"


def test_an_archive_never_leaks_into_another_candidates_arm():
    """A height candidate replayed WITH an archive at hand must not read MOP's sea: only SURF_NEARSHORE_MOP=1
    serves it. The null height candidate (Kr at its own default) must stay the null result."""
    from services.weather_pipeline.surf_transform import REFRACTION_KR
    lat, lng, sid, g = _covered()
    rep = AB.replay_frames([{"valid_time": VT, "spots": [_row(lat, lng, g)]}],
                           {"SURF_REFRACTION_KR": str(REFRACTION_KR)}, mop=AB.MopArchive(_blob(sid)))
    m = (rep["biggest_upgrades"] + rep["biggest_downgrades"])[0]
    assert m["delta"] == 0.0 and "mop_hs_m" not in m and "mop" not in rep


def test_an_unguarded_height_candidate_reports_its_ratio_over_every_row():
    lat, lng, _sid, g = _covered()
    pipe_g = resolve_surf_geometry(*PIPELINE)
    rows = [_row(lat, lng, g, offshore=0.8), _row(*PIPELINE, pipe_g, offshore=1.0, tp=14.0, swell_from=315.0)]
    rep = AB.replay_frames([{"valid_time": VT, "spots": rows}], {"SURF_REFRACTION_KR": "1.0"})
    assert rep["height_ratio"]["n"] == 2 and rep["height_ratio"]["min"] > 1.0, "a larger Kr raises both"
    assert "height_ratio" not in AB.replay_frames([{"spots": rows}], {"RATING_LOCAL_SIZE": "0"}), (
        "a rating-only candidate has no height move to report")


def test_the_control_moves_only_when_an_archive_can_answer():
    _lat, _lng, sid, _g = _covered()
    assert AB.candidate_can_move({"SURF_NEARSHORE_MOP": "1"})["can_move"] is False
    assert AB.candidate_can_move({"SURF_NEARSHORE_MOP": "1"}, mop=AB.MopArchive({"spots": {}}))["can_move"] is False
    assert AB.candidate_can_move({"SURF_NEARSHORE_MOP": "1"}, mop=AB.MopArchive(_blob(sid)))["can_move"] is True


def test_serving_reads_mop_through_the_same_lookup(clean):
    """`nearshore_for_point` and the replay share `sea_from_blob`: flag on, the served sea IS the lookup's."""
    import asyncio
    lat, lng, sid, _g = _covered()
    blob = _blob(sid)
    clean.setenv("SURF_NEARSHORE_MOP", "1")
    clean.setattr(SERVE, "_load_blob", lambda: blob)
    served = asyncio.run(SERVE.nearshore_for_point(lat, lng, VT))
    assert served == SERVE.sea_from_blob(blob, lat, lng, VT) and served["spot_id"] == sid
    assert SERVE.sea_from_blob(blob, lat, lng, "not a time") is None
    assert SERVE.sea_from_blob(blob, 0.0, 0.0, VT) is None, "an uncovered point"
    assert SERVE.sea_from_blob({"spots": {}}, lat, lng, VT) is None, "a spot the run did not answer"


def _main(clean, tmp_path, capsys, rows, frames_generated_at, archive=None):
    f = tmp_path / "frames.json"
    f.write_text(json.dumps({"generated_at": frames_generated_at,
                             "frames": [{"valid_time": VT, "spots": rows}]}), encoding="utf-8")
    argv = ["x", "--candidate", "SURF_NEARSHORE_MOP=1", "--frames-file", str(f)]
    if archive is not None:
        d = tmp_path / "mop_archive" / "1"
        d.mkdir(parents=True)
        (d / "mop_spot_series.json").write_text(json.dumps(archive), encoding="utf-8")
        argv += ["--mop-archive", str(tmp_path / "mop_archive")]
    clean.setattr(sys, "argv", argv)
    code = AB.main()
    return code, capsys.readouterr().out


def test_no_archive_is_REFUSED_not_a_null(clean, tmp_path, capsys):
    lat, lng, _sid, g = _covered()
    code, out = _main(clean, tmp_path, capsys, [_row(lat, lng, g)], "2026-09-28T05:30:00+00:00")
    assert code == 3 and "REFUSED" in out and "SURF_NEARSHORE_MOP" in out and "SHADOW A/B" not in out


def test_an_archive_written_after_the_frames_is_REFUSED(clean, tmp_path, capsys):
    lat, lng, sid, g = _covered()
    code, out = _main(clean, tmp_path, capsys, [_row(lat, lng, g)], "2026-09-28T04:00:00+00:00",
                      archive=_blob(sid, generated_at="2026-09-28T05:00:00+00:00"))
    assert code == 3 and "REFUSED" in out and "1 archived runs" in out


def test_with_the_run_the_report_names_it_and_measures(clean, tmp_path, capsys):
    lat, lng, sid, g = _covered()
    code, out = _main(clean, tmp_path, capsys, [_row(lat, lng, g)], "2026-09-28T05:30:00+00:00",
                      archive=_blob(sid))
    assert code == 0 and "SHADOW A/B" in out
    assert "MOP        ingest blob 2026-09-28T05:00:00+00:00" in out and "a MOP sea for 1 of 1" in out
