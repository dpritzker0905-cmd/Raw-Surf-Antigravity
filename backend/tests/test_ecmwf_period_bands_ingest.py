"""
test_ecmwf_period_bands_ingest.py — the fetch half of M4: ECMWF's six period bands.

WHAT THIS GUARDS
----------------
EURO publishes no spectral partitions on any path, so the six period-band heights
(`h1012`...`h2530`, ">= 10 s" through "25-30 s") are the only way it can describe its own sea. They
are free on the stream `ecmwf_opendata_fetcher` already talks to, and `estimate_surf` is strongly
non-linear in period — the exact variable the bands are indexed by.

The ingest was gated on ONE measurement, not on an opinion: do the bands stay inside the total, or
would the residual wind-sea reconstruction fabricate energy? Probed against the live 20260802/00z
cycle over 20,494 ocean cells (`.github/workflows/ecmwf-band-closure-probe.yml`):

    sqrt(sum(band^2))/swh    p50 0.5549   p90 0.8008   p99 0.9929   max 1.0012   exceed 0.0%
    -> BANDS_CLOSE

⚠️ DEFAULT OFF. The flag gates the FETCH, not merely the emit: six extra global fields per cycle on
a 1-CPU box with a documented melt history is the binding constraint (the recorded `SURF_PARTITIONS
costs 4x` lesson). With `ECMWF_PERIOD_BANDS` unset, this module must be byte-identical to before —
that is what makes it shippable while the composition half is still unwired.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import ecmwf_opendata_fetcher as f  # noqa: E402
from services.weather_pipeline import period_bands as pb  # noqa: E402


def test_default_is_off_and_the_request_is_unchanged(monkeypatch):
    """Inert by default — the wave request is exactly what it was before the bands existed."""
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    assert f.period_bands_enabled() is False
    assert f.layer_params("waves") == ["swh", "mwp", "pp1d", "mwd"]


def test_flag_on_adds_the_six_bands_to_the_request(monkeypatch):
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    params = f.layer_params("waves")
    assert params[:4] == ["swh", "mwp", "pp1d", "mwd"], "the base four must still lead"
    assert params[4:] == ["h1012", "h1214", "h1417", "h1721", "h2125", "h2530"]


def test_only_an_explicit_1_enables_it(monkeypatch):
    """A flag that turns on for 'true'/'0 '/'no' is a flag nobody can reason about."""
    for val in ("0", "", "true", "TRUE", "yes", "2", " 1"):
        monkeypatch.setenv("ECMWF_PERIOD_BANDS", val)
        assert f.period_bands_enabled() is False, f"{val!r} must not enable the bands"
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    assert f.period_bands_enabled() is True


def test_the_flag_is_read_per_call_not_at_import(monkeypatch):
    """A module-level read freezes the environment at process start, and this repo's recorded scar
    is a flag holding a different value in each lane."""
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    assert f.layer_params("waves") == ["swh", "mwp", "pp1d", "mwd"]
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    assert len(f.layer_params("waves")) == 10, "the flag did not take effect without a reimport"


def test_the_baseline_constant_is_never_mutated(monkeypatch):
    """★ `LAYER_PARAMS` is the documented baseline and `test_ecmwf_euro.py` pins it. Enabling the
    bands must ADD to a request, not redefine what the module says its wave layer is."""
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    f.layer_params("waves")
    assert f.LAYER_PARAMS["waves"] == ["swh", "mwp", "pp1d", "mwd"]


def test_other_layers_are_untouched_by_the_flag(monkeypatch):
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    assert f.layer_params("wind") == ["10u", "10v"]
    assert f.layer_params("pressure") == ["msl"]


def test_producer_and_consumer_share_ONE_vocabulary():
    """★★ THE GUARD THAT MATTERS. `period_bands.bands_to_partitions` keys on the ECMWF param names
    verbatim ('h1012'...), and this fetcher emits series named for the same strings. If the two
    lists ever diverge the composition silently sees an EMPTY band set and every sea degrades to
    the blended-period behaviour — no error, no log, just the win quietly gone.

    This repo's recorded class for that is "a duplicated constant only diverges on a boundary"
    (seven copies of a knots constant). One list, asserted."""
    consumer = [name for name, _lo, _hi in pb.ECMWF_PERIOD_BANDS]
    assert f.WAVE_PERIOD_BAND_PARAMS == consumer, (
        "the fetcher requests band params the composition does not key on (or vice versa) — "
        f"fetcher={f.WAVE_PERIOD_BAND_PARAMS} consumer={consumer}"
    )


def test_the_bands_a_consumer_gets_are_the_bands_that_were_fetched(monkeypatch):
    """The emitted series names must be derivable from the requested params with no lookup table."""
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    requested = [p for p in f.layer_params("waves") if p.startswith("h")]
    emitted = [f"wave_band_{p}" for p in f.WAVE_PERIOD_BAND_PARAMS]
    assert requested == f.WAVE_PERIOD_BAND_PARAMS
    assert all(name == f"wave_band_{p}" for name, p in zip(emitted, requested))


def test_band_centre_periods_are_inside_their_own_band():
    """A band transformed at a period outside itself would be a silent physics error — `estimate_
    surf` goes as Tp^0.4, so the centre period is doing real work, not labelling."""
    for name, lo, hi in pb.ECMWF_PERIOD_BANDS:
        centre = pb.band_centre_period(lo, hi)
        assert lo < centre < hi, f"{name}: centre {centre} outside [{lo}, {hi}]"
