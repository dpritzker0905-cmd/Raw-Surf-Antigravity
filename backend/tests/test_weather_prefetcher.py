"""Unit tests for the serve-box warm-on-boot prefetcher (no network — Supabase + manifest mocked).

Guards the cold-start fix: the prefetcher must warm the near-term products for ALL models and the layers
the map renders/scrubs (not just GFS/marine/waves), nearest-hour-first, honoring the window, cap, and the
PREFETCH_DISABLED kill switch.
"""
import asyncio
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

from services.weather_pipeline import prefetcher


def _mk(model, domain, layer, dt, fixture=False, name=None):
    return SimpleNamespace(
        model=model, domain=domain, layer=layer,
        valid_time_start=dt, is_test_fixture=fixture,
        filename=name or f"{model}_{domain}_{layer}_{int(dt.timestamp())}.json",
    )


class _Bucket:
    def __init__(self, rec): self.rec = rec
    def download(self, fn): self.rec.append(fn); return b'{"ok": 1}'


class _Storage:
    def __init__(self, rec): self.rec = rec
    def from_(self, _bucket): return _Bucket(self.rec)


class _SB:
    def __init__(self, rec): self.storage = _Storage(rec)


def _setup(monkeypatch, tmp_path, products):
    fake_store = SimpleNamespace(cache_dir=tmp_path, get_manifest=lambda: SimpleNamespace(products=products))
    monkeypatch.setattr(prefetcher, "ProductStore", lambda: fake_store)
    rec = []
    monkeypatch.setattr(prefetcher, "_get_supabase_storage", lambda: _SB(rec))
    monkeypatch.delenv("PREFETCH_DISABLED", raising=False)
    monkeypatch.delenv("PREFETCH_MAX", raising=False)
    monkeypatch.delenv("PREFETCH_WINDOW_DAYS", raising=False)
    return rec


def test_prefetch_warms_all_models_and_layers_nearest_first(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    products = [
        _mk("GFS", "marine", "waves", now, name="gfs_waves_now.json"),
        _mk("GFS", "marine", "waves", now + timedelta(hours=3), name="gfs_waves_3.json"),
        _mk("GFS", "wind", "wind", now, name="gfs_wind_now.json"),
        _mk("EURO", "marine", "swell_1", now, name="euro_swell1_now.json"),
        _mk("ICON", "marine", "wind_waves", now, name="icon_ww_now.json"),
        _mk("EURO", "weather", "pressure", now, name="euro_pressure_now.json"),
        _mk("GFS", "marine", "waves", now + timedelta(days=10), name="gfs_waves_far.json"),  # outside window
        _mk("GFS", "marine", "steepness", now, name="nonwarm.json"),  # non-warm layer
        _mk("GFS", "marine", "waves", now, fixture=True, name="fixture.json"),  # test fixture
    ]
    rec = _setup(monkeypatch, tmp_path, products)
    monkeypatch.setenv("PREFETCH_CONCURRENCY", "1")  # deterministic ordering for the priority assertion

    asyncio.run(prefetcher.prefetch_supabase_products())

    # Coverage beyond the old GFS/marine/waves-only behavior:
    assert "gfs_wind_now.json" in rec          # wind now prewarmed (was the ~5min cold-load bug)
    assert "euro_swell1_now.json" in rec       # EURO + a swell layer
    assert "icon_ww_now.json" in rec           # ICON + wind_waves
    assert "euro_pressure_now.json" in rec     # pressure
    # Exclusions:
    assert "gfs_waves_far.json" not in rec      # beyond the near-term window
    assert "nonwarm.json" not in rec            # not a map-rendered layer
    assert "fixture.json" not in rec            # test fixture
    # Priority: nearest-to-now, default GFS/marine/waves first.
    assert rec[0] == "gfs_waves_now.json"


def test_prefetch_kill_switch(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    rec = _setup(monkeypatch, tmp_path, [_mk("GFS", "marine", "waves", now)])
    monkeypatch.setenv("PREFETCH_DISABLED", "1")
    asyncio.run(prefetcher.prefetch_supabase_products())
    assert rec == []


def test_prefetch_cap_keeps_nearest(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    products = [_mk("GFS", "marine", "waves", now + timedelta(hours=i * 3), name=f"w{i}.json") for i in range(6)]
    rec = _setup(monkeypatch, tmp_path, products)
    monkeypatch.setenv("PREFETCH_CONCURRENCY", "1")
    monkeypatch.setenv("PREFETCH_MAX", "2")
    asyncio.run(prefetcher.prefetch_supabase_products())
    assert len(rec) == 2
    assert set(rec) == {"w0.json", "w1.json"}  # the two nearest hours
