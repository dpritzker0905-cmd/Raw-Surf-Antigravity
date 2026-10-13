"""The rating band's wind comes from the product the point resolver answers that cell from (2026-09-26).

`grid_resolver_surf._build_wind_sampler` took `min(products, key=time)` over every wind product of the
model. Production carries 16 per model per hour (14 regional 0.25° tiles, 2° and 10° globals), all tied
on time, so the manifest's ORDER chose one wind field for the whole band: the Florida tile for ICON,
sampled at its nearest edge for a Portuguese cell. Measured the same day, served ICON band cells in
Florida reproduced exactly from ICON's local wind and in Portugal and SoCal from no local wind at all.

The point resolver's pick (both copies) and the band's now share `manifest_point_selection`.
"""
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import grid_resolver_surf as GRS  # noqa: E402
from services.weather_pipeline import manifest_point_selection as MPS  # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct  # noqa: E402
from services.weather_pipeline.surf_rating import KT_TO_MS  # noqa: E402

NOW = datetime(2026, 9, 26, 21, 0, tzinfo=timezone.utc)
IBERIA_CELL = (39.25, -9.5)
FLORIDA_CELL = (27.75, -80.25)
MID_ATLANTIC = (35.0, -40.0)

# (name, resolution, (w, s, e, n), knots) — the production shape: tiles, a 2° and a 10° global.
PRODUCTS = [
    ("florida_east_coast", 0.25, (-85.0, 24.0, -79.0, 31.0), 5.0),
    ("global_mid", 2.0, (-180.0, -80.0, 180.0, 85.0), 20.0),
    ("iberia_west", 0.25, (-11.0, 36.0, -6.0, 44.0), 8.0),
    ("global_coarse", 10.0, (-180.0, -80.0, 180.0, 85.0), 30.0),
]


def _prod(name, res, bounds, model="ICON", when=NOW, region_id=None, estimated=False):
    w, s, e, n = bounds
    return ManifestProduct(
        model=model, provider="open-meteo", domain="wind", layer="wind", run_time=when,
        valid_time_start=when, valid_time_end=when + timedelta(hours=1), resolution=res,
        freshness_sec=3600, is_forecast_authoritative=not estimated, is_estimated=estimated,
        region_id=region_id or name, coverage=CoverageBounds(west=w, south=s, east=e, north=n),
        filename=f"{model.lower()}_wind_wind_{name}_{when:%Y%m%dT%H%M%SZ}.json")


class _Store:
    """load_product -> a uniform wind field at the product's own speed; counts loads."""

    def __init__(self, speeds):
        self.speeds, self.loads = speeds, []

    def load_product(self, filename):
        self.loads.append(filename)
        kn = self.speeds[filename]
        vecs = [SimpleNamespace(lat=la, lng=ln, speed=kn, direction=270.0)
                for la in range(-80, 86, 1) for ln in range(-180, 181, 1)]
        return SimpleNamespace(grid=SimpleNamespace(vectors=vecs))


def _setup(order=PRODUCTS, model="ICON"):
    prods = [_prod(n, r, b, model=model) for n, r, b, _ in order]
    speeds = {p.filename: kn for p, (_, _, _, kn) in zip(prods, order)}
    return SimpleNamespace(products=prods), _Store(speeds)


def _kn(sample):
    return round(sample[0] / KT_TO_MS, 6)


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.delenv("POINT_RES_TIEBREAK", raising=False)
    monkeypatch.delenv("COPERNICUS_ISLAND_SERVE", raising=False)


# ── 1. The defect, and its fix ───────────────────────────────────────────────────────────────

async def test_each_cell_gets_the_finest_wind_that_covers_it_whatever_the_manifest_order():
    for order in (PRODUCTS, list(reversed(PRODUCTS)), PRODUCTS[1:] + PRODUCTS[:1]):
        manifest, store = _setup(order)
        wind = await GRS._build_wind_sampler(store, manifest, "ICON", NOW)
        assert _kn(wind(*IBERIA_CELL)) == 8.0, "a Portuguese cell must read the Iberia tile's wind"
        assert _kn(wind(*FLORIDA_CELL)) == 5.0, "a Florida cell must read the Florida tile's wind"
        assert _kn(wind(*MID_ATLANTIC)) == 20.0, "open ocean falls to the 2° global, never the 10°"


async def test_the_florida_tile_no_longer_answers_a_portuguese_cell():
    """The production case exactly: ICON's manifest lists the Florida tile first."""
    manifest, store = _setup(PRODUCTS, model="ICON")
    wind = await GRS._build_wind_sampler(store, manifest, "ICON", NOW)
    assert _kn(wind(*IBERIA_CELL)) != 5.0


async def test_each_product_loads_once_and_only_when_a_cell_needs_it():
    manifest, store = _setup()
    wind = await GRS._build_wind_sampler(store, manifest, "ICON", NOW)
    assert store.loads == [], "nothing loads until a cell is sampled"
    for k in range(50):
        wind(39.0 + k * 0.01, -9.5)
    assert len(store.loads) == 1 and "iberia" in store.loads[0]


async def test_no_wind_product_within_three_hours_means_no_sampler():
    manifest, store = _setup()
    assert await GRS._build_wind_sampler(store, manifest, "ICON", NOW + timedelta(hours=4)) is None


async def test_an_ungated_island_tile_does_not_answer_the_band():
    """The old sampler never applied the island serving gate; the shared pick does."""
    island = _prod("island_madeira", 0.083, (-17.5, 32.4, -16.2, 33.2), region_id="island_madeira")
    manifest, store = _setup()
    manifest.products.insert(0, island)
    store.speeds[island.filename] = 99.0
    wind = await GRS._build_wind_sampler(store, manifest, "ICON", NOW)
    assert _kn(wind(32.75, -16.9)) == 20.0, "an island tile must not serve while the lane is unarmed"


# ── 2. The extraction changed nothing for the point resolver ─────────────────────────────────

def _old_pick(manifest, model, domain, layer, lat, lng, target_dt):
    """The loop both point-resolver sites carried until 2026-09-26, verbatim in its logic."""
    from services.weather_pipeline.island_gate import is_island_gated
    from services.weather_pipeline.route_helpers import get_actual_grid_bounds, is_inside_bounds
    auth, est = [], []
    for p in manifest.products:
        if (p.model, p.domain, p.layer) != (model, domain, layer) or is_island_gated(p):
            continue
        if is_inside_bounds(lat, lng, get_actual_grid_bounds(p.coverage, p.resolution), margin=0.0001):
            diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
            if diff <= 3 * 3600:
                (est if getattr(p, "is_estimated", False) else auth).append((p, diff))
    ba = min(auth, key=MPS.selection_key) if auth else None
    be = min(est, key=MPS.selection_key) if est else None
    if ba and be:
        return be[0] if (be[1] <= 1800 and ba[1] > 1800) else ba[0]
    return ba[0] if ba else (be[0] if be else None)


def test_the_shared_pick_equals_the_loop_it_replaced_on_random_manifests():
    rng = random.Random(926)
    for _ in range(60):
        prods = []
        for i in range(rng.randint(1, 12)):
            w = rng.uniform(-180, 150)
            s = rng.uniform(-70, 60)
            when = NOW + timedelta(minutes=rng.choice([0, 0, 20, 45, 90, 200]))
            prods.append(_prod(f"p{i}", rng.choice([0.25, 0.25, 2.0, 10.0]),
                               (w, s, w + rng.uniform(2, 60), s + rng.uniform(2, 40)),
                               when=when, estimated=rng.random() < 0.3))
        manifest = SimpleNamespace(products=prods)
        cands = MPS.point_candidates(manifest, "ICON", "wind", "wind", NOW)
        for _ in range(25):
            lat, lng = rng.uniform(-70, 80), rng.uniform(-180, 180)
            assert MPS.choose_for_point(cands, lat, lng) is _old_pick(
                manifest, "ICON", "wind", "wind", lat, lng, NOW)
