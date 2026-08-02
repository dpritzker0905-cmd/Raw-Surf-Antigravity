"""
test_partition_band_composition.py — M4's COMPOSITION half: ECMWF period bands into the rating.

THE ARC. `9553991d` shipped the FETCH (six band heights, behind `ECMWF_PERIOD_BANDS`), and
`4b895c94` proved the decode path executes and stays time-aligned. Both were inert by design,
because a band set that nothing composes changes no number. This is the composition.

WHY THE BANDS AND NOT MORE CMEMS PARTITIONS — the cost argument, measured:
  `point_resolution._resolve_partitions` samples THREE SEPARATE LAYERS per waves point (4x cost,
  0.17-0.77 s each), which is why `SURF_PARTITIONS` is off by default on a 1-CPU box with a
  three-incident melt history. The ECMWF bands ride in the SAME wave product as the total, so a
  band-derived split costs ZERO extra point resolutions. Same spectral benefit, none of the 4x.

⛔ WHAT THIS FILE DOES *NOT* CLAIM. The bands still have to REACH the response: the sampler that
would populate `point.wave_bands` lives in `point_resolution.py`, which a concurrent session holds
uncommitted, so that one hook is deliberately not written here. Everything either side of it is —
the schema field, the adapter, and the composition-point wiring — and every one is exercised by a
test that builds the response by hand. This is wired-and-proven, NOT written-and-never-run: the
distinction the rest of this session has been about.

⚠️ AUTHENTICITY, the recorded landmine. `_resolve_partitions` refuses any train whose
`estimate_basis.method` is `wave_component_ratio_estimation`, because a ratio-derived train is the
TOTAL field re-weighted and feeding it to the spectral factors double-counts the total under an
invented bearing (the 2026-07-30 phantom NE swell). Band heights are MEASURED fields, not ratios —
but the residual wind sea that `bands_to_partitions` reconstructs is an ASSUMPTION, and it is
stamped as one. A caller must be able to tell the two apart.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import period_bands as pb          # noqa: E402
from services.weather_pipeline.schemas import NormalizedPointDetail  # noqa: E402

_BANDS = {"h1012": 1.2, "h1214": 0.8, "h1417": 0.4, "h1721": 0.0, "h2125": 0.0, "h2530": 0.0}


def test_the_point_model_can_carry_band_heights():
    """The schema is the only place a band can survive the trip from fetcher to composition."""
    fields = set(NormalizedPointDetail.model_fields)
    assert "wave_bands" in fields, (
        "NormalizedPointDetail cannot carry period bands, so a band decoded by the fetcher dies "
        "before anything can compose it")
    assert NormalizedPointDetail.model_fields["wave_bands"].default is None, \
        "wave_bands must default to None — every path that never fetched bands must still validate"


def test_a_point_without_bands_is_unchanged():
    """Additive only. The overwhelming majority of points carry no bands and must be byte-identical
    to before."""
    p = NormalizedPointDetail(requested_lat=0.0, requested_lng=0.0, sampled_lat=0.0,
                              sampled_lng=0.0, interpolation_method="nearest")
    assert p.wave_bands is None


def test_bands_on_the_point_become_partitions():
    """★ THE COMPOSITION. Band heights -> the `{h, tp, dir, kind}` shape `estimate_surf_partitioned`
    consumes, at the band CENTRE periods, all inheriting the sea's single mean direction."""
    parts, diag = pb.bands_to_partitions(_BANDS, total_h_m=1.75, mean_dir_deg=270.0,
                                         mean_period_s=11.5)
    assert parts, "a real band set produced no partitions"
    swell = [p for p in parts if p["kind"] == "swell"]
    assert len(swell) == 3, f"expected the three non-zero bands, got {len(swell)}"
    for p in swell:
        assert p["dir"] == 270.0, "every band inherits the sea's mean direction — there is only one"
        assert 10.0 <= p["tp"] <= 30.0, f"band period {p['tp']} outside the >=10 s band range"
    assert diag is not None


def test_the_residual_wind_sea_is_STAMPED_as_an_assumption():
    """⚠️ The bands cover >=10 s ONLY. Everything below is reconstructed in quadrature from the
    total and labelled windsea — an ASSUMPTION, not a measurement. A consumer that cannot tell it
    from a measured band would be trusting an inference as data, which is the provenance defect
    this session has been closing everywhere else."""
    parts, diag = pb.bands_to_partitions(_BANDS, total_h_m=1.75, mean_dir_deg=270.0,
                                         mean_period_s=11.5)
    windsea = [p for p in parts if p["kind"] == "windsea"]
    if windsea:
        blob = repr(diag) + repr(windsea)
        assert "estimated_residual" in blob or any("estimated" in str(v) for v in diag.values()), \
            "the reconstructed wind sea is not distinguishable from a measured band"


def test_bands_that_exceed_the_total_do_not_fabricate_energy():
    """The residual is the band set's own error term. If the bands over-report it must CLAMP at
    zero, never go imaginary and never invent a train — the gate the closure probe was run to
    justify (BANDS_CLOSE, max ratio 1.0012 over 20,494 ocean cells)."""
    over = {"h1012": 3.0, "h1214": 3.0, "h1417": 0.0, "h1721": 0.0, "h2125": 0.0, "h2530": 0.0}
    parts, diag = pb.bands_to_partitions(over, total_h_m=1.0, mean_dir_deg=270.0,
                                         mean_period_s=11.5)
    for p in parts:
        assert p["h"] == p["h"] and p["h"] >= 0.0, f"non-finite or negative height {p['h']}"
    ws = [p for p in parts if p["kind"] == "windsea"]
    assert not ws or all(p["h"] >= 0.0 for p in ws), "the residual went negative instead of clamping"


def test_an_empty_or_all_zero_band_set_yields_nothing_rather_than_a_phantom():
    """A cycle with no band energy must produce NO partitions, so the caller falls through to the
    total field — never a zero-height train that the spectral factors would then weight."""
    parts, _ = pb.bands_to_partitions({k: 0.0 for k in _BANDS}, total_h_m=1.75,
                                      mean_dir_deg=270.0, mean_period_s=11.5)
    assert all(p["h"] > 0.0 for p in parts), "a zero-height partition reached the caller"


def test_the_composition_point_prefers_the_resolver_and_falls_back_to_bands():
    """★★ THE WIRING, asserted on the SOURCE because the call site is async and injected.

    `point_surf_augment` must (a) keep using the injected `resolve_partitions` when it answers —
    that lane is the reconciled CMEMS split and is authoritative — and (b) fall back to the point's
    own bands only when it does not. Bands are a cheaper SECOND source, never a replacement: two
    partition sources for one sea state is the ONE FORECAST COMPOSITION rule broken."""
    import inspect
    from services.weather_pipeline import point_surf_augment as psa
    src = inspect.getsource(psa)
    assert "bands_to_partitions" in src, "the composition point does not consult the period bands"
    i_resolver = src.index("resolve_partitions(")
    i_bands = src.index("bands_to_partitions")
    assert i_resolver < i_bands, "the band fallback is written before the injected resolver"


# ── BEHAVIOURAL GUARDS ──────────────────────────────────────────────────────────────────────────
# ⚠️ THE SOURCE-TEXT TEST ABOVE IS NOT ENOUGH, and a mutation run proved it: making the band branch
# unconditional (`if True:` instead of `if not _parts:`) and disabling it entirely (`if False:`)
# BOTH left it green — the text and the ordering are unchanged in each case. A guard that reads
# source can only see that a call exists, never which value wins. These two run the real function.

def _resp_with_bands(bands):
    """A minimal marine point response carrying period bands, built by hand — the sampler that
    would populate `wave_bands` in production lives in a file held by a concurrent session."""
    from services.weather_pipeline.schemas import NormalizedPointResponse
    return NormalizedPointResponse(
        model="EURO", provider="ecmwf", domain="marine", layer="waves",
        run_time="2026-08-02T00:00:00Z", valid_time="2026-08-02T12:00:00Z",
        is_forecast_authoritative=True, is_estimated=False,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["swh"], freshness_sec=0,
        point=NormalizedPointDetail(
            requested_lat=33.65, requested_lng=-118.0, sampled_lat=33.65, sampled_lng=-118.0,
            speed=1.75, direction=270.0, period=11.5, interpolation_method="nearest",
            wave_bands=bands))


@pytest.mark.asyncio
async def test_bands_compose_when_the_resolver_returns_nothing():
    """The gap this fills: `SURF_PARTITIONS` is OFF by default, so the resolver returns None on
    almost every point. That is exactly where a zero-cost band split should land."""
    from services.weather_pipeline.point_surf_augment import augment_with_surf

    async def _none(*a, **k):
        return None

    r = await augment_with_surf(_resp_with_bands(_BANDS), "EURO", "marine", "waves",
                                33.65, -118.0, None, _none)
    assert r.partitions, "the resolver returned None and the bands did not compose"
    assert len(r.partitions) >= 2, f"expected a real split, got {r.partitions}"


@pytest.mark.asyncio
async def test_the_reconciled_resolver_WINS_over_the_bands():
    """★★ THE ONE FORECAST COMPOSITION RULE. The CMEMS split is reconciled and authoritative; the
    bands are a cheaper second source. If both are available the resolver must win, or the same sea
    state has two answers. A mutation making the band branch unconditional passes the source test
    and fails this one."""
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    reconciled = [{"h": 1.5, "tp": 14.0, "dir": 250.0, "kind": "swell"}]

    async def _real(*a, **k):
        return reconciled

    r = await augment_with_surf(_resp_with_bands(_BANDS), "EURO", "marine", "waves",
                                33.65, -118.0, None, _real)
    assert r.partitions == reconciled, (
        f"the band fallback DISPLACED the reconciled resolver — two sources for one sea state. "
        f"got {r.partitions}")
