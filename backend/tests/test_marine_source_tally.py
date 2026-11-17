"""The precompute's marine-source counter: it must COUNT and never CHANGE anything.

Owner, 2026-11-17: "Count in precompute". The question it answers: how many SERVED spot-frames are answered by
the point resolver's live upstream branch (no stored product), by model and lead. The contract pinned here:
  1. the counter is a pass-through: the same response object comes back, and the frames the precompute builds are
     byte-identical with and without it (the real `rate_one_spot` runs in that test, not a mock);
  2. only marine `waves` answers are counted; a wind call passes through uncounted;
  3. a resolver error is counted and re-raised unchanged; a fault in the counting itself never costs a rating;
  4. the printed table carries counts only: no spot, no coordinate, no value."""
import asyncio
import inspect
import json
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import marine_source_tally as T  # noqa: E402

BASE = datetime(2026, 11, 17, 12, 0, 0, tzinfo=timezone.utc)


# ── classify ─────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("resp,expected", [
    (None, "no_answer"),
    (NS(point=None, product_id="gfs_marine_waves_global_mid"), "no_answer"),
    (NS(point=NS(speed=1.0), product_id="gfs_marine_waves_global_mid", upstream_provider=None, provider="gfs"), "stored"),
    (NS(point=NS(speed=1.0), product_id=None, upstream_provider="Open-Meteo", provider="gfs"), "upstream:open-meteo"),
    (NS(point=NS(speed=1.0), product_id=None, upstream_provider=None, provider="copernicus"), "upstream:copernicus"),
    (NS(point=NS(speed=1.0), product_id="", upstream_provider=" MFWAM ", provider=None), "upstream:mfwam"),
    (NS(point=NS(speed=1.0)), "upstream:unknown"),
])
def test_classify(resp, expected):
    assert T.classify(resp) == expected


def test_a_stored_product_wins_over_an_upstream_label():
    """A response that carries a product id was answered from a stored product, whatever else it is labelled."""
    assert T.classify(NS(point=NS(speed=1.0), product_id="x", upstream_provider="open-meteo")) == "stored"


# ── lead bands ───────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("vt,expected", [
    ("2026-11-17T12:00:00Z", "0-24h"), ("2026-11-18T11:00:00Z", "0-24h"),
    ("2026-11-18T12:00:00Z", "24-48h"), ("2026-11-19T11:00:00Z", "24-48h"),
    ("2026-11-19T12:00:00Z", "48-72h"), ("2026-11-20T11:00:00+00:00", "48-72h"),
    ("2026-11-20T12:00:00Z", "72h+"), ("2026-12-01T12:00:00Z", "72h+"),
    ("2026-11-18T12:00:00", "24-48h"),              # no zone: read as UTC
    ("not a time", "unknown"), (None, "unknown"), ("", "unknown"),
])
def test_lead_band(vt, expected):
    assert T.lead_band(vt, BASE) == expected


def test_lead_band_without_a_base_is_unknown():
    assert T.lead_band("2026-11-18T12:00:00Z", None) == "unknown"


def test_lead_band_accepts_a_naive_base():
    assert T.lead_band("2026-11-18T12:00:00Z", BASE.replace(tzinfo=None)) == "24-48h"


# ── the pass-through ─────────────────────────────────────────────────────────────────────────────────────────
class Inner:
    """A resolver that answers marine from a per-model script, and wind with a distinct object."""

    def __init__(self, marine):
        self.marine, self.calls, self.extra = marine, [], "kept"
        self.wind = NS(point=NS(speed=5.0))

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        self.calls.append((model, domain, layer, lat, lng, valid_time_str))
        if domain != "marine":
            return self.wind
        got = self.marine[model]
        if isinstance(got, BaseException):
            raise got
        return got


STORED = NS(point=NS(speed=1.0), product_id="gfs_marine_waves_global_mid", provider="gfs", upstream_provider=None)
LIVE = NS(point=NS(speed=1.0), product_id=None, provider="euro", upstream_provider="copernicus")


def _ask(res, model, vt="2026-11-17T15:00:00Z", domain="marine", layer="waves"):
    return asyncio.run(res.resolve_point(model=model, domain=domain, layer=layer, lat=21.0, lng=-158.0, valid_time_str=vt))


def test_the_same_object_comes_back_and_the_inner_call_is_unchanged():
    inner = Inner({"GFS": STORED, "EURO": LIVE})
    res = T.CountingResolver(inner, base=BASE)
    assert _ask(res, "GFS") is STORED and _ask(res, "EURO") is LIVE
    assert inner.calls == [("GFS", "marine", "waves", 21.0, -158.0, "2026-11-17T15:00:00Z"),
                           ("EURO", "marine", "waves", 21.0, -158.0, "2026-11-17T15:00:00Z")]
    assert res.counts == {("GFS", "0-24h", "stored"): 1, ("EURO", "0-24h", "upstream:copernicus"): 1}


def test_other_attributes_reach_the_inner_resolver():
    res = T.CountingResolver(Inner({}), base=BASE)
    assert res.extra == "kept"
    with pytest.raises(AttributeError):
        res.not_there


def test_wind_is_passed_through_and_not_counted():
    inner = Inner({"GFS": STORED})
    res = T.CountingResolver(inner, base=BASE)
    assert _ask(res, "GFS", domain="wind", layer="wind") is inner.wind
    assert not res.counts


def test_a_positional_call_is_counted_too():
    res = T.CountingResolver(Inner({"GFS": LIVE}), base=BASE)
    got = asyncio.run(res.resolve_point("GFS", "marine", "waves", 21.0, -158.0, "2026-11-19T12:00:00Z"))
    assert got is LIVE and res.counts == {("GFS", "48-72h", "upstream:copernicus"): 1}


def test_no_answer_is_counted_as_no_answer():
    res = T.CountingResolver(Inner({"ICON": None}), base=BASE)
    assert _ask(res, "ICON") is None
    assert res.counts == {("ICON", "0-24h", "no_answer"): 1}


@pytest.mark.parametrize("exc", [RuntimeError("upstream 429"), asyncio.CancelledError()])
def test_a_resolver_error_is_counted_and_reraised_unchanged(exc):
    res = T.CountingResolver(Inner({"GFS": exc}), base=BASE)
    with pytest.raises(type(exc)) as caught:
        _ask(res, "GFS")
    assert caught.value is exc
    assert res.counts == {("GFS", "0-24h", "error"): 1}


def test_a_fault_in_the_counting_never_costs_the_answer():
    class Hostile:
        point = NS(speed=1.0)

        @property
        def product_id(self):
            raise RuntimeError("boom")

    hostile = Hostile()
    res = T.CountingResolver(Inner({"GFS": hostile}), base=BASE)
    assert _ask(res, "GFS") is hostile
    assert res.counts == {("GFS", "0-24h", "unclassified"): 1}
    res.counts = None                                   # even a broken counter must not raise
    assert _ask(res, "GFS") is hostile


# ── the served frames are identical with and without the counter ─────────────────────────────────────────────
def test_the_precomputed_frames_are_byte_identical_with_and_without_the_counter(monkeypatch):
    """The REAL rate_one_spot runs here. One spot answers from a stored product, one from the live branch."""
    from services.weather_pipeline import spot_ratings_precompute as pc
    from services.weather_pipeline.schemas import NormalizedPointResponse
    for flag in ("SURF_PARTITIONS", "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_LOCAL_SIZE"):
        monkeypatch.setenv(flag, "0")
    run = datetime(2026, 11, 17, 6, tzinfo=timezone.utc)

    def marine(lat):
        return NormalizedPointResponse.model_construct(
            point=NS(speed=1.0 + lat / 100.0, period=12.0, direction=300.0), run_time=run,
            product_id="gfs_marine_waves_global_mid" if lat < 30 else None,
            provider="gfs", upstream_provider=None if lat < 30 else "open-meteo")

    class Resolver:
        def __init__(self):
            self.sampler = NS(sample_point=lambda product, *a: NS(point=product.point))
            self.provider = NS(fetch_point=self.fetch_point)

        async def resolve_point(self, **kw):
            return marine(kw["lat"]) if kw["domain"] == "marine" else None

        async def find_cached_grid_product(self, *a, **k):
            return None

        async def fetch_point(self, **kw):
            return {"hourly": {}}

    spots = [{"id": "a", "name": "A", "latitude": 21.665, "longitude": -158.05},
             {"id": "b", "name": "B", "latitude": 33.0, "longitude": -118.0}]

    def build(resolver):
        obj = asyncio.run(pc.precompute_spot_ratings(resolver, spots, ["GFS"], [0, 30, 80], base_dt=BASE))
        return json.dumps(obj["frames"], sort_keys=True, default=str)

    bare = build(Resolver())
    counted_resolver = T.CountingResolver(Resolver(), base=BASE)
    counted = build(counted_resolver)
    assert counted == bare
    assert '"offshore_hs_m"' in bare, "the real rate_one_spot did not produce a rated row"
    assert counted_resolver.counts == {
        ("GFS", "0-24h", "stored"): 1, ("GFS", "0-24h", "upstream:open-meteo"): 1,
        ("GFS", "24-48h", "stored"): 1, ("GFS", "24-48h", "upstream:open-meteo"): 1,
        ("GFS", "72h+", "stored"): 1, ("GFS", "72h+", "upstream:open-meteo"): 1}


# ── the report ───────────────────────────────────────────────────────────────────────────────────────────────
COUNTS = {("EURO", "0-24h", "stored"): 6, ("EURO", "0-24h", "upstream:copernicus"): 3, ("EURO", "0-24h", "no_answer"): 1,
          ("EURO", "72h+", "upstream:open-meteo"): 4, ("GFS", "0-24h", "stored"): 10}


def test_summary_table_counts_and_shares():
    lines = T.summary_lines(COUNTS)
    assert lines[2] == "| model | lead | stored | no_answer | upstream:copernicus | upstream:open-meteo | not stored |"
    assert "| EURO | 0-24h | 6 | 1 | 3 | 0 | 40.0% |" in lines
    assert "| EURO | 72h+ | 0 | 0 | 0 | 4 | 100.0% |" in lines
    assert "| EURO | all | 6 | 1 | 3 | 4 | 57.1% |" in lines
    assert "| GFS | all | 10 | 0 | 0 | 0 | 0.0% |" in lines
    assert not any("24-48h" in ln for ln in lines), "an empty lead band must not print a row"


def test_one_line_and_empty():
    assert T.one_line(COUNTS) == "EURO 8 of 14 not stored (57.1%); GFS 0 of 10 not stored (0.0%)"
    assert T.one_line({}) == "nothing counted"
    assert T.summary_lines({}) == ["Marine point source (spot ratings, waves): nothing counted."]


def test_the_report_carries_no_coordinate_and_no_value():
    res = T.CountingResolver(Inner({"GFS": LIVE}), base=BASE)
    _ask(res, "GFS")
    text = "\n".join(T.summary_lines(res.counts)) + T.one_line(res.counts)
    assert "21.0" not in text and "158" not in text and "speed" not in text


def test_step_summary_is_appended_when_there_is_one(tmp_path):
    path = tmp_path / "summary.md"
    path.write_text("before\n", encoding="utf-8")
    assert T.write_step_summary(COUNTS, env={"GITHUB_STEP_SUMMARY": str(path)}) is True
    body = path.read_text(encoding="utf-8")
    assert body.startswith("before\n") and "| EURO | all | 6 | 1 | 3 | 4 | 57.1% |" in body
    assert T.write_step_summary(COUNTS, env={}) is False
    assert T.write_step_summary(COUNTS, env={"GITHUB_STEP_SUMMARY": str(tmp_path / "no" / "dir" / "x.md")}) is False


# ── the wiring and its switch ────────────────────────────────────────────────────────────────────────────────
def test_the_switch(monkeypatch):
    monkeypatch.delenv(T.FLAG, raising=False)
    assert T.enabled() is True
    monkeypatch.setenv(T.FLAG, "0")
    assert T.enabled() is False
    monkeypatch.setenv(T.FLAG, "1")
    assert T.enabled() is True


def test_the_precompute_wraps_its_own_resolver_behind_the_switch_and_reports_once():
    from services.weather_pipeline import spot_ratings_precompute as pc
    src = inspect.getsource(pc.run_spot_ratings_precompute)
    made = src.index("resolver = _make_point_resolver()")
    wrapped = src.index("resolver = _tally.CountingResolver(resolver, base=_top_of_hour_utc())")
    assert made < src.index("if _tally.enabled():") < wrapped < src.index("store = ProductStore()")
    assert src.count("_tally.write_step_summary(") == 1 and src.count("CountingResolver(") == 1
    assert "marine_source_tally" not in inspect.getsource(pc.precompute_spot_ratings), \
        "the counter belongs to the CI entry point, not to the function that builds frames"
