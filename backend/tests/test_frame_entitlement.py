"""O6: static-frame entitlement. Classes mirror forecast_tier_window; paid frames never reach the public bucket or the
public index; the signer signs once per (index, class) and shares the URLs; everything is held OFF."""
import gzip
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import forecast_tier_window as FTW
from services import frame_entitlement as FE
from services import runtime_flags as rf

RUN = "2026-11-11T00:00:00Z"


def _vt(h):
    return f"2026-11-{11 + h // 24:02d}T{h % 24:02d}:00:00Z"


@pytest.mark.parametrize("model,lead,cls", [
    ("GFS", 0, "public"), ("GFS", 96, "public"), ("GFS", 99, "basic"), ("GFS", 192, "basic"), ("GFS", 195, "premium"),
    ("EURO", 0, "basic"), ("ICON", 0, "basic"), ("EURO", 300, "premium"), ("gfs", 3, "public"),
])
def test_classes_follow_the_resolver_echo(model, lead, cls):
    assert FE.class_for(model, RUN, _vt(lead)) == cls


def test_unknown_times_fail_closed_to_premium():
    assert FE.class_for("GFS", None, _vt(3)) == "premium"
    assert FE.class_for("GFS", RUN, "garbage") == "premium"


def test_the_class_edges_move_with_the_echo(monkeypatch):
    monkeypatch.setitem(FTW.TIER_FORECAST_DAYS, "guest", 5)
    assert FE.class_for("GFS", RUN, _vt(5 * 24 + FE.RUN_MARGIN_H)) == "public"


@pytest.mark.parametrize("tier,classes", [("guest", ("public",)), ("free", ("public",)), (None, ("public",)),
                                          ("basic", ("public", "basic")), ("surfer_premium", FE.CLASSES)])
def test_allowed_classes(tier, classes):
    assert FE.allowed_classes(tier) == classes


def test_a_frame_path_names_its_class():
    assert FE.class_for_path("v1/gfs/marine/waves/global_mid/20261111T000000Z/20261111T030000Z-0123456789ab.bin") == "public"
    assert FE.class_for_path("v1/euro/marine/waves/global_mid/20261111T000000Z/20261111T030000Z-0123456789ab.bin") == "basic"
    assert FE.class_for_path("v1/gfs/marine/waves/global_mid/index/20261111T000000Z-0123456789ab.json") is None
    assert FE.class_for_path("v1/latest.json") is None


def _frame_index(model="GFS", leads=(0, 99, 300)):
    pre = f"v1/{model.lower()}/marine/waves/global_mid"
    return {"model": model, "run": RUN, "path": f"{pre}/index/20261111T000000Z-aaaaaaaaaaaa.json",
            "frames": [{"valid_time": _vt(h), "path": f"{pre}/20261111T000000Z/{_vt(h).replace('-', '').replace(':', '')}-"
                        f"{h:012x}.bin", "is_estimated": False} for h in leads]}


def test_split_strips_paid_paths_from_the_public_index():
    full = _frame_index()
    pub, priv, recut = FE.split_index(full)
    assert recut == {}
    assert [("path" in f, f.get("paid")) for f in pub["frames"]] == [(True, None), (False, "basic"), (False, "premium")]
    assert [f["entitlement"] for f in priv["frames"]] == ["public", "basic", "premium"]
    assert all(f["path"] for f in priv["frames"])


def _bundle_index(leads=(0, 99, 300)):
    segs = [gzip.compress(f"frame-{h}".encode()) for h in leads]
    blob, frames, off = b"", [], 0
    for h, s in zip(leads, segs):
        frames.append({"valid_time": _vt(h), "offset": off, "length": len(s), "sha12": FE._sha12(s)})
        blob += s
        off += len(s)
    pre = "v1/gfs/marine/waves/hawaii"
    full = {"model": "GFS", "run": RUN, "path": f"{pre}/index/20261111T000000Z-bbbbbbbbbbbb.json", "frames": frames,
            "bundle": {"path": f"{pre}/20261111T000000Z/bundle-{FE._sha12(blob)}.bin", "bytes": len(blob)}}
    return full, blob, segs


def test_a_bundle_is_recut_per_class_and_the_public_bundle_holds_only_public_bytes():
    full, blob, segs = _bundle_index()
    pub, priv, recut = FE.split_index(full, blob)
    pb = recut[pub["bundle"]["path"]]
    assert pb == segs[0]                                                    # nothing paid in the public bundle
    f0, f1, f2 = pub["frames"]
    assert (f0["offset"], f0["length"]) == (0, len(segs[0]))
    assert (f1.get("paid"), f1["offset"], f2.get("paid"), f2["offset"]) == ("basic", None, "premium", None)
    for item in FE.paid_items(priv, ["basic", "premium"]):                  # every paid slice is byte-exact
        obj = recut[item["object"]]
        assert obj[item["offset"]:item["offset"] + item["length"]] == segs[[99, 300].index(
            int((FE._parse(item["valid_time"]) - FE._parse(RUN)).total_seconds() // 3600)) + 1]
    assert set(FE.class_bundle_paths(priv)) == set(recut)


class DictSink:
    def __init__(self):
        self.store, self.deleted = {}, []

    def ensure_bucket(self):
        pass

    def write(self, path, data, ctype, cache):
        self.store[path] = data

    def read(self, path):
        return self.store.get(path)

    def list(self, prefix):
        return [p for p in self.store if p.startswith(prefix)]

    def delete(self, paths):
        for p in paths:
            self.store.pop(p, None)
        self.deleted.extend(paths)


def test_the_sink_routes_frames_and_indexes_by_class():
    pub, paid = DictSink(), DictSink()
    sink = FE.EntitledSink(pub, paid)
    full = _frame_index("GFS", (0, 300))
    for f in full["frames"]:
        sink.write(f["path"], b"x", "application/octet-stream", "immutable")
    sink.write(full["path"], json.dumps(full).encode(), "application/json", "immutable")
    sink.write("v1/latest.json", b"{}", "application/json", "no-cache")
    assert full["frames"][0]["path"] in pub.store and full["frames"][0]["path"] not in paid.store
    assert full["frames"][1]["path"] in paid.store and full["frames"][1]["path"] not in pub.store
    public_index = json.loads(pub.store[full["path"]])
    assert full["frames"][1]["path"] not in json.dumps(public_index)       # the paid path never reaches the public index
    assert json.loads(sink.read(full["path"]))["frames"][1]["path"] == full["frames"][1]["path"]   # the full copy
    assert "v1/latest.json" in pub.store


def test_bundle_flow_and_retention_never_deletes_the_recut_bundles():
    pub, paid = DictSink(), DictSink()
    sink = FE.EntitledSink(pub, paid)
    full, blob, _ = _bundle_index()
    sink.write(full["bundle"]["path"], blob, "application/octet-stream", "immutable")
    sink.write(full["path"], json.dumps(full).encode(), "application/json", "immutable")
    assert full["bundle"]["path"] not in pub.store and full["bundle"]["path"] not in paid.store   # the mixed bundle: never
    recut = FE.class_bundle_paths(json.loads(paid.store[full["path"]]))
    assert recut and all((p in pub.store) != (p in paid.store) for p in recut)
    sink.delete(sorted(sink.list("v1/gfs/marine/waves/hawaii")))
    assert all(p in pub.store or p in paid.store for p in recut)


# ── the signer ────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_signing_is_once_per_index_and_class_and_shared(monkeypatch):
    from routes import weather_frame_urls as W
    W._index_cache.clear()
    W._sign_cache.clear()
    full = FE.split_index(_frame_index("GFS", (0, 99, 300)))[1]
    calls = []

    def sign(paths, expires):
        calls.append(tuple(paths))
        return {p: f"https://cdn.test/{p}?token=t" for p in paths}

    now = [0.0]
    guest = W.entitled_urls(full["path"], "guest", load=lambda p: full, sign=sign, clock=lambda: now[0])
    basic = W.entitled_urls(full["path"], "basic", load=lambda p: full, sign=sign, clock=lambda: now[0])
    prem1 = W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    prem2 = W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    assert guest["frames"] == []
    assert [f["class"] for f in basic["frames"]] == ["basic"]
    assert [f["class"] for f in prem1["frames"]] == ["basic", "premium"] and prem1 == prem2
    assert len(calls) == 2                                                  # basic once, premium once, for every user
    now[0] = W.SIGN_CACHE_S + 1
    W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    assert len(calls) == 4                                                  # re-signed after the cache window


def _app(monkeypatch, on):
    from routes import weather_frame_urls as W
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(FE.FLAG, "1" if on else "0")
    rf._reset_for_tests(lambda: None)
    app = FastAPI()
    app.include_router(W.router, prefix="/api")
    return TestClient(app), W


def test_route_is_off_by_default_and_validates_the_index_path(monkeypatch):
    client, _ = _app(monkeypatch, False)
    assert client.get("/api/weather/frame-urls", params={"index": "v1/x"}).status_code == 404
    monkeypatch.delenv(FE.FLAG)
    assert rf.GUARDED[FE.FLAG] == "0" and not FE.enabled()
    client, _ = _app(monkeypatch, True)
    assert client.get("/api/weather/frame-urls", params={"index": "../../weather-products/manifest.json"}).status_code == 400


def test_route_answers_privately_for_the_resolved_tier(monkeypatch):
    client, W = _app(monkeypatch, True)
    import services.weather_tier_clamp as C

    async def tier(auth):
        return "premium" if auth == "Bearer p" else "guest"

    monkeypatch.setattr(C, "resolve_tier", tier)
    seen = []
    monkeypatch.setattr(W, "entitled_urls", lambda index, t: seen.append(t) or {"index": index, "tier": t, "frames": []})
    path = "v1/gfs/marine/waves/global_mid/index/20261111T000000Z-aaaaaaaaaaaa.json"
    r = client.get("/api/weather/frame-urls", params={"index": path}, headers={"Authorization": "Bearer p"})
    assert r.status_code == 200 and r.headers["cache-control"] == "private, max-age=300" and seen == ["premium"]
    client.get("/api/weather/frame-urls", params={"index": path})
    assert seen[-1] == "guest"


# ── the real publisher, through the wrapper, offline (the publish_frame_sets fixtures) ───────────────────────────────
def test_the_real_publisher_routes_by_class_and_retention_spans_both_buckets(tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import publish_frame_images as pub
    from services import frame_set as fs
    from tests.test_publish_frame_sets import _write_store

    target = fs.SETS[0]                                                    # GFS / marine / waves / global_mid

    def valids(run_h):
        base = 6 + run_h
        return [f"2026-10-{20 + (base + lead) // 24}T{(base + lead) % 24:02d}:00:00Z" for lead in (0, 120, 200)]

    def run_iso(run_h):
        return f"2026-10-{20 + (6 + run_h) // 24}T{(6 + run_h) % 24:02d}:00:00Z"

    store, out, paid_out = tmp_path / "store", tmp_path / "pub", tmp_path / "paid"
    pubs, paids, firsts = pub.LocalSink(out), pub.LocalSink(paid_out), None
    for i, run_h in enumerate((0, 6, 12)):
        _write_store(store, run=run_iso(run_h), bump=0.1 * i, valids=valids(run_h))
        sink = FE.EntitledSink(pubs, paids)
        pub.publish_frame_sets(pub.LocalCache(store), sink, sets=[target], log=lambda *_: None)
        latest = json.loads((out / fs.LATEST).read_text())
        rec = latest["sets"][fs.set_key(target)]
        public_index = json.loads((out / rec["index"]).read_text())
        full_index = json.loads((paid_out / rec["index"]).read_text())
        classes = [f["entitlement"] for f in full_index["frames"]]
        assert classes == ["public", "basic", "premium"]
        for f, g in zip(full_index["frames"], public_index["frames"]):
            if f["entitlement"] == "public":
                assert (out / f["path"]).exists() and not (paid_out / f["path"]).exists() and g["path"] == f["path"]
            else:
                assert (paid_out / f["path"]).exists() and not (out / f["path"]).exists() and "path" not in g
        if i == 0:
            firsts = [f["path"] for f in full_index["frames"]] + [rec["index"]]
    assert not any((out / p).exists() or (paid_out / p).exists() for p in firsts)   # two runs back: gone from both
