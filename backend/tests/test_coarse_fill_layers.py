"""The coarse marine hole-fill covered ONE layer of four, and its comment said otherwise.

★★★ MEASURED LIVE 2026-08-01 at the 10° global-coarse tier. A cell counts as a HOLE only when it is
invalid in one model and VALID IN BOTH OTHERS — land is land for every model, so that discriminator
cannot mistake a coastline or an ice edge for a defect (the trap that produced five false positives
on the land-bleed probe):

    layer         EURO holes    ICON holes    GFS holes
    waves              0             0            3
    swell_1           76             0            2
    wind_waves       107             0            1

**ONE CONDITION — `layer != "waves"` → return unchanged — was the entire difference between 0 and
107 holes on the SAME model at the SAME tier.** The Jacobian variable is the LAYER, not the model.
⚠️ And the code comment beside that gate claimed "swells/wind_waves ride the same fill via the
total's validity flag". Measured false — the 4th instance in this repo of a comment asserting the
opposite of reality.

★ WHY EURO AND NOT ICON, checked by PROVENANCE before treating it as a defect: EURO `waves` is
ECMWF WAM via open-meteo, while EURO `swell_1`/`wind_waves` come from Copernicus CMEMS
(`cmems_mod_glo_wav_anfc_0.083deg`, vars `VHM0_SW1`/`VHM0_WW`) which masks far more aggressively.
⚠️⚠️ These are REAL CMEMS partitions, NOT the fabricated ECMWF partitions gated off in `81c7bcb5` —
"EURO swell is fiction" would have made the whole finding a false positive, so it was verified from
the served product's own `upstream_provider` before a line was written.

⚠️ RULE 9 — the fix was tested against the failing instance BEFORE being built: every one of the
183 holes has a valid GFS cell of the SAME layer at distance **0.0°** (co-located on the shared 10°
lattice), so widening the gate fills 76/76 and 107/107 rather than nothing.
"""
import asyncio
import types

import pytest

from services.weather_pipeline import coarse_gulf_fill as CF


def _vec(lat, lng, speed=1.0, valid=True):
    return types.SimpleNamespace(lat=lat, lng=lng, speed=(speed if valid else None),
                                 direction=270.0, u=1.0, v=0.0, period=9.0, is_valid=valid)


def _product(vectors, valid_time="2026-08-01T18:00:00Z"):
    grid = types.SimpleNamespace(
        vectors=vectors,
        bounds=types.SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0))
    return types.SimpleNamespace(grid=grid, valid_time=valid_time)


class _Store:
    """Records WHICH layer the donor loader was asked for — the point of the same-layer rule."""

    def __init__(self, donors):
        self.donors, self.asked = donors, []


def _run(product, model, layer, store, donor_vectors):
    """Drive the real fill with the manifest lookup stubbed to a donor of the requested layer."""
    def _fake_loader(_store, _vt, lyr="waves"):
        _store.asked.append(lyr)
        vs = donor_vectors.get(lyr)
        return _product(vs) if vs else None

    orig = CF._load_gfs_coarse_waves
    CF._load_gfs_coarse_waves = _fake_loader
    try:
        return asyncio.run(CF.fill_coarse_enclosed_sea_from_gfs_served(
            product, store, model, "marine", layer))
    finally:
        CF._load_gfs_coarse_waves = orig


DONORS = {L: [_vec(-70.0, -50.0, 2.5), _vec(30.0, -90.0, 1.1)]
          for L in ("waves", "swell_1", "swell_2", "wind_waves")}


# ── 1. THE DEFECT ITSELF ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
def test_every_marine_layer_gets_its_holes_filled(layer):
    """THE REGRESSION. Before 2026-08-01 only `waves` was fillable, so EURO served 76 `swell_1` and
    107 `wind_waves` holes at cells where both other models had data."""
    store = _Store(DONORS)
    hole = _vec(-70.0, -50.0, valid=False)
    out = _run(_product([hole, _vec(0.0, 0.0, 1.4)]), "EURO", layer, store, DONORS)
    assert hole.is_valid is True, f"{layer} hole was not filled"
    assert hole.speed == pytest.approx(2.5)
    assert out.coarse_fill["cells_filled"] == 1


def test_a_layer_outside_the_list_is_left_ALONE():
    """NEGATIVE CONTROL. The gate must still bind — a fill that fires on everything is not a fix,
    and `wind`/`pressure` are not marine height fields at all."""
    store = _Store(DONORS)
    hole = _vec(-70.0, -50.0, valid=False)
    _run(_product([hole]), "EURO", "wind", store, DONORS)
    assert hole.is_valid is False, "a non-marine-height layer was filled"
    assert store.asked == [], "the donor was loaded for a layer that must never be filled"


# ── 2. THE DONOR MUST CARRY THE SAME QUANTITY ────────────────────────────────────────────────

@pytest.mark.parametrize("layer", ["swell_1", "wind_waves"])
def test_the_donor_is_requested_for_the_SAME_layer(layer):
    """⛔ Filling a `swell_1` hole from a `waves` donor would substitute the TOTAL significant
    height for one train's height — two different quantities in the same units, the class
    `5ae2d267` closed at the infobox. Assert the loader is ASKED for the right layer, because a
    same-units substitution is invisible in the output value."""
    store = _Store(DONORS)
    _run(_product([_vec(-70.0, -50.0, valid=False)]), "EURO", layer, store, DONORS)
    assert store.asked == [layer], f"donor requested for {store.asked}, must be ['{layer}']"


def test_no_same_layer_donor_means_NO_FILL_rather_than_a_wrong_quantity():
    """If GFS has no product for that layer, the honest answer is the hole. Falling back to `waves`
    would paint total wave height onto a swell layer and nothing would say so."""
    store = _Store({})
    hole = _vec(-70.0, -50.0, valid=False)
    _run(_product([hole]), "EURO", "swell_1", store, {"waves": DONORS["waves"]})
    assert hole.is_valid is False, "a missing same-layer donor was papered over"


# ── 3. PROVENANCE — a substituted cell used to be indistinguishable from a native one ─────────

def test_a_filled_product_SAYS_it_was_filled():
    """★★ In a repo where every recurring defect is PROVENANCE or COMPOSITION, widening this fill
    without a marker would have widened a silent lie from 0 cells to 183: the product claims to be
    EURO at cells whose numbers came from GFS."""
    store = _Store(DONORS)
    out = _run(_product([_vec(-70.0, -50.0, valid=False), _vec(30.0, -90.0, valid=False),
                         _vec(0.0, 0.0, 1.4)]), "EURO", "swell_1", store, DONORS)
    cf = out.coarse_fill
    assert cf["donor_model"] == "GFS" and cf["layer"] == "swell_1"
    assert cf["cells_filled"] == 2 and cf["cells_masked"] == 2 and cf["cells_total"] == 3


def test_an_UNFILLED_product_makes_no_provenance_claim():
    """A marker that is always present says nothing. Absence must mean 'nothing was substituted'."""
    store = _Store(DONORS)
    out = _run(_real_product([_vec_real(0.0, 0.0, 1.4)]), "EURO", "swell_1", store, DONORS)
    assert out.coarse_fill is None, "claimed a fill on a product with no masked cells"


# ── 3b. THE SAME PROVENANCE, AGAINST THE TYPE THAT ACTUALLY SHIPS ────────────────────────────
#
# ⛔⛔ EVERY TEST ABOVE BUILDS ITS PRODUCT WITH `types.SimpleNamespace`, WHICH ACCEPTS ANY ATTRIBUTE
# ASSIGNMENT. The production type is `NormalizedProduct`, a pydantic BaseModel with no `coarse_fill`
# field and no `extra="allow"` — so `product.coarse_fill = {...}` raised `ValueError` on every real
# product, the write site swallowed it, and `"coarse_fill" in model_dump_json()` was False.
# **The provenance guard was green for eleven days and had never once touched the type that raises.**
# (MASTER AUDIT 1.0 §2a.) A harness that cannot express the defect is not a guard.
#
# ★ These tests are their own negative control: undeclare `NormalizedProduct.coarse_fill` and they
#   fail, because the stamp is read back off the real object rather than off a namespace that
#   invents attributes on demand.

def _vec_real(lat, lng, speed=1.0, valid=True):
    """A REAL GridVector. `speed` is non-Optional here, so a masked cell is `is_valid=False` —
    which is exactly what `_is_masked` keys on first."""
    from services.weather_pipeline.schemas import GridVector
    return GridVector(lat=lat, lng=lng, speed=(speed if valid else 0.0),
                      direction=270.0, u=1.0, v=0.0, period=9.0, is_valid=valid)


def _real_product(vectors, valid_time="2026-08-01T18:00:00Z"):
    """A REAL NormalizedProduct — the type `/grid` declares as its `response_model`."""
    from services.weather_pipeline.schemas import (
        CoverageBounds, NormalizedGrid, NormalizedProduct)
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer="swell_1",
        run_time=valid_time, valid_time=valid_time,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=len(vectors), rows=1, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["VHM0_SW1"], freshness_sec=0)


def test_provenance_lands_on_the_REAL_type_and_reaches_the_JSON():
    """The whole point: the stamp must survive on `NormalizedProduct`, not just on a namespace."""
    from services.weather_pipeline.schemas import NormalizedProduct
    store = _Store(DONORS)
    prod = _real_product([_vec_real(-70.0, -50.0, valid=False),
                          _vec_real(30.0, -90.0, valid=False), _vec_real(0.0, 0.0, 1.4)])
    assert isinstance(prod, NormalizedProduct), "harness regressed to a namespace"

    out = _run(prod, "EURO", "swell_1", store, DONORS)

    # ★ ASSERT THE SETUP HAPPENED. Without this, a fill that silently did nothing would leave
    #   `coarse_fill is None` and read as "no substitution" rather than "the guard tested nothing".
    assert sum(1 for v in out.grid.vectors if v.is_valid) == 3, "the fill did not run"
    cf = out.coarse_fill
    assert cf is not None, "the stamp did not land on NormalizedProduct"
    assert cf["donor_model"] == "GFS" and cf["layer"] == "swell_1"
    assert cf["cells_filled"] == 2 and cf["cells_masked"] == 2 and cf["cells_total"] == 3
    assert "coarse_fill" in out.model_dump_json(), "declared but not serialized"


def test_provenance_survives_the_response_model_filter():
    """⭐ THE SECOND BARRIER. `/grid` declares `response_model=NormalizedProduct`, and FastAPI
    re-validates the returned object through that model — so a field that is assignable but
    undeclared is dropped at the route even when the assignment succeeds. Declaring the field is
    necessary AND sufficient only if it also survives this round-trip; that is what is asserted."""
    from services.weather_pipeline.schemas import NormalizedProduct
    store = _Store(DONORS)
    out = _run(_real_product([_vec_real(30.0, -90.0, valid=False), _vec_real(0.0, 0.0, 1.4)]),
               "EURO", "swell_1", store, DONORS)
    assert out.coarse_fill is not None, "nothing to filter — setup failed"

    filtered = NormalizedProduct.model_validate(out.model_dump())
    assert filtered.coarse_fill is not None, "response_model filtered the provenance away"
    assert filtered.coarse_fill["cells_filled"] == 1


def test_the_grid_route_still_declares_the_model_this_guard_pins():
    """The two tests above are only about `/grid` because `/grid` serves this product. Read that
    from the LIVE router, never from a grep: if the route is repointed at another response model,
    the barrier moves and these guards would silently stop covering the shipped path."""
    from routes.weather import router
    from services.weather_pipeline.schemas import NormalizedProduct
    # Match on the SUFFIX: the router carries a `/weather` prefix, so the live path is
    # `/weather/grid`. (Asserting the bare `/grid` I remembered is how this test failed its own
    # first run — the router was right and the guard was written from recall.)
    grid = [r for r in router.routes if getattr(r, "path", "").endswith("/grid")]
    assert grid, "no /grid route found — this guard is watching nothing"
    assert any(getattr(r, "response_model", None) is NormalizedProduct for r in grid), (
        "/grid no longer returns NormalizedProduct; re-point the provenance guard at the new model")


# ── 4. THE GUARDS THAT MUST STILL BIND ───────────────────────────────────────────────────────

def test_GFS_is_never_a_recipient():
    """It is the donor. Filling GFS from GFS would be circular, and GFS's own 1-3 holes are the
    INGEST defect (queue #25), which this serve-time fill deliberately does not pretend to solve."""
    store = _Store(DONORS)
    hole = _vec(-70.0, -50.0, valid=False)
    _run(_product([hole]), "GFS", "swell_1", store, DONORS)
    assert hole.is_valid is False


def test_a_REGIONAL_grid_is_untouched():
    """Coarse-global only (span >= 350°). A regional tile has its own resolution and donor logic."""
    store = _Store(DONORS)
    hole = _vec(-70.0, -50.0, valid=False)
    prod = _product([hole])
    prod.grid.bounds = types.SimpleNamespace(west=-100.0, south=20.0, east=-60.0, north=50.0)
    _run(prod, "EURO", "swell_1", store, DONORS)
    assert hole.is_valid is False, "a regional grid was filled by the global-coarse path"


def test_the_kill_switch_still_works(monkeypatch):
    monkeypatch.setenv("MARINE_COARSE_GULF_FILL", "0")
    store = _Store(DONORS)
    hole = _vec(-70.0, -50.0, valid=False)
    _run(_product([hole]), "EURO", "swell_1", store, DONORS)
    assert hole.is_valid is False


def test_a_hole_with_no_donor_NEARBY_stays_a_hole():
    """★ This is what keeps the fill honest over land and solid ice: no GFS ocean cell within
    _MAX_FILL_DIST_DEG means the masked cell is genuine, and None is the correct answer. It is also
    why the live hole count could be trusted — the donor had to exist for a cell to count."""
    store = _Store(DONORS)
    hole = _vec(85.0, 170.0, valid=False)          # far from every donor above
    _run(_product([hole]), "EURO", "swell_1", store, DONORS)
    assert hole.is_valid is False
