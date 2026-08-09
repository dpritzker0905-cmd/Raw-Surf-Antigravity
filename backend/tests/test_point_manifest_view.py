"""manifest_view.products_for — the lane index must be a pure re-arrangement of the linear scan.

The index replaced three serving-path full scans of manifest.products (16,132 rows live, ~5-6 ms
x22 per hub request). Selection downstream tie-breaks with min() over candidate lists, so the
bucket must reproduce the scan's candidates IN THE SCAN'S ORDER, and its cache must invalidate
exactly when get_manifest() hands out a new object — no second freshness protocol."""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import manifest_view                     # noqa: E402
from services.weather_pipeline.manifest_view import products_for        # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct  # noqa: E402

NOW = datetime(2026, 8, 9, 0, 0, tzinfo=timezone.utc)


def _prod(i, model, domain, layer):
    return ManifestProduct(
        model=model, provider="open-meteo", domain=domain, layer=layer,
        run_time=NOW, valid_time_start=NOW + timedelta(hours=i),
        valid_time_end=NOW + timedelta(hours=i + 1), resolution=0.25, freshness_sec=3600,
        is_forecast_authoritative=True,
        coverage=CoverageBounds(west=-180, south=-80, east=180, north=85),
        filename=f"p{i}.json")


class _Manifest:
    def __init__(self, products):
        self.products = products


def _linear(manifest, model, domain, layer):
    """VERBATIM filter shape from point_resolution at 5e181f69."""
    out = []
    for p in manifest.products:
        if (p.model.upper() == model.upper() and p.domain.lower() == domain.lower()
                and p.layer.lower() == layer.lower()):
            out.append(p)
    return out


def _mixed_manifest():
    prods = []
    for i in range(60):
        model = ("GFS", "EURO", "ICON")[i % 3]
        domain, layer = (("marine", "waves"), ("wind", "wind"), ("marine", "swell_1"))[(i // 3) % 3]
        # ⚠️ NON-CANONICAL CASE ON THE DATA SIDE, deliberately: the linear scan normalized BOTH
        # sides per comparison, so a product stored as model="gfs" was always found. An index that
        # normalizes only the lookup key silently loses those rows — mutation-tested: without these
        # rows the build-side .upper()/.lower() could be deleted and every test stayed green.
        if i % 7 == 0:
            model, domain, layer = model.lower(), domain.upper(), layer.title()
        prods.append(_prod(i, model, domain, layer))
    return _Manifest(prods)


def test_every_lane_reproduces_the_linear_scan_in_order_and_identity():
    m = _mixed_manifest()
    for model in ("GFS", "EURO", "ICON"):
        for domain, layer in (("marine", "waves"), ("wind", "wind"), ("marine", "swell_1")):
            a = _linear(m, model, domain, layer)
            b = products_for(m, model, domain, layer)
            assert len(a) == len(b) and all(x is y for x, y in zip(a, b)), (
                f"lane ({model},{domain},{layer}) diverges from the linear scan")


def test_case_insensitivity_matches_the_scan_exactly():
    m = _mixed_manifest()
    assert products_for(m, "gfs", "MARINE", "Waves") == _linear(m, "GFS", "marine", "waves")


def test_the_index_invalidates_on_the_two_mutation_shapes_the_writers_actually_use():
    """The writer paths mutate the CACHED manifest object in memory: eleven sites REASSIGN
    manifest.products to a new list, one APPENDS in place (store_helpers.py:447). The linear scan
    saw both instantly; the index must too, or it serves stale candidates forever — which is why
    it keys on the products LIST identity plus length, never on the manifest object."""
    m1 = _mixed_manifest()
    b1 = products_for(m1, "GFS", "marine", "waves")
    b1_again = products_for(m1, "GFS", "marine", "waves")
    assert b1_again is b1, "unchanged products list must be a cache hit (identity key)"
    # shape 1: REASSIGNMENT on the same manifest object (store.py:208 et al.)
    m1.products = m1.products + [_prod(999, "GFS", "marine", "waves")]
    b2 = products_for(m1, "GFS", "marine", "waves")
    assert len(b2) == len(b1) + 1, "a products-list REASSIGNMENT went unseen — stale index"
    # shape 2: IN-PLACE append on the same list object (store_helpers.py:447)
    m1.products.append(_prod(1000, "GFS", "marine", "waves"))
    b3 = products_for(m1, "GFS", "marine", "waves")
    assert len(b3) == len(b2) + 1, "an in-place append went unseen — stale index"


def test_an_absent_lane_is_an_empty_list_not_an_error():
    m = _mixed_manifest()
    assert products_for(m, "NOPE", "marine", "waves") == []
    assert products_for(_Manifest([]), "GFS", "marine", "waves") == []
