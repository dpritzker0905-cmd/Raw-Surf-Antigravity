"""Egress saving (no-op skip) of #724 (manifest_publish_economy), ON, through the real one-step publisher and the chain harness.

A merge that equals the head (only the per-dump stamps differ) uploads nothing and swaps nothing; any real change still
publishes at once; the kill switch restores today's behaviour. The legacy manifest.json stays a LIVE fallback: it is still
PUT after every win, and written on every publish when the pointer lane is disabled.
"""
import json

import pytest

from services.weather_pipeline import manifest_publish_economy as economy
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures)
from tests._manifest_chain_harness import BASE, PILOTS_NEW, _files, chain, inline, store, submit  # noqa: F401


@pytest.fixture(autouse=True)
def _savings_on(monkeypatch, chain):
    monkeypatch.setenv("MANIFEST_SKIP_NOOP_PUBLISH", "1")
    monkeypatch.setattr(economy, "noop_skips", 0)
    yield


def _legacy_puts(chain):
    return [u for u in chain.uploads if u[0] == "manifest.json"]


def _unique_uploads(chain):
    return [u for u in chain.uploads if u[0].startswith("manifests/")]


def test_a_merge_equal_to_the_head_uploads_and_swaps_nothing(chain, store, inline):
    head_before = chain.head_key
    submit(store, BASE)                                   # the head already serves BASE
    assert chain.wins() == [] and _unique_uploads(chain) == [] and _legacy_puts(chain) == []
    assert chain.head_key == head_before and economy.noop_skips == 1


def test_a_real_change_still_publishes_at_once(chain, store, inline):
    submit(store, BASE + PILOTS_NEW)
    assert len(chain.wins()) == 1 and chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert economy.noop_skips == 0


def test_the_noop_kill_switch_publishes_as_before(chain, store, inline, monkeypatch):
    monkeypatch.setenv("MANIFEST_SKIP_NOOP_PUBLISH", "0")
    submit(store, BASE)
    assert len(chain.wins()) == 1 and economy.noop_skips == 0


def _two_wins_in_one_drain(chain, store):
    chain.during_upload = lambda: submit(store, BASE + PILOTS_NEW + ["euro_wind_wind_global_mid_20261026T000000Z.json"])
    submit(store, BASE + PILOTS_NEW)


def test_the_legacy_fallback_is_still_put_after_every_win(chain, store, inline):
    """manifest.json is a LIVE fallback (store_helpers reads it whenever fetch_pointed_manifest() returns None), so it is
    refreshed after EVERY win, never deferred, and always equals the head that was just published."""
    seen = []
    real_upload = chain.upload

    def upload(key, data, **kw):
        result = real_upload(key, data, **kw)
        if key == "manifest.json":
            seen.append((_files(data), chain.head_files()))
        return result
    chain.upload = upload
    _two_wins_in_one_drain(chain, store)
    assert len(chain.wins()) == 2 and len(seen) == 2
    assert all(legacy == head for legacy, head in seen)


def test_pointer_disabled_writes_the_legacy_manifest_on_every_publish(chain, store, inline, monkeypatch):
    """The pointer lane gone (disabled for the process): every publish goes to manifest.json, the only copy readers then use."""
    from services.weather_pipeline import manifest_pointer as mp
    monkeypatch.setattr(mp, "pointer_enabled", lambda: False)
    monkeypatch.setattr(mp, "read_pointer", lambda **kw: None)
    submit(store, BASE + PILOTS_NEW)
    submit(store, BASE + PILOTS_NEW + ["euro_wind_wind_global_mid_20261026T000000Z.json"])
    assert len(_legacy_puts(chain)) == 2 and economy.noop_skips == 0
    assert "euro_wind_wind_global_mid_20261026T000000Z.json" in _files(chain.objects["manifest.json"])


def test_a_pointer_read_error_never_counts_as_a_noop(chain, store, inline, monkeypatch):
    """A transient pointer failure is a failed attempt (retried), never a skip: nothing is called published that was not."""
    from services.weather_pipeline import manifest_pointer as mp
    real = mp.read_pointer
    answers = [None]
    monkeypatch.setattr(mp, "read_pointer", lambda **kw: answers.pop(0) if answers else real(**kw))
    submit(store, BASE + PILOTS_NEW)
    assert economy.noop_skips == 0 and len(chain.wins()) == 1 and len(_legacy_puts(chain)) == 1


def test_signature_ignores_only_the_per_dump_stamps():
    doc = {"last_manifest_update": "a", "written_by": "x", "products": [{"filename": "f"}]}
    same = dict(doc, last_manifest_update="b", written_by="y")
    other = dict(doc, products=[{"filename": "g"}])
    sig = economy.content_signature(json.dumps(doc))
    assert sig == economy.content_signature(json.dumps(same)) and sig != economy.content_signature(json.dumps(other))
    assert economy.content_signature(b"<html>") is None and not economy.is_noop(None, json.dumps(doc))
