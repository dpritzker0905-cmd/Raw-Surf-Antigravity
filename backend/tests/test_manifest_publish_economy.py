"""Egress savings 1 and 2 of #724 (manifest_publish_economy), ON, through the real one-step publisher and the chain harness.

1. A merge that equals the head (only the per-dump stamps differ) uploads nothing and swaps nothing; any real change still
   publishes at once. 2. The legacy manifest.json is PUT once per drain with the NEWEST merged bytes (or when held past the
   lag bound), not after every win. Each has its own kill switch, which restores today's behaviour.
"""
import json

import pytest

from services.weather_pipeline import manifest_publish_economy as economy
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures)
from tests._manifest_chain_harness import BASE, PILOTS_NEW, _files, chain, inline, store, submit  # noqa: F401


@pytest.fixture(autouse=True)
def _savings_on(monkeypatch, chain):
    monkeypatch.setenv("MANIFEST_SKIP_NOOP_PUBLISH", "1")
    monkeypatch.setenv("MANIFEST_LEGACY_REFRESH_DEFERRED", "1")
    monkeypatch.setattr(economy, "_held", None)
    monkeypatch.setattr(economy, "noop_skips", 0)
    yield
    economy._held = None


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


def test_the_legacy_manifest_is_put_once_per_drain_with_the_newest_bytes(chain, store, inline):
    _two_wins_in_one_drain(chain, store)
    assert len(chain.wins()) == 2
    assert len(_legacy_puts(chain)) == 1
    assert _files(chain.objects["manifest.json"]) == chain.head_files()   # the fallback equals the head at drain end


def test_the_legacy_kill_switch_puts_after_every_win(chain, store, inline, monkeypatch):
    monkeypatch.setenv("MANIFEST_LEGACY_REFRESH_DEFERRED", "0")
    _two_wins_in_one_drain(chain, store)
    assert len(chain.wins()) == 2 and len(_legacy_puts(chain)) == 2


def test_the_lag_bound_puts_held_bytes_before_the_drain_ends(chain, store, inline, monkeypatch):
    monkeypatch.setattr(economy, "LEGACY_MAX_LAG_SECONDS", 0.0)
    _two_wins_in_one_drain(chain, store)
    assert len(_legacy_puts(chain)) == 2


def test_signature_ignores_only_the_per_dump_stamps():
    doc = {"last_manifest_update": "a", "written_by": "x", "products": [{"filename": "f"}]}
    same = dict(doc, last_manifest_update="b", written_by="y")
    other = dict(doc, products=[{"filename": "g"}])
    sig = economy.content_signature(json.dumps(doc))
    assert sig == economy.content_signature(json.dumps(same)) and sig != economy.content_signature(json.dumps(other))
    assert economy.content_signature(b"<html>") is None and not economy.is_noop(None, json.dumps(doc))
