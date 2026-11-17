"""The precompute's marine-source counter: it must COUNT and never CHANGE anything.

Owner, 2026-11-17: "Count in precompute". The question it answers: how many SERVED spot-frames are answered by
the point resolver's live upstream branch (no stored product), by model and lead. The contract pinned here:
  1. the counter is a pass-through: the same response object comes back, and the frames the precompute builds are
     byte-identical with and without it (the real `rate_one_spot` runs in that test, not a mock);
  2. marine `waves` and wind `wind` answers are counted, each in its OWN table, never pooled (owner, relayed by the
     advisor: "Count wind too"); any other layer passes through uncounted;
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
    # the three live answers the resolver's 2c branch can give, each on its own row
    (NS(point=NS(speed=1.0), product_id=None, provider="copernicus", upstream_provider="copernicus",
        upstream_model="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"), "upstream:copernicus:cmems_mod_glo_wav_anfc_0.083deg_pt3h-i"),
    (NS(point=NS(speed=1.0), product_id=None, provider="open-meteo", upstream_provider="open-meteo",
        upstream_model="ncep_gfswave025"), "upstream:open-meteo:ncep_gfswave025"),
    (NS(point=NS(speed=1.0), product_id=None, provider="gfs_estimated_fallback", upstream_provider="gfs_estimated_fallback",
        upstream_model="ncep_gfswave025"), "upstream:gfs_estimated_fallback:ncep_gfswave025"),
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
        self.wind = NS(point=NS(speed=5.0), product_id=None, provider="open-meteo", upstream_provider="open-meteo",
                       upstream_model="gfs_seamless")

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        self.calls.append((model, domain, layer, lat, lng, valid_time_str))
        if domain == "wind":
            return self.wind
        if layer != "waves":
            return None
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
    assert res.counts == {("waves", "GFS", "0-24h", "stored"): 1, ("waves", "EURO", "0-24h", "upstream:copernicus"): 1}


def test_other_attributes_reach_the_inner_resolver():
    res = T.CountingResolver(Inner({}), base=BASE)
    assert res.extra == "kept"
    with pytest.raises(AttributeError):
        res.not_there


def test_wind_is_passed_through_and_counted_in_its_own_table():
    inner = Inner({"GFS": STORED})
    res = T.CountingResolver(inner, base=BASE)
    assert _ask(res, "GFS", domain="wind", layer="wind") is inner.wind
    assert _ask(res, "GFS") is STORED
    assert res.counts == {("wind", "GFS", "0-24h", "upstream:open-meteo:gfs_seamless"): 1,
                          ("waves", "GFS", "0-24h", "stored"): 1}


@pytest.mark.parametrize("domain,layer", [("marine", "swell_1"), ("marine", "wind_waves"), ("weather", "pressure"),
                                          ("wind", "gust"), ("marine", "wind"), (None, None)])
def test_any_other_layer_passes_through_uncounted(domain, layer):
    res = T.CountingResolver(Inner({"GFS": STORED}), base=BASE)
    _ask(res, "GFS", domain=domain, layer=layer)
    assert not res.counts


def test_the_rule_holds_on_wind_answers_built_by_the_real_code():
    """The rule is 'a product id means a stored product'. Pinned on the REAL direct-point wind builder (the live
    branch: no product id, Open-Meteo named) and on a schema-built stored answer."""
    from services.weather_pipeline.point_direct_fallbacks import build_wind_direct_point_response
    from services.weather_pipeline.schemas import NormalizedPointResponse

    class Provider:
        FORECAST_MODELS = {"GFS": "gfs_seamless", "ICON": "icon_seamless"}

        async def fetch_point(self, **kw):
            return {"hourly": {"time": ["2026-11-17T15:00"], "wind_speed_10m": [9.0], "wind_direction_10m": [45.0],
                               "wind_gusts_10m": [12.0]}}

    live = asyncio.run(build_wind_direct_point_response(Provider(), "ICON", 21.0, -158.0,
                                                        datetime(2026, 11, 17, 15, tzinfo=timezone.utc)))
    assert isinstance(live, NormalizedPointResponse) and live.product_id is None
    assert T.classify(live) == "upstream:open-meteo:icon_seamless"
    stored = NormalizedPointResponse.model_construct(point=live.point, product_id="gfs_wind_wind_global_mid_x.json",
                                                     provider="noaa", upstream_provider=None, upstream_model=None)
    assert T.classify(stored) == "stored"


def test_a_positional_call_is_counted_too():
    res = T.CountingResolver(Inner({"GFS": LIVE}), base=BASE)
    got = asyncio.run(res.resolve_point("GFS", "marine", "waves", 21.0, -158.0, "2026-11-19T12:00:00Z"))
    assert got is LIVE and res.counts == {("waves", "GFS", "48-72h", "upstream:copernicus"): 1}
    asyncio.run(res.resolve_point("GFS", "wind", "wind", 21.0, -158.0, "2026-11-19T12:00:00Z"))
    assert res.counts[("wind", "GFS", "48-72h", "upstream:open-meteo:gfs_seamless")] == 1


def test_no_answer_is_counted_as_no_answer():
    res = T.CountingResolver(Inner({"ICON": None}), base=BASE)
    assert _ask(res, "ICON") is None
    assert res.counts == {("waves", "ICON", "0-24h", "no_answer"): 1}


@pytest.mark.parametrize("exc", [RuntimeError("upstream 429"), asyncio.CancelledError()])
def test_a_resolver_error_is_counted_and_reraised_unchanged(exc):
    res = T.CountingResolver(Inner({"GFS": exc}), base=BASE)
    with pytest.raises(type(exc)) as caught:
        _ask(res, "GFS")
    assert caught.value is exc
    assert res.counts == {("waves", "GFS", "0-24h", "error"): 1}


def test_a_fault_in_the_counting_never_costs_the_answer():
    class Hostile:
        point = NS(speed=1.0)

        @property
        def product_id(self):
            raise RuntimeError("boom")

    hostile = Hostile()
    res = T.CountingResolver(Inner({"GFS": hostile}), base=BASE)
    assert _ask(res, "GFS") is hostile
    assert res.counts == {("waves", "GFS", "0-24h", "unclassified"): 1}
    res.counts = None                                   # even a broken counter must not raise
    assert _ask(res, "GFS") is hostile


def _marine_only(resolver):
    async def resolve_point(**kw):
        return await resolver.resolve_point(**kw) if kw["domain"] == "marine" else None
    return resolve_point


# ── the served frames are identical with and without the counter ─────────────────────────────────────────────
def test_the_precomputed_frames_are_byte_identical_with_and_without_the_counter(monkeypatch):
    """The REAL rate_one_spot runs here. One spot answers from a stored product, one from the live branch, for
    waves and for wind alike."""
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
            return marine(kw["lat"]) if kw["domain"] == "marine" else wind(kw["lat"])

        async def find_cached_grid_product(self, *a, **k):
            return None

        async def fetch_point(self, **kw):
            return {"hourly": {}}

    def wind(lat):
        return NormalizedPointResponse.model_construct(
            point=NS(speed=8.0, direction=45.0, gust=None), run_time=run,
            product_id="gfs_wind_wind_global_mid" if lat < 30 else None,
            provider="open-meteo", upstream_provider=None if lat < 30 else "open-meteo",
            upstream_model=None if lat < 30 else "gfs_seamless")

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
    no_wind = json.dumps(asyncio.run(pc.precompute_spot_ratings(
        NS(resolve_point=_marine_only(Resolver()), sampler=None, provider=None, find_cached_grid_product=Resolver().find_cached_grid_product),
        spots, ["GFS"], [0], base_dt=BASE))["frames"], sort_keys=True, default=str)
    with_wind = json.dumps(asyncio.run(pc.precompute_spot_ratings(Resolver(), spots, ["GFS"], [0], base_dt=BASE))["frames"],
                           sort_keys=True, default=str)
    assert no_wind != with_wind, "the wind answer did not reach the rated row, so this test would prove nothing about wind"
    expected = {}
    for band in ("0-24h", "24-48h", "72h+"):
        expected[("waves", "GFS", band, "stored")] = 1
        expected[("waves", "GFS", band, "upstream:open-meteo")] = 1
        expected[("wind", "GFS", band, "stored")] = 1
        expected[("wind", "GFS", band, "upstream:open-meteo:gfs_seamless")] = 1
    assert counted_resolver.counts == expected


# ── the report ───────────────────────────────────────────────────────────────────────────────────────────────
COUNTS = {("waves", "EURO", "0-24h", "stored"): 6, ("waves", "EURO", "0-24h", "upstream:copernicus"): 3,
          ("waves", "EURO", "0-24h", "no_answer"): 1, ("waves", "EURO", "72h+", "upstream:open-meteo"): 4,
          ("waves", "GFS", "0-24h", "stored"): 10,
          ("wind", "EURO", "0-24h", "stored"): 9, ("wind", "EURO", "0-24h", "upstream:open-meteo:ecmwf_ifs025"): 1}


def test_summary_table_counts_and_shares():
    lines = T.summary_lines(COUNTS)
    assert lines[2] == "| model | lead | stored | no_answer | upstream:copernicus | upstream:open-meteo | not stored |"
    assert "| EURO | 0-24h | 6 | 1 | 3 | 0 | 40.0% |" in lines
    assert "| EURO | 72h+ | 0 | 0 | 0 | 4 | 100.0% |" in lines
    assert "| EURO | all | 6 | 1 | 3 | 4 | 57.1% |" in lines
    assert "| GFS | all | 10 | 0 | 0 | 0 | 0.0% |" in lines
    assert not any("24-48h" in ln for ln in lines), "an empty lead band must not print a row"
    # wind is its own table, after the waves table, never pooled into it
    head = lines.index("| model | lead | stored | upstream:open-meteo:ecmwf_ifs025 | not stored |")
    assert head > lines.index("| GFS | all | 10 | 0 | 0 | 0 | 0.0% |")
    assert lines[head + 2:] == ["| EURO | 0-24h | 9 | 1 | 10.0% |", "| EURO | all | 9 | 1 | 10.0% |"]
    assert "WAVES" in lines[0] and "WIND" in lines[head - 2]


def test_one_line_and_empty():
    assert T.one_line(COUNTS) == ("waves: EURO 8 of 14 not stored (57.1%); GFS 0 of 10 not stored (0.0%) | "
                                  "wind: EURO 1 of 10 not stored (10.0%)")
    assert T.one_line({}) == "waves: nothing counted | wind: nothing counted"
    assert T.summary_lines({}) == ["Point source (spot ratings, waves): nothing counted.", "",
                                   "Point source (spot ratings, wind): nothing counted."]


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
    # the count is the SERVED RATINGS stage only: the wrapped resolver feeds exactly one call, the frame builder
    after = src[wrapped:]
    # (the three uses from the wrap on: the wrap itself, the frame builder, and reading the counts back)
    assert after.count("(resolver") == 3 and "precompute_spot_ratings(resolver, spots, [model], hours)" in after
    assert 'getattr(resolver, "counts", None)' in after
