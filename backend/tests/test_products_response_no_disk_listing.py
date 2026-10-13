"""
A15-16 (audit 15.0, measured live 2026-09-25): the public `/api/weather/products` response carried
`cache_dir` (the server's absolute cache path) and `files_on_disk` (2,717 file names), re-listed
from disk on every call. Nothing consumed either over HTTP. The response is now the manifest only.
"""
import asyncio
from types import SimpleNamespace as S

import routes.weather as W


def test_products_response_is_the_manifest_and_nothing_about_the_disk(monkeypatch):
    manifest = S(last_manifest_update="2026-09-25T18:23:27Z", products=[{"product_id": "p.json"}])

    class Store:
        cache_dir = "/opt/render/project/src/backend/data/weather_cache"

        def get_manifest(self):
            return manifest

    monkeypatch.setattr(W, "store", Store())
    body = asyncio.run(W.get_products())
    assert body == {"last_manifest_update": "2026-09-25T18:23:27Z", "products": [{"product_id": "p.json"}]}
    assert "cache_dir" not in body and "files_on_disk" not in body


def test_products_route_no_longer_lists_the_cache_directory(monkeypatch, tmp_path):
    import os
    (tmp_path / "gfs_marine_waves_x.json").write_text("{}")   # a real, non-empty cache dir
    calls = []
    monkeypatch.setattr(os, "listdir", lambda *a, **k: calls.append(a) or [])

    class Store:
        cache_dir = tmp_path

        def get_manifest(self):
            return S(last_manifest_update=None, products=[])

    monkeypatch.setattr(W, "store", Store())
    asyncio.run(W.get_products())
    assert calls == [], "no directory listing on the request path"
