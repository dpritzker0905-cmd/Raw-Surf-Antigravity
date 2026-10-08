from datetime import datetime, timedelta, timezone
import gzip
import io
import json
from types import SimpleNamespace
import urllib.error

import pytest

from services.weather_pipeline import buoy_calibration as bc, forecast_skill as fs
from services.weather_pipeline.skill_archive_codec import (
    archive_size_warning, decode_archive, encode_archive, SIZE_WARN_BYTES,
)
from scripts import forecast_accuracy_monitor as monitor

KEY = 'calibration/skill/scored-2026-10.json'
ROWS = [{'source': 'raw_surf', 'buoy_id': '41009', 'target_time': '2026-10-07T12:00:00Z',
         'lead_h': 24, 'hs_m': 1.25, 'obs_hs_m': 1.2, 'err_m': .05}]


@pytest.fixture
def storage_config(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://storage.example.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'offline-test-only')
    monitor._L2_READ_FAILURES.clear()
    monitor._L2_OBJECT_BYTES.clear()


def test_gzip_changes_no_serialized_row_byte():
    encoded = encode_archive(ROWS, KEY)
    raw = json.dumps(ROWS, separators=(',', ':')).encode('utf-8')
    assert gzip.decompress(encoded) == raw
    assert decode_archive(encoded) == decode_archive(raw) == ROWS
    assert encode_archive(ROWS, 'calibration/skill/pending.json') == raw


def test_large_month_fits_a_50_mib_limit_without_dropping_rows():
    rows = [{**ROWS[0], 'buoy_id': str(i), 'diagnostics': {'note': 'archive-shape-' * 90}}
            for i in range(50000)]
    raw = json.dumps(rows, separators=(',', ':')).encode('utf-8')
    encoded = encode_archive(rows, KEY)
    limit = 50 * 1024 * 1024
    assert len(raw) > limit  # Uncompressed writes fail this Storage limit.
    assert len(encoded) < limit
    assert gzip.decompress(encoded) == raw
    assert len(decode_archive(encoded)) == 50000


@pytest.mark.parametrize('compressed', [False, True])
def test_real_calibration_and_monitor_readers_accept_old_and_new_bytes(storage_config, monkeypatch, compressed):
    raw = json.dumps(ROWS).encode('utf-8')
    content = gzip.compress(raw) if compressed else raw
    monkeypatch.setattr('requests.get', lambda *a, **kw: SimpleNamespace(status_code=200, content=content))
    monkeypatch.setattr('urllib.request.urlopen', lambda *a, **kw: io.BytesIO(content))
    assert bc.load_calibration_l2(KEY, strict=True) == ROWS
    assert monitor._fetch_l2(KEY) == ROWS
    assert monitor._L2_OBJECT_BYTES[KEY] == len(content)


def test_corrupt_compressed_archive_is_unreadable_not_empty(storage_config, monkeypatch):
    corrupt = b'\x1f\x8bnot-a-valid-gzip-stream'
    monkeypatch.setattr('requests.get', lambda *a, **kw: SimpleNamespace(status_code=200, content=corrupt))
    monkeypatch.setattr('urllib.request.urlopen', lambda *a, **kw: io.BytesIO(corrupt))
    with pytest.raises(bc.CalibrationReadError):
        bc.load_calibration_l2(KEY, strict=True)
    assert monitor._fetch_l2(KEY) is None
    assert KEY in monitor._L2_READ_FAILURES


@pytest.mark.parametrize('content', [b'null', b'{}'])
def test_invalid_row_archive_is_not_confirmed_absence(storage_config, monkeypatch, content):
    monkeypatch.setattr('requests.get', lambda *a, **kw: SimpleNamespace(status_code=200, content=content))
    monkeypatch.setattr('urllib.request.urlopen', lambda *a, **kw: io.BytesIO(content))
    with pytest.raises(bc.CalibrationReadError):
        bc.load_calibration_rows_l2(KEY)
    assert monitor._fetch_l2(KEY) is None
    assert KEY in monitor._L2_READ_FAILURES


@pytest.mark.parametrize('code,body,failed', [
    (400, {'statusCode': '404', 'error': 'not_found'}, False),
    (404, {'code': 'NoSuchBucket'}, True),
    (503, {'error': 'Unavailable'}, True),
])
def test_month_seam_distinguishes_confirmed_absence_from_unreadable(storage_config, monkeypatch, code, body, failed):
    def read(*a, **kw):
        raise urllib.error.HTTPError('https://storage.example.invalid', code, 'synthetic', {},
                                     io.BytesIO(json.dumps(body).encode('utf-8')))
    monkeypatch.setattr('urllib.request.urlopen', read)
    assert monitor._fetch_l2(KEY) is None
    assert (KEY in monitor._L2_READ_FAILURES) is failed


def test_storage_size_warns_at_40_mib_without_changing_other_archive_types():
    assert archive_size_warning(KEY, SIZE_WARN_BYTES - 1) is None
    assert '::warning::' in archive_size_warning(KEY, SIZE_WARN_BYTES)
    assert archive_size_warning('calibration/skill/pending.json', SIZE_WARN_BYTES) is None


@pytest.mark.parametrize('failure', [None, 'current', 'previous', 'residual-current', 'residual-previous'])
def test_real_monitor_main_borrows_only_readable_month_seam(storage_config, monkeypatch, capsys, failure):
    from test_forecast_accuracy_monitor import _pair_rows, _report
    now = datetime(2026, 10, 1, 0, 30, tzinfo=timezone.utc)
    report = {**_report(), 'generated_at': (now - timedelta(hours=1)).isoformat()}
    previous = _pair_rows(260, now - timedelta(hours=130), 'seam-')

    def read(request, **kwargs):
        key = request.full_url.split('/weather-products/', 1)[1]
        if key.endswith('residuals-2026-10.json'):
            if failure == 'residual-current':
                return io.BytesIO(b'\x1f\x8bcorrupt')
            raise urllib.error.HTTPError(request.full_url, 400, 'synthetic', {},
                                         io.BytesIO(b'{"statusCode":"404","error":"not_found"}'))
        if key.endswith('residuals-2026-09.json'):
            return io.BytesIO(b'\x1f\x8bcorrupt' if failure == 'residual-previous' else
                              json.dumps([{'buoy_time': (now - timedelta(hours=1)).isoformat()}]).encode('utf-8'))
        if key.endswith('scored-2026-10.json'):
            if failure == 'current':
                return io.BytesIO(b'\x1f\x8bcorrupt')
            raise urllib.error.HTTPError(request.full_url, 400, 'synthetic', {},
                                         io.BytesIO(b'{"statusCode":"404","error":"not_found"}'))
        if key.endswith('scored-2026-09.json'):
            return io.BytesIO(b'\x1f\x8bcorrupt' if failure == 'previous' else encode_archive(previous, key))
        return io.BytesIO(json.dumps([{'buoy_time': now.isoformat()}]).encode('utf-8'))

    monkeypatch.setattr('urllib.request.urlopen', read)
    monkeypatch.setattr(monitor, '_fetch_json', lambda *a, **kw: report)
    monkeypatch.setattr('sys.argv', ['forecast_accuracy_monitor.py', '--as-of', now.isoformat()])
    verdict = monitor.main()
    output = capsys.readouterr().out
    if failure:
        assert verdict != monitor.OK
        assert ('ARCHIVE READER BLIND' if failure.startswith('residual-') else 'SKILL FLOOR UNMEASURED') in output
    else:
        assert verdict == monitor.OK
        assert 'we win' in output and 'newest scored target' in output


@pytest.mark.parametrize('fraction,warns', [(0.85, False), (0.86, True)])
def test_pending_capacity_warns_before_any_eviction(fraction, warns):
    from test_forecast_accuracy_monitor import _report
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    report = {**_report(), 'generated_at': now.isoformat()}
    report['forecast_skill_ops']['pending_kept'] = int(fraction * fs.PENDING_MAX_ENTRIES)
    verdict, lines = monitor.evaluate_report(report, now, monitor.default_cfg())
    assert verdict == monitor.OK
    assert any('SKILL PENDING CAPACITY' in line for line in lines) is warns


def test_measured_twenty_pass_cadence_keeps_every_pending_lead():
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    incoming = [dict(source=f'lane-{lane}', buoy_id=f'buoy-{buoy}', lead_h=lead, hs_m=1.25,
                     target_time=(now + timedelta(hours=(slot + 1) * 24 / 20)).isoformat(),
                     made_at=now.isoformat())
                for lane in range(9) for buoy in range(60) for lead in (24, 48, 72)
                for slot in range(20 * lead // 24)]
    assert len(incoming) == 64800
    before_stats, after_stats = {}, {}
    before = fs.merge_pending([], incoming, now=now, max_entries=54000, stats=before_stats)
    after = fs.merge_pending([], incoming, now=now, max_entries=fs.PENDING_MAX_ENTRIES, stats=after_stats)
    assert len(before) == 54000 and before_stats['cap_evicted'] == 10800
    assert len(after) == 64800 and after_stats['cap_evicted'] == 0
