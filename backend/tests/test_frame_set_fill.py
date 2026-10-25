"""EURO / ICON world frames with the TARGETED Gulf fill baked in (services/frame_set_fill.py, 2026-10-24).

Pins: a filled frame decodes to what /grid's own fill (coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served, the route
function, run on the same products) serves, node for node, with the same `coarse_fill` stamp, while the plain global_mid frame
does not (the positive control); only the targeted mode is baked, and a mode change retires the filled set's record; a missing,
absent or stale donor leaves that hour unbuilt (never an unfilled frame); a new donor run rebuilds the frame; the plain set and
its keys are unchanged. Offline only (LocalCache + LocalSink).
"""
import asyncio
import gzip
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_fill as fsf  # noqa: E402
from services.weather_pipeline import coarse_gulf_fill as cgf  # noqa: E402
from services.weather_pipeline.schemas import NormalizedProduct  # noqa: E402

RUN = "2026-10-24T00:00:00Z"
GFS_RUN = "2026-10-24T06:00:00Z"
VALIDS = ["2026-10-24T12:00:00Z", "2026-10-24T15:00:00Z"]
EURO_FILLED = next(t for t in fsf.FILLED_SETS if t["model"] == "EURO" and t["layer"] == "waves")
EURO_PLAIN = next(t for t in fs.SETS if t["model"] == "EURO" and t["layer"] == "waves" and not t.get("variant"))
COLS, ROWS = 181, 3                                   # a world span (-180..180, 2 deg): the route's fill needs >= 350 deg


def _gfs_sea(r, c):
    return c % 7 != 0                                 # GFS land / ice every 7th column


def _euro_masked(r, c):
    return c % 7 == 0 or c % 5 == 0                   # EURO masks GFS's land AND some GFS sea (the cells the fill takes)


def _vec(lat, lng, h, d, period, valid):
    if not valid:
        return {"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0, "gust": None,
                "value": None, "is_valid": False, "dir_confidence": None}
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4),
            "period": period, "gust": None, "value": None, "is_valid": True, "dir_confidence": 0.9}


def _product(model, valid, run, sea, base, layer="waves"):
    vecs = []
    for r in range(ROWS):
        for c in range(COLS):
            lat, lng = -2.0 + 2.0 * r, -180.0 + 2.0 * c
            vecs.append(_vec(lat, lng, round(base + 0.01 * c + 0.1 * r, 3), round((13.0 * c + 5.0 * r) % 360.0, 2),
                             round(7.0 + 0.5 * r + 0.01 * c, 2), sea(r, c)))
    return {"model": model, "provider": "test", "domain": "marine", "layer": layer, "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
            "source_dataset": "test", "upstream_provider": "test", "region_id": "global_mid", "resolution": 2.0,
            "freshness_sec": 3600, "source_variables": [],
            "coverage": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
            "grid": {"cols": COLS, "rows": ROWS, "bounds": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _name(model, layer, vt):
    return f"{model.lower()}_marine_{layer}_global_mid_{vt.replace('-', '').replace(':', '')}.json"


def _write(store, gfs_valids=VALIDS, gfs_run=GFS_RUN, skip_gfs_files=(), gfs_disk_run=None, euro_valids=VALIDS):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in euro_valids:
        (store / _name("EURO", "waves", vt)).write_text(json.dumps(_product("EURO", vt, RUN, lambda r, c: not _euro_masked(r, c), 2.0)))
        entries.append({"model": "EURO", "domain": "marine", "layer": "waves", "region_id": "global_mid", "resolution": 2.0,
                        "filename": _name("EURO", "waves", vt), "valid_time_start": vt, "model_run_time": RUN, "run_time": RUN,
                        "ingested_at": RUN, "is_estimated": False})
    for vt in gfs_valids:
        name = _name("GFS", "waves", vt)
        if name not in skip_gfs_files:
            (store / name).write_text(json.dumps(_product("GFS", vt, gfs_disk_run or gfs_run, _gfs_sea, 1.0)))
        entries.append({"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid", "resolution": 2.0,
                        "filename": name, "valid_time_start": vt, "model_run_time": gfs_run, "run_time": gfs_run,
                        "ingested_at": gfs_run, "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


@pytest.fixture(autouse=True)
def _targeted(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "1")
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    monkeypatch.delenv("MARINE_FILL_PROVENANCE_NODES", raising=False)
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")
    cgf._DONOR_LRU.clear()                            # the route's donor LRU is process-wide: never reuse another test's donor
    yield
    cgf._DONOR_LRU.clear()


def _publish(store, target, previous_index=None):
    up = []
    index, stats = fs.publish_set(pub.LocalCache(store), None, target, previous_index, up.extend, log=lambda *_: None)
    return index, stats, {p: b for p, b, *_ in up}


def _frame(index, uploads, vt):
    f = next(f for f in index["frames"] if f["valid_time"] == vt)
    return f, fb.decode_frame(gzip.decompress(uploads[f["path"]])), {**index["common_meta"], **(f.get("meta") or {})}


class _RouteStore:
    """What the box's route sees: a manifest of items and load_product (no cache_dir: the donor is read through load_product)."""

    def __init__(self, store):
        self.dir = store
        self.items = [SimpleNamespace(**p) for p in json.loads((store / "manifest.json").read_text())["products"]]

    def get_manifest(self):
        return SimpleNamespace(products=self.items)

    def load_product(self, filename, **kw):
        return NormalizedProduct.model_validate(json.loads((self.dir / filename).read_text()))


def _route(store, vt):
    """The world /grid's fill, the route function itself, on the stored EURO product: what the box serves."""
    prod = NormalizedProduct.model_validate(json.loads((store / _name("EURO", "waves", vt)).read_text()))
    out = asyncio.run(cgf.fill_coarse_enclosed_sea_from_gfs_served(prod, _RouteStore(store), "EURO", "marine", "waves"))
    return out.model_dump(mode="json")


def test_a_filled_frame_is_what_the_world_grid_serves_and_the_plain_frame_is_not(tmp_path):
    _write(tmp_path / "s")
    index, stats, uploads = _publish(tmp_path / "s", EURO_FILLED)
    plain, _, plain_up = _publish(tmp_path / "s", EURO_PLAIN)
    gfs_sea_masked = sum(1 for r in range(ROWS) for c in range(COLS) if _euro_masked(r, c) and _gfs_sea(r, c))
    assert gfs_sea_masked > 0 and stats["cells_filled"] == 2 * gfs_sea_masked and stats["built"] == 2
    for vt in VALIDS:
        served = _route(tmp_path / "s", vt)
        assert served["coarse_fill"]["mode"] == "targeted" and served["coarse_fill"]["cells_filled"] == gfs_sea_masked
        f, decoded, meta = _frame(index, uploads, vt)
        assert fb.parity(served, decoded)["bad"] == 0                       # node for node: the frame IS the world /grid
        assert meta["coarse_fill"] == served["coarse_fill"]                 # and carries its stamp
        assert meta["product_id"] == _name("EURO", "waves", vt)             # the EURO product, as /grid names it
        _, plain_decoded, plain_meta = _frame(plain, plain_up, vt)
        assert fb.parity(served, plain_decoded)["bad"] == gfs_sea_masked    # positive control: the plain frame is the stored one
        assert plain_meta.get("coarse_fill") is None
    assert fs.set_key(EURO_FILLED) == "EURO/marine/waves/global_mid_filled"
    assert index["fill"]["mode"] == "targeted" and all(f["path"].startswith("v1/euro/marine/waves/global_mid_filled/")
                                                       for f in index["frames"] if f.get("path"))
    assert fs.latest_record(index, None, "t", "w")["fill_mode"] == "targeted"
    assert "fill_mode" not in fs.latest_record(plain, None, "t", "w") and "fill" not in plain


def test_land_stays_masked_only_gfs_sea_is_filled(tmp_path):
    _write(tmp_path / "s")
    index, _, uploads = _publish(tmp_path / "s", EURO_FILLED)
    _, decoded, _ = _frame(index, uploads, VALIDS[0])
    h = decoded["fields"][fb.HEIGHT]
    for r in range(ROWS):
        for c in range(COLS):
            i = r * COLS + c
            if not _gfs_sea(r, c):
                assert h[i] is None, (r, c)                                 # GFS land: never painted
            elif _euro_masked(r, c):
                assert h[i] is not None and abs(h[i] - round(1.0 + 0.01 * c + 0.1 * r, 3)) <= 0.0006   # the GFS value
            else:
                assert abs(h[i] - round(2.0 + 0.01 * c + 0.1 * r, 3)) <= 0.0006                        # EURO's own, untouched


@pytest.mark.parametrize("mode_env, mode", [({"MARINE_GULF_FILL_MID_TARGETED": "0"}, "legacy"), ({"MARINE_GULF_FILL_MID": "0"}, "off")])
def test_only_the_targeted_mode_is_baked_and_another_mode_retires_the_record(tmp_path, monkeypatch, mode_env, mode):
    _write(tmp_path / "s")
    report = pub.publish_frame_sets(pub.LocalCache(tmp_path / "s"), pub.LocalSink(tmp_path / "out"), log=lambda *_: None)
    key = fs.set_key(EURO_FILLED)
    first = json.loads((tmp_path / "out" / fs.LATEST).read_text())["sets"][key]
    assert first["fill_mode"] == "targeted" and report[key]["built"] == 2
    for k, v in mode_env.items():
        monkeypatch.setenv(k, v)
    _write(tmp_path / "s", gfs_run="2026-10-24T12:00:00Z")                 # a new GFS run: the GFS sets move the pointer
    report = pub.publish_frame_sets(pub.LocalCache(tmp_path / "s"), pub.LocalSink(tmp_path / "out"), log=lambda *_: None)
    assert report[key]["skipped_fill_mode"] and report[key]["fill_mode"] == mode and report[key]["entries"] == 0
    rec = json.loads((tmp_path / "out" / fs.LATEST).read_text())["sets"][key]
    assert rec["empty"] is True and "fill_mode" not in rec and "index" not in rec and rec["fill_mode_off"] == mode
    assert rec["previous_index"] == first["index"]
    assert fs.fill_mode_off_record(rec, mode, "t", "w") is None            # already retired for this mode: nothing to write
    assert fs.fill_mode_off_record(None, mode, "t", "w") is None           # never published: nothing to retire


def test_no_donor_within_3h_leaves_the_hour_unbuilt(tmp_path):
    late_vt = "2026-10-24T18:00:00Z"
    _write(tmp_path / "s", gfs_valids=[VALIDS[0]], euro_valids=[VALIDS[0], late_vt])   # no GFS within 3 h of 18Z
    index, stats, _ = _publish(tmp_path / "s", EURO_FILLED)
    assert index is None and stats["fill_donor_missing"] == 1 and stats["built"] == 1 and stats["coverage_refused"]   # 1/2 < 0.9
    with pytest.MonkeyPatch.context() as m:
        m.setenv("FRAME_MIN_COVERAGE", "0.5")
        index, stats, _ = _publish(tmp_path / "s", EURO_FILLED)
    late = next(f for f in index["frames"] if f["valid_time"] == late_vt)
    assert late["path"] is None and late["unbuilt"] == "fill_donor_missing" and late["source"]["fill_donor"] is None


@pytest.mark.parametrize("kw, why, refused", [({"skip_gfs_files": (_name("GFS", "waves", VALIDS[0]),)}, "not on this runner's disk", 1),
                                              ({"gfs_disk_run": "2026-10-23T18:00:00Z"}, "not the run", 2)])
def test_an_absent_or_stale_donor_refuses_the_frame_never_an_unfilled_one(tmp_path, monkeypatch, kw, why, refused):
    _write(tmp_path / "s", **kw)
    logs = []
    up = []
    monkeypatch.setenv("FRAME_MIN_COVERAGE", "0")
    index, stats = fs.publish_set(pub.LocalCache(tmp_path / "s"), None, EURO_FILLED, None, up.extend, log=logs.append)
    assert stats["fill_refused"] == refused and stats["built"] == 2 - refused and any(why in line for line in logs)
    if refused == 2:
        assert index is None and not up                                     # nothing built: nothing uploaded, no index
        return
    f = next(f for f in index["frames"] if f["valid_time"] == VALIDS[0])
    assert f["path"] is None and f["unbuilt"] == "fill_refused"


def test_a_new_donor_run_rebuilds_the_frame_and_an_unchanged_one_carries_it(tmp_path):
    _write(tmp_path / "s")
    first, _, _ = _publish(tmp_path / "s", EURO_FILLED)
    _, stats, _ = _publish(tmp_path / "s", EURO_FILLED, previous_index=first)
    assert stats["carried"] == 2 and stats["built"] == 0                   # same EURO product, same donor: nothing read
    _write(tmp_path / "s", gfs_run="2026-10-24T12:00:00Z")
    second, stats, _ = _publish(tmp_path / "s", EURO_FILLED, previous_index=first)
    assert stats["carried"] == 0 and stats["built"] == 2
    assert {f["source"]["fill_donor"]["model_run_time"] for f in second["frames"]} == {"2026-10-24T12:00:00Z"}


def test_a_lattice_mismatch_refuses_instead_of_misaligning(tmp_path):
    _write(tmp_path / "s")
    name = _name("GFS", "waves", VALIDS[0])
    gfs = json.loads((tmp_path / "s" / name).read_text())
    for v in gfs["grid"]["vectors"]:
        v["lng"] += 1.0                                                     # a GFS lattice offset by half a cell
    (tmp_path / "s" / name).write_text(json.dumps(gfs))
    product = json.loads((tmp_path / "s" / _name("EURO", "waves", VALIDS[0])).read_text())
    entry = fsf.donor_entry(json.loads((tmp_path / "s" / "manifest.json").read_text())["products"], VALIDS[0], "waves")
    with pytest.raises(ValueError, match="lattice mismatch"):
        fsf.apply_fill(product, entry, (tmp_path / "s" / name).read_bytes(), "waves")


def test_apply_fill_never_writes_its_input(tmp_path):
    _write(tmp_path / "s")
    raw = (tmp_path / "s" / _name("EURO", "waves", VALIDS[0])).read_text()
    product = json.loads(raw)
    entry = fsf.donor_entry(json.loads((tmp_path / "s" / "manifest.json").read_text())["products"], VALIDS[0], "waves")
    out, n = fsf.apply_fill(product, entry, (tmp_path / "s" / _name("GFS", "waves", VALIDS[0])).read_bytes(), "waves")
    assert n > 0 and json.dumps(product) == json.dumps(json.loads(raw)) and out["grid"]["vectors"] is not product["grid"]["vectors"]


def test_the_plain_set_keys_and_selection_are_unchanged():
    assert fs.set_key(EURO_PLAIN) == "EURO/marine/waves/global_mid" and fs.set_prefix(EURO_PLAIN) == "v1/euro/marine/waves/global_mid"
    products = [{"model": "EURO", "domain": "marine", "layer": "waves", "region_id": "global_mid", "filename": "a.json",
                 "valid_time_start": VALIDS[0]}]
    assert fs.select_entries(products, EURO_FILLED) == fs.select_entries(products, EURO_PLAIN) == products
