"""S2 (2026-07-11): run-keyed manifest + Postgres pointer CAS — manifest_pointer.py.

Semantics under test:
- CAS advance only wins when the returned representation is non-empty (PostgREST returns []
  when the generation precondition missed — another writer advanced first).
- A missing pointer table (migration not applied) disables the lane for the process and the
  legacy manifest.json path is untouched.
- publish_run_keyed uploads the immutable run-keyed object BEFORE the pointer flip (the flip
  is the commit point) and prunes the retention ring only after a WON CAS.
- fetch_pointed_manifest is fallback-safe: any failure returns None (reader uses legacy path).
- Kill switch MANIFEST_POINTER=0 silences both directions.
"""

import json
import os
from unittest import mock

import pytest

from services.weather_pipeline import manifest_pointer as mp


@pytest.fixture(autouse=True)
def _pointer_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://unit.test.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "unit-test-key")
    monkeypatch.delenv("MANIFEST_POINTER", raising=False)
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    mp._disabled_for_process = False
    yield
    mp._disabled_for_process = False


def _resp(status, body):
    r = mock.Mock()
    r.status_code = status
    r.text = json.dumps(body) if not isinstance(body, str) else body
    r.content = r.text.encode("utf-8")
    r.json = mock.Mock(return_value=body)
    return r


class TestReadPointer:
    def test_returns_row(self):
        row = {"generation": 7, "manifest_key": "manifests/manifest-g000000000007.json"}
        with mock.patch("requests.get", return_value=_resp(200, [row])):
            assert mp.read_pointer() == row

    def test_empty_table_returns_none(self):
        with mock.patch("requests.get", return_value=_resp(200, [])):
            assert mp.read_pointer() is None

    def test_missing_table_disables_lane(self):
        with mock.patch("requests.get", return_value=_resp(404, "relation not found")):
            assert mp.read_pointer() is None
        assert not mp.pointer_enabled()

    def test_kill_switch(self, monkeypatch):
        monkeypatch.setenv("MANIFEST_POINTER", "0")
        with mock.patch("requests.get") as g:
            assert mp.read_pointer() is None
            g.assert_not_called()


class TestCasAdvance:
    def test_win(self):
        with mock.patch("requests.patch", return_value=_resp(200, [{"generation": 8}])) as p:
            assert mp.cas_advance(7, "manifests/manifest-g000000000008.json", None, "designated:gh-run-1")
        url = p.call_args[0][0]
        assert "generation=eq.7" in url  # precondition on the EXPECTED generation

    def test_lost_race_returns_false(self):
        with mock.patch("requests.patch", return_value=_resp(200, [])):
            assert not mp.cas_advance(7, "manifests/manifest-g000000000008.json", None, "x")

    def test_missing_table_disables_lane(self):
        with mock.patch("requests.patch", return_value=_resp(404, "relation not found")):
            assert not mp.cas_advance(1, "k", None, "x")
        assert not mp.pointer_enabled()


class TestPublishRunKeyed:
    def test_advance_uploads_then_flips_then_prunes(self):
        uploads, deletes = [], []
        current = {"generation": 9, "manifest_key": mp.run_keyed_manifest_key(9)}
        with mock.patch.object(mp, "read_pointer", return_value=current), \
             mock.patch.object(mp, "cas_advance", return_value=True) as cas:
            key = mp.publish_run_keyed(
                store=None, manifest_bytes=b"{}",
                upload_fn=lambda k, b: uploads.append(k),
                delete_fn=lambda k: deletes.append(k),
            )
        assert key == mp.run_keyed_manifest_key(10)
        assert uploads == [key]  # immutable object written before the flip
        cas.assert_called_once()
        assert cas.call_args[0][0] == 9  # CAS against the read generation
        assert deletes == [mp.run_keyed_manifest_key(10 - mp.KEEP_RUN_KEYED)]

    def test_cas_lost_returns_none_and_no_prune(self):
        uploads, deletes = [], []
        with mock.patch.object(mp, "read_pointer", return_value={"generation": 3}), \
             mock.patch.object(mp, "cas_advance", return_value=False):
            key = mp.publish_run_keyed(None, b"{}", lambda k, b: uploads.append(k), lambda k: deletes.append(k))
        assert key is None
        assert len(uploads) == 1  # the unreferenced copy lingers for the ring sweep
        assert deletes == []

    def test_initializes_empty_pointer(self):
        uploads = []
        with mock.patch.object(mp, "read_pointer", return_value=None), \
             mock.patch.object(mp, "_insert_initial", return_value=True) as ins:
            key = mp.publish_run_keyed(None, b"{}", lambda k, b: uploads.append(k), lambda k: None)
        assert key == mp.run_keyed_manifest_key(1)
        assert uploads == [key]
        ins.assert_called_once()

    def test_disabled_lane_is_inert(self, monkeypatch):
        monkeypatch.setenv("MANIFEST_POINTER", "0")
        uploads = []
        assert mp.publish_run_keyed(None, b"{}", lambda k, b: uploads.append(k), lambda k: None) is None
        assert uploads == []

    def test_never_raises(self):
        with mock.patch.object(mp, "read_pointer", side_effect=RuntimeError("boom")):
            assert mp.publish_run_keyed(None, b"{}", lambda k, b: None, lambda k: None) is None


class TestFetchPointedManifest:
    def test_happy_path(self):
        ptr = {"generation": 4, "manifest_key": mp.run_keyed_manifest_key(4), "written_by": "designated:gh-run-2"}
        body = _resp(200, {"products": []})
        with mock.patch.object(mp, "read_pointer", return_value=ptr), \
             mock.patch("requests.get", return_value=body) as g:
            out = mp.fetch_pointed_manifest()
        assert out == body.content
        assert ptr["manifest_key"] in g.call_args[0][0]

    def test_no_pointer_falls_back(self):
        with mock.patch.object(mp, "read_pointer", return_value=None):
            assert mp.fetch_pointed_manifest() is None

    def test_object_404_falls_back(self):
        ptr = {"generation": 4, "manifest_key": mp.run_keyed_manifest_key(4)}
        with mock.patch.object(mp, "read_pointer", return_value=ptr), \
             mock.patch("requests.get", return_value=_resp(404, "gone")):
            assert mp.fetch_pointed_manifest() is None
