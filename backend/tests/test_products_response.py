"""GET /api/weather/products, encoded once per manifest version (products_response.py), through the actual route.

Pins: the body is byte-identical to the per-call FastAPI response it replaces; a repeat is served without encoding;
a manifest change re-encodes; concurrent first calls share one encode; If-None-Match answers 304; `gzip;q=0` is never
compressed; the compact variant carries exactly the client's fields with the full variant's values; the kill switch
restores the per-call path.
"""
import asyncio
import gzip
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.middleware.gzip import GZipMiddleware

from services.weather_pipeline import products_response as P
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest

T0 = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)


def _product(i, **kw):
    vt = T0 + timedelta(hours=3 * i)
    fields = dict(model=("GFS", "ICON", "EURO")[i % 3], provider="open-meteo", domain="marine",
                  layer=("waves", "swell_1")[i % 2], run_time=T0, model_run_time=T0 if i % 2 else None,
                  ingested_at=T0 + timedelta(hours=4, microseconds=123456), valid_time_start=vt, valid_time_end=vt,
                  resolution=(1e-07, 1e16, -0.0, 0.1 + 0.2)[i % 4] if i > 5 else (0.25 if i % 2 else 2.0),
                  freshness_sec=3600 + 10 ** (i + 3), is_forecast_authoritative=bool(i % 2),
                  coverage=CoverageBounds(west=-85.0, south=24.0, east=-79.0 + i / 7.0, north=31.0),
                  filename=f"gfs_marine_waves_r{i}_{vt:%Y%m%dT%H%M%SZ}.json", estimate_basis={"anchor": "ü", "w": 0.1},
                  region_id=None if i == 4 else f"r{i}", product_id=f"p{i}")
    fields.update(kw)
    return ManifestProduct(**fields)


class _Store:
    def __init__(self, n=12):
        self.manifest = PipelineManifest(last_manifest_update=T0 + timedelta(seconds=1.5),
                                         products=[_product(i) for i in range(n)])

    def get_manifest(self):
        return self.manifest


@pytest.fixture(autouse=True)
def store(monkeypatch):
    monkeypatch.setattr(P, "CACHE", P.ProductsCache())
    monkeypatch.delenv(P.FLAG, raising=False)
    monkeypatch.delenv("PRODUCTS_GZIP_LEVEL", raising=False)
    from routes import weather
    s = _Store()
    monkeypatch.setattr(weather, "store", s)
    return s


def _app():
    from routes.weather import router
    app = FastAPI()
    app.include_router(router)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    return app


async def _calls(*specs):
    out = []
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
        for params, headers in specs:
            out.append(await c.get("/weather/products", params=params, headers=headers))
    return out


def _raw(resp):
    """The identity bytes of a response, whichever encoding it travelled in (httpx decodes gzip itself)."""
    return resp.content


@pytest.mark.parametrize("chunk", [1, 5, 500])
def test_the_body_is_byte_identical_to_the_per_call_fastapi_response(monkeypatch, chunk):
    monkeypatch.setattr(P, "CHUNK", chunk)
    spec = (({}, {"accept-encoding": "identity"}), ({}, {"accept-encoding": "gzip"}), ({"fields": "compact"}, {}))
    on_id, on_gz, on_compact = asyncio.run(_calls(*spec))
    monkeypatch.setenv(P.FLAG, "0")
    off_id, off_gz, off_compact = asyncio.run(_calls(*spec))
    assert on_id.status_code == on_gz.status_code == off_id.status_code == 200
    assert _raw(on_id) == _raw(off_id) == _raw(on_gz) == _raw(off_gz), "same bytes as the route always served"
    assert _raw(on_compact) == _raw(off_compact), "the compact variant equals FastAPI's encoding of the same dict"
    assert on_gz.headers["content-encoding"] == "gzip" and on_id.headers["content-encoding"] == "identity"
    assert "etag" not in off_id.headers and "server-timing" not in off_id.headers, "kill switch: the old path"
    body = json.loads(_raw(on_id))
    assert set(body) == {"last_manifest_update", "products"} and len(body["products"]) == 12


def test_a_repeat_is_served_without_encoding_and_a_manifest_change_re_encodes(store):
    real = P.encode_body
    calls = []

    def counting(*a, **k):
        calls.append(1)
        return real(*a, **k)

    async def run():
        with patch.object(P, "encode_body", counting):
            first, second = await _calls(({}, {}), ({}, {}))
            store.manifest = PipelineManifest(last_manifest_update=T0 + timedelta(hours=1),
                                              products=store.manifest.products[:5])
            third, = await _calls(({}, {}))
        return first, second, third
    first, second, third = asyncio.run(run())
    assert len(calls) == 2, "one encode per manifest version"
    assert "memo;desc=miss" in first.headers["server-timing"] and "encode;dur=" in first.headers["server-timing"]
    assert "memo;desc=hit" in second.headers["server-timing"]
    assert first.content == second.content and first.headers["etag"] == second.headers["etag"]
    assert len(json.loads(third.content)["products"]) == 5 and third.headers["etag"] != first.headers["etag"]


def test_an_in_place_manifest_write_re_encodes(store):
    first, = asyncio.run(_calls(({}, {})))
    store.manifest.products = store.manifest.products + [_product(40)]      # save_product's in-place shape
    store.manifest.last_manifest_update = T0 + timedelta(hours=2)
    second, = asyncio.run(_calls(({}, {})))
    assert len(json.loads(second.content)["products"]) == 13 and second.headers["etag"] != first.headers["etag"]


def test_concurrent_first_calls_share_one_encode():
    real = P.encode_body
    calls = []

    def slow(*a, **k):
        calls.append(1)
        import time
        time.sleep(0.2)
        return real(*a, **k)

    async def run():
        with patch.object(P, "encode_body", slow):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                return await asyncio.gather(*[c.get("/weather/products") for _ in range(4)])
    rs = asyncio.run(run())
    assert len(calls) == 1
    assert len({r.content for r in rs}) == 1 and all(r.status_code == 200 for r in rs)
    outcomes = sorted(r.headers["server-timing"].split("memo;desc=")[1].split(";")[0] for r in rs)
    assert outcomes.count("miss") == 1 and set(outcomes) <= {"miss", "shared", "hit"}, outcomes


def test_if_none_match_answers_304_with_no_body():
    first, = asyncio.run(_calls(({}, {})))
    tag = first.headers["etag"]
    assert tag.startswith('W/"') and first.headers["cache-control"] == "no-cache"
    hit, star, strong, miss = asyncio.run(_calls(({}, {"if-none-match": tag}), ({}, {"if-none-match": "*"}),
                                                 ({}, {"if-none-match": '"x", ' + tag[2:]}),
                                                 ({}, {"if-none-match": 'W/"stale"'})))
    for r in (hit, star, strong):
        assert r.status_code == 304 and r.content == b"" and r.headers["etag"] == tag
        assert "memo;desc=not_modified" in r.headers["server-timing"]
    assert miss.status_code == 200 and miss.content == first.content


def test_gzip_refused_with_q0_is_never_compressed():
    r, = asyncio.run(_calls(({}, {"accept-encoding": "gzip;q=0"})))
    assert r.headers["content-encoding"] == "identity"
    json.loads(r.content)


def test_the_compact_variant_carries_only_the_client_fields_with_the_full_values():
    full, compact = asyncio.run(_calls(({}, {}), ({"fields": "compact"}, {})))
    f, c = json.loads(full.content), json.loads(compact.content)
    assert c["last_manifest_update"] == f["last_manifest_update"]
    assert [list(p) for p in c["products"]] == [list(P.COMPACT_FIELDS)] * len(f["products"])
    assert c["products"] == [{k: p[k] for k in P.COMPACT_FIELDS} for p in f["products"]]
    assert compact.headers["etag"] != full.headers["etag"] and len(compact.content) < len(full.content)
    bad, = asyncio.run(_calls(({"fields": "everything"}, {})))
    assert bad.status_code == 422


def test_the_stored_gzip_decodes_to_the_identity_bytes(store):
    body = P.encode_body(store.manifest, False, 9)
    assert gzip.decompress(body.gz) == body.raw


def test_etag_comparison_is_weak():
    assert P.etag_matches('W/"abc"', 'W/"abc"') and P.etag_matches('"abc"', 'W/"abc"')
    assert P.etag_matches(' "zz" , W/"abc" ', 'W/"abc"') and P.etag_matches("*", 'W/"abc"')
    assert not P.etag_matches("", 'W/"abc"') and not P.etag_matches('W/"abd"', 'W/"abc"')
