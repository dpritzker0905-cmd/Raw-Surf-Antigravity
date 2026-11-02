"""RATED static frames: the Surf Rating band as /grid?surf=1 serves it, as CDN frames (services/frame_set_rating.py, 2026-11-01).

Pins: a rated frame decodes (the client's rule, frame_set_rating.rebuild) to EXACTLY what the served overlay
(grid_resolver_surf.apply_surf_overlay) returns for a crop of the same stored product, node for node, while the plain frame does
not (the positive control); the u32 RATING plane round-trips in both decoders; `ask_offsets_h` holds the asks whose wind choice is
the frame's own and shrinks when hourly wind would change the rating; an unrepresentable node or a wind product missing from the
runner's disk leaves the hour unbuilt (never a frame /grid would not serve); the rated sets are OFF unless FRAME_RATING_SETS=1.
The real /grid?surf=1 route is compared by frontend/scripts/offline-backend/scn_rated_crop_parity.mjs. Offline only.
"""
import asyncio
import gzip
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_rating as fsr  # noqa: E402
from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay  # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, NormalizedProduct, PipelineManifest  # noqa: E402

RUN = "2026-11-01T00:00:00Z"
VALIDS = ["2026-11-01T12:00:00Z", "2026-11-01T15:00:00Z"]
COLS, ROWS = 181, 4                                   # a world span, rows on coasts with real bathymetry (26-32 N)
LAT0 = 26.0
GFS_WAVES = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
GFS_RATED = next(t for t in fsr.RATED_SETS if t["model"] == "GFS" and t["layer"] == "waves")


def _vec(lat, lng, h, d, period, valid=True):
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h if valid else 0.0, "direction": d,
            "u": round(-h * math.sin(rad), 4) if valid else 0.0, "v": round(-h * math.cos(rad), 4) if valid else 0.0,
            "period": period, "gust": None, "value": None, "is_valid": valid, "dir_confidence": 0.9 if valid else None}


def _product(domain, layer, valid, vecs, value_kind="wave_height"):
    return {"model": "GFS", "provider": "test", "domain": domain, "layer": layer, "run_time": RUN, "model_run_time": RUN,
            "model_run_time_status": "known", "ingested_at": RUN, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": value_kind, "value_unit": "m", "display_unit_hint": "ft",
            "source_dataset": "test", "upstream_provider": "test", "region_id": "global_mid", "resolution": 2.0,
            "freshness_sec": 3600, "source_variables": [],
            "coverage": {"west": -180.0, "south": LAT0, "east": 180.0, "north": LAT0 + 2.0 * (ROWS - 1)},
            "grid": {"cols": COLS, "rows": ROWS, "bounds": {"west": -180.0, "south": LAT0, "east": 180.0,
                                                            "north": LAT0 + 2.0 * (ROWS - 1)},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _waves(valid, bump=0.0):
    return _product("marine", "waves", valid, [
        _vec(LAT0 + 2.0 * r, -180.0 + 2.0 * c, round(1.2 + bump + 0.004 * c + 0.2 * r, 3), round((70.0 + 3.0 * c) % 360.0, 2),
             round(9.0 + 0.5 * r + 0.01 * c, 2)) for r in range(ROWS) for c in range(COLS)])


def _wind(valid, spin=0.0):
    return _product("wind", "wind", valid, [
        _vec(LAT0 + 2.0 * r, -180.0 + 2.0 * c, 12.0, round((spin + 5.0 * c) % 360.0, 2), None)
        for r in range(ROWS) for c in range(COLS)], value_kind="wind_speed")


def _name(domain, layer, vt):
    return f"gfs_{domain}_{layer}_global_mid_{vt.replace('-', '').replace(':', '')}.json"


def _entry(domain, layer, vt, est=False):
    return {"model": "GFS", "provider": "test", "domain": domain, "layer": layer, "region_id": "global_mid", "resolution": 2.0,
            "filename": _name(domain, layer, vt), "valid_time_start": vt, "valid_time_end": vt, "model_run_time": RUN,
            "run_time": RUN, "ingested_at": RUN, "is_estimated": est, "freshness_sec": 3600, "is_forecast_authoritative": True,
            "coverage": {"west": -180.0, "south": LAT0, "east": 180.0, "north": LAT0 + 2.0 * (ROWS - 1)}}


def _write(store, wind_valids=VALIDS, skip_wind_files=()):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in VALIDS:
        (store / _name("marine", "waves", vt)).write_text(json.dumps(_waves(vt)))
        entries.append(_entry("marine", "waves", vt))
    for k, vt in enumerate(wind_valids):
        if _name("wind", "wind", vt) not in skip_wind_files:
            (store / _name("wind", "wind", vt)).write_text(json.dumps(_wind(vt, spin=40.0 * k)))
        entries.append(_entry("wind", "wind", vt))
    (store / "manifest.json").write_text(json.dumps({"last_manifest_update": RUN, "products": entries}))


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("RATING_OBS_GATE", "RATING_LOCAL_SIZE", "FRAME_RATING_SETS", "SURF_RATING", "SURF_TRANSFORM"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")


def _publish(store, target, previous_index=None):
    up = []
    index, stats = fs.publish_set(pub.LocalCache(store), None, target, previous_index, up.extend, log=lambda *_: None)
    return index, stats, {p: b for p, b, *_ in up}


def _decoded(index, uploads, vt):
    f = next(f for f in index["frames"] if f["valid_time"] == vt)
    return f, fb.decode_frame(gzip.decompress(uploads[f["path"]])), {**index["common_meta"], **(f.get("meta") or {})}


def _client_vectors(stored_vectors, codes):
    """The client's rebuild (staticFrameCodec.buildVectors' rating step) applied to the stored vectors."""
    return [fsr.rebuild(v, int(c or 0)) for v, c in zip(stored_vectors, codes)]


class _Store:
    def __init__(self, store):
        self.dir = store

    def load_product(self, filename, **kw):
        return NormalizedProduct.model_validate(json.loads((self.dir / filename).read_text()))


def _served_crop(store, vt, west, east):
    """What /grid's overlay serves for a crop [west, east] of the stored product: the served function on the clip itself."""
    prod = NormalizedProduct.model_validate(json.loads((store / _name("marine", "waves", vt)).read_text()))
    prod.grid.vectors = [v for v in prod.grid.vectors if west <= v.lng <= east]
    prod.grid.bounds = CoverageBounds(west=west, south=LAT0, east=east, north=LAT0 + 2.0 * (ROWS - 1))
    manifest = PipelineManifest.model_validate(json.loads((store / "manifest.json").read_text()))
    from datetime import datetime
    out = asyncio.run(apply_surf_overlay(prod, store=_Store(store), manifest=manifest, model="GFS", domain="marine", layer="waves",
                                         surf=True, target_dt=datetime.fromisoformat(vt.replace("Z", "+00:00"))))
    assert (out.grid.diagnostics.get("surf_transform") or {}).get("value_kind") == "surf_rating"
    return {(v.lat, v.lng): v.model_dump() for v in out.grid.vectors}


def test_a_rated_frame_rebuilds_what_the_overlay_serves_for_a_crop_and_the_plain_frame_does_not(tmp_path):
    _write(tmp_path / "s")
    index, stats, uploads = _publish(tmp_path / "s", GFS_RATED)
    plain, _, plain_up = _publish(tmp_path / "s", GFS_WAVES)
    assert stats["built"] == 2 and stats["rating_refused"] == 0 and stats["parity_bad"] == 0
    assert stats["rated_nodes"] > 0 and stats["masked_nodes"] > 0
    for vt in VALIDS:
        f, dec, meta = _decoded(index, uploads, vt)
        pf, pdec, _ = _decoded(plain, plain_up, vt)
        assert fb.RATING in dec["fields"] and fb.RATING not in pdec["fields"]
        for fid in fb.DEFAULT_FIELDS:                 # the stored product's planes are byte-identical to the plain frame's
            assert dec["fields"][fid] == pdec["fields"][fid]
        stored = json.loads((tmp_path / "s" / _name("marine", "waves", vt)).read_text())["grid"]["vectors"]
        mine = _client_vectors(stored, dec["fields"][fb.RATING])
        plain_mine = _client_vectors(stored, [0] * len(stored))
        for west, east in ((-100.0, 20.0), (-178.0, -20.0), (40.0, 178.0)):       # three crops, each a real sub-350 extent
            served = _served_crop(tmp_path / "s", vt, west, east)
            diff = plain_diff = 0
            for m, p in zip(mine, plain_mine):
                if not (west <= m["lng"] <= east):
                    continue
                g = served[(m["lat"], m["lng"])]
                for k in ("speed", "is_valid", "phys_speed"):
                    diff += fsr._written(m, k) != fsr._written(g, k)
                    plain_diff += fsr._written(p, k) != fsr._written(g, k)
            assert diff == 0
            assert plain_diff > 0                     # the control: the plain frame is not the band
        assert meta["is_estimated"] is True and meta["diagnostics"]["surf_transform"]["value_kind"] == "surf_rating"
        # wind at 12Z and 15Z only: asks up to 13Z read the 12Z wind, from 14Z the 15Z wind (the nearest one wins)
        assert meta["ask_offsets_h"] == ([-3, -2, -1, 0, 1] if vt == VALIDS[0] else [-1, 0, 1, 2, 3])
    assert index["rating_chain"]["env"]["RATING_OBS_GATE"] is None and index["rating"]["via"].endswith("apply_surf_overlay")
    assert index["set"] == "GFS/marine/waves/global_mid_rated" and index["path"].startswith("v1/gfs/marine/waves/global_mid_rated/")


def test_hourly_wind_narrows_the_ask_offsets_to_the_frame_hour(tmp_path):
    hourly = ["2026-11-01T%02d:00:00Z" % h for h in range(9, 19)]
    _write(tmp_path / "s", wind_valids=hourly)
    index, stats, _ = _publish(tmp_path / "s", GFS_RATED)
    assert stats["built"] == 2
    assert all({**index["common_meta"], **(f.get("meta") or {})}["ask_offsets_h"] == [0] for f in index["frames"])


def test_a_wind_product_missing_from_disk_leaves_the_hour_unbuilt(tmp_path):
    _write(tmp_path / "s", skip_wind_files=(_name("wind", "wind", VALIDS[1]),))
    index, stats, _ = _publish(tmp_path / "s", GFS_RATED, None)
    assert stats["rating_refused"] >= 1
    assert any(f["path"] is None and f["unbuilt"] == "rating_refused" for f in index["frames"]) if index else True


def test_an_unrepresentable_node_is_refused():
    stored = _vec(28.0, -80.0, 1.5, 90.0, 10.0)
    with pytest.raises(ValueError):                   # a rated node on a cell the stored product calls no data
        fsr.rating_code(dict(stored, is_valid=False), dict(stored, is_valid=False, speed=4.2, phys_speed=1.5))
    with pytest.raises(ValueError):                   # the rating must never move u / v / direction / period
        fsr.rating_code(stored, dict(stored, u=0.0, speed=4.2, phys_speed=1.5))
    assert fsr.rating_code(stored, dict(stored)) == fsr.UNTOUCHED
    assert fsr.rating_code(stored, dict(stored, is_valid=False, phys_speed=1.5)) == fsr.MASKED
    assert fsr.rating_code(stored, dict(stored, speed=6.2345, phys_speed=1.5)) == fsr.RATED_BASE + 62345
    assert fsr.rebuild(stored, fsr.RATED_BASE + 62345)["speed"] == 6.2345


def test_the_u32_rating_plane_round_trips_in_both_decoders():
    vecs = [_vec(LAT0 + 2.0 * r, -180.0 + 2.0 * c, 1.0, 0.0, 9.0) for r in range(ROWS) for c in range(COLS)]
    codes = [0, 1, 2, 100002, 65537, 16777217] * (len(vecs) // 6) + [3] * (len(vecs) % 6)
    for v, k in zip(vecs, codes):
        v["_rating_code"] = k
    raw = fb.encode_frame(_product("marine", "waves", VALIDS[0], vecs), fb.RATED_FIELDS)
    assert [int(x) for x in fb.decode_frame(raw)["fields"][fb.RATING]] == codes
    _, planes = fb.decode_plane(raw)
    assert [int(x) for x in planes[fb.RATING].ravel()] == codes
    assert fb.parity(_product("marine", "waves", VALIDS[0], vecs), fb.decode_frame(raw))["bad"] == 0


def test_rated_sets_are_off_unless_switched_on(monkeypatch, tmp_path):
    assert not fsr.enabled()
    assert not any(fsr.is_rated(t) for t in pub.selected_sets())
    _write(tmp_path / "s")
    assert pub.main(["--store-dir", str(tmp_path / "s"), "--out-dir", str(tmp_path / "o"), "--only", "rated"]) == 0   # off: no-op
    assert not (tmp_path / "o" / "v1" / "latest.json").exists()
    monkeypatch.setenv("FRAME_RATING_SETS", "1")
    assert fsr.enabled()
    assert [fs.set_key(t) for t in pub.selected_sets(fsr.RATED_SETS)][0] == "GFS/marine/waves/global_mid_rated"


def test_a_rated_regional_bundle_builds_for_a_tile_on_one_side_of_the_split(tmp_path, monkeypatch):
    """A pilot tile lies entirely west of 0 deg (the east half is empty): the rated bundle still builds, every slice carries the
    RATING plane, and the rated step publishes the regional waves bundles first (they are what the band paints from)."""
    from services import frame_set_bundle as fsb
    store = tmp_path / "s"
    _write(store)
    fl = {"west": -82.0, "south": 26.0, "east": -79.0, "north": 30.0}
    cols, rows = 13, 17                                           # 0.25 deg
    vecs = [_vec(26.0 + 0.25 * r, -82.0 + 0.25 * c, round(1.4 + 0.01 * c, 3), 90.0, 10.0) for r in range(rows) for c in range(cols)]
    man = json.loads((store / "manifest.json").read_text())
    for vt in VALIDS:
        p = dict(_waves(vt), region_id="florida_east_coast", resolution=0.25, coverage=fl,
                 grid={"cols": cols, "rows": rows, "bounds": fl, "vectors": vecs, "diagnostics": {}})
        name = f"gfs_marine_waves_florida_east_coast_{vt.replace('-', '').replace(':', '')}.json"
        (store / name).write_text(json.dumps(p))
        man["products"].append(dict(_entry("marine", "waves", vt), region_id="florida_east_coast", resolution=0.25, coverage=fl,
                                    filename=name))
    (store / "manifest.json").write_text(json.dumps(man))
    target = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "florida_east_coast", "bundle": True,
              "variant": fsr.VARIANT}
    up = []
    index, stats = fsb.publish_bundle_set(pub.LocalCache(store), None, target, None, up.extend, log=lambda *_: None)
    assert index is not None and stats["built"] == 2 and stats["rating_refused"] == 0
    assert index["set"] == "GFS/marine/waves/florida_east_coast_rated" and index["rating_chain"]["code_sha12"]
    blob = up[0][1]
    for f in index["frames"]:
        dec = fb.decode_frame(gzip.decompress(blob[f["offset"]:f["offset"] + f["length"]]))
        assert fb.RATING in dec["fields"]
    order = [fs.set_key(t) for t in fsr.rated_publish_sets()]
    assert order[0].endswith("_rated") and order[0].split("/")[2] == "waves" and order[0].split("/")[3] != "global_mid_rated"
    assert order.index("GFS/marine/waves/global_mid_rated") < order.index(next(k for k in order if k.split("/")[2] == "swell_1"))
    monkeypatch.setenv("FRAME_RATING_REGIONAL", "0")
    assert fsr.rated_regional_sets() == ()
