"""Evaluation harness v0.1: the GRIB backend order (pygrib, else eccodes, else the built-in decoder), the eccodes
decoder on a committed synthetic fixture, and the served pgrb2 10 m wind read through it. Offline."""
import importlib
import os
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services.weather_pipeline import eval_gfswave as gw
from services.weather_pipeline import eval_grib2 as g2
from services.weather_pipeline import eval_provenance as pv
from tests._eval_harness_grib import file_with_idx, regional_fields

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "eval_harness",
                   "synthetic_3x4_three_packings.grib2")
EXPECT = np.array([[3.0, 2.5, 2.25, 0.75], [0.5, np.nan, 1.0, 1.125], [1.25, 1.5, 1.75, 2.0]])   # south -> north
CYCLE = datetime(2026, 10, 20, 0, tzinfo=timezone.utc)


def _has(name):
    return g2._importable(name) is not None


def _mock(monkeypatch, pygrib, eccodes):
    """Mocked imports: None in sys.modules makes `import x` raise ImportError; a module object makes it succeed."""
    for name, present in (("pygrib", pygrib), ("eccodes", eccodes)):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name) if present else None)


@pytest.mark.parametrize("pygrib,eccodes,want", [(True, True, "pygrib"), (True, False, "pygrib"),
                                                 (False, True, "eccodes"), (False, False, "builtin")])
def test_auto_backend_order_is_pygrib_then_eccodes_then_builtin(monkeypatch, pygrib, eccodes, want):
    _mock(monkeypatch, pygrib, eccodes)
    assert g2.select_backend("auto") == want
    assert gw.resolve("auto", "auto") == ("pgrb2" if want != "builtin" else "gfswave", want)


def test_an_explicit_backend_that_does_not_import_is_never_swapped_silently(monkeypatch):
    _mock(monkeypatch, False, False)
    for b in ("pygrib", "eccodes"):
        with pytest.raises(ImportError):
            g2.select_backend(b)
    assert g2.select_backend("builtin") == "builtin"
    with pytest.raises(ValueError):
        g2.select_backend("cfgrib")
    with pytest.raises(g2.Unsupported, match="5.3"):
        gw.resolve("pgrb2", "builtin")


def test_eccodes_that_cannot_load_its_library_counts_as_absent(monkeypatch):
    real = importlib.import_module

    def fake(name, *a, **k):
        if name == "eccodes":
            raise RuntimeError("Cannot find the ecCodes library")
        if name == "pygrib":
            raise ImportError(name)
        return real(name, *a, **k)
    monkeypatch.setattr(importlib, "import_module", fake)
    assert g2.select_backend("auto") == "builtin"


def test_the_builtin_decoder_reads_the_fixtures_5_0_and_5_40_and_refuses_5_3():
    with open(FIX, "rb") as f:
        msgs = list(g2.iter_messages(f.read()))
    assert len(msgs) == 3
    for m in (msgs[0], msgs[2]):
        a, meta = g2.decode_builtin(m)
        np.testing.assert_allclose(a, EXPECT, equal_nan=True)
        assert (meta["lat_south"], meta["lon_west"], meta["dlat"], meta["dlon"]) == (33.5, 240.0, 0.25, 0.25)
    with pytest.raises(g2.Unsupported, match="5.3"):
        g2.decode_builtin(msgs[1])


@pytest.mark.skipif(not _has("eccodes"), reason="eccodes is not installed here (optional: "
                                                 "backend/requirements-eval-harness.txt); CI decodes with pygrib")
def test_eccodes_decodes_every_packing_of_the_fixture_including_the_pgrb2_template_5_3():
    with open(FIX, "rb") as f:
        buf = f.read()
    got = g2.decode_span(buf, ["A", "B", "C"], ["A", "B", "C"], "eccodes")
    assert [got[k][1]["template"] for k in "ABC"] == ["5.0", "5.3", "5.40"]
    for k in "ABC":
        a, meta = got[k]
        np.testing.assert_allclose(a, EXPECT, equal_nan=True)
        assert meta["decoder"] == "eccodes" and (meta["ni"], meta["nj"]) == (4, 3)
    assert "ecCodes" in g2.backend_version("eccodes")


@pytest.mark.skipif(not _has("pygrib"), reason="pygrib is not installed here (no Windows wheel); CI runs this")
def test_pygrib_decodes_the_fixture_to_the_same_values():
    with open(FIX, "rb") as f:
        got = g2.decode_span(f.read(), ["A", "B", "C"], ["A", "B", "C"], "pygrib")
    for k in "ABC":
        np.testing.assert_allclose(got[k][0], EXPECT, equal_nan=True)


class FakeArchive:
    """A wave file with UGRD/VGRD = 1, 2 (forcing) and an atmosphere file with UGRD/VGRD 10 m = 5, -3 (served)."""

    def __init__(self):
        self.urls = []
        wave = regional_fields(32.0, 35.0, 240.0, 243.0, 0.25,
                               lambda la, lo: {"UGRD": 1.0, "VGRD": 2.0, "HTSGW": 1.5, "PERPW": 12.0, "DIRPW": 270.0})
        self.wave, self.wave_idx = file_with_idx(wave, "2026102000", 24)
        atm = regional_fields(32.0, 35.0, 240.0, 243.0, 0.25,
                              lambda la, lo: {"UGRD": 5.0, "VGRD": -3.0, "HTSGW": 0, "PERPW": 0, "DIRPW": 0})
        atm = [(v, "10 m above ground", m) for v, _, m in atm[:2]]
        self.atm, self.atm_idx = file_with_idx(atm, "2026102000", 24)

    def __call__(self, url, rng=None, max_bytes=None):
        self.urls.append(url)
        wave = "/wave/" in url
        if url.endswith(".idx"):
            return (self.wave_idx if wave else self.atm_idx).encode(), 200
        b = self.wave if wave else self.atm
        return b[rng[0]:(rng[1] + 1 if rng[1] is not None else None)], 206


@pytest.mark.skipif(not (_has("eccodes") or _has("pygrib")), reason="needs an ecCodes backend (eccodes or pygrib)")
def test_the_served_pgrb2_wind_is_read_and_recorded(tmp_path):
    fake = FakeArchive()
    cache = pv.Cache(str(tmp_path / "c"), get=fake, pause_s=0)
    fields, recs, info = gw.fetch_fields(cache, CYCLE, 24)
    assert info["wind_source"] == "pgrb2" and info["grib_backend"] in ("pygrib", "eccodes")
    assert info["decoders"] == [info["grib_backend"]]
    assert any("/atmos/" in u for u in fake.urls)
    assert np.nanmax(np.abs(fields["U"][0] - 5.0)) < 1e-6 and np.nanmax(np.abs(fields["V"][0] + 3.0)) < 1e-6
    atm = [r for r in recs if r["source"] == "gfs_atm_grib2"]
    assert atm and f"decode_span({info['grib_backend']})" in atm[0]["parser"]
    assert info["grib_backend_version"] in atm[0]["notes"]
    c = gw.crop(fields, 33.5, -118.5)
    assert c["U"][0][0] == pytest.approx(5.0)


def test_the_builtin_path_falls_back_to_the_wave_files_forcing_wind(tmp_path):
    fake = FakeArchive()
    cache = pv.Cache(str(tmp_path / "c"), get=fake, pause_s=0)
    fields, recs, info = gw.fetch_fields(cache, CYCLE, 24, wind_source="auto", decoder="builtin")
    assert info["wind_source"] == "gfswave" and info["grib_backend"] == "builtin"
    assert not any("/atmos/" in u for u in fake.urls)
    assert np.nanmax(np.abs(fields["U"][0] - 1.0)) < 1e-6


def test_crop_refuses_fields_on_a_shifted_grid():
    a = np.zeros((3, 4))
    m = {"ni": 4, "nj": 3, "lat_south": 33.5, "lon_west": 240.0, "dlat": 0.25, "dlon": 0.25, "lat_north": 34.0}
    fields = {k: (a, m) for k in ("HTSGW", "PERPW", "DIRPW", "U")}
    fields["V"] = (a, dict(m, lon_west=240.25))
    with pytest.raises(g2.Unsupported, match="another grid"):
        gw.crop(fields, 33.75, -119.5)
