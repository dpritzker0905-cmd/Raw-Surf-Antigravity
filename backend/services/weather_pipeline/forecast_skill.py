"""Forecast skill ledger — our accuracy at LEAD TIME, against reality and against a competitor.

WHY (owner, 2026-07-30): "test against reality and other surf forecast apps' data, to measure if
we're very wrong or near — we are trying to be more accurate than the competition." T+0 residuals
(the calibration loop) cannot answer that: the product a surfer judges is "will Thursday be good",
which is the +24/+48/+72h forecast. Per-lead skill is how the industry scores itself, and like the
residual archive it is unrecoverable — a forecast not recorded when it was made can never be
scored. So every calibration run:

  1. LEDGERS the forecasts being made NOW for +24/+48/+72h at every mapped buoy — ours (the same
     resolver the product serves from) and a competitor lane (Open-Meteo marine, one batched
     multi-coordinate call) — into `calibration/skill/pending.json`.
  2. SCORES pending rows whose target hour has arrived against THIS run's fresh buoy observations
     (truth), appending to monthly `calibration/skill/scored-YYYY-MM.json` segments (append-only,
     deduplicated, never pruned — same contract as the residual history).

The dedupe key keeps the EARLIEST forecast per (source, buoy, target, lead-bucket) — the honest
lead. Summary: per source x lead MAE/bias with n and n_buoys, so "are we near?" is a number, not
an impression. Kill switch FORECAST_SKILL=0; every failure is swallowed (the calibration loop is
never at risk). Rows are ~120 B; pending is capped, scored history is monthly-segmented.
"""
import json
import logging
import math
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SKILL_PENDING_L2_KEY = "calibration/skill/pending.json"
SKILL_SCORED_PREFIX = "calibration/skill/scored-"
LEADS_H = (24, 48, 72)
SCORE_JOIN_TOLERANCE_S = 90 * 60      # obs within 1.5h of the target hour scores it
PENDING_EXPIRY_H = 96                  # unmatched past-target rows drop (buoy gap)
# ⭐ SIZED FROM DEMAND, ARITHMETIC SHOWN (2026-08-08) — the last number here was a guess that killed
# the instrument. Steady-state pending = buoys x lanes x runs/day x Σ(lead_h/24)
# = 60 x 4 x 12 x (1+2+3) = 17,280 rows (simulated at production shape: 17,280 exactly, 2.05 MB
# compact). The old 10,000 sat UNDER demand from the 08-03 model fan-out onward, and with the old
# keep-latest eviction that read as scored=0 in production from 08-04T12:36Z — the platform's only
# lead-time accuracy number, dead for four days (MASTER-AUDIT-11.0 §3.1). 30,000 holds today's
# demand plus two more compare models (6 lanes -> 25,920) and bounds the object at ~3.6 MB; if it
# ever binds, that is itself a pathology signal, and `merge_pending`'s keep-earliest order confines
# the damage to the farthest lead instead of zeroing all three.
PENDING_MAX_ENTRIES = 30000
OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"

SOURCE_OURS = "raw_surf"
SOURCE_OM = "open_meteo_marine"
# ⭐ THE PERSISTENCE BASELINE (2026-08-09, MASTER-AUDIT-11.0 Phase 0). "Tomorrow = today" is the
# reference every operational centre scores against: a model that cannot beat persistence at a lead
# is not adding value at that lead, and WITHOUT this row the ledger's only reference is a
# competitor lane — which tells you who is better, never whether either is earning its keep.
# Zero extra requests: the forecast IS the buoy's current observation from the report the ledger
# already receives. Kill: FORECAST_SKILL_PERSISTENCE=0.
SOURCE_PERSISTENCE = "persistence"

# ⭐⭐⭐ SCORE EVERY MODEL WE COULD SERVE, NOT JUST THE ONE WE DO (2026-08-03).
# The ledger scored only `BUOY_CALIBRATION_MODEL` (default GFS) — which is also `/spot-ratings`'
# default — against Open-Meteo's best-match blend. Reading the archive for the first time, PAIRED on
# (buoy, target hour, lead) over 3,852 cells: ours MAE 0.304 m vs theirs 0.199 m, we win 35-43% of
# cells, at 42 of 59 buoys, with ~zero bias on BOTH sides. Scatter, not an offset a constant fixes.
# ★ Then the obvious question nobody had asked: is that a RAW-SURF gap or a GFS gap? Measured live
#   at 60 buoys, one hour, same coordinates and valid_time, 100% paired
#   (`scripts/model_skill_census.py`):
#       GFS  MAE 0.388   ICON MAE 0.324   EURO MAE 0.223   (EURO closest at 29 of 60 buoys)
#   and EURO wins EVERY observed-height band, worst for GFS on flat water (0.616 vs 0.263 — over-
#   reading a calm day is the app inventing surf). EURO lands on Open-Meteo's own number, which is
#   what you would expect if both are ECMWF.
# ⇒ The default-model decision is worth far more than any rating-constant tuning, and it must NOT be
#   made on one hour. This makes the ledger accumulate per-model skill continuously so the decision
#   is evidence, not a snapshot.
# ⚠️ COST, priced as a multiple (rule 21): each extra model is one more `calibrate_spots` per lead,
#   so the default here is 3x the ledger's resolve work. It runs in the CALIBRATION lane (GitHub
#   Actions: forecast-ingest.yml / precompute.yml), NOT on the 1-CPU serve box with the melt history.
#   Kill with FORECAST_SKILL_COMPARE_MODELS='' (empty restores the exact previous behaviour).
# ⚠️ ADDITIVE ON PURPOSE: the primary model keeps the bare `raw_surf` source so the existing archive
#   stays one continuous series. Comparison models get `raw_surf:MODEL`, so nothing already scored
#   changes meaning — a source rename would have silently split the history at today's date.
COMPARE_MODELS_DEFAULT = "ICON,EURO"


def compare_models(primary: str) -> List[str]:
    """Extra models to ledger beside `primary`, from FORECAST_SKILL_COMPARE_MODELS. Never includes
    the primary (that would double-count it under two source names)."""
    raw = os.environ.get("FORECAST_SKILL_COMPARE_MODELS", COMPARE_MODELS_DEFAULT)
    out = []
    for m in (raw or "").split(","):
        m = m.strip().upper()
        if m and m != (primary or "").strip().upper() and m not in out:
            out.append(m)
    return out


def source_for(model: str, primary: str) -> str:
    """`raw_surf` for the model we actually serve, `raw_surf:MODEL` for a comparison lane."""
    return SOURCE_OURS if (model or "").upper() == (primary or "").upper() else f"{SOURCE_OURS}:{model.upper()}"


def _parse_iso(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _lead_bucket(lead_h: float) -> int:
    return int(round(lead_h / 24.0))


def dedupe_key(row) -> tuple:
    return (row.get("source"), row.get("buoy_id"), row.get("target_time"),
            _lead_bucket(row.get("lead_h") or 0))


def rows_from_calibration_report(report, target_time: str, lead_h: float,
                                 source: str = SOURCE_OURS) -> List[dict]:
    """Our model's forecast rows for one target hour, from a calibrate_spots report resolved AT
    that hour. One row per distinct buoy; buoy obs fields in the report are ignored (they are
    today's sea, not the target's).

    ``source`` defaults to `raw_surf` so every existing caller is byte-identical; a comparison lane
    passes `raw_surf:MODEL` (see `source_for`)."""
    rows, seen = [], set()
    for entry in (report or {}).get("spots") or []:
        bid = entry.get("buoy_id")
        res = entry.get("residual") or {}
        hs = res.get("model_hs_m")
        if bid is None or bid in seen or hs in (None, 0.0):
            continue
        seen.add(bid)
        rows.append({"source": source, "buoy_id": bid, "target_time": target_time,
                     "lead_h": round(lead_h, 1), "hs_m": hs, "tp_s": res.get("model_tp_s")})
    return rows


def persistence_rows_from_report(report, now: datetime, leads_h=LEADS_H) -> List[dict]:
    """One persistence row per (buoy, lead): the forecast for now+lead is the buoy's CURRENT
    observation. One row per distinct buoy (spots share buoys), rows without a current observation
    are skipped — a persistence forecast from a dark buoy would be a fabrication."""
    rows, seen = [], set()
    for entry in (report or {}).get("spots") or []:
        bid = entry.get("buoy_id")
        obs = (entry.get("residual") or {}).get("buoy_wvht_m")
        if bid is None or bid in seen or not isinstance(obs, (int, float)):
            continue
        seen.add(bid)
        for lead in leads_h:
            target = (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00:00Z")
            rows.append({"source": SOURCE_PERSISTENCE, "buoy_id": bid, "target_time": target,
                         "lead_h": float(lead), "hs_m": obs,
                         "tp_s": (entry.get("residual") or {}).get("buoy_dpd_s")})
    return rows


def fetch_om_forecast_rows(buoys: Dict[str, tuple], now: datetime,
                           leads_h=LEADS_H, timeout: int = 60) -> List[dict]:
    """The competitor lane: ONE batched multi-coordinate Open-Meteo marine forecast call for every
    mapped buoy, sliced at each lead's target hour. `buoys` maps buoy_id -> (lat, lng)."""
    if not buoys:
        return []
    ids = list(buoys.keys())
    lats = ",".join(f"{buoys[b][0]:.4f}" for b in ids)
    lngs = ",".join(f"{buoys[b][1]:.4f}" for b in ids)
    url = (f"{OM_MARINE}?latitude={lats}&longitude={lngs}"
           f"&hourly=wave_height,swell_wave_period&forecast_days=4&timezone=UTC")
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-skill"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.load(r)
    if isinstance(payload, dict):
        payload = [payload]
    rows = []
    for bid, loc in zip(ids, payload):
        h = (loc or {}).get("hourly") or {}
        times, heights = h.get("time") or [], h.get("wave_height") or []
        periods = h.get("swell_wave_period") or []
        index = {t: i for i, t in enumerate(times)}
        for lead in leads_h:
            target = (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00")
            i = index.get(target)
            if i is None or i >= len(heights) or heights[i] is None:
                continue
            rows.append({"source": SOURCE_OM, "buoy_id": bid,
                         "target_time": target + ":00Z", "lead_h": float(lead),
                         "hs_m": heights[i],
                         "tp_s": periods[i] if i < len(periods) else None})
    return rows


def merge_pending(existing, incoming, now: Optional[datetime] = None,
                  max_entries: int = PENDING_MAX_ENTRIES,
                  stats: Optional[dict] = None) -> List[dict]:
    """Append forecasts, keeping the EARLIEST row per dedupe key (the honest lead) and dropping
    rows whose target passed more than PENDING_EXPIRY_H ago (a buoy gap nobody can score).

    ⚠️ THE CAP EVICTS THE FURTHEST-FUTURE TARGETS FIRST (2026-08-08). It used to keep them —
    `out[-max_entries:]` after the ascending sort — which evicts each row exactly as its target
    hour approaches, so once demand exceeded the cap NOTHING could ever score: production logged
    scored=0 on every run from 08-04T12:36Z (the pre-fan-out control 30839909407 was healthy).
    Keeping the EARLIEST targets makes overflow starve only the farthest lead — measured
    100/95.4/9.5% per lead at the old cap versus 0/0/0% — a degradation instead of an outage.
    `stats`, when given, is filled with {kept, expired, cap_evicted} so eviction is observable
    rather than invisible for four days again."""
    now = now or datetime.now(timezone.utc)
    horizon = now - timedelta(hours=PENDING_EXPIRY_H)
    out, seen = [], set()
    expired = 0
    for row in list(existing or []) + list(incoming or []):
        t = _parse_iso(row.get("target_time"))
        if t is None or t < horizon:
            expired += 1
            continue
        key = dedupe_key(row)
        if key in seen:
            continue          # first wins: existing rows precede incoming ⇒ earliest lead kept
        seen.add(key)
        out.append(row)
    out.sort(key=lambda r: (r.get("target_time") or "", r.get("source") or "", r.get("buoy_id") or ""))
    kept = out[:max_entries] if max_entries else out
    if stats is not None:
        stats.update(kept=len(kept), expired=expired, cap_evicted=len(out) - len(kept))
    return kept


def score_pending(pending, report, now: Optional[datetime] = None):
    """Split pending into (still_pending, scored): a row scores when THIS run's report holds a
    buoy observation within tolerance of its target hour."""
    now = now or datetime.now(timezone.utc)
    obs = {}
    for entry in (report or {}).get("spots") or []:
        bid = entry.get("buoy_id")
        res = entry.get("residual") or {}
        bt = _parse_iso(entry.get("buoy_time"))
        if bid is None or bt is None or res.get("buoy_wvht_m") is None:
            continue
        obs.setdefault(bid, []).append((bt, res.get("buoy_wvht_m"), res.get("buoy_dpd_s")))
    still, scored = [], []
    for row in pending or []:
        t = _parse_iso(row.get("target_time"))
        if t is None:
            continue
        candidates = obs.get(row.get("buoy_id")) or []
        best = None
        for bt, wvht, dpd in candidates:
            dt_s = abs((bt - t).total_seconds())
            if dt_s <= SCORE_JOIN_TOLERANCE_S and (best is None or dt_s < best[0]):
                best = (dt_s, bt, wvht, dpd)
        if best is not None:
            scored.append({**row,
                           "obs_time": best[1].isoformat(),
                           "obs_hs_m": best[2], "obs_dpd_s": best[3],
                           "err_m": round((row.get("hs_m") or 0.0) - best[2], 4)})
        elif t > now - timedelta(hours=PENDING_EXPIRY_H):
            still.append(row)
        # else: expired unmatched — dropped
    return still, scored


# ⭐⭐⭐ THE MEASUREMENT GATES EVERY ACCURACY DECISION (MASTER AUDIT 1.0 §8.1, 2026-08-03).
# The ledger reported BIAS and MAE and nothing else. That pair cannot answer the question the
# archive was built to settle: reading it for the first time gave ours MAE 0.304 vs Open-Meteo's
# 0.199 at ~ZERO BIAS ON BOTH SIDES — so the gap is SCATTER, and a scatter gap is invisible to the
# two numbers being reported. Every accuracy lever in the queue (Kr, the quantile map, H110, the
# default-model flip) is a constant chosen against a target this summary could not measure.
#
# These are the metrics operational wave centres verify on (Bidlot et al.; ECMWF/NOAA wave
# verification), and each answers a DIFFERENT failure:
#   rmse_m      penalises large misses — with bias ~0 this is the scatter, in metres
#   si          DE-BIASED scatter index = rms(err - bias) / mean(obs). The normalised standard;
#               it is the number that stays comparable across buoys of different sea state
#   corr        does the forecast move WITH the sea at all, or is it flat?
#   sym_slope   sqrt(sum f^2 / sum o^2) — amplitude ratio treating both axes symmetrically.
#               >1 over-reads, <1 under-reads. Unlike bias this survives a symmetric error.
#
# ★ THE REFUSAL (rule: a check that cannot tell "not sampled" from "broken" must REFUSE). Every
#   shape metric is None below `MIN_N_FOR_SHAPE` or on a degenerate denominator, never 0.0 — an
#   r of 1.0 from n=2 and an SI of 0.0 from mean_obs=0 are both indistinguishable from excellence.
# ★ `n` KEEPS ITS OLD MEANING (rows carrying `err_m`) so the existing archive stays one series;
#   `n_paired` is the count that the new metrics were actually computed over. When a row carries
#   `err_m` but not both sides, those two numbers differ — and that difference is the instrument
#   telling you it was starved rather than quietly averaging fewer points.
MIN_N_FOR_SHAPE = 10

# Bands chosen by what they mean to a surfer, not by equal counts: flat / small / rideable / big.
# ⚠️ CANONICAL HERE, imported by `scripts/model_skill_census.py`. A duplicated constant diverges
# only on a boundary, and this repo has already paid for seven copies of one (`e6d4b5b9`).
OBS_BANDS = ((0.0, 0.5, "flat <0.5m"), (0.5, 1.5, "small 0.5-1.5m"),
             (1.5, 3.0, "rideable 1.5-3m"), (3.0, 99.0, "big >3m"))


def obs_band(obs_m) -> Optional[str]:
    """The surfer-meaningful band an observation falls in, or None if it is not a number."""
    if not isinstance(obs_m, (int, float)):
        return None
    for lo, hi, label in OBS_BANDS:
        if lo <= obs_m < hi:
            return label
    return None


def verification_metrics(pairs) -> Optional[dict]:
    """Operational wave-verification metrics over (forecast_m, observed_m) pairs, or None if empty.

    Shape metrics (si/corr/sym_slope) are None rather than a number whenever they would be
    unstable or undefined — see MIN_N_FOR_SHAPE above for why that matters more than coverage."""
    fo = [(f, o) for f, o in (pairs or [])
          if isinstance(f, (int, float)) and isinstance(o, (int, float))]
    n = len(fo)
    if n == 0:
        return None
    fs = [f for f, _ in fo]
    obs = [o for _, o in fo]
    errs = [f - o for f, o in fo]
    mean_f, mean_o = sum(fs) / n, sum(obs) / n
    bias = mean_f - mean_o
    out = {
        "n_paired": n,
        "mean_obs_m": round(mean_o, 4), "mean_fc_m": round(mean_f, 4),
        "bias_m": round(bias, 4),
        "mae_m": round(sum(abs(e) for e in errs) / n, 4),
        "rmse_m": round(math.sqrt(sum(e * e for e in errs) / n), 4),
        "si": None, "corr": None, "sym_slope": None,
    }
    if n < MIN_N_FOR_SHAPE:
        return out
    if mean_o > 0:
        scatter = math.sqrt(sum((e - bias) ** 2 for e in errs) / n)
        out["si"] = round(scatter / mean_o, 4)
    df = [f - mean_f for f in fs]
    do = [o - mean_o for o in obs]
    den = math.sqrt(sum(x * x for x in df) * sum(y * y for y in do))
    if den > 0:
        out["corr"] = round(sum(x * y for x, y in zip(df, do)) / den, 4)
    sum_oo = sum(o * o for o in obs)
    if sum_oo > 0:
        out["sym_slope"] = round(math.sqrt(sum(f * f for f in fs) / sum_oo), 4)
    return out


def head_to_head(scored_rows, primary: str = SOURCE_OURS) -> List[dict]:
    """PAIRED comparison of `primary` against every other source, on the EXACT SAME
    (buoy_id, target_time, lead-bucket) keys.

    ⛔⛔ WHY THIS EXISTS — IT CAUGHT A FALSE ALARM, MINE, ON 2026-08-10. `skill_summary` groups each
    source INDEPENDENTLY, so its MAE column compares DIFFERENT POPULATIONS. Read across that column
    and the archive said `raw_surf` 0.268 vs `persistence` 0.206 — "we lose to the trivial
    baseline", which was reported as a finding. It is an artifact: `raw_surf` spanned 2,825 rows
    over 64 target times, `persistence` 374 rows over SEVEN, because `persistence_rows_from_report`
    only emits for buoys carrying a live observation. On the identical 374 keys we WIN, 0.183 vs
    0.206. The unpaired column had inverted the sign of the answer.

    ★★★ PARITY OF STATISTIC IS NOT PARITY OF POPULATION. A per-source MAE table invites a
    comparison it cannot support, so the comparison is computed here instead of left to the reader.

    Emits `n_ours_total` / `n_theirs_total` beside `n_paired` on purpose: when those three diverge
    the populations differ, which is exactly the condition that made the raw column misleading.
    `win_rate` is the fraction of paired keys where our absolute error is strictly smaller — a
    median-free view, because one storm can move an MAE and cannot move a win rate.
    """
    by_source: Dict[str, Dict[tuple, float]] = {}
    for r in scored_rows or []:
        e = r.get("err_m")
        if not isinstance(e, (int, float)):
            continue
        key = (r.get("buoy_id"), r.get("target_time"), _lead_bucket(r.get("lead_h") or 0))
        by_source.setdefault(r.get("source"), {})[key] = abs(e)

    ours = by_source.get(primary) or {}
    out = []
    for source in sorted(k for k in by_source if k != primary):
        theirs = by_source[source]
        for bucket in sorted({k[2] for k in ours} | {k[2] for k in theirs}):
            common = [k for k in ours if k[2] == bucket and k in theirs]
            if not common:
                continue
            n = len(common)
            mo = sum(ours[k] for k in common) / n
            mt = sum(theirs[k] for k in common) / n
            wins = sum(1 for k in common if ours[k] < theirs[k])
            out.append({
                "source": source, "lead_h": bucket * 24, "n_paired": n,
                "n_ours_total": sum(1 for k in ours if k[2] == bucket),
                "n_theirs_total": sum(1 for k in theirs if k[2] == bucket),
                "mae_ours_m": round(mo, 4), "mae_theirs_m": round(mt, 4),
                "delta_m": round(mo - mt, 4),
                "win_rate": round(wins / n, 4),
                "we_lose": mo > mt,
            })
    return out


def skill_summary(scored_rows) -> List[dict]:
    """Per source x lead-bucket: n, n_buoys, bias, MAE — plus RMSE / scatter index / correlation /
    symmetric slope, and the same metrics per observed-height band.

    ⚠️ A single MAE hides the SHAPE. Measured at 60 buoys, GFS's error was concentrated on FLAT
    seas (0.616 vs EURO's 0.263) — over-reading a calm day is the app inventing surf, and it is the
    error a surfer notices most while contributing least to the average."""
    groups: Dict[tuple, List[dict]] = {}
    for r in scored_rows or []:
        if not isinstance(r.get("err_m"), (int, float)):
            continue
        groups.setdefault((r.get("source"), _lead_bucket(r.get("lead_h") or 0)), []).append(r)
    out = []
    for (source, bucket), rows in sorted(groups.items()):
        errs = [r["err_m"] for r in rows]
        row = {"source": source, "lead_h": bucket * 24, "n": len(errs),
               "n_buoys": len({r.get("buoy_id") for r in rows}),
               "bias_m": round(sum(errs) / len(errs), 4),
               "mae_m": round(sum(abs(e) for e in errs) / len(errs), 4)}
        pairs = [(r.get("hs_m"), r.get("obs_hs_m")) for r in rows]
        metrics = verification_metrics(pairs)
        if metrics:
            # `bias_m`/`mae_m` above are computed from `err_m` and stay authoritative; the paired
            # recomputation only ADDS fields, so a row missing one side cannot change the series.
            row.update({k: v for k, v in metrics.items() if k not in ("bias_m", "mae_m")})
            bands = {}
            for lo, hi, label in OBS_BANDS:
                sub = [(r.get("hs_m"), r.get("obs_hs_m")) for r in rows
                       if obs_band(r.get("obs_hs_m")) == label]
                m = verification_metrics(sub)
                if m:
                    bands[label] = m
            if bands:
                row["by_obs_band"] = bands
        out.append(row)
    return out


async def run_skill_ledger(store, resolver, spots, model: str, report,
                           now: Optional[datetime] = None) -> Optional[dict]:
    """The wired entry point (guarded by the caller): ledger new forecasts, score arrivals.
    Returns {"ledgered": n, "scored": n, "summary": [...]} or None when disabled."""
    if os.environ.get("FORECAST_SKILL", "1") == "0":
        return None
    from services.weather_pipeline.buoy_calibration import (
        calibrate_spots, fetch_ndbc_station_coords, load_calibration_l2, upload_calibration_l2,
    )
    now = now or datetime.now(timezone.utc)
    incoming: List[dict] = []
    # The served model first, then any comparison models — each is an INDEPENDENT source, so one
    # model failing a lead never removes another's row. See COMPARE_MODELS_DEFAULT for the cost.
    for mdl in [model] + compare_models(model):
        src = source_for(mdl, model)
        for lead in LEADS_H:
            target = (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00:00Z")
            try:
                lead_report = await calibrate_spots(resolver, spots, mdl, target)
                incoming.extend(rows_from_calibration_report(lead_report, target, lead, source=src))
            except Exception as e:
                logger.warning("[forecast-skill] %s lead +%dh resolve failed (%s)", src, lead, e)
    if os.environ.get("FORECAST_SKILL_PERSISTENCE", "1") != "0":
        incoming.extend(persistence_rows_from_report(report, now))
    try:
        coords = await fetch_ndbc_station_coords()
        buoys = {}
        for entry in (report or {}).get("spots") or []:
            bid = entry.get("buoy_id")
            if bid and bid in coords and bid not in buoys:
                buoys[bid] = coords[bid]
        incoming.extend(fetch_om_forecast_rows(buoys, now))
    except Exception as e:
        logger.warning("[forecast-skill] competitor lane failed (%s)", e)

    pending = load_calibration_l2(SKILL_PENDING_L2_KEY) or []
    merge_stats: Dict[str, int] = {}
    pending = merge_pending(pending, incoming, now=now, stats=merge_stats)
    still, scored = score_pending(pending, report, now=now)
    upload_calibration_l2(store, still, SKILL_PENDING_L2_KEY)
    if scored:
        month_groups: Dict[str, List[dict]] = {}
        for r in scored:
            t = _parse_iso(r.get("target_time"))
            month_groups.setdefault(t.strftime("%Y-%m"), []).append(r)
        for month, rows in month_groups.items():
            key = f"{SKILL_SCORED_PREFIX}{month}.json"
            existing = load_calibration_l2(key) or []
            seen = {dedupe_key(r) for r in existing}
            fresh = [r for r in rows if dedupe_key(r) not in seen]
            if fresh:
                upload_calibration_l2(store, existing + fresh, key)
    summary = skill_summary(scored)
    # ⚠️ The `ledgered=%d scored=%d` prefix is an operator surface: it is the string the Actions-log
    # grep dated the 08-04 outage with. Append fields, never reorder it.
    logger.info("[forecast-skill] ledgered=%d scored=%d pending=%d evicted_cap=%d %s",
                len(incoming), len(scored), len(still), merge_stats.get("cap_evicted", 0),
                summary if summary else "")
    return {"ledgered": len(incoming), "scored": len(scored),
            "pending_kept": len(still), "pending_evicted_cap": merge_stats.get("cap_evicted", 0),
            "summary": summary}


def attach_to_report(report, skill) -> None:
    """Write the skill block onto the calibration report. PRESENT-BUT-EMPTY IS DELIBERATE:
    with the old `if skill.get("summary")` guard, scored=0 for four days (08-04 -> 08-08) was
    byte-identical on the wire to "the ledger never ran", so the outage was only datable from CI
    logs. `forecast_skill` keeps its existing shape (a list); `forecast_skill_ops` carries the
    counts — `pending_evicted_cap` > 0 is the early signal the last starvation never gave."""
    if report is None or skill is None:
        return
    report["forecast_skill"] = skill.get("summary") or []
    report["forecast_skill_ops"] = {k: skill.get(k) for k in
                                    ("ledgered", "scored", "pending_kept", "pending_evicted_cap")}
