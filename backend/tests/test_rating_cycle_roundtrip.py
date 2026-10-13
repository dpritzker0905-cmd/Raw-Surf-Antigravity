import copy
import json
from datetime import datetime, timezone

import pytest
from routes.weather import SpotRatingItem
from services.weather_pipeline import spot_ratings_precompute as pc
from services.weather_pipeline.spot_ratings import rate_one_spot
from test_spot_rating_geometry_disclosure import _marine, _wind


@pytest.mark.asyncio
async def test_actual_rating_cycle_survives_json_interning_selection_and_api():
    class Resolver:
        receipt_hour = 10
        async def resolve_point(self, **kw):
            r = _marine('full') if kw['domain'] == 'marine' else _wind()
            r.model_run_time = datetime(2026, 8, 14, 0 if kw['domain'] == 'marine' else 6, tzinfo=timezone.utc)
            r.model_run_time_status = 'known'
            r.ingested_at = datetime(2026, 8, 14, self.receipt_hour, tzinfo=timezone.utc)
            r.run_time = r.ingested_at
            return r
    spot = dict(id='a', name='a', latitude=28, longitude=-80)
    row = await rate_one_spot(Resolver(), spot, 'GFS', '2026-08-14T12:00:00Z')
    later = Resolver()
    later.receipt_hour = 16
    changed = await rate_one_spot(later, spot, 'GFS', '2026-08-14T12:00:00Z')
    assert changed['score'] == row['score']
    for lane in ('marine', 'wind'):
        assert changed['time_provenance'][lane]['model_run_time'] == row['time_provenance'][lane]['model_run_time']
        assert changed['time_provenance'][lane]['ingested_at'] != row['time_provenance'][lane]['ingested_at']
    proof = row['time_provenance']
    assert proof['marine']['model_run_time'] == '2026-08-14T00:00:00Z'
    assert proof['wind']['model_run_time'] == '2026-08-14T06:00:00Z'
    frame = dict(model='GFS', valid_time='2026-08-14T12:00:00Z', spots=[row, copy.deepcopy(row)])
    pc.intern_frame_runs(frame)
    assert len(frame['runs']) == 1
    assert 'time_provenance' not in frame['spots'][0]
    saved = json.dumps(frame)
    pc.intern_frame_runs(frame)
    assert json.dumps(frame) == saved
    restored = json.loads(saved)
    expanded = pc.expand_frame_runs(restored['spots'], restored)
    selected = pc.select_precomputed({'version': pc.SPOT_RATINGS_SCHEMA_VERSION, 'frames': [restored]},
                                    (-81, 27, -79, 29), 'GFS', frame['valid_time'])
    assert selected == expanded
    assert json.dumps(restored) == saved
    assert SpotRatingItem(**expanded[0]).model_dump()['time_provenance'] == proof
    assert expanded[0]['score'] == row['score']
    expanded[0]['time_provenance']['marine']['model_run_time'] = 'changed'
    assert json.dumps(restored) == saved


def test_same_legacy_pair_different_cycles_do_not_collapse():
    spots = [dict(run_time='receipt', wind_run_time='receipt', time_provenance={'marine': {'model_run_time': c}}) for c in ['cycle0', 'cycle6']]
    frame = pc.intern_frame_runs({'spots': spots})
    assert len(frame['runs']) == 2
    assert [s['time_provenance']['marine']['model_run_time'] for s in pc.expand_frame_runs(spots, frame)] == ['cycle0', 'cycle6']


def test_old_two_column_table_never_invents_cycle():
    rows = pc.expand_frame_runs([{'spot_id': 'a', 'latitude': 0, 'longitude': 0, 'run': 0}], {'runs': [['receipt', 'receipt']]})
    assert SpotRatingItem(**rows[0]).model_dump()['time_provenance'] is None
