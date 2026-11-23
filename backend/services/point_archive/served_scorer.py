"""The `served` purpose's scorer (gate served-wave-verify-v1 sections 7, 7a, 8, 10, 11). PURE: records, truth snapshots and
the buoy list in; score tables out. Only the CI scorer job feeds it raw records (section 9).

JOIN. Each `ok` record is collocated with the NDBC report nearest its valid time within +/- 30 min (qc.at_hour), per variable:
  waves rows       hs (WVHT), tp (DPD) or tm (APD) as the set serves, dir (MWD)
  partition rows   swell_1 -> SwH / SwP / SwD and wind_waves -> WWH / WWP / WWD from `.spec` (INDICATIVE: the model's and
                   NDBC's partitions are defined differently); swell_2 has no NDBC counterpart and is counted, not scored.
Directions only when the observed height of the same component is >= 0.3 m. The scorer's statuses go on the JOINED pair:
  no_obs (cause no_report: no report within +/- 30 min, or the field is MM; cause fetch_gap: no snapshot covered the time,
  i.e. no realtime2 fetch F with F - 45 d <= valid <= F) and buoy_qc_fail (cause range: outside the field's range; cause
  stuck). The raw record is never edited.

TABLES. Per window (30 and 90 days of valid time, ending at `asof`), per cell
  (tier class A = global_mid | B = a 0.25 deg regional box) x model x frame set x variable x lead bin x region (+ `all`)
  x stratum (exposed | sheltered | nearshore) x decoder_version x buoy_list_version:
  n, n_buoys, n_runs, mean_obs, bias = mean(f - o), rmse, si = rmse / mean(o) (heights and periods); for directions the
  circular error e = ((f - o + 180) mod 360) - 180, its mean absolute value and its circular mean.
  A cell needs n >= 100 pairs from >= 3 buoys and >= 10 distinct runs; below that it reads `insufficient` with n shown and
  no metric. Tiers, strata, decoder versions and list versions are never pooled. CDIP stations go to the separate `exam`
  table only. n >= 100 is a floor for SHOWING a number, not for inference (section 11).
"""
from __future__ import annotations

import math
from datetime import timedelta

from services.point_archive import core, qc

SCORER_VERSION = "served-wave-scorer/2"            # 2: LOCKED holdout excluded, holdout header (amendment 2)
TABLE_SCHEMA = "served-wave-verify-scores/1"
MIN_N, MIN_BUOYS, MIN_RUNS = 100, 3, 10
WINDOWS_DAYS = (30, 90)
REALTIME_DAYS = 45
DIR_VARS = ("dir", "swell_1.dir", "wind_waves.dir")
# partition -> (.spec height, period, direction) row keys; swell_2 has no NDBC counterpart
PARTITION_TRUTH = {"swell_1": ("swell_h_m", "swell_t_s", "swell_dir_deg"), "wind_waves": ("ww_h_m", "ww_t_s", "ww_dir_deg")}
INDICATIVE = "partition rows are INDICATIVE: model partitions and NDBC's SwH / WWH split are defined differently"


def circ_err(f, o):
    return ((f - o + 180.0) % 360.0) - 180.0


def _span(fetched, text, parser):
    """(first report time, fetch time) one snapshot covers: realtime2 holds 45 days for NDBC-run stations but only ~24 h for
    the ECCC stations NDBC mirrors, so the window is read from the snapshot itself, capped at REALTIME_DAYS."""
    f = core.parse_time(fetched)
    try:
        rows = parser(text)
    except ValueError:
        return f, f
    first = rows[0]["time"] if rows else f
    return max(first, f - timedelta(days=REALTIME_DAYS)), f


class Truth:
    """One station's merged truth: stdmet rows, spec rows, and each snapshot's covered span (for fetch_gap)."""

    def __init__(self, std_texts=(), spec_texts=()):
        self.std = qc.merge_snapshots(list(std_texts), qc.parse_stdmet) if std_texts else []
        self.spec = qc.merge_snapshots(list(spec_texts), qc.parse_spec) if spec_texts else []
        self.std_fetches = sorted(_span(f, t, qc.parse_stdmet) for f, t in std_texts)
        self.spec_fetches = sorted(_span(f, t, qc.parse_spec) for f, t in spec_texts)

    @staticmethod
    def covered(spans, when):
        """True when some snapshot's span holds `when`: a missing report there is `no_report`, not a fetch gap."""
        return any(lo - timedelta(minutes=qc.COLLOCATE_MIN) <= when <= hi for lo, hi in spans)


def _pair_status(rows, fetches, when, field, hs_field=None, need_hs=False):
    """(status, cause, obs value, obs row). status: ok | no_obs | buoy_qc_fail | low_hs (direction below 0.3 m)."""
    obs = qc.at_hour(rows, when)
    if obs is None:
        return "no_obs", ("no_report" if Truth.covered(fetches, when) else "fetch_gap"), None, None
    why = obs["qc"].get(field)
    if why == "missing":
        return "no_obs", "no_report", None, obs
    if why in ("range", "stuck"):
        return "buoy_qc_fail", why, None, obs
    if need_hs:
        h = obs.get(hs_field)
        if h is None or obs["qc"].get(hs_field) in ("range", "stuck") or h < qc.DIR_MIN_HS_M:
            return "low_hs", None, None, obs
    return "ok", None, obs[field], obs


def join(records, truth, stations):
    """Joined pairs [{key fields..., variable, f, o, status, cause}] for every record (sampler statuses other than ok
    become one pair-less census entry with variable None). `truth`: {station_id: Truth}; `stations`: {id: list row}."""
    out = []
    for r in records:
        if r.get("row_type") != "record":
            continue
        st = stations.get(r["station_id"])
        if st is None:
            continue
        key = {"model": r["model"], "frame_set": r["frame_set"], "tier": r["tier"],
               "tier_class": "A" if r["tier"] == "global_mid" else "B", "station_id": r["station_id"],
               "run_time": r["run_time"], "valid_time": r["valid_time"], "lead_h": r["lead_h"],
               "lead_bin": core.lead_bin(r["lead_h"]), "region": st["region"], "stratum": st["stratum"],
               "exam": bool(st["exam_only"]), "decoder_version": r.get("decoder_version"),
               "buoy_list_version": r.get("buoy_list_version")}
        if r["status"] != "ok":
            out.append({**key, "variable": None, "status": r["status"], "cause": r.get("cause")})
            continue
        t = truth.get(r["station_id"]) or Truth()
        when = core.parse_time(r["valid_time"])
        if r["frame_set"] == "waves":
            asks = [("hs", r.get("hs_m"), t.std, t.std_fetches, "hs_m", None, False)]
            if "tp_s" in r:
                asks.append(("tp", r["tp_s"], t.std, t.std_fetches, "tp_s", None, False))
            if "tm_s" in r:
                asks.append(("tm", r["tm_s"], t.std, t.std_fetches, "tm_s", None, False))
            if "dir_deg" in r:
                asks.append(("dir", r["dir_deg"], t.std, t.std_fetches, "dir_deg", "hs_m", True))
        else:
            p = (r.get("partitions") or [{}])[0]
            kind = r["frame_set"]
            if kind not in PARTITION_TRUTH:
                out.append({**key, "variable": f"{kind}.h", "status": "no_truth_partition", "cause": None})
                continue
            hf, tf, df = PARTITION_TRUTH[kind]
            asks = [(f"{kind}.h", p.get("h"), t.spec, t.spec_fetches, hf, None, False)]
            if "tp" in p:
                asks.append((f"{kind}.t", p["tp"], t.spec, t.spec_fetches, tf, None, False))
            if "dir" in p:
                asks.append((f"{kind}.dir", p["dir"], t.spec, t.spec_fetches, df, hf, True))
        for var, f, rows, fetches, field, hs_field, need_hs in asks:
            if f is None:
                continue
            status, cause, o, _obs = _pair_status(rows, fetches, when, field, hs_field, need_hs)
            out.append({**key, "variable": var, "status": status, "cause": cause, "f": f, "o": o})
    return out


def metrics(pairs, variable):
    n = len(pairs)
    if variable in DIR_VARS or variable.endswith(".dir"):
        e = [circ_err(p["f"], p["o"]) for p in pairs]
        s, c = math.fsum(math.sin(math.radians(x)) for x in e), math.fsum(math.cos(math.radians(x)) for x in e)
        return {"mae_deg": math.fsum(abs(x) for x in e) / n, "circ_mean_err_deg": math.degrees(math.atan2(s, c))}
    e = [p["f"] - p["o"] for p in pairs]
    mean_o = math.fsum(p["o"] for p in pairs) / n
    rmse = math.sqrt(math.fsum(x * x for x in e) / n)
    return {"bias": math.fsum(e) / n, "rmse": rmse, "mean_obs": mean_o, "si": (rmse / mean_o) if mean_o > 0 else None}


CELL_KEYS = ("tier_class", "model", "frame_set", "variable", "lead_bin", "region", "stratum", "decoder_version",
             "buoy_list_version")


def tables(pairs, min_n=MIN_N, min_buoys=MIN_BUOYS, min_runs=MIN_RUNS):
    """(main rows, exam rows) from joined pairs of ONE window. Each cell row: its keys, n, n_buoys, n_runs, status, metrics."""
    cells = {}
    for p in pairs:
        if p["status"] != "ok" or p["lead_bin"] is None:
            continue
        for region in (p["region"], "all"):
            k = tuple(p[c] if c != "region" else region for c in CELL_KEYS) + (p["exam"],)
            cells.setdefault(k, []).append(p)
    main, exam = [], []
    for k in sorted(cells, key=lambda x: tuple(str(v) for v in x)):
        ps = cells[k]
        row = dict(zip(CELL_KEYS, k[:-1]))
        row.update(n=len(ps), n_buoys=len({p["station_id"] for p in ps}), n_runs=len({p["run_time"] for p in ps}))
        if row["variable"].startswith(("swell_", "wind_waves")):
            row["indicative"] = True
        if row["n"] >= min_n and row["n_buoys"] >= min_buoys and row["n_runs"] >= min_runs:
            row.update(status="ok", **metrics(ps, row["variable"]))
        else:
            row["status"] = "insufficient"
        (exam if k[-1] else main).append(row)
    return main, exam


def census(pairs):
    """Every joined outcome counted per (model, frame set, tier): sampler statuses (variable None) and scorer statuses."""
    out = {}
    for p in pairs:
        k = (p["model"], p["frame_set"], p["tier"])
        label = p["status"] if p["variable"] is None else f"{p['variable']}:{p['status']}" + (
            f":{p['cause']}" if p.get("cause") else "")
        c = out.setdefault(k, {})
        c[label] = c.get(label, 0) + 1
    return [{"model": m, "frame_set": f, "tier": t, "counts": dict(sorted(c.items()))} for (m, f, t), c in sorted(out.items())]


def score(records, truth, buoy_doc, asof, windows=WINDOWS_DAYS, min_n=MIN_N, min_buoys=MIN_BUOYS, min_runs=MIN_RUNS,
          locked=frozenset(), locked_sha256=None):
    """The published score document for `asof` (UTC). `locked` (#1199's LOCKED ids, amendment 2): their records, truth and
    list rows are dropped BEFORE anything is joined, so no table, census or count reads them (the CLI already filtered
    them out on load; this is the second fence)."""
    from services.point_archive import buoys as buoylist
    locked = frozenset(str(i).upper() for i in locked)
    stations = {s["id"]: s for s in buoylist.stations(buoy_doc) if s["id"].upper() not in locked}
    records = [r for r in records if str(r.get("station_id", "")).upper() not in locked]
    truth = {k: v for k, v in truth.items() if str(k).upper() not in locked}
    asof_t = core.parse_time(asof)
    pairs = join(records, truth, stations)
    doc = {"schema": TABLE_SCHEMA, "scorer_version": SCORER_VERSION, "asof": core.iso_z(asof_t),
           "buoy_list_version": buoy_doc["version"], "buoy_list_hash": buoylist.list_hash(buoy_doc),
           "holdout": {"locked_list_sha256": locked_sha256, "locked_excluded": len(locked),
                       "fit_used_in_tables": sorted({s["id"] for s in stations.values() if s.get("fit_used")}) or None},
           "lead_bins": [f"[{lo},{hi})" for lo, hi in core.LEAD_BINS],
           "minimum": {"n": min_n, "buoys": min_buoys, "runs": min_runs}, "note": INDICATIVE,
           "use": "reading, the Truth/HUD diagnostics and later gates; NEVER consensus weighting (gate section 10)",
           "windows": {}}
    for w in windows:
        lo = asof_t - timedelta(days=w)
        sel = [p for p in pairs if lo < core.parse_time(p["valid_time"]) <= asof_t]
        main, exam = tables(sel, min_n, min_buoys, min_runs)
        doc["windows"][f"{w}d"] = {"from": core.iso_z(lo), "to": core.iso_z(asof_t), "tables": main, "exam": exam,
                                   "census": census(sel)}
    return doc
