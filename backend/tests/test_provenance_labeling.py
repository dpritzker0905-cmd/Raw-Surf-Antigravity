"""The manifest must say WHERE data actually came from.

On 2026-07-30 the owner challenged "EURO should not be on open-meteo". The manifest reported
`provider=open-meteo` AND `upstream_provider=open-meteo` for EURO marine waves — and the honest
answer turned out to be that THE MANIFEST COULD NOT SAY. EURO waves is fetched from ECMWF Open Data
direct (`ecmwf_wave_service` -> `ecmwf_opendata_fetcher`, free CC-BY GRIB), but that path
deliberately keeps `provider='open-meteo'` so the normalizer's existing branch fires. The Open-Meteo
`ecmwf_wam025` endpoint is ALSO a real route. Both produce byte-identical manifests.

★ `provider` is a DISPATCH KEY, not provenance — its branches choose `source_dataset` and, for
copernicus, the whole variable-name mapping (VHM0/VMDR/...). It must not be repurposed.

The truth already existed and was being thrown away: every direct fetcher stamps `__provider` on
its output points (`ecmwf`, `dwd`, `noaa`, `copernicus`). `upstream_provider` is informational only
— written in `capabilities.py` and the normalizer, branched on NOWHERE in backend or frontend — so
it now carries that value.

⚠️ A field that cannot distinguish the thing it is named for is worse than no field: it reads as an
answer. That mislabel cost a live investigation an hour and sent it down a wrong root.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.normalizer import WeatherNormalizer

BBOX = {"west": -122.0, "south": 37.0, "east": -121.0, "north": 38.0}
T = datetime(2026, 7, 30, 12, 0, 0, tzinfo=timezone.utc)


def _points(marker=None, n=4):
    """Open-Meteo-shaped marine points, optionally carrying a direct fetcher's `__provider`."""
    out = []
    for i in range(n):
        p = {
            "latitude": 37.0 + i * 0.25, "longitude": -122.0 + i * 0.25,
            "hourly": {
                "time": [T.strftime("%Y-%m-%dT%H:00")],
                "wave_height": [1.5], "wave_direction": [270.0], "wave_period": [12.0],
            },
        }
        if marker:
            p["__provider"] = marker
        out.append(p)
    return out


def _norm(provider, marker, model="EURO", domain="marine", layer="waves"):
    return WeatherNormalizer().normalize(
        model=model, provider=provider, domain=domain, layer=layer,
        raw_results=_points(marker), bbox=BBOX, resolution=0.25, target_time=T)


def test_a_direct_ECMWF_fetch_no_longer_claims_open_meteo():
    """THE DEFECT: EURO waves comes from ECMWF Open Data, and the manifest said open-meteo."""
    p = _norm("open-meteo", "ecmwf")
    assert p is not None
    assert p.upstream_provider == "ecmwf", \
        "ECMWF-direct data still reports as open-meteo — the label that caused the wrong root"


def test_the_dispatch_key_and_the_dataset_are_UNCHANGED():
    """`provider` selects the source_dataset branch and the CMEMS variable mapping. Sharpening
    provenance must not move either, or this becomes a data change wearing a labelling hat."""
    direct = _norm("open-meteo", "ecmwf")
    plain = _norm("open-meteo", None)
    assert direct.provider == plain.provider == "open-meteo"
    assert direct.source_dataset == plain.source_dataset == "ecmwf_wam025"
    assert direct.upstream_model == plain.upstream_model == "ecmwf_wam025"
    assert direct.is_estimated == plain.is_estimated


def test_it_is_SELF_CORRECTING_genuine_open_meteo_still_says_open_meteo():
    """A payload with no `__provider` really did come from Open-Meteo. The field must keep saying so
    — otherwise it is just a differently-wrong label."""
    p = _norm("open-meteo", None, model="GFS")
    assert p.upstream_provider == "open-meteo"


@pytest.mark.parametrize("marker", ["ecmwf", "dwd", "noaa", "copernicus"])
def test_every_direct_fetchers_marker_is_carried(marker):
    """These are the exact values the direct fetchers stamp today."""
    assert _norm("open-meteo", marker).upstream_provider == marker


def test_the_marker_is_case_normalised():
    assert _norm("open-meteo", "ECMWF").upstream_provider == "ecmwf"


def test_a_marker_on_ANY_point_is_enough():
    """Fetchers stamp per point; a partially-stamped payload must still report the truth."""
    pts = _points(None, n=3)
    pts[2]["__provider"] = "ecmwf"
    p = WeatherNormalizer().normalize(model="EURO", provider="open-meteo", domain="marine", layer="waves",
                               raw_results=pts, bbox=BBOX, resolution=0.25, target_time=T)
    assert p.upstream_provider == "ecmwf"


def test_copernicus_provenance_is_unchanged_when_it_agrees():
    """The copernicus branch already set upstream_provider correctly; the override must agree with
    it rather than fight it."""
    p = _norm("copernicus", "copernicus", layer="swell_1")
    assert p.upstream_provider == "copernicus"
    assert p.source_dataset == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"


def test_the_direct_fetchers_still_stamp_the_marker_this_reads():
    """Pins the contract at the SOURCE. If a fetcher stops emitting `__provider`, provenance goes
    quietly back to lying — and a silent revert to a wrong label is exactly the failure being fixed.
    """
    import re
    roots = os.path.join(backend_dir, "services")
    expected = {
        "ecmwf_opendata_fetcher.py": "ecmwf",
        "dwd_gwam_fetcher.py": "dwd",
        "dwd_icon_wind_fetcher.py": "dwd",
        "noaa_gfs_pressure_fetcher.py": "noaa",
        "copernicus_marine_service.py": "copernicus",
    }
    for fname, marker in expected.items():
        path = os.path.join(roots, fname)
        if not os.path.exists(path):
            pytest.skip(f"{fname} not present")
        src = open(path, encoding="utf-8").read()
        # TWO legitimate forms: a literal mapping, or the shared `make_point_dict(lat, lon,
        # <marker>, ...)` helper which sets `__provider` from its third argument. The first version
        # of this test only matched the literal and reported the ECMWF fetcher as broken when it was
        # not — a source-grep assertion has to know every shape the thing it greps for can take.
        literal = re.search(rf'"__provider"\s*:\s*"{marker}"', src)
        via_helper = re.search(rf'make_point_dict\([^)]*"{marker}"', src, re.S)
        assert literal or via_helper, \
            f"{fname} no longer stamps __provider='{marker}' — provenance silently reverts to open-meteo"
