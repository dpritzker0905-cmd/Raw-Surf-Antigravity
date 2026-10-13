"""Interpolation preserves only a cycle proven by both contributing brackets."""
from datetime import timedelta, timezone

import pytest

from services.weather_pipeline.lattice_fill import interpolate_between
from services.weather_pipeline.schemas import NormalizedProduct
from tests.test_lattice_inband_fill import RUN, T0, _four, _product


def brackets(layer="waves"):
    domain = "wind" if layer == "wind" else "marine"
    a = _product(T0, _four(2.0, 90.0, 8.0), layer=layer, domain=domain)
    b = _product(T0 + timedelta(hours=6), _four(4.0, 90.0, 12.0),
                 layer=layer, domain=domain, run_time=RUN + timedelta(hours=1))
    return a, b


@pytest.mark.parametrize("layer", ["waves", "wind"])
@pytest.mark.parametrize("status_a,cycle_a,status_b,cycle_b,expected", [
    ("known", RUN, "known", RUN, "known"),
    ("known", RUN, "known", RUN + timedelta(hours=6), "conflicting"),
    ("known", RUN, "missing", None, "incomplete"),
    ("missing", None, "known", RUN, "incomplete"),
    ("missing", None, "missing", None, "missing"),
    ("known", None, "known", RUN, "incomplete"),
    ("known", RUN, "known", None, "incomplete"),
    ("known", RUN.replace(tzinfo=None), "known", RUN, "invalid"),
    ("known", RUN, "known", RUN.replace(tzinfo=None), "invalid"),
    ("invalid", RUN, "known", RUN, "incomplete"),
    ("missing", RUN, "missing", RUN, "missing"),
    ("conflicting", RUN, "conflicting", RUN, "missing"),
])
def test_cycle_requires_both_verified_brackets(layer, status_a, cycle_a, status_b, cycle_b, expected):
    a, b = brackets(layer)
    a.model_run_time_status, a.model_run_time = status_a, cycle_a
    b.model_run_time_status, b.model_run_time = status_b, cycle_b
    before = (a.model_dump(), b.model_dump())
    result = interpolate_between(a, b, T0 + timedelta(hours=3))
    assert result is not None
    assert result.model_run_time_status == expected
    assert result.model_run_time == (RUN if expected == "known" else None)
    assert result.is_estimated and not result.is_forecast_authoritative
    assert result.run_time == b.run_time  # Receipt time stays distinct from the verified cycle.
    assert result.ingested_at is None  # Never invent an ingestion timestamp.
    assert (a.model_dump(), b.model_dump()) == before


def test_equivalent_timezone_cycles_survive_serialization():
    a, b = brackets()
    a.model_run_time_status = b.model_run_time_status = "known"
    a.model_run_time = RUN
    b.model_run_time = RUN.astimezone(timezone(timedelta(hours=-4)))
    result = interpolate_between(a, b, T0 + timedelta(hours=3))
    restored = NormalizedProduct.model_validate_json(result.model_dump_json())
    assert restored.model_run_time_status == "known"
    assert restored.model_run_time == RUN
    assert restored.estimate_basis == result.estimate_basis
    assert restored.grid.model_dump() == result.grid.model_dump()


@pytest.mark.parametrize("layer", ["waves", "wind"])
@pytest.mark.parametrize("mode", ["known", "missing", "conflicting", "invalid"])
def test_metadata_modes_leave_physical_output_identical(layer, mode):
    a, b = brackets(layer)
    baseline = interpolate_between(a, b, T0 + timedelta(hours=3))
    a.model_run_time_status = b.model_run_time_status = "known" if mode != "missing" else "missing"
    a.model_run_time = RUN
    b.model_run_time = (RUN + timedelta(hours=6) if mode == "conflicting" else
                        RUN.replace(tzinfo=None) if mode == "invalid" else RUN)
    result = interpolate_between(a, b, T0 + timedelta(hours=3))
    excluded = {"model_run_time", "model_run_time_status"}
    assert result.model_dump(exclude=excluded) == baseline.model_dump(exclude=excluded)
