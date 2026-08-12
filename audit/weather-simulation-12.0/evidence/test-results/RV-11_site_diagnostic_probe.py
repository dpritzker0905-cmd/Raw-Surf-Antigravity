# -*- coding: utf-8 -*-
"""RV-11 -- WHY is the GFS lane bad at the sites the EURO lane routes away from ECMWF?

RV-09 found the EURO advantage collapses from 36.7% to 2.9% once restricted to sites where EURO
actually served ECMWF. The other 26 of 60 sites carry the headline, and at those sites the GFS lane
scored 0.30-0.32 against its own 0.177 elsewhere. Two readings were open:

  (a) the served GFS lane is genuinely bad at a subset of sites  -> a real defect, high value
  (b) an artifact of scoring at BUOY coordinates instead of SPOT coordinates -> the finding dissolves

Neither was tested. This probe tests them by asking the SERVED payload what it is doing at each
site, instead of inferring from the score: provider, is_estimated, coverage_status, resolution,
fallback_reason. A lane serving an ESTIMATED product at those sites is (a) with a mechanism; a lane
serving a clean native product is evidence for (b).

Read-only. GFS + EURO only (120 requests, 6 concurrent), same panel as model_skill_census.
ASCII stdout only (cp1252).
"""
#
# ⛔⛔ CORRECTION, 2026-08-12 — MY FIRST VERSION OF THIS PROBE WAS INVALID AND ITS OUTPUT IS
# RETRACTED. It hand-rolled a `latest_obs` parser and took the FIRST 60 rows. `model_skill_census`
# does neither: it parses with `parse_latest_obs_waves` (documented column map + a `max_age_min`
# freshness gate) and then SORTS to spread the sample geographically, with the reason stated in
# its own source -- "the file's own order is regional, and a regional sample would score one
# basin's weather rather than the models". So my 60 buoys were a REGIONAL sample and its 60 were
# global: two different panels, and the "disagreement" I saw was my own selection, not a finding.
# The census's selection is now IMPORTED, not reimplemented -- the same rule its OBS_BANDS comment
# states, applied to the thing that actually bit.
#
import json
import os
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")
from scripts.model_skill_census import (                    # noqa: E402
    LATEST_OBS, parse_latest_obs_waves, _fetch as census_fetch,
)

BASE = "https://raw-surf-antigravity.onrender.com"
MODELS = ("GFS", "EURO")
FIELDS = ("upstream_provider", "is_estimated", "coverage_status", "resolution",
          "fallback_reason", "estimate_basis", "product_id", "stale")


def fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-audit-12.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def stations(limit, max_age_min=90.0):
    """EXACTLY the census's panel: same parser, same freshness gate, same geographic spread."""
    now = datetime.now(timezone.utc)
    st = parse_latest_obs_waves(census_fetch(LATEST_OBS), now, max_age_min)
    st.sort(key=lambda s: (round(s["lat"] / 10), round(s["lon"] / 10)))
    step = max(1, len(st) // limit)
    return st[::step][:limit]


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    vt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    vts = vt.strftime("%Y-%m-%dT%H:%M:%SZ")
    sample = stations(limit)
    print("probe at valid_time %s over %d buoys, GFS + EURO\n" % (vts, len(sample)))

    def one(job):
        st, m = job
        u = ("%s/api/weather/point?model=%s&domain=marine&layer=waves&lat=%s&lng=%s&valid_time=%s"
             % (BASE, m, st["lat"], st["lon"], vts))
        try:
            d = json.loads(fetch(u))
            return st["id"], m, {k: d.get(k) for k in FIELDS}
        except Exception as e:
            return st["id"], m, {"_error": str(e)[:60]}

    jobs = [(s, m) for s in sample for m in MODELS]
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(one, jobs))

    by = defaultdict(dict)
    for sid, m, d in res:
        by[sid][m] = d

    groups = defaultdict(list)
    for sid, d in by.items():
        if len(d) < 2:
            continue
        groups[(d["EURO"].get("upstream_provider") or "none")].append((sid, d))

    print("=" * 96)
    print("THE GFS LANE, GROUPED BY WHAT THE **EURO** LANE SERVED AT THE SAME SITE")
    print("=" * 96)
    print("%-26s %6s | %s" % ("EURO provider at the site", "sites", "what the GFS lane served there"))
    for prov, items in sorted(groups.items()):
        gp = defaultdict(int)
        est = sum(1 for _, d in items if d["GFS"].get("is_estimated"))
        cov = defaultdict(int)
        for _, d in items:
            gp[d["GFS"].get("upstream_provider") or "none"] += 1
            cov[d["GFS"].get("coverage_status") or "none"] += 1
        print("%-26s %6d | provider %s | GFS is_estimated %d/%d | coverage %s"
              % (prov, len(items), dict(gp), est, len(items), dict(cov)))

    print("\n" + "=" * 96)
    print("THE DISCRIMINATOR: is the GFS lane serving an ESTIMATED product where EURO leaves ecmwf?")
    print("=" * 96)
    away = [(sid, d) for sid, d in by.items() if len(d) == 2
            and (d["EURO"].get("upstream_provider") or "") != "ecmwf"]
    ecm = [(sid, d) for sid, d in by.items() if len(d) == 2
           and (d["EURO"].get("upstream_provider") or "") == "ecmwf"]
    for label, grp in (("EURO routed AWAY from ecmwf", away), ("EURO served by ecmwf", ecm)):
        if not grp:
            continue
        est = sum(1 for _, d in grp if d["GFS"].get("is_estimated"))
        res_null = sum(1 for _, d in grp if d["GFS"].get("resolution") is None)
        stale = sum(1 for _, d in grp if d["GFS"].get("stale"))
        print("  %-30s n=%2d | GFS is_estimated %d | GFS resolution null %d | GFS stale %d"
              % (label, len(grp), est, res_null, stale))

    print("\n  sample of 8 sites where EURO left ecmwf:")
    print("  %-8s %-22s %-12s %-22s %s" % ("buoy", "EURO provider", "GFS estim?", "GFS provider", "GFS coverage"))
    for sid, d in away[:8]:
        print("  %-8s %-22s %-12s %-22s %s"
              % (sid, d["EURO"].get("upstream_provider"), d["GFS"].get("is_estimated"),
                 d["GFS"].get("upstream_provider"), d["GFS"].get("coverage_status")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
