"""The pointer-side pieces of the one-step publisher: reconcile(remote_products=), manifest_pointer.fetch_manifest_object,
and publish_run_keyed's per-thread suppression."""
import json
import threading
from types import SimpleNamespace

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline.store import reconcile_manifest_products_for_upload
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import RUN_TIME, _entry, _raw_entry  # noqa: F401,F811


def test_reconcile_with_remote_products_merges_against_them_and_never_fetches(monkeypatch):
    """The one-step job holds the head it read by generation; reconcile must use THAT list, not fetch another one."""
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: pytest.fail("fetched a second head"))
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    folded = reconcile_manifest_products_for_upload(
        manifest, exclude_keys={"pruned.json"},
        remote_products=[_raw_entry("ours.json"), _raw_entry("theirs.json"), _raw_entry("pruned.json")])
    assert folded == 1
    assert sorted(p.filename for p in manifest.products) == ["ours.json", "theirs.json"]


def test_reconcile_with_an_empty_remote_products_list_still_does_not_fetch(monkeypatch):
    """[] is a head with no products, not 'unknown': it must not trigger the fetch that None means."""
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: pytest.fail("fetched a second head"))
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest, remote_products=[]) == 0
    assert [p.filename for p in manifest.products] == ["ours.json"]


def test_reconcile_without_remote_products_fetches_exactly_as_before(monkeypatch):
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    fetched = []
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                        lambda: fetched.append(1) or [_raw_entry("theirs.json")])
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest) == 1
    assert fetched == [1]
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest, remote_products=None) == 1
    assert fetched == [1, 1]


def test_reconcile_swallows_a_failure_when_it_fetches_but_raises_when_the_caller_supplied_the_head(monkeypatch):
    """Fetching: 'never raises, the local snapshot is the upload basis' is the documented pre-fix behaviour and stays.
    Supplied: the caller is about to CAS the result, and a swallowed failure would hand it an UNMERGED snapshot that looks
    merged, so the failure must reach the caller."""
    monkeypatch.setattr(store_mod, "manifest_retention_cutoff", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [_raw_entry("theirs.json")])
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest) == 0
    with pytest.raises(RuntimeError, match="boom"):
        reconcile_manifest_products_for_upload(manifest, remote_products=[_raw_entry("theirs.json")])


class _Response:
    def __init__(self, status_code=200, content=b"{}"):
        self.status_code, self.content, self.text = status_code, content, content.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.content)


@pytest.fixture
def storage_get(monkeypatch):
    """requests.get, recorded. `answers` is consumed one per call (an Exception instance is raised)."""
    import requests
    calls, answers = [], []
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://storage.invalid", {"apikey": "test-key"}))

    def get(url, **kwargs):
        calls.append((url, kwargs))
        answer = answers.pop(0) if answers else _Response()
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(requests, "get", get)
    return SimpleNamespace(calls=calls, answers=answers)


def test_fetch_manifest_object_returns_the_bytes_of_the_object_named_by_the_key(storage_get):
    key = "manifests/manifest-g000000000006-" + "ab" * 16 + ".json"
    storage_get.answers.append(_Response(200, b'{"products": []}'))
    assert mp.fetch_manifest_object(key) == b'{"products": []}'
    url, kwargs = storage_get.calls[0]
    assert url == "https://storage.invalid/storage/v1/object/weather-products/" + key
    assert kwargs["headers"] == {"apikey": "test-key"} and kwargs["timeout"] > 0


@pytest.mark.parametrize("answer", [_Response(404, b"not found"), _Response(500, b"boom"), _Response(429, b"SlowDown"),
                                    RuntimeError("connection reset")], ids=["404", "500", "429", "raises"])
def test_fetch_manifest_object_never_raises_and_answers_none_on_any_failure(storage_get, answer):
    storage_get.answers.append(answer)
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is None


@pytest.mark.parametrize("key", [None, ""])
def test_fetch_manifest_object_without_a_key_does_not_ask_storage(storage_get, key):
    assert mp.fetch_manifest_object(key) is None
    assert storage_get.calls == []


def test_fetch_manifest_object_without_storage_configuration_is_none(monkeypatch, storage_get):
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: (None, None))
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is None
    assert storage_get.calls == []


def _publish_reaches_the_pointer(monkeypatch):
    """True when publish_run_keyed got as far as reading the pointer (i.e. it was NOT suppressed)."""
    reached = []
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", lambda: reached.append(1))        # no row yet: the initial-insert branch
    monkeypatch.setattr(mp, "_insert_initial", lambda *args, **kwargs: False)
    monkeypatch.setattr(store_mod, "_l2_writer_identity", lambda: "designated:test")
    mp.publish_run_keyed(None, b"{}", lambda *args, **kwargs: True, lambda key: None)
    return bool(reached)


def test_publish_run_keyed_is_a_no_op_while_it_is_suppressed_on_this_thread(monkeypatch):
    with mp.publish_run_keyed_suppressed():
        assert _publish_reaches_the_pointer(monkeypatch) is False


def test_the_suppression_ends_with_the_block_even_when_the_block_raises(monkeypatch):
    with pytest.raises(RuntimeError):
        with mp.publish_run_keyed_suppressed():
            raise RuntimeError("legacy PUT failed")
    assert _publish_reaches_the_pointer(monkeypatch) is True


def test_nested_suppression_restores_the_outer_one(monkeypatch):
    with mp.publish_run_keyed_suppressed():
        with mp.publish_run_keyed_suppressed():
            pass
        assert _publish_reaches_the_pointer(monkeypatch) is False


def test_the_suppression_is_per_thread(monkeypatch):
    seen = []
    with mp.publish_run_keyed_suppressed():
        worker = threading.Thread(target=lambda: seen.append(_publish_reaches_the_pointer(monkeypatch)))
        worker.start()
        worker.join()
    assert seen == [True], "another thread's publish was silenced"


# ── cas_advance(expected_key=): the swap also names the head it was merged against (ABA) ──────────────────────────────────

@pytest.fixture
def patched(monkeypatch):
    """requests.patch, recorded: the pointer row's UPDATE."""
    import requests
    calls = []
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://db.invalid", {"apikey": "test-key"}))
    monkeypatch.setattr(requests, "patch",
                        lambda url, **kwargs: calls.append((url, kwargs)) or _Response(200, b'[{"generation": 6}]'))
    return calls


def test_cas_advance_without_an_expected_key_filters_on_the_generation_alone_as_before(patched):
    assert mp.cas_advance(5, "manifests/manifest-g000000000006.json", "run-1", "designated:gh-run-1") is True
    url, kwargs = patched[0]
    assert url == "https://db.invalid/rest/v1/weather_manifest_pointer?id=eq.1&generation=eq.5"
    body = json.loads(kwargs["data"])
    assert body["generation"] == 6 and body["manifest_key"] == "manifests/manifest-g000000000006.json"


def test_cas_advance_with_an_expected_key_also_filters_on_the_manifest_key_url_encoded(patched):
    head = "manifests/manifest-g000000000005-" + "ab" * 16 + ".json"
    assert mp.cas_advance(5, "manifests/manifest-g000000000006-" + "cd" * 16 + ".json", "run-1", "x", expected_key=head) is True
    url, kwargs = patched[0]
    assert url == ("https://db.invalid/rest/v1/weather_manifest_pointer?id=eq.1&generation=eq.5"
                   "&manifest_key=eq.manifests%2Fmanifest-g000000000005-" + "ab" * 16 + ".json")
    assert json.loads(kwargs["data"])["manifest_key"].startswith("manifests/manifest-g000000000006-"), \
        "the new key is written, not the expected one"


def test_an_expected_key_cannot_smuggle_a_second_filter_into_the_update(patched):
    mp.cas_advance(5, "k", None, "x", expected_key="k&generation=eq.1")
    url = patched[0][0]
    assert url.count("&") == 2 and "%26" in url, url


# ── fetch_manifest_object: a DEFINITE miss is not a transient failure (round-4 finding P7) ───────────────────────────────

@pytest.mark.parametrize("status,body", [
    (400, {"statusCode": "404", "error": "not_found", "message": "Object not found"}),      # what Supabase answers for a missing object
    (400, {"code": "NoSuchKey"}),
    (404, {"statusCode": "404", "error": "not_found", "message": "Object not found"}),
    (404, {"code": "NoSuchKey"}),
], ids=["400-not_found", "400-NoSuchKey", "404-not_found", "404-NoSuchKey"])
def test_fetch_manifest_object_answers_MISSING_when_storage_says_the_object_does_not_exist(storage_get, status, body):
    storage_get.answers.append(_Response(status, json.dumps(body).encode("utf-8")))
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is mp.MISSING


@pytest.mark.parametrize("answer", [
    _Response(404, b"<html>404 Not Found</html>"),                       # a proxy's page says nothing about the object
    _Response(400, b'{"statusCode": "404", "error": "Bucket not found"}'),     # a missing BUCKET is not a missing object
    _Response(400, b'{"error": "InvalidKey"}'),
    _Response(500, b'{"code": "NoSuchKey"}'),
    _Response(429, b'{"error": "SlowDown"}'),
    RuntimeError("connection reset"),
], ids=["404-html", "bucket", "invalid-key", "500", "429", "raises"])
def test_fetch_manifest_object_answers_None_for_everything_that_is_not_a_definite_miss(storage_get, answer):
    storage_get.answers.append(answer)
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is None


def test_MISSING_is_falsy_and_distinct_from_the_bytes_and_from_None():
    assert mp.MISSING is not None and not mp.MISSING and repr(mp.MISSING) == "MISSING"
