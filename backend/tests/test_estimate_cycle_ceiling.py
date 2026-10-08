"""Exercise both extension jobs at their real save seam with a delayed receipt clock."""
from datetime import timedelta, datetime, timezone
from types import SimpleNamespace
import math

import pytest

from test_icon_marine_extended_estimates import RUN, _scheduler
from services.weather_pipeline.icon_marine_extension import ingest_icon_marine_extended_estimates_impl
from services.weather_pipeline.scheduler_helpers import ingest_euro_marine_extended_estimates_impl


def scheduler(model, cycle_status='known', delay=13, short=0):
    s = _scheduler(target_hours=(330, 336, 339, 348))
    items = s.store.get_manifest.return_value.products
    loaded = s.store.load_product.side_effect
    limit = 168 if model == 'ICON' else 240
    for p in items:
        obj = loaded(p.filename)
        if p.model == 'ICON':
            p.model = obj.model = model
            p.valid_time_start = obj.valid_time = RUN + timedelta(hours=limit-short)
            obj.run_time = RUN + timedelta(hours=delay)
            obj.model_run_time_status = cycle_status
            obj.model_run_time = RUN if cycle_status == 'known' else None
        elif p.filename.endswith('anchor.json'):
            p.valid_time_start = obj.valid_time = RUN + timedelta(hours=limit-short)
    return s


async def run(s, model):
    fn = ingest_icon_marine_extended_estimates_impl if model == 'ICON' else ingest_euro_marine_extended_estimates_impl
    assert await fn(s)
    return [p for p, _ in s.store.save_products_batch.call_args.args[0]]


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['ICON', 'EURO'])
async def test_verified_cycle_caps_delayed_receipt_without_changing_retained_values(monkeypatch, model):
    monkeypatch.setenv('TESTING', '1')
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '0')
    before = await run(scheduler(model), model)
    assert max(p.valid_time for p in before) == RUN + timedelta(hours=348)
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '1')
    after = await run(scheduler(model), model)
    assert [p.valid_time for p in after] == [RUN+timedelta(hours=h) for h in (330, 336)]
    by_time = {p.valid_time: p for p in before}
    for p in after:
        assert p.grid.model_dump() == by_time[p.valid_time].grid.model_dump()
        assert p.estimate_basis == by_time[p.valid_time].estimate_basis
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '0')
    rollback = await run(scheduler(model), model)
    assert [p.grid.model_dump() for p in rollback] == [p.grid.model_dump() for p in before]


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['ICON', 'EURO'])
async def test_short_native_anchor_uses_verified_cycle_not_nominal_anchor(monkeypatch, model):
    monkeypatch.setenv('TESTING', '1')
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '1')
    results = await run(scheduler(model, short=21), model)
    assert max(p.valid_time for p in results) == RUN + timedelta(hours=336)


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['ICON', 'EURO'])
@pytest.mark.parametrize('status', ['missing', 'conflicting', 'invalid'])
async def test_unknown_cycle_never_uses_delayed_ingestion_clock(monkeypatch, model, status):
    monkeypatch.setenv('TESTING', '1')
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '1')
    results = await run(scheduler(model, cycle_status=status), model)
    assert max(p.valid_time for p in results) == RUN + timedelta(hours=336)


@pytest.mark.parametrize('cycle,status', [
    (RUN.replace(tzinfo=None), 'known'), ('broken', 'known'),
    (RUN+timedelta(hours=400), 'known'), (RUN, 'conflicting'),
    (datetime(2060, 1, 1, tzinfo=timezone.utc), 'known'),
])
def test_unverified_cycle_falls_back_without_trusting_receipt(cycle, status):
    from services.weather_pipeline.estimate_extension_ceiling import extension_ceiling
    a = SimpleNamespace(valid_time=RUN+timedelta(hours=219), model_run_time=cycle,
                        model_run_time_status=status, run_time=RUN+timedelta(hours=13))
    assert extension_ceiling(a, 240) == RUN+timedelta(hours=315)


async def sample(model, state, parameter=None, amount=0):
    s = scheduler(model)
    # Probe the middle of the persistence blend, where both donor weights have support.
    probe_hour = 192 if model == 'ICON' else 264
    for p in s.store.get_manifest.return_value.products:
        if p.filename.endswith('t330.json'):
            p.valid_time_start = s.store.load_product.side_effect(p.filename).valid_time = RUN+timedelta(hours=probe_hour)
    loaded = s.store.load_product.side_effect
    anchors = [p for p in s.store.get_manifest.return_value.products if p.filename.endswith('anchor.json')]
    for i, p in enumerate(anchors):
        v = loaded(p.filename).grid.vectors[0]
        v.speed, v.period, v.direction = state[i]
        if parameter and parameter[0] == i:
            setattr(v, parameter[1], getattr(v, parameter[1])+amount)
        v.u = -v.speed*math.sin(math.radians(v.direction))
        v.v = -v.speed*math.cos(math.radians(v.direction))
    for p in s.store.get_manifest.return_value.products:
        if p.filename.endswith('t330.json'):
            v = loaded(p.filename).grid.vectors[0]
            v.speed, v.period, v.direction = state[2]
            if parameter and parameter[0] == 2:
                setattr(v, parameter[1], getattr(v, parameter[1])+amount)
            v.u = -v.speed*math.sin(math.radians(v.direction))
            v.v = -v.speed*math.cos(math.radians(v.direction))
    p = (await run(s, model))[0].grid.vectors[0]
    return (p.speed, p.period, p.direction)


async def jacobian(model, state):
    rows = []
    for i in range(3):
        for field in ('speed', 'period', 'direction'):
            step = .01 if field == 'speed' else 1.0  # Exceed stored grid's 0.01 period/bearing quantization.
            plus = await sample(model, state, (i, field), step)
            minus = await sample(model, state, (i, field), -step)
            rows.append(tuple((a-b)/(2*step) for a, b in zip(plus, minus)))
    return rows


STATES = [((2.3, 14, 290), (1.1, 9, 250), (1.8, 11, 270)),
          ((.7, 7, 75), (1.4, 15, 110), (2.2, 10, 90)),
          ((4.1, 17, 330), (1.6, 11, 290), (3.2, 13, 310))]


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['ICON', 'EURO'])
async def test_retained_frame_values_and_jacobians_are_identical(monkeypatch, model):
    monkeypatch.setenv('TESTING', '1')
    for state in STATES:
        monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '0')
        before, jb = await sample(model, state), await jacobian(model, state)
        monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '1')
        after, ja = await sample(model, state), await jacobian(model, state)
        assert before == after
        assert jb == ja
        assert any(abs(x) > .01 for row in jb for x in row), 'Jacobian must have signal'


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['ICON', 'EURO'])
@pytest.mark.parametrize('kind', ['period', 'direction'])
async def test_jacobian_positive_control_detects_one_percent_weight_mutants(monkeypatch, model, kind):
    from services.weather_pipeline import estimator
    monkeypatch.setenv('TESTING', '1')
    monkeypatch.setenv('ESTIMATE_CYCLE_CEILING', '1')
    original = getattr(estimator, 'blend_'+kind)
    before = await jacobian(model, STATES[0])

    def mutant(*args):
        weights = list(args[-1])
        weights[0] *= 1.01
        return original(*args[:-1], weights)

    monkeypatch.setattr(estimator, 'blend_'+kind, mutant)
    after = await jacobian(model, STATES[0])
    assert max(abs(a-b) for ra, rb in zip(after, before) for a, b in zip(ra, rb)) > 1e-6
