"""The RATING half of the spectral partitions — build #5 (2026-07-30).

The height half shipped first: `point_resolution._resolve_partitions` feeds `estimate_surf_at`, so
`surf_height_m` is spectral when SURF_PARTITIONS=1. What no surface did was grade that same sea
state — `dominant_swell_period`, `effective_swell_exposure` and `sea_cleanliness` all read the
blended field. These tests pin the wiring that closes it, per surface:

  REFERENCE  the response CARRIES the reconciled trains its own height ran on
             (`response.partitions`, attached at the single injection point) and
             `rate_one_spot` grades exactly that list — never a re-resolved one.
  HUB        `spot_conditions` samples the same three layers from its LOCAL grid cache,
             reconciles them, and feeds one list to BOTH the height and the rating. A partition
             miss must never trigger the upstream point fallback.
  SIM        `calculate_surf_rating` threads trains from the LIVE lane only; a what-if that
             changes any swell field DROPS them (`_baseline_partitions` — the forecast's trains do
             not describe a hypothetical sea), and `sim_explain`'s reconstruction stays honest.

Flag off (production today) everything is byte-identical: partitions are None at every surface.
"""
import ast
import inspect
import math
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
from services.weather_pipeline.surf_rating import rating_score
from services.weather_pipeline.surf_transform import reconcile_partitions

# The same real production sea state test_surf_partitions_wiring pins (Mavericks, 2026-07-29):
# windsea-DOMINATED — 86% of the energy is 6.69 s chop — which is exactly the regime the
# partition-aware factors exist to expose.
MAVS_TOTAL = 1.7257
MAVS = [{"h": 0.8419, "tp": 10.25, "dir": 272.21, "kind": "swell"},
        {"h": 0.3904, "tp": 15.37, "dir": 219.29, "kind": "swell"},
        {"h": 1.7135, "tp": 6.69, "dir": 303.36, "kind": "windsea"}]
MAVS_LAT, MAVS_LNG = 37.4915, -122.5083


def _quad(ps):
    return math.sqrt(sum(float(p["h"]) ** 2 for p in ps))


def _response(domain, layer, lat, lng, Hs, Tp, direction=280.0):
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain=domain, layer=layer,
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                    sampled_lng=lng, speed=Hs, period=Tp, direction=direction,
                                    interpolation_method="t"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800)


# ── the response carries what the height ran on ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_response_carries_the_trains_its_height_ran_on(monkeypatch):
    """One sea state per point: the SAME reconciled list `estimate_surf_at` consumed is attached
    to the response, so no rating surface can resolve a second, disagreeing one.

    ⚠️ CONSUMPTION is recorded, not just attachment — mutation-tested 2026-07-30: attaching the
    trains while quietly dropping them from the height call left 186 tests green, serving a
    total-field height under a response that advertised spectral trains."""
    from services.weather_pipeline import surf_point
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService()
    recon = reconcile_partitions(MAVS, MAVS_TOTAL)
    consumed = []
    real_estimate = surf_point.estimate_surf_at

    def recording_estimate(*args, **kwargs):
        consumed.append(kwargs.get("partitions"))
        return real_estimate(*args, **kwargs)

    async def fake_marine(**kw):
        return _response("marine", "waves", MAVS_LAT, MAVS_LNG, MAVS_TOTAL, 10.9)

    async def fake_parts(model, layer, lat, lng, valid_time_str, total_h, total_tp=None):
            # total_tp added 2026-07-31 (the PERIOD half of partitions_represent). This
            # double's ARITY is load-bearing: resolve_partitions is injected as a callable,
            # so a stale signature raises TypeError at call time -- which is exactly how
            # this test caught the change.
        return recon

    monkeypatch.setattr(surf_point, "estimate_surf_at", recording_estimate)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_marine)
    monkeypatch.setattr(svc, "_resolve_partitions", fake_parts, raising=False)
    r = await svc.resolve_point("GFS", "marine", "waves", MAVS_LAT, MAVS_LNG, "2026-07-30T00:00:00Z")
    assert r.partitions == recon
    assert consumed and consumed[0] == recon, (
        "the height must RUN on the trains the response advertises — attachment without "
        "consumption serves a total-field height labeled spectral")


@pytest.mark.asyncio
async def test_flag_off_the_response_partitions_stay_None(monkeypatch):
    """Production today: the field exists but is None, so every consumer takes the total-field
    path, byte-identical to before the wiring."""
    monkeypatch.delenv("SURF_PARTITIONS", raising=False)
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService()

    async def fake_marine(**kw):
        return _response("marine", "waves", MAVS_LAT, MAVS_LNG, MAVS_TOTAL, 10.9)

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_marine)
    r = await svc.resolve_point("GFS", "marine", "waves", MAVS_LAT, MAVS_LNG, "2026-07-30T00:00:00Z")
    assert r.partitions is None


# ── the REFERENCE surface ───────────────────────────────────────────────────────────────────────

class _RefResolver:
    """Resolver whose marine response already carries a surf height and the trains it ran on —
    the shape `resolve_point` produces when SURF_PARTITIONS is on."""

    def __init__(self, partitions):
        self.partitions = partitions

    async def resolve_point(self, **kw):
        if kw["domain"] == "marine":
            r = _response("marine", "waves", kw["lat"], kw["lng"], MAVS_TOTAL, 10.9)
            r.surf_height_m = 1.2
            r.partitions = self.partitions
            return r
        return _response("wind", "wind", kw["lat"], kw["lng"], 8.0, None, direction=95.0)


@pytest.mark.asyncio
async def test_the_reference_grades_the_trains_off_the_response(monkeypatch):
    """`rate_one_spot` passes the response's own partitions to the engine — read, never
    re-resolved — and passes every optional factor BY NAME (invariant 2)."""
    from services.weather_pipeline import spot_ratings
    recon = reconcile_partitions(MAVS, MAVS_TOTAL)
    seen = {}

    def recorder(*args, **kwargs):
        seen["args"] = args
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(spot_ratings, "compute_surf_rating", recorder)
    spot = {"id": "t1", "name": "Mavericks", "latitude": MAVS_LAT, "longitude": MAVS_LNG}
    d = await spot_ratings.rate_one_spot(_RefResolver(recon), spot, "GFS", "2026-07-30T00:00:00Z")
    assert seen["partitions"] == recon
    assert len(seen["args"]) == 3, (
        "the reference must pass only the three REQUIRED inputs positionally — ten positional "
        "args are exactly how `9b808d05` silently stopped one short of `break_depth_m`")
    assert d["score"] == 50.0
    # The why-text must quote the period the rating GRADED: the dominant swell train's 10.25 s,
    # not the blended 10.9 s (mutation-tested 2026-07-30 — reverting to the blended period left
    # 126 tests green while the why quoted a period the engine never used).
    assert "10s period" in (d["why"] or ""), d["why"]
    assert "11s" not in (d["why"] or ""), d["why"]


def test_no_surface_calls_the_engine_positionally_beyond_the_required_three():
    """Invariant 2, pinned structurally at ALL three surfaces: a positional call is how a new
    engine input silently fails to reach a surface."""
    from services.weather_pipeline import sim_rating, spot_conditions, spot_ratings
    for module in (spot_ratings, spot_conditions, sim_rating):
        for node in ast.walk(ast.parse(inspect.getsource(module))):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if name in ("compute_surf_rating", "rating_score"):
                assert len(node.args) <= 3, (
                    f"{module.__name__} passes {len(node.args)} positional args to {name}; "
                    f"only surf_h_m, tp_s, wind_speed_ms may be positional")


# ── the HUB surface ─────────────────────────────────────────────────────────────────────────────

class _Pt:
    def __init__(self, speed, period, direction):
        self.speed, self.period, self.direction = speed, period, direction


class _Res:
    def __init__(self, pt):
        self.point = pt


class _FakeHub:
    """A hub service whose grid cache answers from a canned layer table. Records every cache ask
    and every upstream dial so the tests can assert the partition path never escalates."""

    def __init__(self, layers):
        self.layers = layers
        self.grid_asks = []
        self.upstream_calls = []
        self.sampler = self
        self.provider = self

    async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
        self.grid_asks.append(layer)
        return layer if layer in self.layers else None

    def sample_point(self, prod, lat, lng):
        return _Res(_Pt(*self.layers[prod]))

    async def fetch_point(self, **kw):
        self.upstream_calls.append(kw)
        raise RuntimeError("this test permits no upstream dial")

    async def resolve_point(self, **kw):
        return _Res(_Pt(8.0, None, 95.0))       # the wind sample (knots)


_HUB_LAYERS = {"waves": (MAVS_TOTAL, 10.9, 280.0),
               "swell_1": (0.8419, 10.25, 272.21),
               "swell_2": (0.3904, 15.37, 219.29),
               "wind_waves": (1.7135, 6.69, 303.36)}


@pytest.mark.asyncio
async def test_the_hub_samples_reconciles_and_grades_the_trains(monkeypatch):
    """Flag on: the hub builds the trains from its LOCAL cache, reconciles them to the total, and
    feeds THE SAME LIST to the height transform and the rating.

    ⚠️ Both halves are recorded — mutation-tested 2026-07-30: dropping the trains from
    `_breaking_ft` alone (total-field height under a spectral rating, the exact two-sea-states
    payload invariant 6 forbids) left all 32 tests green when only the rating side was pinned."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_point, surf_rating
    seen = {}
    height_saw = []
    real_estimate = surf_point.estimate_surf_at

    def recording_estimate(*args, **kwargs):
        height_saw.append(kwargs.get("partitions"))
        return real_estimate(*args, **kwargs)

    def recorder(*args, **kwargs):
        seen["args"] = args
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(surf_point, "estimate_surf_at", recording_estimate)
    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    hub = _FakeHub(dict(_HUB_LAYERS))
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    parts = seen["partitions"]
    assert parts and [p["kind"] for p in parts] == ["swell", "swell", "windsea"]
    assert _quad(parts) == pytest.approx(MAVS_TOTAL, rel=1e-6), "must be reconciled to the total"
    assert hub.upstream_calls == []
    # The CURRENT frame's height call (the first) must have run on the identical list the rating
    # graded — one sea state per frame, by construction not by luck.
    assert height_saw and height_saw[0] == parts, (height_saw[0], parts)


@pytest.mark.asyncio
async def test_a_missing_minority_train_still_leaves_representative_trains(monkeypatch):
    """swell_2 (the smallest train) missing from the cache: the survivors still carry the sea
    (quadrature 1.91 of a 1.73 total), so they are kept, reconciled — and nothing dials."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_rating
    seen = {}

    def recorder(*args, **kwargs):
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    hub = _FakeHub({k: v for k, v in _HUB_LAYERS.items() if k != "swell_2"})
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    parts = seen["partitions"]
    assert parts is not None and len(parts) == 2, "the surviving trains are still used"
    assert _quad(parts) == pytest.approx(MAVS_TOTAL, rel=1e-6)
    assert hub.upstream_calls == []


@pytest.mark.asyncio
async def test_a_lone_minority_train_is_REJECTED_not_inflated(monkeypatch):
    """Only swell_1 (0.84 m of a 1.73 m total) cached: reconciling it would inflate a minority
    train 2.06x into a clean 10.25 s sea that never existed — a sea state neither the blend nor
    the spectrum describes (2026-07-30 review). The represent gate falls back to the total field
    instead, and still never dials."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_rating
    seen = {}

    def recorder(*args, **kwargs):
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    hub = _FakeHub({"waves": _HUB_LAYERS["waves"], "swell_1": _HUB_LAYERS["swell_1"]})
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    assert seen["partitions"] is None, "under-representative trains must fall back, not inflate"
    assert hub.upstream_calls == []


@pytest.mark.asyncio
async def test_a_NaN_train_is_rejected_at_the_hub(monkeypatch):
    """NaN passes `not x` AND `x <= 0` — without the self-inequality guard a NaN train rides the
    quadrature into the rating, where score=NaN maps to level 'epic' (every `score < upper` is
    False). The guard must reject the NaN train and keep the clean ones."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_rating
    seen = {}

    def recorder(*args, **kwargs):
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    layers = dict(_HUB_LAYERS)
    layers["wind_waves"] = (float("nan"), 6.69, 303.36)
    hub = _FakeHub(layers)
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    parts = seen["partitions"]
    assert parts is not None and len(parts) == 2, "the NaN train is dropped, the rest survive"
    assert all(p["h"] == p["h"] for p in parts), "no NaN may reach the rating"


@pytest.mark.asyncio
async def test_a_raising_partition_layer_never_costs_the_conditions_read(monkeypatch):
    """Invariant 3 at the RAISE branch (the miss branch alone was pinned before — a refactor
    hoisting the sampling out of its try would have gone green): a partition-layer lookup that
    RAISES is skipped; the conditions read completes."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_rating

    def recorder(*args, **kwargs):
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)

    class _RaisingHub(_FakeHub):
        async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
            if layer in ("swell_2", "wind_waves"):
                raise RuntimeError("partition product store exploded")
            return await super().find_cached_grid_product(model, domain, layer, lat, lng, dt)

    hub = _RaisingHub(dict(_HUB_LAYERS))
    out = await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    assert "current_conditions" in out, "a partition problem may never cost the conditions read"
    assert hub.upstream_calls == []


@pytest.mark.asyncio
async def test_a_raising_reconcile_never_costs_the_conditions_read(monkeypatch):
    """The umbrella except: reconcile (and its import) sit OUTSIDE the per-layer try, so a
    regression there must degrade to the total field — pre-umbrella it killed the entire hub
    payload where the same breakage used to cost only the height transform."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    from services.weather_pipeline import spot_conditions, surf_rating, surf_transform
    seen = {}

    def recorder(*args, **kwargs):
        seen.update(kwargs)
        return (50.0, "fair")

    def exploding_reconcile(*a, **k):
        raise RuntimeError("reconcile regression")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    monkeypatch.setattr(surf_transform, "reconcile_partitions", exploding_reconcile)
    hub = _FakeHub(dict(_HUB_LAYERS))
    out = await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    assert "current_conditions" in out
    assert seen["partitions"] is None, "a reconcile failure degrades to the total field"


@pytest.mark.asyncio
async def test_flag_off_the_hub_never_asks_for_partition_layers(monkeypatch):
    """Production today must cost NOTHING extra: no swell_2/wind_waves cache asks, partitions
    None at the rating."""
    monkeypatch.delenv("SURF_PARTITIONS", raising=False)
    from services.weather_pipeline import spot_conditions, surf_rating
    seen = {}

    def recorder(*args, **kwargs):
        seen.update(kwargs)
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    hub = _FakeHub(dict(_HUB_LAYERS))
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG)
    assert "swell_2" not in hub.grid_asks and "wind_waves" not in hub.grid_asks
    assert seen["partitions"] is None


# ── the SIM surface ─────────────────────────────────────────────────────────────────────────────

def test_a_single_train_identical_to_the_total_field_scores_byte_identically():
    """The sim's scenario vocabulary is one train. Passing that train AS a partition list must be
    a no-op — same exposure cosine, same period, no windsea — or the sim's what-ifs would move
    the moment the plumbing landed."""
    for h, tp, d in ((1.5, 12.0, 270.0), (0.8, 16.0, 219.0), (2.5, 9.0, 300.0)):
        base = rating_score(h, tp, 4.0, wind_from_deg=90.0, shore_normal_deg=270.0,
                            swell_from_deg=d)
        spectral = rating_score(h, tp, 4.0, wind_from_deg=90.0, shore_normal_deg=270.0,
                                swell_from_deg=d,
                                partitions=[{"h": h, "tp": tp, "dir": d, "kind": "swell"}])
        assert spectral == base


def test_the_sim_grades_the_trains_and_the_explainer_stays_honest():
    """A windsea-dominated sea must score BELOW its blended-field twin (cleanliness bites, and the
    chop no longer shoals as groundswell) — and `sim_explain` must reconstruct the partition-aware
    score exactly, or its honesty check would brand the explanation a lie."""
    from services.weather_pipeline import sim_rating
    spot = {"name": "Mavericks", "latitude": MAVS_LAT, "longitude": MAVS_LNG,
            "orientation": 270.0}
    recon = reconcile_partitions(MAVS, MAVS_TOTAL)
    with_parts = sim_rating.calculate_surf_rating(spot, MAVS_TOTAL, 10.9, 280.0, 8.0, 95.0,
                                                  partitions=recon)
    without = sim_rating.calculate_surf_rating(spot, MAVS_TOTAL, 10.9, 280.0, 8.0, 95.0)
    assert with_parts["quality_rating"] < without["quality_rating"], (with_parts, without)
    why = with_parts.get("why") or {}
    assert why, "the explanation must survive the partition path"
    assert "warning" not in why, why.get("warning")
    assert abs(why.get("reconstruction_error", 0.0)) <= 0.15
    assert why["inputs"]["swell_trains"] == 3
    sea = [f for f in why["multipliers"] if f["factor"] == "sea_cleanliness"][0]
    assert sea["value"] < 1.0, "86% windsea energy must read as an unclean sea"
    # The graded period is the dominant SWELL train's (10.25 s), not the blended 10.9 s.
    assert why["inputs"]["graded_period_sec"] == pytest.approx(10.25, abs=0.06)


def test_a_swell_whatif_drops_the_forecast_trains_a_wind_whatif_keeps_them():
    """The forecast's trains describe the forecast sea. Changing any swell field rates a DIFFERENT
    sea; hypothesizing a different local wind does not move the swell already in the water."""
    import weather_sim_mcp as sim
    base = {"swell_height_m": 1.7, "swell_period_sec": 10.9, "swell_direction_deg": 280.0,
            "wind_speed_knots": 8.0, "wind_direction_deg": 95.0, "partitions": MAVS}
    assert sim._baseline_partitions(base) == MAVS
    assert sim._baseline_partitions(base, dict(base)) == MAVS
    wind_only = dict(base, wind_speed_knots=25.0, wind_direction_deg=200.0)
    assert sim._baseline_partitions(base, wind_only) == MAVS
    for key, value in (("swell_height_m", 2.5), ("swell_period_sec", 16.0),
                       ("swell_direction_deg", 200.0)):
        assert sim._baseline_partitions(base, dict(base, **{key: value})) is None, key
    assert sim._baseline_partitions({"swell_height_m": 1.0}) is None
    assert sim._baseline_partitions(None) is None


def test_the_live_lane_carries_the_servers_trains(monkeypatch):
    """`fetch_live_forecast` forwards `response.partitions` — the trains the SERVER's own height
    ran on — so the sim grades the same sea state the app served, with no sim-side flag and no
    extra fetch."""
    from services.weather_pipeline import sim_forecast
    marine = {"point": {"speed": 1.7, "period": 10.9, "direction": 280.0},
              "valid_time": "2026-07-30T23:00:00Z", "partitions": MAVS}
    wind = {"point": {"speed": 8.0, "direction": 95.0}}

    def fake_fetch(domain, layer, lat, lng, valid_time):
        return marine if domain == "marine" else wind

    monkeypatch.setattr(sim_forecast, "fetch_point", fake_fetch)
    monkeypatch.setattr(sim_forecast, "_is_down", lambda: False)
    baseline, _prov = sim_forecast.fetch_live_forecast(11.1234, -33.9876, "2026-07-30T23:00:00Z")
    assert baseline is not None and baseline["partitions"] == MAVS


def test_the_live_lane_omits_the_key_when_the_server_sent_none(monkeypatch):
    """A serve side with SURF_PARTITIONS off sends partitions: null — the baseline must not grow
    a None entry that consumers would have to guard."""
    from services.weather_pipeline import sim_forecast
    marine = {"point": {"speed": 1.7, "period": 10.9, "direction": 280.0}, "partitions": None}
    wind = {"point": {"speed": 8.0, "direction": 95.0}}

    def fake_fetch(domain, layer, lat, lng, valid_time):
        return marine if domain == "marine" else wind

    monkeypatch.setattr(sim_forecast, "fetch_point", fake_fetch)
    monkeypatch.setattr(sim_forecast, "_is_down", lambda: False)
    baseline, _prov = sim_forecast.fetch_live_forecast(12.4321, -44.8765, "2026-07-30T22:00:00Z")
    assert baseline is not None and "partitions" not in baseline


# ── the trust boundary + the represent gate ─────────────────────────────────────────────────────

def test_malformed_network_trains_are_sanitized_at_the_boundary(monkeypatch):
    """The trains cross an HTTP boundary (json.loads of a REMOTE deploy). A version-skewed server
    sending h as a string would raise TypeError out of `rating_score`'s `h <= 0` guards and cost
    the sim caller its WHOLE tool answer (reproduced 2026-07-30) — so items are validated and
    coerced at the ONE entry point, never downstream."""
    from services.weather_pipeline import sim_forecast
    marine = {"point": {"speed": 1.7, "period": 10.9, "direction": 280.0},
              "partitions": [
                  {"h": "not a number", "tp": 10.0, "dir": 200.0, "kind": "swell"},   # dropped
                  {"h": 0.8, "tp": "bad", "dir": 200.0, "kind": "swell"},             # dropped
                  "not even a dict",                                                   # dropped
                  {"h": float("nan"), "tp": 6.7, "dir": 300.0, "kind": "windsea"},    # dropped
                  {"h": "0.9", "tp": "11.5", "dir": "210.0", "kind": "swell"},        # coerced
                  {"h": 1.2, "tp": 7.0, "dir": "north", "kind": "mystery"},           # dir->None, kind->swell
              ]}
    wind = {"point": {"speed": 8.0, "direction": 95.0}}

    def fake_fetch(domain, layer, lat, lng, valid_time):
        return marine if domain == "marine" else wind

    monkeypatch.setattr(sim_forecast, "fetch_point", fake_fetch)
    monkeypatch.setattr(sim_forecast, "_is_down", lambda: False)
    baseline, _prov = sim_forecast.fetch_live_forecast(13.5678, -55.4321, "2026-07-30T21:00:00Z")
    parts = baseline["partitions"]
    assert parts == [{"h": 0.9, "tp": 11.5, "dir": 210.0, "kind": "swell"},
                     {"h": 1.2, "tp": 7.0, "dir": None, "kind": "swell"}]
    # And the engine accepts the sanitized shape without raising.
    assert rating_score(1.5, 10.9, 4.0, wind_from_deg=90.0, shore_normal_deg=270.0,
                        swell_from_deg=280.0, partitions=parts) is not None


def test_all_malformed_trains_leave_no_partitions_key(monkeypatch):
    from services.weather_pipeline import sim_forecast
    marine = {"point": {"speed": 1.7, "period": 10.9, "direction": 280.0},
              "partitions": [{"h": "x", "tp": "y"}, 42]}
    wind = {"point": {"speed": 8.0, "direction": 95.0}}
    monkeypatch.setattr(sim_forecast, "fetch_point",
                        lambda domain, layer, lat, lng, valid_time:
                        marine if domain == "marine" else wind)
    monkeypatch.setattr(sim_forecast, "_is_down", lambda: False)
    baseline, _ = sim_forecast.fetch_live_forecast(14.1111, -66.2222, "2026-07-30T20:00:00Z")
    assert "partitions" not in baseline


def test_partitions_represent_rejects_degenerate_coverage():
    """The shared supply-side gate: trains carrying under half the total Hs in quadrature do not
    represent the sea (the dominant train is missing). Both measured LEGITIMATE deviations pass;
    the lone-minority-train case and garbage totals fail."""
    from services.weather_pipeline.surf_transform import partitions_represent
    assert partitions_represent(MAVS, MAVS_TOTAL)                      # over-total: legitimate
    bondi = [{"h": 0.20, "tp": 8.85, "dir": 173.0, "kind": "swell"},
             {"h": 0.18, "tp": 3.00, "dir": 4.0, "kind": "swell"},
             {"h": 0.28, "tp": 2.35, "dir": 282.0, "kind": "windsea"}]
    assert partitions_represent(bondi, 0.5)                            # -22.3% under: legitimate
    lone = [{"h": 0.8419, "tp": 10.25, "dir": 272.21, "kind": "swell"}]
    assert not partitions_represent(lone, MAVS_TOTAL)                  # 49% of the total: missing dominant
    assert not partitions_represent(MAVS, float("nan"))
    assert not partitions_represent(MAVS, 0.0)
    assert not partitions_represent([], MAVS_TOTAL)
    assert not partitions_represent(None, MAVS_TOTAL)


@pytest.mark.asyncio
async def test_the_point_lane_applies_the_represent_gate_and_the_NaN_guard(monkeypatch):
    """The point-lane supplier shares the gate: a lone minority train falls back to the total
    field, and a NaN train is rejected by the self-inequality guard (NaN passes both `not x` and
    `x <= 0`; unguarded it becomes score=NaN -> level 'epic')."""
    from services.weather_pipeline.point_resolution import PointResolutionService

    def _svc(answers):
        svc = PointResolutionService.__new__(PointResolutionService)

        async def fake_internal(model, domain, layer, lat, lng, valid_time_str, **kw):
            a = answers.get(layer)
            pt = type("P", (), dict(speed=a[0], period=a[1], direction=a[2]))() if a else None
            return type("R", (), dict(point=pt))()

        monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
        return svc

    monkeypatch.setenv("SURF_PARTITIONS", "1")
    lone = _svc({"swell_1": (0.8419, 10.25, 272.21)})
    assert await lone._resolve_partitions("GFS", "waves", MAVS_LAT, MAVS_LNG, "t", MAVS_TOTAL) is None

    nan_ww = _svc({"swell_1": (0.8419, 10.25, 272.21), "swell_2": (0.3904, 15.37, 219.29),
                   "wind_waves": (float("nan"), 6.69, 303.36)})
    out = await nan_ww._resolve_partitions("GFS", "waves", MAVS_LAT, MAVS_LNG, "t", MAVS_TOTAL)
    assert out is not None and len(out) == 2
    assert all(p["h"] == p["h"] for p in out)


# ── representation coherence + the sim MCP call sites ──────────────────────────────────────────

def test_the_komar_fallback_drops_the_trains_it_never_ran_on(monkeypatch):
    """SIM_PRODUCTION_GEOMETRY=0: the height is BLENDED Komar — the trains never touched it — so
    the rating and the explanation must drop them too (invariant 6: one payload, one sea
    representation). Pinned as byte-identity with the no-trains call."""
    from services.weather_pipeline import sim_rating
    monkeypatch.setenv("SIM_PRODUCTION_GEOMETRY", "0")
    sim_rating._GEOMETRY_CACHE.clear()
    try:
        spot = {"name": "Mavericks", "latitude": MAVS_LAT, "longitude": MAVS_LNG,
                "orientation": 270.0}
        recon = reconcile_partitions(MAVS, MAVS_TOTAL)
        with_parts = sim_rating.calculate_surf_rating(spot, MAVS_TOTAL, 10.9, 280.0, 8.0, 95.0,
                                                      partitions=recon)
        without = sim_rating.calculate_surf_rating(spot, MAVS_TOTAL, 10.9, 280.0, 8.0, 95.0)
        assert with_parts == without
    finally:
        sim_rating._GEOMETRY_CACHE.clear()


def _sim_baseline_with_trains():
    return {"swell_height_m": MAVS_TOTAL, "swell_period_sec": 10.9, "swell_direction_deg": 280.0,
            "wind_speed_knots": 8.0, "wind_direction_deg": 95.0,
            "partitions": reconcile_partitions(MAVS, MAVS_TOTAL)}


def _record_calc(monkeypatch, module):
    """Record the partitions each calculate_surf_rating call receives, then call through."""
    seen = []
    real = module.calculate_surf_rating

    def rec(*args, **kwargs):
        seen.append(kwargs.get("partitions"))
        return real(*args, **kwargs)

    monkeypatch.setattr(module, "calculate_surf_rating", rec)
    return seen


def test_the_forecast_tool_grades_the_baselines_trains(monkeypatch):
    """Mutation-tested 2026-07-30: dropping `partitions=` from get_weather_forecast's call left
    every suite green — the live lane's trains silently never reached the primary tool."""
    import weather_sim_mcp
    from services.weather_pipeline import sim_forecast
    base = _sim_baseline_with_trains()
    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (dict(base), {"model": "GFS"}))
    weather_sim_mcp._SIM_OVERRIDES.clear()
    seen = _record_calc(monkeypatch, weather_sim_mcp)
    tool = getattr(weather_sim_mcp.get_weather_forecast, "fn", weather_sim_mcp.get_weather_forecast)
    out = tool("Mavericks")
    assert out.get("wave_simulation"), out
    assert seen and seen[0] == base["partitions"]


def test_a_swell_whatif_drops_trains_on_BOTH_sides_of_the_delta(monkeypatch):
    """Two pins in one: (a) a swell what-if drops the forecast's trains (they do not describe a
    hypothetical sea) — mutation-tested: keeping them left 139 tests green; (b) base_calc drops
    them TOO, so the delta is composition-matched — measured 2026-07-30, a +1 cm what-if against
    the windsea-dominated spectral baseline otherwise reported +12.5 'better', all of it the
    composition switch and none of it the change."""
    import weather_sim_mcp
    from services.weather_pipeline import sim_forecast
    base = _sim_baseline_with_trains()
    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (dict(base), {"model": "GFS"}))
    monkeypatch.setattr(weather_sim_mcp.sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (dict(base), {"model": "GFS"}))
    weather_sim_mcp._SIM_OVERRIDES.clear()
    seen = _record_calc(monkeypatch, weather_sim_mcp)
    sim = getattr(weather_sim_mcp.simulate_weather_change, "fn",
                  weather_sim_mcp.simulate_weather_change)
    out = sim("Mavericks", swell_height_m=MAVS_TOTAL + 0.01)
    assert out["success"] is True
    assert seen == [None, None], (
        f"a swell what-if must drop the trains from the what-if AND the delta's base_calc "
        f"(composition-matched); got {seen}")
    assert "composition" in (out.get("baseline_delta") or {}), (
        "the delta must SAY the trains were dropped")
    # And the delta itself is now the caller's change, not the composition switch.
    assert abs(out["baseline_delta"]["quality_rating"]["delta"]) < 3.0, out["baseline_delta"]


def test_a_wind_only_whatif_keeps_the_trains_on_both_sides(monkeypatch):
    import weather_sim_mcp
    from services.weather_pipeline import sim_forecast
    base = _sim_baseline_with_trains()
    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (dict(base), {"model": "GFS"}))
    monkeypatch.setattr(weather_sim_mcp.sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (dict(base), {"model": "GFS"}))
    weather_sim_mcp._SIM_OVERRIDES.clear()
    seen = _record_calc(monkeypatch, weather_sim_mcp)
    sim = getattr(weather_sim_mcp.simulate_weather_change, "fn",
                  weather_sim_mcp.simulate_weather_change)
    out = sim("Mavericks", wind_speed_knots=25.0)
    assert out["success"] is True
    assert seen == [base["partitions"], base["partitions"]], (
        f"the swell in the water is unchanged by a hypothesized wind; got {seen}")


def test_the_window_scan_grades_each_frames_trains(monkeypatch):
    """Mutation-tested 2026-07-30: dropping `partitions=` from sim_window.scan left 37 tests
    green — every scanned hour silently reverted to the blended field."""
    from services.weather_pipeline import sim_window
    base = _sim_baseline_with_trains()
    seen = _record_calc(monkeypatch, sim_window)
    spot = {"name": "Mavericks", "latitude": MAVS_LAT, "longitude": MAVS_LNG,
            "orientation": 270.0}
    hours = ["2026-07-30T18:00:00Z", "2026-07-30T21:00:00Z"]
    out = sim_window.scan(spot, lambda sp, hour: (dict(base), "live_forecast", {}), hours)
    assert len(out["series"]) == 2
    assert seen == [base["partitions"], base["partitions"]]
