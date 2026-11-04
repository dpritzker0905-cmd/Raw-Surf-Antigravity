"""Egress fix (2026-11-04): the publisher answers its own head read from memory, by immutable unique key only.

Storage logs, 2026-11-03T20:03Z..11-04T20:03Z: every GitHub-runner GET of `manifests/manifest-g*` (1,503, ~33 GB) followed a
POST of the SAME key from the SAME runner. These pins: an acknowledged create-only upload is answered without a GET; a
different key, a legacy upserted key, or the kill switch still GETs; a fetched object is reused for its own key only.
"""
import types

import pytest

from services.weather_pipeline import manifest_pointer as mp

KEY_A = "manifests/manifest-g000000170066-1f11231a922b437ba453da5d99b091af.json"
KEY_B = "manifests/manifest-g000000170067-5c4d1911499c490d9a221fcfcf1cdf9e.json"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    mp.forget_manifest_object()
    monkeypatch.delenv("MANIFEST_SELF_READ_CACHE", raising=False)
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://example.invalid", {}))
    yield
    mp.forget_manifest_object()


def _fake_requests(monkeypatch, body=b'{"products": []}', status=200):
    calls = []

    def get(url, headers=None, timeout=None):
        calls.append(url)
        return types.SimpleNamespace(status_code=status, content=body, text="", json=lambda: {})

    import requests
    monkeypatch.setattr(requests, "get", get)
    return calls


def test_own_upload_is_answered_without_a_get(monkeypatch):
    calls = _fake_requests(monkeypatch)
    mp.remember_manifest_object(KEY_A, b"own-bytes")
    assert mp.fetch_manifest_object(KEY_A) == b"own-bytes"
    assert calls == []


def test_another_writers_head_is_still_fetched(monkeypatch):
    calls = _fake_requests(monkeypatch, body=b"theirs")
    mp.remember_manifest_object(KEY_A, b"own-bytes")
    assert mp.fetch_manifest_object(KEY_B) == b"theirs"
    assert len(calls) == 1
    assert mp.fetch_manifest_object(KEY_B) == b"theirs"   # a fetched immutable object is reused for its own key
    assert len(calls) == 1
    assert mp.fetch_manifest_object(KEY_A) == b"theirs"   # only the newest is held: the older key GETs again
    assert len(calls) == 2


def test_legacy_upserted_key_is_never_held(monkeypatch):
    calls = _fake_requests(monkeypatch, body=b"live")
    legacy = "manifests/manifest-g000000000007.json"
    mp.remember_manifest_object(legacy, b"stale")
    assert mp.fetch_manifest_object(legacy) == b"live"
    assert mp.fetch_manifest_object(legacy) == b"live"
    assert len(calls) == 2


def test_kill_switch_restores_every_get(monkeypatch):
    calls = _fake_requests(monkeypatch, body=b"live")
    mp.remember_manifest_object(KEY_A, b"own-bytes")
    monkeypatch.setenv("MANIFEST_SELF_READ_CACHE", "0")
    assert mp.fetch_manifest_object(KEY_A) == b"live"
    assert len(calls) == 1


def test_failed_get_is_not_held(monkeypatch):
    calls = _fake_requests(monkeypatch, status=503)
    assert mp.fetch_manifest_object(KEY_B) is None
    assert mp.fetch_manifest_object(KEY_B) is None
    assert len(calls) == 2


def test_store_remembers_only_acknowledged_create_only_manifest_uploads(monkeypatch):
    from services.weather_pipeline import store as store_mod
    posted = []

    def post(url, headers=None, data=None, timeout=None):
        posted.append((url, headers.get("x-upsert")))
        return types.SimpleNamespace(status_code=200, text="")

    import requests
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: object())
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only")
    st = store_mod.ProductStore.__new__(store_mod.ProductStore)
    assert st._upload_to_supabase(KEY_A, b"merged", strict=True, overwrite=False) is True
    calls = _fake_requests(monkeypatch)
    assert mp.fetch_manifest_object(KEY_A) == b"merged"
    assert calls == []
    mp.forget_manifest_object()
    st._upload_to_supabase(KEY_B, b"upserted", strict=True, overwrite=True)   # an upsert can be replaced: not held
    assert mp.fetch_manifest_object(KEY_B) == b'{"products": []}'
    assert len(calls) == 1
