"""Gate (1a) of the 0.5-degree world tier, in CI (2026-11-16; docs/weather-program/log/2026-11-16-opus-world-0p5-tier.md):
the vectorized chain (reduce_hour -> layer_planes -> tile_frame) must give EXACTLY the bytes of the real chain
(fetch_global_coarse -> Normalizer.normalize -> frame_binary.encode_frame) for every marine layer, on the loop-shadow suite's
stubbed GRIB (structured fields, a land band, a zero-energy cell). Plus the registered seeded negatives: one node changed by one
quantum, a tile shifted one node, and a wrong hour must each fail the comparison.
"""
from datetime import datetime

import numpy as np
import pytest

from services import frame_binary as fb
from services import world_tiles_0p5 as wt
from services.weather_pipeline.normalizer import WeatherNormalizer as Normalizer
from tests.test_vector_blockmean_loop_shadow import _GLAT, _GLON, _Msg, _run

BBOX = {"west": -40.0, "south": -30.0, "east": 40.0, "north": 30.0}


def _reference(monkeypatch, part_conf):
    points, _ok, _failed, times = _run(monkeypatch, "1", part_conf=part_conf, resolution=wt.RES, bbox=BBOX)
    assert points and times
    return points, times


def _ours_series(part_conf, monkeypatch):
    monkeypatch.setenv("NOAA_PARTITION_DIR_CONFIDENCE", part_conf)
    F = wt._fetcher()
    arrs = {om: _Msg(i).values for i, om in enumerate(F.OM_ORDER)}
    lats, lons = wt.axis(BBOX["south"], BBOX["north"], wt.RES), wt.axis(BBOX["west"], BBOX["east"], wt.RES)
    rs, cs = wt.node_indices(_GLAT[:, 0], _GLON[0, :], lats, lons)
    return wt.reduce_hour(arrs, rs, cs), lats, lons


def _ref_frame(points, times, layer):
    t0 = datetime.fromisoformat(times[0].replace("Z", "+00:00"))
    product = Normalizer().normalize(model="GFS", provider="open-meteo", domain="marine", layer=layer, raw_results=points,
                                     bbox=BBOX, resolution=wt.RES, target_time=t0, run_time=t0,
                                     region_id="global_mid", coverage_mode="global_tile")
    d = product.model_dump(mode="json")
    return fb.encode_frame(d), d


@pytest.mark.parametrize("part_conf", ["1", "0"])
@pytest.mark.parametrize("layer", wt.LAYERS)
def test_the_vectorized_tile_is_byte_identical_to_the_real_chain(monkeypatch, layer, part_conf):
    points, times = _reference(monkeypatch, part_conf)
    ref_raw, prod = _ref_frame(points, times, layer)
    series, lats, lons = _ours_series(part_conf, monkeypatch)
    planes = wt.layer_planes(series, layer, len(lats), len(lons), mirror=False)
    ours = wt.tile_frame(planes, 0, len(lats), 0, len(lons), lats, lons, fb._epoch(prod["valid_time"]),
                         fb._epoch(prod["model_run_time"]))
    assert ours == ref_raw


def test_seeded_negatives_fail_the_comparison(monkeypatch):
    """(1a) is a plumbing identity: it must SEE a one-quantum change, a one-node shift and a wrong hour."""
    points, times = _reference(monkeypatch, "1")
    ref_raw, prod = _ref_frame(points, times, "swell_1")   # the stub's swell heights are 0-8 m
    series, lats, lons = _ours_series("1", monkeypatch)
    planes = wt.layer_planes(series, "swell_1", len(lats), len(lons), mirror=False)
    ve, re_ = fb._epoch(prod["valid_time"]), fb._epoch(prod["model_run_time"])
    nudged = {k: v.copy() for k, v in planes.items()}
    # a node under the u16 height ceiling (the stub draws some "heights" up to 360 m, which the encoder clamps at 65.534 m)
    r, c = np.argwhere(nudged["valid"] & (nudged["speed"] < 60.0))[0]
    nudged["speed"][r, c] += 0.001                                    # one quantum of height
    assert wt.tile_frame(planes, 0, len(lats), 0, len(lons), lats, lons, ve, re_) == ref_raw   # the control: identical as built
    assert wt.tile_frame(nudged, 0, len(lats), 0, len(lons), lats, lons, ve, re_) != ref_raw
    # Every node shifted east. The STUB's native cells are ~15 deg wide, so neighbouring 0.5-deg nodes read the same cell and a
    # one-column shift is invisible HERE (on the real 0.25-deg grid each node reads its own 2 x 2 block); 37 columns crosses a cell.
    shifted = {k: np.roll(v, 37, axis=1) for k, v in planes.items()}
    assert wt.tile_frame(shifted, 0, len(lats), 0, len(lons), lats, lons, ve, re_) != ref_raw
    assert wt.tile_frame(planes, 0, len(lats), 0, len(lons), lats, lons, ve + 3 * 3600, re_) != ref_raw


def test_world_axes_and_tiles_cover_the_globe_once_with_shared_edges():
    lats, lons, grid_lons = wt.world_axes()
    assert (len(lats), len(lons), len(grid_lons)) == (331, 720, 721) and grid_lons[-1] == 180.0
    blocks = wt.tile_blocks(lats, grid_lons)
    assert len(blocks) == 72
    covered = np.zeros((len(lats), len(grid_lons)), int)
    for _tid, r0, r1, c0, c1 in blocks:
        covered[r0:r1, c0:c1] += 1
    assert covered.min() >= 1                                         # every node in a tile; shared edges in two or four


def test_a_layer_hour_bundle_is_independent_gzip_members_with_byte_ranges():
    lats, lons, grid_lons = wt.world_axes()
    rows, cols = len(lats), len(lons)
    rng = np.random.default_rng(3)
    series = {k: rng.uniform(0.1, 5.0, rows * cols) for k in ("wave_height", "wave_period")}
    series["wave_direction"] = rng.uniform(0, 360, rows * cols)
    series["wave_direction_confidence"] = rng.uniform(0, 1, rows * cols)
    planes = wt.layer_planes(series, "waves", rows, cols)
    blob, recs = wt.layer_hour_bundle(planes, lats, grid_lons, 1.0e9, 1.0e9)
    assert len(recs) == 72 and recs[0]["offset"] == 0 and recs[-1]["offset"] + recs[-1]["length"] == len(blob)
    raw = wt.gunzip_member(blob, recs[5])
    head, fields = fb.decode_plane(raw)
    assert (head["cols"], head["rows"]) == (recs[5]["cols"], recs[5]["rows"]) and list(head["bounds"]) == recs[5]["bounds"]
    assert wt.sha12(blob[recs[5]["offset"]:recs[5]["offset"] + recs[5]["length"]]) == recs[5]["sha12"]


def test_the_tier_refuses_dominant_swell_stamping_rather_than_drawing_another_direction(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    with pytest.raises(RuntimeError, match="DOMINANT_SWELL"):
        wt.layer_planes({"wave_height": [1.0], "wave_direction": [1.0], "wave_period": [1.0]}, "waves", 1, 1)


# ── the hook in the GFS-Wave pass (payload `world_tiles_dir`) ───────────────────────────────────────────────────────────

def _run_with_world(monkeypatch, world_dir):
    import services.noaa_gfs_wave_fetcher as fetcher
    orig = fetcher.fetch_global_coarse
    monkeypatch.setattr(fetcher, "fetch_global_coarse", lambda p, _o=orig: _o({**p, "world_tiles_dir": world_dir}))
    try:
        return _run(monkeypatch, "1", resolution=1.0, bbox={"west": -20.0, "south": -20.0, "east": 20.0, "north": 20.0})
    finally:
        monkeypatch.setattr(fetcher, "fetch_global_coarse", orig)


def test_the_pass_writes_the_tier_and_its_own_payload_is_unchanged(monkeypatch, tmp_path):
    import json
    plain = _run(monkeypatch, "1", resolution=1.0, bbox={"west": -20.0, "south": -20.0, "east": 20.0, "north": 20.0})
    with_world = _run_with_world(monkeypatch, str(tmp_path))
    assert json.dumps(with_world, sort_keys=True, default=str) == json.dumps(plain, sort_keys=True, default=str)
    hours = len(plain[3])
    for layer in wt.LAYERS:
        recs = [json.loads(x) for x in (tmp_path / layer / "index.jsonl").read_text().splitlines()]
        assert len(recs) == hours and all(len(r["tiles"]) == 72 for r in recs)
        blob = (tmp_path / layer / recs[0]["file"]).read_bytes()
        assert len(blob) == recs[0]["bytes"] and wt.sha12(blob) == recs[0]["sha12"]
        assert fb.decode_plane(wt.gunzip_member(blob, recs[0]["tiles"][0]))[0]["cols"] == recs[0]["tiles"][0]["cols"]


def test_a_failing_tier_never_breaks_the_pass(monkeypatch, tmp_path, capsys):
    import json
    plain = _run(monkeypatch, "1", resolution=1.0, bbox={"west": -20.0, "south": -20.0, "east": 20.0, "north": 20.0})

    def boom(*a, **k):
        raise RuntimeError("synthetic tier failure")
    monkeypatch.setattr(wt, "write_hour", boom)
    with_world = _run_with_world(monkeypatch, str(tmp_path))
    assert json.dumps(with_world, sort_keys=True, default=str) == json.dumps(plain, sort_keys=True, default=str)
    assert "world tier stopped" in capsys.readouterr().err
