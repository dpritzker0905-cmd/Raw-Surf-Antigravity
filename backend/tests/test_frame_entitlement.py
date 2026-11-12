"""O6: static-frame entitlement, ACCOUNTS ONLY (owner 2026-11-12). Classes mirror forecast_tier_window; NO frame reaches
the public bucket and no frame path reaches the public index; free accounts get the free class by signed URL; signed
out gets 401; the signer signs once per (index, class) and shares the URLs; everything is held OFF."""
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
    ("GFS", 0, "free"), ("GFS", 96, "free"), ("GFS", 99, "basic"), ("GFS", 192, "basic"), ("GFS", 195, "premium"),
    ("EURO", 0, "basic"), ("ICON", 0, "basic"), ("EURO", 300, "premium"), ("gfs", 3, "free"),
])
def test_classes_follow_the_resolver_echo(model, lead, cls):
    assert FE.class_for(model, RUN, _vt(lead)) == cls


def test_unknown_times_fail_closed_to_premium():
    assert FE.class_for("GFS", None, _vt(3)) == "premium"
    assert FE.class_for("GFS", RUN, "garbage") == "premium"


def test_the_class_edges_move_with_the_echo(monkeypatch):
    monkeypatch.setitem(FTW.TIER_FORECAST_DAYS, "free", 5)
    assert FE.class_for("GFS", RUN, _vt(5 * 24 + FE.RUN_MARGIN_H)) == "free"


@pytest.mark.parametrize("tier,classes", [("guest", ()), (None, ()), ("free", ("free",)), ("surfer_free", ("free",)),
                                          ("basic", ("free", "basic")), ("surfer_premium", FE.CLASSES)])
def test_allowed_classes_signed_out_reads_nothing(tier, classes):
    assert FE.allowed_classes(tier) == classes


def test_a_frame_path_names_its_class():
    assert FE.class_for_path("v1/gfs/marine/waves/global_mid/20261111T000000Z/20261111T030000Z-0123456789ab.bin") == "free"
    assert FE.class_for_path("v1/euro/marine/waves/global_mid/20261111T000000Z/20261111T030000Z-0123456789ab.bin") == "basic"
    assert FE.class_for_path("v1/gfs/marine/waves/global_mid/index/20261111T000000Z-0123456789ab.json") is None
    assert FE.class_for_path("v1/latest.json") is None


def _frame_index(model="GFS", leads=(0, 99, 300)):
    pre = f"v1/{model.lower()}/marine/waves/global_mid"
    return {"model": model, "run": RUN, "path": f"{pre}/index/20261111T000000Z-aaaaaaaaaaaa.json",
            "frames": [{"valid_time": _vt(h), "path": f"{pre}/20261111T000000Z/{_vt(h).replace('-', '').replace(':', '')}-"
                        f"{h:012x}.bin", "is_estimated": False} for h in leads]}


def test_split_strips_every_path_from_the_public_index():
    full = _frame_index()
    pub, priv, recut = FE.split_index(full)
    assert recut == {}
    assert [("path" in f, f.get("entitlement")) for f in pub["frames"]] == [
        (False, "free"), (False, "basic"), (False, "premium")]
    assert [f["valid_time"] for f in pub["frames"]] == [f["valid_time"] for f in full["frames"]]   # metadata stays
    assert [f["entitlement"] for f in priv["frames"]] == ["free", "basic", "premium"]
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


def test_a_bundle_is_recut_per_class_and_the_public_index_names_no_bundle():
    full, blob, segs = _bundle_index()
    pub, priv, recut = FE.split_index(full, blob)
    assert pub["bundle"] is None and len(recut) == 3                        # free, basic, premium: all private
    assert [(f["entitlement"], f["offset"], f["length"], f["sha12"]) for f in pub["frames"]] == [
        ("free", None, None, None), ("basic", None, None, None), ("premium", None, None, None)]
    for item in FE.entitled_items(priv, FE.CLASSES):                        # every slice is byte-exact
        obj = recut[item["object"]]
        lead = int((FE._parse(item["valid_time"]) - FE._parse(RUN)).total_seconds() // 3600)
        assert obj[item["offset"]:item["offset"] + item["length"]] == segs[[0, 99, 300].index(lead)]
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


def test_the_sink_keeps_every_frame_private_and_only_metadata_public():
    pub, private = DictSink(), DictSink()
    sink = FE.EntitledSink(pub, private)
    full = _frame_index("GFS", (0, 300))
    for f in full["frames"]:
        sink.write(f["path"], b"x", "application/octet-stream", "immutable")
    sink.write(full["path"], json.dumps(full).encode(), "application/json", "immutable")
    sink.write("v1/latest.json", b"{}", "application/json", "no-cache")
    sink.write("v1/other/unknown-shape.bin", b"y", "application/octet-stream", "immutable")     # fail closed
    assert not [p for p in pub.store if p.endswith(".bin")]                 # the public bucket holds NO forecast bytes
    assert all(f["path"] in private.store for f in full["frames"]) and "v1/other/unknown-shape.bin" in private.store
    public_index = json.loads(pub.store[full["path"]])
    assert not any(f["path"] in json.dumps(public_index) for f in full["frames"])   # no frame path in the public index
    assert json.loads(sink.read(full["path"]))["frames"][1]["path"] == full["frames"][1]["path"]   # the full copy
    assert sink.read(full["frames"][0]["path"]) == b"x"
    assert set(pub.store) == {full["path"], "v1/latest.json"}


def test_the_public_bucket_is_an_allowlist_so_the_png_proof_and_anything_new_stay_private():
    """Security review 2026-11-12: a deny-list (.bin only) let the PNG proof (a forecast image) through. Only the
    path-free index copies and PUBLIC_POINTERS may be public; the pointers are the publisher's own constants."""
    from services import frame_set as fs
    from services import frame_set_wind as fsw
    assert FE.PUBLIC_POINTERS == {fs.LATEST, fsw.LANE_POINTER}
    pub, private = DictSink(), DictSink()
    sink = FE.EntitledSink(pub, private)
    for path in ("gfs/waves/global_mid/20261111T000000Z/20261111T030000Z.png", "manifest.json", "v1/new/thing.json"):
        sink.write(path, b"data", "application/octet-stream", "immutable")
        assert path in private.store and path not in pub.store
    sink.write(fsw.LANE_POINTER, b"{}", "application/json", "no-cache")
    assert set(pub.store) == {fsw.LANE_POINTER} and sink.read(fsw.LANE_POINTER) == b"{}"


def test_a_private_index_miss_never_falls_back_to_the_public_copy():
    """Before the flip, the public index names frames in the PUBLIC bucket. Carrying those over would keep their bytes
    public, so a private miss is a miss: the first entitled run rebuilds every set privately."""
    pub, private = DictSink(), DictSink()
    old = _frame_index("GFS", (0,))
    pub.store[old["path"]] = json.dumps(old).encode()                       # a pre-flip public index, paths and all
    assert FE.EntitledSink(pub, private).read(old["path"]) is None


def test_bundle_flow_and_retention_never_deletes_the_recut_bundles():
    pub, private = DictSink(), DictSink()
    sink = FE.EntitledSink(pub, private)
    full, blob, _ = _bundle_index()
    sink.write(full["bundle"]["path"], blob, "application/octet-stream", "immutable")
    sink.write(full["path"], json.dumps(full).encode(), "application/json", "immutable")
    assert full["bundle"]["path"] not in pub.store and full["bundle"]["path"] not in private.store   # the mixed bundle: never
    recut = FE.class_bundle_paths(json.loads(private.store[full["path"]]))
    assert len(recut) == 3 and all(p in private.store and p not in pub.store for p in recut)
    sink.delete(sorted(sink.list("v1/gfs/marine/waves/hawaii")))
    assert all(p in private.store for p in recut)


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
    free = W.entitled_urls(full["path"], "free", load=lambda p: full, sign=sign, clock=lambda: now[0])
    basic = W.entitled_urls(full["path"], "basic", load=lambda p: full, sign=sign, clock=lambda: now[0])
    prem1 = W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    prem2 = W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    assert guest["frames"] == []
    assert [f["class"] for f in free["frames"]] == ["free"]                 # a FREE ACCOUNT goes through signed URLs
    assert [f["class"] for f in basic["frames"]] == ["free", "basic"]
    assert [f["class"] for f in prem1["frames"]] == ["free", "basic", "premium"] and prem1 == prem2
    assert len(calls) == 3                                                  # free, basic, premium once each, for every user
    assert all(f["url"].startswith(f"https://cdn.test/{f['object']}?") for f in prem1["frames"])   # the client keys bundles by object
    now[0] = W.SIGN_CACHE_S + 1
    W.entitled_urls(full["path"], "premium", load=lambda p: full, sign=sign, clock=lambda: now[0])
    assert len(calls) == 6                                                  # re-signed after the cache window


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


def test_route_answers_privately_for_an_account_and_refuses_signed_out(monkeypatch):
    client, W = _app(monkeypatch, True)
    import services.weather_tier_clamp as C

    async def identity(auth):
        return ("u-p", "premium") if auth == "Bearer p" else (None, "guest")

    monkeypatch.setattr(C, "resolve_identity", identity)
    seen = []
    monkeypatch.setattr(W, "entitled_urls", lambda index, t: seen.append(t) or {"index": index, "tier": t, "frames": []})
    path = "v1/gfs/marine/waves/global_mid/index/20261111T000000Z-aaaaaaaaaaaa.json"
    r = client.get("/api/weather/frame-urls", params={"index": path}, headers={"Authorization": "Bearer p"})
    assert r.status_code == 200 and r.headers["cache-control"] == "private, max-age=300" and seen == ["premium"]
    r = client.get("/api/weather/frame-urls", params={"index": path})                  # signed out: accounts only
    assert r.status_code == 401 and seen == ["premium"] and r.json() == {"detail": "sign_in_required"}
    assert r.headers["x-raw-tier-clamp"] == "account" and r.headers["cache-control"] == "private, no-store"


# ── the real publisher, through the wrapper, offline (the publish_frame_sets fixtures) ───────────────────────────────
def test_the_real_publisher_keeps_every_frame_private_and_retention_spans_both_buckets(tmp_path):
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

    store, out, private_out = tmp_path / "store", tmp_path / "pub", tmp_path / "private"
    pubs, privates, firsts = pub.LocalSink(out), pub.LocalSink(private_out), None
    for i, run_h in enumerate((0, 6, 12)):
        _write_store(store, run=run_iso(run_h), bump=0.1 * i, valids=valids(run_h))
        sink = FE.EntitledSink(pubs, privates)
        pub.publish_frame_sets(pub.LocalCache(store), sink, sets=[target], log=lambda *_: None)
        latest = json.loads((out / fs.LATEST).read_text())
        rec = latest["sets"][fs.set_key(target)]
        public_index = json.loads((out / rec["index"]).read_text())
        full_index = json.loads((private_out / rec["index"]).read_text())
        classes = [f["entitlement"] for f in full_index["frames"]]
        assert classes == ["free", "basic", "premium"]
        for f, g in zip(full_index["frames"], public_index["frames"]):
            assert (private_out / f["path"]).exists() and not (out / f["path"]).exists() and "path" not in g
        assert not list(out.rglob("*.bin"))                                # the public bucket: no forecast bytes
        if i == 0:
            firsts = [f["path"] for f in full_index["frames"]] + [rec["index"]]
    assert not any((out / p).exists() or (private_out / p).exists() for p in firsts)   # two runs back: gone from both


# ── the rollout: raster frames and the one-time purge ─────────────────────────────────────────────────────────────────
def test_raster_frames_go_through_the_same_private_sink(monkeypatch, tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import publish_raster_frames as R
    seen = []
    monkeypatch.setattr(R.fsr, "enabled", lambda name: True)
    monkeypatch.setattr(R.fsr, "make_source", lambda spec: None)
    monkeypatch.setattr(R.fsr, "publish", lambda source, sink, uploader, log, spec: seen.append(sink) or {})
    for on in (False, True):
        monkeypatch.setattr(R.fe, "enabled", lambda on=on: on)
        R.main(["--out-dir", str(tmp_path / str(on))])
    assert not isinstance(seen[0], FE.EntitledSink) and isinstance(seen[1], FE.EntitledSink)


def test_the_purge_refuses_until_every_set_is_private_then_removes_only_public_bins():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import purge_public_frame_bins as P
    pub, private = DictSink(), DictSink()
    idx = "v1/gfs/marine/waves/global_mid/index/20261111T000000Z-aaaaaaaaaaaa.json"
    pub.store.update({"v1/latest.json": json.dumps({"sets": {"gfs": {"index": idx}}}).encode(), idx: b"{}",
                      "v1/gfs/marine/waves/global_mid/20261111T000000Z/x-0123456789ab.bin": b"old",
                      "gfs/waves/global_mid/20261111T000000Z/20261111T030000Z.png": b"proof", "manifest.json": b"{}",
                      "v1/wind_lane.json": b"{}"})
    assert P.run(pub, private, apply=True, log=lambda *_: None) == 2 and pub.deleted == []   # not rebuilt yet: refused
    private.store[idx] = b"{}"
    assert P.run(pub, private, apply=False, log=lambda *_: None) == 0 and pub.deleted == []  # dry run
    assert P.run(pub, private, apply=True, log=lambda *_: None) == 0
    assert set(pub.store) == {"v1/latest.json", idx, "v1/wind_lane.json"}       # metadata only


def test_signing_requests_are_limited_per_account_with_retry_after(monkeypatch):
    """Owner 2026-11-12: "a per-account limit on signing requests". 429 + Retry-After; another account is untouched."""
    from services import weather_account_rate_limit as RL
    client, W = _app(monkeypatch, True)
    import services.weather_tier_clamp as C

    async def identity(auth):
        return {"Bearer a": ("u-a", "free"), "Bearer b": ("u-b", "free")}[auth]

    monkeypatch.setattr(C, "resolve_identity", identity)
    monkeypatch.setattr(W, "entitled_urls", lambda index, t: {"index": index, "tier": t, "frames": []})
    monkeypatch.setattr(RL, "LIMITER", RL.AccountLimiter({"frame-urls": (2.0, 0.1)}, clock=lambda: 0.0))
    path = "v1/gfs/marine/waves/global_mid/index/20261111T000000Z-aaaaaaaaaaaa.json"
    ask = lambda who: client.get("/api/weather/frame-urls", params={"index": path}, headers={"Authorization": f"Bearer {who}"})  # noqa: E731
    assert [ask("a").status_code for _ in range(2)] == [200, 200]
    r = ask("a")
    assert r.status_code == 429 and r.headers["retry-after"] == "10" and r.headers["cache-control"] == "private, no-store"
    assert r.headers["x-raw-tier-clamp"] == "rate_limited" and r.json()["retry_after_s"] == 10
    assert ask("b").status_code == 200
    monkeypatch.setenv(RL.FLAG, "0")
    rf._reset_for_tests(lambda: None)
    assert ask("a").status_code == 200                                      # the kill switch
