#!/usr/bin/env python3
"""rework_net.py - the network resilience the 2026-11-04 rework scorecards share (rework_window.py,
rework_exposure_run.py): a retrying GET for the harness's cache and per-station truth isolation. Both keep the
harness's own network guard (eval_provenance.http_get does every request). Counts every retry and every loss."""
import os
import sys
import time
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import eval_provenance as pv  # noqa: E402

COUNT = {}


def bump(k, n=1):
    COUNT[k] = COUNT.get(k, 0) + n


def retrying_get(url, rng=None, **kw):
    """pv.http_get with backoff on throttling (S3 SlowDown 503, 429, CDIP THREDDS's transient 403 under load) and
    transient network errors: 7 tries over ~2 min. A 404 is never retried (a missing object is an answer)."""
    for i in range(7):
        try:
            return pv.http_get(url, rng=rng, **kw)
        except urllib.error.HTTPError as e:
            if e.code not in (403, 429, 500, 502, 503, 504) or i == 6:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == 6:
                raise
        bump("http_retry")
        time.sleep(min(2 ** i, 40))


def install_resilient_truth():
    """One station's truth failing (after retrying_get's retries) costs THAT station, not the window: it scores with
    no truth (no items) and the failure is recorded in truth.json's summary and COUNT. eval_harness.stage_truth raises
    on the first failing station otherwise."""
    from services.weather_pipeline import eval_reference as rf
    if getattr(rf.fetch_station, "_rework_resilient", False):
        return
    orig = rf.fetch_station

    def fetch_station(cache, station, window, ndbc_meta=None, with_spectra=True):
        try:
            return orig(cache, station, window, ndbc_meta, with_spectra)
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            bump("truth_unavailable_" + station["id"])
            return {"obs": [], "meta": {"version": f"unavailable: {type(e).__name__}: {e}"[:160]},
                    "extra": {"failed": [f"primary: {type(e).__name__}: {e}"[:200]]}, "records": []}
    fetch_station._rework_resilient = True
    rf.fetch_station = fetch_station
