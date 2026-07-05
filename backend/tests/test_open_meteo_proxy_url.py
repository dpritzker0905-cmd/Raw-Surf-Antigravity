"""
WEATHER_PROXY_URL empty-secret regression (2026-07-05).

The CI workflows (precompute.yml, forecast-ingest*.yml) pass `WEATHER_PROXY_URL: ${{ secrets.WEATHER_PROXY_URL }}`
but the secret was never created, so Actions injects the env var as an EMPTY STRING. With
`os.environ.get("WEATHER_PROXY_URL", default)` the empty string SHADOWS the default (the key exists),
and every proxied point-fetch POSTs to "" -> httpx "Request URL is missing an 'http://' or 'https://'
protocol" -> per-point Copernicus subprocess fallback at ~16s/point. 221 points ≈ 59 min: every
precompute run since 07-03 20:43Z died at its 30-min cap, and the same tail pushed the core ingest
into its 165-min cap (run 28747064567) even after the mid jobs moved to the pilots lane.

The resolver must treat empty-or-unset identically: fall back to the Netlify proxy default.
"""
import inspect
import os

from services.weather_pipeline.providers import open_meteo_provider
from services.weather_pipeline.providers.open_meteo_provider import (
    DEFAULT_WEATHER_PROXY_URL,
    resolve_weather_proxy_url,
)


def test_empty_string_env_falls_back_to_default(monkeypatch):
    """The CI failure mode: secret unset -> Actions injects '' -> must NOT be used as a URL."""
    monkeypatch.setenv("WEATHER_PROXY_URL", "")
    assert resolve_weather_proxy_url() == DEFAULT_WEATHER_PROXY_URL


def test_unset_env_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("WEATHER_PROXY_URL", raising=False)
    assert resolve_weather_proxy_url() == DEFAULT_WEATHER_PROXY_URL


def test_real_value_is_honored(monkeypatch):
    monkeypatch.setenv("WEATHER_PROXY_URL", "https://example.com/proxy")
    assert resolve_weather_proxy_url() == "https://example.com/proxy"


def test_call_sites_use_the_resolver_not_a_get_default():
    """Lock both proxied fetch paths (grid batch + single point) onto resolve_weather_proxy_url so a
    refactor can't reintroduce the `.get("WEATHER_PROXY_URL", default)` empty-string shadow."""
    src = inspect.getsource(open_meteo_provider)
    assert 'environ.get("WEATHER_PROXY_URL",' not in src, \
        ".get with a default resurrects the empty-secret shadow bug; use resolve_weather_proxy_url()"
    assert src.count("proxy_url = resolve_weather_proxy_url()") >= 2, \
        "both the grid-batch and single-point fetch paths must resolve via resolve_weather_proxy_url()"
