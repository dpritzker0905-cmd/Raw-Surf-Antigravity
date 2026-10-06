"""Actual publisher, REST CAS and store upload; offline adversarial storage interleavings."""
import json
import re
import secrets
import threading
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests

from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import store as storage


def response(status=200, body=None, content=b''):
    return SimpleNamespace(status_code=status, text=json.dumps(body), content=content, json=lambda: body)


class MemoryStorage:
    def __init__(self, generation):
        self.pointer = None if generation == 0 else dict(generation=generation, manifest_key=mp.run_keyed_manifest_key(generation))
        self.objects = {}
        self.events = []
        self.lock = threading.RLock()
        self.fail_upload = False

    def read(self):
        with self.lock:
            return self.pointer.copy() if self.pointer else None

    def post(self, url, **kw):
        with self.lock:
            if '/object/list/' in url:
                self.events.append('list')
                return response(body=[])
            if '/rest/v1/' in url:
                if self.pointer:
                    return response(409)
                self.pointer = json.loads(kw['data'])
                self.events.append('insert')
                return response(201)
            key = url.split('/weather-products/', 1)[1]
            self.events.append(('upload', key, kw['headers']['x-upsert']))
            if self.fail_upload:
                return response(500)
            if key in self.objects and kw['headers']['x-upsert'] == 'false':
                return response(409)
            self.objects[key] = kw['data']
            return response(201)

    def patch(self, url, **kw):
        with self.lock:
            expected = int(re.search(r'generation=eq\.(\d+)', url).group(1))
            self.events.append('cas')
            if self.pointer['generation'] != expected:
                return response(body=[])
            self.pointer.update(json.loads(kw['data']))
            return response(body=[self.pointer.copy()])

    def get(self, url, **kw):
        key = url.split('/weather-products/', 1)[1]
        return response(200, content=self.objects[key]) if key in self.objects else response(404)


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setenv('MANIFEST_IMMUTABLE_PUBLICATION', '1')
    monkeypatch.setenv('SUPABASE_URL', 'https://storage.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', secrets.token_hex(16))
    monkeypatch.delenv('SUPABASE_KEY', raising=False)
    monkeypatch.delenv('MANIFEST_POINTER', raising=False)
    monkeypatch.setattr(mp, '_disabled_for_process', False)
    monkeypatch.setattr(mp, '_rest_base_and_headers', lambda: ('https://storage.invalid', {}))
    monkeypatch.setattr(storage, '_l2_writer_identity', lambda: threading.current_thread().name)
    monkeypatch.setattr(storage, '_l2_pipeline_writes_allowed', lambda: True)
    monkeypatch.setattr(storage, '_get_supabase_storage', lambda: object())
    monkeypatch.setattr('services.weather_pipeline.l2_retry.post_with_retry', lambda send, key: (send(), 0))
    memory = MemoryStorage(5)
    monkeypatch.setattr(mp, 'read_pointer', memory.read)
    monkeypatch.setattr(requests, 'post', memory.post)
    monkeypatch.setattr(requests, 'patch', memory.patch)
    monkeypatch.setattr(requests, 'get', memory.get)
    monkeypatch.setattr(requests, 'delete', Mock(return_value=response()))
    return memory, object.__new__(storage.ProductStore)


@pytest.mark.parametrize('generation', [0, 5])
def test_concurrent_loser_cannot_change_winner_bytes_or_reader_provenance(world, monkeypatch, generation):
    memory, store = world
    memory.pointer = None if generation == 0 else dict(generation=generation, manifest_key=mp.run_keyed_manifest_key(generation))
    paused, release = threading.Event(), threading.Event()

    def read():
        row = memory.read()
        if threading.current_thread().name == 'writer-B':
            paused.set()
            assert release.wait(3), 'coordination timed out'
        return row

    monkeypatch.setattr(mp, 'read_pointer', read)
    answers = {}
    thread = threading.Thread(name='writer-B', target=lambda: answers.update(B=mp.publish_run_keyed(
        store, b'B-snapshot', store._upload_to_supabase, store._delete_from_supabase)))
    thread.start()
    try:
        assert paused.wait(3)
        answers['A'] = mp.publish_run_keyed(store, b'A-snapshot', store._upload_to_supabase, store._delete_from_supabase)
    finally:
        release.set()
        thread.join(3)
    assert not thread.is_alive()
    assert answers['A'] and answers['B'] is None
    assert memory.objects[memory.pointer['manifest_key']] == b'A-snapshot'
    assert mp.fetch_pointed_manifest() == b'A-snapshot'


def test_unacknowledged_real_store_failure_never_advances_pointer(world):
    memory, store = world
    memory.fail_upload = True
    assert mp.publish_run_keyed(store, b'not-uploaded', store._upload_to_supabase, store._delete_from_supabase) is None
    assert memory.pointer['generation'] == 5
    assert 'cas' not in memory.events and 'list' not in memory.events


@pytest.mark.parametrize('ack', [None, False, 1, 'true'])
def test_unacknowledged_callback_return_never_advances_pointer(world, ack):
    memory, store = world
    assert mp.publish_run_keyed(store, b'candidate', lambda *a, **kw: ack, store._delete_from_supabase) is None
    assert memory.pointer['generation'] == 5 and 'cas' not in memory.events


def test_upload_kwargs_require_strict_non_overwrite_before_cas(world):
    memory, store = world
    upload = Mock(return_value=True)
    key = mp.publish_run_keyed(store, b'candidate', upload, store._delete_from_supabase)
    assert key == memory.pointer['manifest_key']
    assert upload.call_args.kwargs == {'strict': True, 'overwrite': False}


@pytest.mark.parametrize('enabled', ['0', 'true', None])
def test_dark_flag_preserves_legacy_key_ack_and_retention(world, monkeypatch, enabled):
    memory, store = world
    if enabled is None:
        monkeypatch.delenv('MANIFEST_IMMUTABLE_PUBLICATION')
    else:
        monkeypatch.setenv('MANIFEST_IMMUTABLE_PUBLICATION', enabled)
    upload, delete = Mock(return_value=None), Mock()
    key = mp.publish_run_keyed(store, b'candidate', upload, delete)
    assert key == mp.run_keyed_manifest_key(6)
    assert upload.call_args.kwargs == {}
    delete.assert_called_once_with(mp.run_keyed_manifest_key(1))


def test_ambiguous_cas_timeout_keeps_potentially_committed_object(world, monkeypatch):
    memory, store = world
    advance = memory.patch

    def timeout_after_commit(*a, **kw):
        advance(*a, **kw)
        raise requests.Timeout('synthetic lost CAS acknowledgment')

    monkeypatch.setattr(requests, 'patch', timeout_after_commit)
    assert mp.publish_run_keyed(store, b'committed', store._upload_to_supabase, store._delete_from_supabase) is None
    assert mp.fetch_pointed_manifest() == b'committed'
    requests.delete.assert_not_called()
    assert 'list' not in memory.events


@pytest.mark.parametrize('disabled', ['missing-table', 'kill-switch'])
def test_missing_pointer_table_and_pointer_kill_are_inert(world, monkeypatch, disabled):
    _, store = world
    if disabled == 'missing-table':
        monkeypatch.setattr(mp, '_disabled_for_process', True)
    else:
        monkeypatch.setenv('MANIFEST_POINTER', '0')
    upload = Mock()
    assert mp.publish_run_keyed(store, b'x', upload, Mock()) is None
    upload.assert_not_called()


def test_forced_unique_key_collision_refuses_overwrite(world, monkeypatch):
    from services.weather_pipeline import manifest_immutable as immutable
    memory, store = world
    monkeypatch.setattr(immutable, 'uuid4', lambda: SimpleNamespace(hex='a' * 32))
    key = 'manifests/manifest-g000000000006-' + 'a' * 32 + '.json'
    memory.objects[key] = b'protected'
    assert mp.publish_run_keyed(store, b'different', store._upload_to_supabase, store._delete_from_supabase) is None
    assert memory.objects[key] == b'protected' and memory.pointer['generation'] == 5


@pytest.mark.parametrize('generation', [-1, True, '5', None])
def test_invalid_pointer_generation_cannot_publish(world, monkeypatch, generation):
    _, store = world
    monkeypatch.setattr(mp, 'read_pointer', lambda: {'generation': generation})
    upload = Mock(return_value=True)
    assert mp.publish_run_keyed(store, b'x', upload, Mock()) is None
    upload.assert_not_called()


def test_new_key_preserves_immutable_cdn_policy_and_existing_reader(world):
    memory, store = world
    key = mp.publish_run_keyed(store, b'unchanged-wire-bytes', store._upload_to_supabase, store._delete_from_supabase)
    assert storage.manifest_cache_control(key) == '3600'
    assert mp.fetch_pointed_manifest() == b'unchanged-wire-bytes'
    assert next(e for e in memory.events if isinstance(e, tuple))[2] == 'false'


def test_legacy_manifest_success_survives_failed_immutable_copy(world, monkeypatch):
    memory, store = world
    original = memory.post

    def post(url, **kw):
        if '/manifests/' in url:
            return response(500)
        return original(url, **kw)

    monkeypatch.setattr(requests, 'post', post)
    assert store._upload_to_supabase('manifest.json', b'legacy-fallback', strict=True) is True
    assert memory.objects['manifest.json'] == b'legacy-fallback'
    assert memory.pointer['generation'] == 5


def test_retention_keeps_recent_generations_grace_and_unrecognized_paths(world, monkeypatch):
    from services.weather_pipeline import manifest_immutable as immutable
    now = datetime(2026, 10, 4, 20, tzinfo=timezone.utc)
    old = (now - timedelta(hours=2)).isoformat()
    fresh = (now - timedelta(minutes=30)).isoformat()
    rows = [{'name': 'manifest-g000000000001-' + 'a' * 32 + '.json', 'created_at': old},
            {'name': 'manifest-g000000000004.json', 'created_at': old},
            {'name': 'manifest-g000000000006-' + 'b' * 32 + '.json', 'created_at': old},
            {'name': 'manifest-g000000000003-' + 'c' * 32 + '.json', 'created_at': fresh},
            {'name': '../manifest-g000000000001.json', 'created_at': old},
            {'name': 'manifest-g000000000002.json', 'created_at': 'invalid'},
            {'name': 'manifest-g000000000003.json', 'created_at': '2026-10-04T01:00:00'},
            {'name': 'other.json', 'created_at': old}, None]
    rows.append({'name': 'manifest-g000000000002.json', 'created_at': old, 'updated_at': fresh})
    listing = Mock(return_value=response(body=rows))
    monkeypatch.setattr(requests, 'post', listing)
    immutable.prune_immutable_copies(10, now=now)
    assert requests.delete.call_args.kwargs['json'] == {'prefixes': ['manifests/' + rows[0]['name'], 'manifests/' + rows[1]['name']]}
    assert listing.call_args.kwargs['json']['limit'] == immutable.PRUNE_SCAN_LIMIT
    assert listing.call_args.kwargs['timeout'] == 5
    assert requests.delete.call_args.kwargs['timeout'] == 5


def test_retention_scan_and_delete_are_bounded_even_if_server_overreturns(world, monkeypatch):
    from services.weather_pipeline import manifest_immutable as immutable
    rows = [{'name': 'manifest-g000000000001-' + f'{n:032x}' + '.json', 'created_at': '2026-10-01T00:00:00Z'} for n in range(200)]
    monkeypatch.setattr(requests, 'post', Mock(return_value=response(body=rows)))
    immutable.prune_immutable_copies(10)
    assert requests.post.call_count == requests.delete.call_count == 1
    assert len(requests.delete.call_args.kwargs['json']['prefixes']) == immutable.PRUNE_DELETE_LIMIT


@pytest.mark.parametrize('failure', ['list-http', 'list-timeout', 'bad-list', 'delete-timeout'])
def test_retention_failure_does_not_revoke_successful_publication(world, monkeypatch, failure):
    memory, store = world
    original = memory.post

    def post(url, **kw):
        if '/object/list/' not in url:
            return original(url, **kw)
        if failure == 'list-timeout':
            raise requests.Timeout('synthetic list timeout')
        return response(500 if failure == 'list-http' else 200,
                        {} if failure == 'bad-list' else [{'name': 'manifest-g000000000001.json', 'created_at': '2026-10-01T00:00:00Z'}])

    monkeypatch.setattr(requests, 'post', post)
    if failure == 'delete-timeout':
        monkeypatch.setattr(requests, 'delete', Mock(side_effect=requests.Timeout('synthetic delete timeout')))
    key = mp.publish_run_keyed(store, b'accepted', store._upload_to_supabase, store._delete_from_supabase)
    assert key and memory.objects[key] == b'accepted'


def test_retention_never_runs_for_non_designated_writer(world, monkeypatch):
    from services.weather_pipeline import manifest_immutable as immutable
    monkeypatch.setattr(storage, '_l2_pipeline_writes_allowed', lambda: False)
    listing = Mock()
    monkeypatch.setattr(requests, 'post', listing)
    immutable.prune_immutable_copies(10)
    listing.assert_not_called()


def test_non_designated_writer_cannot_publish_namespace_directly(world, monkeypatch):
    _, store = world
    monkeypatch.setattr(storage, '_l2_pipeline_writes_allowed', lambda: False)
    upload = Mock(return_value=True)
    assert mp.publish_run_keyed(store, b'x', upload, Mock()) is None
    upload.assert_not_called()


def test_writer_gate_failure_is_fallback_safe(world, monkeypatch):
    _, store = world
    monkeypatch.setattr(storage, '_l2_pipeline_writes_allowed', Mock(side_effect=RuntimeError('synthetic writer check failure')))
    upload = Mock()
    assert mp.publish_run_keyed(store, b'x', upload, Mock()) is None
    upload.assert_not_called()


def test_cleanup_writer_gate_failure_cannot_revoke_committed_publication(world, monkeypatch):
    memory, store = world
    monkeypatch.setattr(storage, '_l2_pipeline_writes_allowed', Mock(side_effect=[True, RuntimeError('synthetic cleanup check failure')]))
    key = mp.publish_run_keyed(store, b'accepted', store._upload_to_supabase, store._delete_from_supabase)
    assert key and memory.objects[memory.pointer['manifest_key']] == b'accepted'


def test_independent_pilot_writer_declares_the_dark_publication_switch():
    import yaml
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((root/'.github/workflows/forecast-ingest-pilots.yml').read_text(encoding='utf-8'))
    writers = [step for job in workflow['jobs'].values() for step in job.get('steps', [])
               if step.get('run') == 'python scripts/ingest_forecast_ci.py']
    assert len(writers) == 1 and str(writers[0]['env']['MANIFEST_IMMUTABLE_PUBLICATION']) == '0'


def test_upload_acknowledgment_loss_keeps_unreferenced_copy_without_pointer_advance(world, monkeypatch):
    memory, store = world
    original = memory.post

    def lost_ack(url, **kw):
        original(url, **kw)
        raise requests.Timeout('synthetic lost upload acknowledgment')

    monkeypatch.setattr(requests, 'post', Mock(side_effect=lost_ack))
    assert mp.publish_run_keyed(store, b'uploaded-without-ack', store._upload_to_supabase, store._delete_from_supabase) is None
    assert memory.pointer['generation'] == 5 and list(memory.objects.values()) == [b'uploaded-without-ack']
    assert requests.post.call_count == 1 and 'cas' not in memory.events
    requests.delete.assert_not_called()


@pytest.mark.parametrize('status', [400, 409, 429, 500])
def test_storage_http_refusal_never_publishes_or_prunes(world, monkeypatch, status):
    memory, store = world
    monkeypatch.setattr(requests, 'post', Mock(return_value=response(status)))
    assert mp.publish_run_keyed(store, b'x', store._upload_to_supabase, store._delete_from_supabase) is None
    assert memory.pointer['generation'] == 5 and 'cas' not in memory.events
    requests.delete.assert_not_called()


@pytest.mark.parametrize('enabled', ['0', '1'])
def test_publication_jacobian_tracks_winner_and_rejects_loser_perturbation(world, monkeypatch, enabled):
    _, store = world
    monkeypatch.setenv('MANIFEST_IMMUTABLE_PUBLICATION', enabled)

    def sample(winner, loser):
        memory = MemoryStorage(5)
        paused, release = threading.Event(), threading.Event()

        def read():
            row = memory.read()
            if threading.current_thread().name == 'writer-B':
                paused.set()
                assert release.wait(3)
            return row

        monkeypatch.setattr(mp, 'read_pointer', read)
        monkeypatch.setattr(requests, 'post', memory.post)
        monkeypatch.setattr(requests, 'patch', memory.patch)
        monkeypatch.setattr(requests, 'get', memory.get)
        thread = threading.Thread(name='writer-B', target=lambda: mp.publish_run_keyed(
            store, json.dumps({'height': loser}).encode(), store._upload_to_supabase, store._delete_from_supabase))
        thread.start()
        try:
            assert paused.wait(3)
            assert mp.publish_run_keyed(store, json.dumps({'height': winner}).encode(),
                                        store._upload_to_supabase, store._delete_from_supabase)
        finally:
            release.set()
            thread.join(3)
        assert not thread.is_alive()
        return json.loads(mp.fetch_pointed_manifest())['height']

    epsilon = 0.05
    winner_derivative = (sample(2 + epsilon, 1) - sample(2 - epsilon, 1)) / (2 * epsilon)
    loser_derivative = (sample(2, 1 + epsilon) - sample(2, 1 - epsilon)) / (2 * epsilon)
    assert [winner_derivative, loser_derivative] == pytest.approx([1, 0] if enabled == '1' else [0, 1], abs=1e-10)
