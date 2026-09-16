"""The convention belongs to the producer's frame, not the process reading it later."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import spot_ratings_precompute as pc
from services.weather_pipeline.surf_height_convention import describe


@pytest.fixture(autouse=True)
def no_external_inputs(monkeypatch):
    monkeypatch.setenv('RATING_LOCAL_SIZE', '0')
    monkeypatch.setenv('RATING_TIDE', '0')
    monkeypatch.setenv('SURF_HEIGHT_H110', '1')


def produce(monkeypatch, cap):
    monkeypatch.setenv('SURF_CAP_SEAM_MONOTONE', cap)
    async def rate(*args, **kwargs):
        return {'spot_id': 'test', 'latitude': 26., 'longitude': -80.,
                'score': 55., 'surf_height_m': 1.2, 'level': 'fair'}
    monkeypatch.setattr(pc, 'rate_one_spot', rate)
    return asyncio.run(pc.precompute_spot_ratings(
        None, [{'id': 'test'}], ['GFS'], [0],
        base_dt=datetime(2026, 9, 16, 0, tzinfo=timezone.utc)))['frames'][0]


@pytest.mark.parametrize('cap', ['0', '1'])
def test_new_frame_records_its_height_convention(monkeypatch, cap):
    frame = produce(monkeypatch, cap)
    assert frame.get('height_convention') == describe()
    assert frame['spots'][0]['score'] == 55.


def test_merge_keeps_old_frame_policy_and_unknown_old_frames(monkeypatch):
    old = produce(monkeypatch, '0')
    old['model'] = 'ICON'
    unknown = {'model': 'EURO', 'valid_time': old['valid_time'], 'spots': []}
    previous = deepcopy([old, unknown])
    fresh = produce(monkeypatch, '1')
    obj = pc.build_l2_object(pc.merge_model_frames([old, unknown], [fresh], {'GFS'}))
    by_model = {f['model']: f for f in obj['frames']}
    assert by_model['GFS'].get('height_convention', {}).get('cap_seam') == 'monotone'
    assert by_model['ICON'].get('height_convention', {}).get('cap_seam') == 'legacy'
    assert 'height_convention' not in by_model['EURO']
    assert [old, unknown] == previous
    assert 'height_convention' not in obj  # mixed frames cannot have one object-wide policy


@pytest.mark.parametrize('hour', ['2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z'])
def test_route_discloses_selected_frame_not_current_process(monkeypatch, hour):
    from routes import weather as route
    frame = produce(monkeypatch, '0')
    # Independent reader control: producer absence must not mask a dropped wire field.
    frame['height_convention'] = describe()
    expected = deepcopy(frame['height_convention'])
    monkeypatch.setenv('SURF_CAP_SEAM_MONOTONE', '1')
    monkeypatch.setenv('SPOT_RATINGS_V2', '1')
    monkeypatch.setenv('SPOT_RATINGS_STALE_TOLERANCE_S', '21600')
    monkeypatch.setattr(route, 'load_spot_ratings_l2_cached', lambda: pc.build_l2_object([frame]))
    result = asyncio.run(route.get_spot_ratings(
        bbox='-82,24,-79,28', valid_time=hour, model='GFS', limit=40, db=None))
    assert expected is not None
    assert result.model_dump().get('height_convention') == expected
    assert result.spots[0].surf_height_m == 1.2
    assert result.frame_offset_hours == (0.0 if hour == frame['valid_time'] else -5.0)


@pytest.mark.parametrize('metadata', [None, 'invalid', []])
def test_legacy_frame_unknown_despite_current_process_policy(monkeypatch, metadata):
    from routes import weather as route
    frame = {'model': 'GFS', 'valid_time': '2026-09-16T00:00:00Z', 'spots': []}
    if metadata is not None:
        frame['height_convention'] = metadata
    monkeypatch.setenv('SURF_CAP_SEAM_MONOTONE', '1')
    monkeypatch.setenv('SPOT_RATINGS_V2', '1')
    monkeypatch.setattr(route, 'load_spot_ratings_l2_cached', lambda: pc.build_l2_object([frame]))
    result = asyncio.run(route.get_spot_ratings(
        bbox='-82,24,-79,28', valid_time=frame['valid_time'], model='GFS', limit=40, db=None))
    assert result.model_dump().get('height_convention') is None
