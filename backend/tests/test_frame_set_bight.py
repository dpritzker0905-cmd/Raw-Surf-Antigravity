"""SRV-2 (Fable audit 2026-11-10): GFS waves static frames carry the Bight composition /grid serves, node for node.

/grid, /grid_series and /point load GFS waves through `consensus_serve.ServedStore`, which applies
SURF_BIGHT_HS_CONSENSUS (ON): inside the frozen Bight polygon Hs is the GFS+EURO mean. The static publisher read raw
products, so the map wash disagreed with every other surface in the Bight. THE ACCEPTANCE (HANDOFF-FABLE item 4): the
publisher's parity check (frame vs /grid) reports 0 bad nodes inside the polygon, offline. "/grid" here is the serving
view itself (`ServedStore.load_product`) over the same stored files.
"""
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
from services import frame_set_bight as fsb  # noqa: E402
from services.weather_pipeline import bight_hs_consensus as bight  # noqa: E402
from services.weather_pipeline.consensus_serve import ServedStore  # noqa: E402
from services.weather_pipeline.schemas import ManifestProduct, NormalizedProduct  # noqa: E402

RUN = "2026-11-10T00:00:00Z"
GFS_RUN = "2026-11-10T06:00:00Z"
VALIDS = ["2026-11-10T12:00:00Z", "2026-11-10T15:00:00Z"]
REGION = "us_west_coast_socal"
TARGET = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": REGION}
W, S, STEP, COLS, ROWS = -121.0, 31.5, 0.25, 19, 14            # a 0.25 deg SoCal lattice over the Bight box
BOUNDS = {"west": W, "south": S, "east": W + STEP * (COLS - 1), "north": S + STEP * (ROWS - 1)}


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv("SURF_BIGHT_HS_CONSENSUS", raising=False)
    monkeypatch.delenv("SURF_BIGHT_HS_EURO_WEIGHT", raising=False)
    monkeypatch.setenv("CONSENSUS_SERVE", "0")
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")


def _vec(lat, lng, h, d, period, valid=True):
    if not valid:
        return {"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0, "gust": None,
                "value": None, "is_valid": False, "dir_confidence": None}
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4),
            "v": round(-h * math.cos(rad), 4), "period": period, "gust": None, "value": None, "is_valid": True,
            "dir_confidence": 0.9}


def _sea(r, c):
    return c < COLS - 3                                         # the three easternmost columns are land


def _product(model, valid, run, base):
    vecs = []
    for r in range(ROWS):
        for c in range(COLS):
            lat, lng = round(S + STEP * r, 4), round(W + STEP * c, 4)
            vecs.append(_vec(lat, lng, round(base + 0.02 * c + 0.03 * r, 3), round((200.0 + 3.0 * c) % 360, 2),
                             round(12.0 + 0.1 * r, 2), _sea(r, c)))
    return {"model": model, "provider": "test", "domain": "marine", "layer": "waves", "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height", "value_unit": "m",
            "display_unit_hint": "ft", "source_dataset": "test", "upstream_provider": "test", "region_id": REGION,
            "resolution": STEP, "freshness_sec": 3600, "source_variables": [], "coverage": dict(BOUNDS),
            "grid": {"cols": COLS, "rows": ROWS, "bounds": dict(BOUNDS), "vectors": vecs,
                     "diagnostics": {"gridMode": "rectangular"}}}


def _name(model, vt):
    return f"{model.lower()}_marine_waves_{REGION}_{vt.replace('-', '').replace(':', '')}.json"


def _entry(model, vt, run):
    return {"model": model, "provider": "test", "domain": "marine", "layer": "waves", "region_id": REGION,
            "resolution": STEP, "freshness_sec": 3600, "is_forecast_authoritative": True, "coverage": dict(BOUNDS),
            "filename": _name(model, vt), "product_id": _name(model, vt), "valid_time_start": vt, "valid_time_end": vt,
            "model_run_time": run, "run_time": run, "ingested_at": run, "is_estimated": False}


def _write(store, euro_on_disk=True, euro_disk_run=RUN):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in VALIDS:
        if euro_on_disk:
            (store / _name("EURO", vt)).write_text(json.dumps(_product("EURO", vt, euro_disk_run, 2.0)))
        entries.append(_entry("EURO", vt, RUN))
        (store / _name("GFS", vt)).write_text(json.dumps(_product("GFS", vt, GFS_RUN, 1.0)))
        entries.append(_entry("GFS", vt, GFS_RUN))
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


class _RawStore:
    """The box's ProductStore as the serving view wraps it: a manifest of models and load_product."""

    def __init__(self, store):
        self.dir = store
        doc = json.loads((store / "manifest.json").read_text())
        from types import SimpleNamespace
        self._m = SimpleNamespace(products=[ManifestProduct.model_validate(p) for p in doc["products"]])

    def get_manifest(self):
        return self._m

    def load_product(self, filename, **kw):
        return NormalizedProduct.model_validate(json.loads((self.dir / filename).read_text()))


def _served(store, vt):
    return ServedStore(_RawStore(store)).load_product(_name("GFS", vt)).model_dump(mode="json")


def _publish(store, previous_index=None):
    up = []
    index, stats = fs.publish_set(pub.LocalCache(store), None, TARGET, previous_index, up.extend, log=lambda *_: None)
    return index, stats, {p: b for p, b, *_ in up}


def _frame(index, uploads, vt):
    f = next(f for f in index["frames"] if f["valid_time"] == vt)
    return f, fb.decode_frame(gzip.decompress(uploads[f["path"]]))


def _inside(product):
    return [v for v in product["grid"]["vectors"] if bight.inside_bight(v["lat"], v["lng"])]


def test_the_frame_is_what_grid_serves_node_for_node_inside_the_polygon(tmp_path):
    _write(tmp_path / "s")
    index, stats, uploads = _publish(tmp_path / "s")
    assert stats["built"] == 2 and stats["bight_refused"] == 0 and stats["bight_blended_cells"] > 0
    for vt in VALIDS:
        served = _served(tmp_path / "s", vt)
        blended = served["grid"]["diagnostics"]["bight_hs_consensus"]["cells"]["blended"]
        assert blended > 0
        f, decoded = _frame(index, uploads, vt)
        assert fb.parity(served, decoded)["bad"] == 0, "the frame IS /grid, node for node"
        raw = json.loads((tmp_path / "s" / _name("GFS", vt)).read_text())
        assert fb.parity(raw, decoded)["bad"] == blended, "positive control: the raw product differs at the blended nodes"
        assert f["source"]["bight"]["polygon"] == bight.POLYGON_VERSION
        # every authoritative EURO frame the resolver may answer a Bight cell from at this hour (its 3 h window)
        assert [_name("EURO", vt), "2026-11-10T00:00:00+00:00"] in f["source"]["bight"]["euro"]
    assert len(_inside(served)) > 0


def test_the_unbaked_frame_was_the_defect(tmp_path, monkeypatch):
    """The pre-SRV-2 publisher (composition skipped) ships raw GFS: /grid disagrees inside the polygon."""
    _write(tmp_path / "s")
    monkeypatch.setattr(fsb, "applies", lambda target, entry: False)
    index, _, uploads = _publish(tmp_path / "s")
    served = _served(tmp_path / "s", VALIDS[0])
    _, decoded = _frame(index, uploads, VALIDS[0])
    assert fb.parity(served, decoded)["bad"] > 0


@pytest.mark.parametrize("kw,why", [({"euro_on_disk": False}, "not on this runner's disk"),
                                    ({"euro_disk_run": "2026-11-09T18:00:00Z"}, "not the run its manifest entry names")])
def test_a_missing_or_stale_euro_refuses_the_frame_never_a_raw_one(tmp_path, kw, why):
    _write(tmp_path / "s", **kw)
    logs = []
    up = []
    index, stats = fs.publish_set(pub.LocalCache(tmp_path / "s"), None, TARGET, None, up.extend, log=logs.append)
    assert stats["bight_refused"] == 2 and stats["built"] == 0 and index is None
    assert any(why in line for line in logs)


def test_consensus_serve_on_defers_to_grid(tmp_path, monkeypatch):
    _write(tmp_path / "s")
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    _, stats, _ = _publish(tmp_path / "s")
    assert stats["bight_refused"] == 2


@pytest.mark.parametrize("kill", [("SURF_BIGHT_HS_CONSENSUS", "0"), ("FRAME_BIGHT_BAKE", "0")])
def test_the_kill_switch_is_todays_publisher(tmp_path, monkeypatch, kill):
    _write(tmp_path / "s")
    monkeypatch.setenv(*kill)
    index, stats, uploads = _publish(tmp_path / "s")
    assert stats["built"] == 2 and "bight_blended_cells" not in stats
    for f in index["frames"]:
        assert "bight" not in f["source"]
    raw = json.loads((tmp_path / "s" / _name("GFS", VALIDS[0])).read_text())
    _, decoded = _frame(index, uploads, VALIDS[0])
    assert fb.parity(raw, decoded)["bad"] == 0


def test_a_new_euro_run_rebuilds_and_an_unchanged_one_carries(tmp_path):
    _write(tmp_path / "s")
    index, _, _ = _publish(tmp_path / "s")
    again, stats, _ = _publish(tmp_path / "s", previous_index=index)
    assert stats["carried"] == 2 and again is None
    doc = json.loads((tmp_path / "s" / "manifest.json").read_text())
    for p in doc["products"]:
        if p["model"] == "EURO":
            p["run_time"] = p["model_run_time"] = "2026-11-10T12:00:00Z"
    (tmp_path / "s" / "manifest.json").write_text(json.dumps(doc))
    for vt in VALIDS:
        (tmp_path / "s" / _name("EURO", vt)).write_text(json.dumps(_product("EURO", vt, "2026-11-10T12:00:00Z", 2.2)))
    _, stats, _ = _publish(tmp_path / "s", previous_index=index)
    assert stats["carried"] == 0 and stats["built"] == 2


def test_sets_off_the_bight_keep_their_identity_byte_for_byte():
    entry = {"coverage": {"west": -82.0, "south": 25.0, "east": -79.0, "north": 31.0}}
    assert fsb.applies(TARGET, entry) is False
    assert fsb.applies({**TARGET, "model": "EURO"}, {"coverage": dict(BOUNDS)}) is False
    assert fsb.applies({**TARGET, "layer": "swell_1"}, {"coverage": dict(BOUNDS)}) is False
    assert fsb.applies(TARGET, {"coverage": dict(BOUNDS)}) is True


class _FetchingSource:
    """publish_frame_images.TailDownloads' shape: the runner's disk, plus on-demand stored products from the bucket."""

    def __init__(self, local, bucket):
        self.local, self.bucket, self.fetched = local, bucket, []

    def manifest(self):
        return self.local.manifest()

    def product_bytes(self, filename):
        return self.local.product_bytes(filename)

    def fetch_dependency(self, filename):
        self.fetched.append(filename)
        path = self.bucket / filename
        return path.read_bytes() if path.is_file() else None


def test_euro_from_the_core_lane_is_fetched_and_the_frame_still_matches_grid(tmp_path):
    """Production: the EURO global_mid frames the Bight cells read are the core lane's, never on the pilots disk."""
    _write(tmp_path / "bucket")                                    # the stored products, as the bucket holds them
    _write(tmp_path / "s", euro_on_disk=False)                     # the pilots runner: GFS only
    src = _FetchingSource(pub.LocalCache(tmp_path / "s"), tmp_path / "bucket")
    up = []
    index, stats = fs.publish_set(src, None, TARGET, None, up.extend, log=lambda *_: None)
    uploads = {p: b for p, b, *_ in up}
    assert stats["built"] == 2 and stats["bight_refused"] == 0
    assert sorted(set(src.fetched)) == sorted(_name("EURO", vt) for vt in VALIDS)
    for vt in VALIDS:
        _, decoded = _frame(index, uploads, vt)
        assert fb.parity(_served(tmp_path / "bucket", vt), decoded)["bad"] == 0


def test_one_refused_hour_goes_to_grid_and_the_set_still_publishes(tmp_path):
    """Without the exemption one missing EURO frame refused the whole set and left the previous RAW index published."""
    _write(tmp_path / "s")
    (tmp_path / "s" / _name("EURO", VALIDS[1])).unlink()          # only the 15Z EURO is missing from this disk
    index, stats, _ = _publish(tmp_path / "s")
    assert index is not None and stats["built"] >= 1 and stats["bight_refused"] >= 1
    refused = [f for f in index["frames"] if f.get("unbuilt") == "bight_refused"]
    assert refused and all(f["path"] is None for f in refused)


def test_the_dependency_downloader_shares_the_tail_cap_and_counts():
    calls = []

    def fetch(name):
        calls.append(name)
        return (b"{}", 7)
    td = pub.TailDownloads(pub.LocalCache(Path(".")), fetch, cap=1, log=lambda *_: None)
    assert td.fetch_dependency("euro_a.json") == b"{}" and td.fetch_dependency("euro_a.json") == b"{}"
    assert td.fetch_dependency("euro_b.json") is None, "capped"
    assert calls == ["euro_a.json"] and td.stats["dependency_downloads"] == 1 and td.stats["download_capped"] == 1
    assert td.stats["wire_bytes"] == 7
