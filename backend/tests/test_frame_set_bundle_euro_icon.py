"""EURO / ICON regional bundles (2026-11-01, item 11 "instant everywhere"; services/frame_set_bundle.OTHER_MODEL_SETS, BUILT HIDDEN).

Pins: off by default (FRAME_REGIONAL_BUNDLES_EURO_ICON); on, the sets are EURO waves + ICON waves/swell_1/wind_waves on the 14
EURO/ICON pilot boxes (REGIONAL_CONFIGS + WORLDWIDE_COASTAL_REGIONS, never the GFS-only extras), ordered after EVERY GFS set so
the budget stagger drops them first; an EURO tile builds a bundle whose slices decode to the stored tile (parity 0), with the
estimated tail entries the pilots lane does not hold listed unbuilt (offset null: /grid serves them).
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_bundle as fsb  # noqa: E402
from services.weather_pipeline import pilot_regions as pr  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_frame_set_bundle as base  # noqa: E402  (the GFS bundle tests' product builder)

REGION = "florida_east_coast"
EURO_TARGET = next(t for t in fsb.OTHER_MODEL_SETS if t["model"] == "EURO" and t["region_id"] == REGION)
EURO_KEY = fs.set_key(EURO_TARGET)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_REGIONAL_BUNDLES_EURO_ICON", "FRAME_REGIONAL_BUNDLE_LAYERS", "FRAME_SETS", "FRAME_MIN_COVERAGE"):
        monkeypatch.delenv(k, raising=False)


def test_off_by_default_the_regional_sets_are_gfs_only():
    assert fsb.selected_regional_sets() == fsb.REGIONAL_SETS
    assert all(t["model"] == "GFS" for t in pub.selected_sets() if fsb.is_bundle(t))


def test_on_the_euro_icon_sets_follow_every_gfs_set_on_their_own_boxes(monkeypatch):
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES_EURO_ICON", "1")
    boxes = list(pr.REGIONAL_CONFIGS) + [r for r in pr.WORLDWIDE_COASTAL_REGIONS if r not in pr.REGIONAL_CONFIGS]
    assert len(boxes) == 14 and not set(boxes) & set(pr.GFS_MARINE_EXTRA_REGIONS) and "us_pacific_northwest" not in boxes
    want = [("EURO", "waves", r) for r in boxes] + [("ICON", lyr, r) for lyr in ("waves", "swell_1", "wind_waves") for r in boxes]
    got = [(t["model"], t["layer"], t["region_id"]) for t in fsb.OTHER_MODEL_SETS]
    assert sorted(got) == sorted(want) and len(got) == 56
    assert all(t["bundle"] and t["domain"] == "marine" for t in fsb.OTHER_MODEL_SETS)
    keys = [fs.set_key(t) for t in pub.selected_sets()]
    last_gfs = max(i for i, t in enumerate(pub.selected_sets()) if fsb.is_bundle(t) and t["model"] == "GFS")
    first_other = min(i for i, t in enumerate(pub.selected_sets()) if fsb.is_bundle(t) and t["model"] != "GFS")
    assert first_other == last_gfs + 1 and keys[-56:] == [fs.set_key(t) for t in fsb.OTHER_MODEL_SETS]
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLE_LAYERS", "swell_1")      # the layer filter narrows both groups
    assert {(t["model"], t["layer"]) for t in fsb.selected_regional_sets()} == {("GFS", "swell_1"), ("ICON", "swell_1")}


def _euro_product(valid, run, estimated=False):
    p = base._product(valid, run)
    p.update(model="EURO", provider="open-meteo", source_dataset="ecmwf_wam025", upstream_provider="ecmwf",
             is_estimated=estimated, is_forecast_authoritative=not estimated)
    return p


def _write_euro_store(store, run="2026-10-20T06:00:00Z", tail=3):
    """7 native ECMWF tile frames on this lane's disk + `tail` estimated entries the core lane baked (manifest only, no file)."""
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for i, vt in enumerate(base.VALIDS[: 7 + tail]):
        estimated = i >= 7
        name = f"euro_marine_waves_{REGION}_{vt.replace('-', '').replace(':', '')}.json"
        if not estimated:
            (store / name).write_text(json.dumps(_euro_product(vt, run)))
        entries.append({"model": "EURO", "domain": "marine", "layer": "waves", "region_id": REGION, "filename": name,
                        "valid_time_start": vt, "model_run_time": run, "run_time": run, "ingested_at": run, "is_estimated": estimated})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


def test_an_euro_tile_builds_one_bundle_with_the_core_lane_tail_listed_unbuilt(tmp_path, monkeypatch):
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES_EURO_ICON", "1")
    monkeypatch.setenv("FRAME_SETS", EURO_KEY)
    store, out = tmp_path / "s", tmp_path / "o"
    _write_euro_store(store)
    report = pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=lambda *_: None)
    st = report[EURO_KEY]
    assert (st["built"], st["uploaded"], st["parity_bad"]) == (7, 1, 0) and st["coverage_authoritative"] == 1.0
    rec = json.loads((out / fs.LATEST).read_text())["sets"][EURO_KEY]
    assert rec["bundle"]["path"].startswith("v1/euro/marine/waves/florida_east_coast/") and rec["frames"] == 7
    index = json.loads((out / rec["index"]).read_text())
    built = [f for f in index["frames"] if f["offset"] is not None]
    unbuilt = [f for f in index["frames"] if f["offset"] is None]
    assert len(built) == 7 and len(unbuilt) == 3 and all(f["is_estimated"] for f in unbuilt)
    assert all(not f["is_estimated"] for f in built)
