"""The `series_stride` Query-object leak — a live P1 introduced by `d68f6f2d`.

WHAT HAPPENED. `routes/weather.py` declares `series_stride: Optional[int] = Query(None, ...)`, and
`get_grid` is used TWO ways: as a FastAPI route (FastAPI resolves the default to None) **and** as a
plain callable injected into the series builder (`build_grid_series(get_grid, ...)`). Called
programmatically, nothing resolves the default, so the parameter is a `Query` OBJECT. `Query(None)`
is truthy, so `(series_stride or 0)` returns the Query and `Query > 1` raises:

    TypeError: '>' not supported between instances of 'Query' and 'int'

98 occurrences in 13 minutes on production. The route catches it, so it degrades rather than 500s —
every one is a grid request that returns nothing.

WHY MY OWN BLAST-RADIUS TESTING MISSED IT. `test_series_load_stride.py`'s wiring test injects a
plain `async def resolve_grid(..., series_stride=None)`. A plain function's default IS None. The
production resolver's default is a `Query`. **A test double that does not reproduce the production
DEFAULT is not a double** — it reproduces the signature and nothing else.

THE CONTRACT PINNED HERE: `_load_kw` is the boundary that decides whether a stride is forwarded at
all. It must FAIL OPEN — return `{}` — for anything that is not a usable int, because forwarding
garbage is worse than not bounding, and raising takes the whole grid resolve down.
"""
import inspect

import pytest
from fastapi import Query

from services.weather_pipeline.grid_resolver import _load_kw


def test_the_exact_production_shape_does_not_raise():
    """THE REPRODUCTION. This is the value the real resolver receives when called programmatically."""
    import routes.weather as rw
    default = inspect.signature(rw.get_grid).parameters["series_stride"].default
    assert type(default).__name__ == "Query", (
        "SETUP STALE: get_grid's series_stride is no longer a Query default, so this test is no "
        "longer reproducing the production call shape — re-derive it before trusting a pass."
    )
    assert _load_kw(default) == {}, "a Query object must not be forwarded as a stride"


@pytest.mark.parametrize("junk", [Query(None), Query(4), object(), "4", None, 0, 1, -3, float("nan")])
def test_load_kw_fails_open_on_anything_that_is_not_a_usable_int(junk):
    """Fail OPEN, never raise: an unusable stride serves the FULL grid, which is always correct."""
    out = _load_kw(junk)
    assert out == {} or out == {"stride": int(junk)}, f"unexpected {out!r} for {junk!r}"


@pytest.mark.parametrize("n,expected", [(2, {"stride": 2}), (4, {"stride": 4}), (64, {"stride": 64})])
def test_real_strides_still_forward(n, expected):
    """POSITIVE CONTROL. Without this, 'return {} for everything' would pass the tests above and
    silently disable the whole load-time bound."""
    assert _load_kw(n) == expected
