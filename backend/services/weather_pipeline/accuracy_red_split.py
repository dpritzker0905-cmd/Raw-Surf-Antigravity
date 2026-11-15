"""D-072: the accuracy monitor's best_match RED split into three rules (owner approved 2026-11-15 16:14 EST, "Yes to all").

PURE (no I/O). One paired table per lead, built exactly as forecast_skill.head_to_head pairs (same buoy, target, lead
bucket AND the same verifying observation), then three rules instead of the one +0.10 m best_match RED:
  rule 1  same-model regression: ours vs `open_meteo:ncep_gfswave025` on the keys it scores;
  rule 2  hole buoys: ours vs `open_meteo_marine` (best_match) on the keys the same-model control CANNOT score;
  rule 3  best_match where both score: ours vs best_match on the keys the control also scores.
Each rule fires when, at a lead, the paired comparison is gradeable (n >= its floor) AND delta_m > its bound AND the win
rate is under 50% (the monitor's `_loses`). Bounds come from a basis window of replay days, never from the days graded.
Nothing here pages: the replay (scripts/accuracy_red_split_replay.py) decides whether the rules are fit to.
"""
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

OURS = "raw_surf"
BEST_MATCH = "open_meteo_marine"
SAME_MODEL = "open_meteo:ncep_gfswave025"
LEADS = (24, 48, 72)
WINDOW_DAYS = 7                 # the monitor's paired window (PAIRED_WINDOW_DAYS)
MIN_N = {1: 200, 2: 30, 3: 200}  # rule 1 and 3 keep the monitor's paired_min_n; the hole keys are ~10x fewer
BOUND_FACTOR = 1.24             # D-072's method: ~1.24x the worst gap in the basis window
BOUND_FLOOR_M = 0.03            # a basis max under +0.024 m would make a bound tighter than the noise floor


def _parse(v) -> Optional[datetime]:
    if not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def index_rows(rows: Iterable[dict]) -> Dict[str, Dict[tuple, dict]]:
    """{source: {(BUOY, target_time, lead_bucket): row}} for the three lanes, finite err_m only (head_to_head's rule)."""
    out = {OURS: {}, BEST_MATCH: {}, SAME_MODEL: {}}
    for r in rows or []:
        s = r.get("source")
        if s in out and _finite(r.get("err_m")):
            out[s][(str(r.get("buoy_id")).upper(), r.get("target_time"),
                    int(round((r.get("lead_h") or 0) / 24.0)))] = r
    return out


def _same_obs(a: dict, b: dict) -> bool:
    ha, hb = a.get("obs_hs_m"), b.get("obs_hs_m")
    if not (_finite(ha) and _finite(hb)) or ha != hb:
        return False
    sa, sb = a.get("obs_time"), b.get("obs_time")
    if isinstance(sa, str) and sa == sb:                 # the same string is the same instant; parse only if they differ
        return _parse(sa) is not None
    ta, tb = _parse(sa), _parse(sb)
    return (ta is not None and tb is not None and _finite(a.get("obs_hs_m")) and _finite(b.get("obs_hs_m"))
            and ta == tb and a.get("obs_hs_m") == b.get("obs_hs_m"))


def paired_keys(ours: dict, theirs: dict, keys: Iterable[tuple]) -> List[tuple]:
    return sorted(k for k in keys if k in ours and k in theirs and _same_obs(ours[k], theirs[k]))


def stat(keys: List[tuple], ours: dict, theirs: dict, seed_m: float = 0.0,
         swap: Optional[set] = None) -> Optional[dict]:
    """n, MAE ours / theirs, delta, win rate. seed_m: added to OUR |error| (the positive control). swap: keys whose
    lanes trade places (the null)."""
    if not keys:
        return None
    eo, et = [], []
    for k in keys:
        a, b = abs(ours[k]["err_m"]) + seed_m, abs(theirs[k]["err_m"])
        if swap and k in swap:
            a, b = b, a
        eo.append(a)
        et.append(b)
    n = len(keys)
    return {"n": n, "mae_ours": sum(eo) / n, "mae_theirs": sum(et) / n, "delta": (sum(eo) - sum(et)) / n,
            "win": sum(1 for a, b in zip(eo, et) if a < b) / n}


def by_day(idx: dict) -> dict:
    """{lane: {YYYY-MM-DD: [(target datetime, key, row)]}} so a window touches only its own days."""
    out = {}
    for s, rows in idx.items():
        lane = out.setdefault(s, {})
        for k, r in rows.items():
            t = _parse(k[1])
            if t is not None:
                lane.setdefault(f"{t:%Y-%m-%d}", []).append((t, k, r))
    return out


def window(idx: dict, now: datetime, days: int = WINDOW_DAYS, buckets: Optional[dict] = None) -> dict:
    """The lanes restricted to targets in [now - days, now], the monitor's `0 <= now - t <= 7 d`."""
    lo = now - timedelta(days=days)
    buckets = buckets if buckets is not None else by_day(idx)
    span = [f"{lo + timedelta(days=i):%Y-%m-%d}" for i in range(days + 2)]
    out = {}
    for s, lane in buckets.items():
        out[s] = {k: r for d in span for (t, k, r) in lane.get(d, ()) if lo <= t <= now}
    return out


def rule_stats(win: dict, seed_m: float = 0.0, swap_rng: Optional[random.Random] = None) -> Dict[Tuple[int, int], dict]:
    """{(rule, lead): stat} for one window. Rule 2's keys are best_match keys with NO same-model row (the holes);
    rule 3's are best_match keys the same-model control also has."""
    ours, bm, sm = win[OURS], win[BEST_MATCH], win[SAME_MODEL]
    out = {}
    for lead in LEADS:
        b = lead // 24
        r1 = paired_keys(ours, sm, (k for k in ours if k[2] == b))
        bm_keys = [k for k in ours if k[2] == b and k in bm]
        r2 = paired_keys(ours, bm, (k for k in bm_keys if k not in sm))
        r3 = paired_keys(ours, bm, (k for k in bm_keys if k in sm))
        for rule, keys, theirs in ((1, r1, sm), (2, r2, bm), (3, r3, bm)):
            swap = {k for k in keys if swap_rng.random() < 0.5} if swap_rng else None
            out[(rule, lead)] = stat(keys, ours, theirs, seed_m=seed_m if rule == 1 else 0.0, swap=swap)
    return out


def rule_pairs(win: dict) -> Dict[Tuple[int, int], List[Tuple[float, float]]]:
    """{(rule, lead): [(|ours err|, |their err|)]} for one window: the paired values a swap null re-signs."""
    ours, bm, sm = win[OURS], win[BEST_MATCH], win[SAME_MODEL]
    out = {}
    for lead in LEADS:
        b = lead // 24
        r1 = paired_keys(ours, sm, (k for k in ours if k[2] == b))
        bm_keys = [k for k in ours if k[2] == b and k in bm]
        r2 = paired_keys(ours, bm, (k for k in bm_keys if k not in sm))
        r3 = paired_keys(ours, bm, (k for k in bm_keys if k in sm))
        for rule, keys, theirs in ((1, r1, sm), (2, r2, bm), (3, r3, bm)):
            out[(rule, lead)] = [(abs(ours[k]["err_m"]), abs(theirs[k]["err_m"])) for k in keys]
    return out


def swap_null_fire_rates(daily_pairs: Dict[str, Dict[Tuple[int, int], List[Tuple[float, float]]]],
                         bounds: Dict[int, float], draws: int, seed: int) -> Dict[int, float]:
    """{rule: share of independent null draws in which the rule fires on >= 1 (day, lead)}. Every draw re-signs every
    pair on every day afresh (numpy; one sign matrix per day x cell, rows = draws)."""
    import numpy as np
    rng = np.random.default_rng(seed)
    fired = {r: np.zeros(draws, dtype=bool) for r in (1, 2, 3)}
    for day in sorted(daily_pairs):
        for (rule, _lead), pairs in sorted(daily_pairs[day].items()):
            n = len(pairs)
            if n < MIN_N[rule]:
                continue
            a = np.fromiter((p[0] for p in pairs), float, n)
            b = np.fromiter((p[1] for p in pairs), float, n)
            swap = rng.random((draws, n)) < 0.5
            delta = np.where(swap, b - a, a - b).sum(axis=1) / n
            win = np.where(swap, b < a, a < b).sum(axis=1) / n
            fired[rule] |= (delta > bounds[rule]) & (win < 0.50)
    return {r: float(f.mean()) for r, f in fired.items()}


def permute_leads(idx: dict, rng: random.Random) -> dict:
    """Diagnostic (not a null): within each (buoy, target), permute the lead labels JOINTLY across all lanes. Pairing
    survives, so a real gap that does not depend on lead (rule 2's hole buoys) still shows."""
    groups = {}
    for lane in idx.values():
        for k in lane:
            groups.setdefault((k[0], k[1]), set()).add(k[2])
    perm = {}
    for g, leads in groups.items():
        src = sorted(leads)
        dst = src[:]
        rng.shuffle(dst)
        perm[g] = dict(zip(src, dst))
    return {s: {(k[0], k[1], perm[(k[0], k[1])][k[2]]): r for k, r in lane.items()} for s, lane in idx.items()}


def bounds_from_basis(daily: Dict[str, Dict[Tuple[int, int], dict]], basis_days: List[str]) -> Dict[int, float]:
    """One bound per rule: BOUND_FACTOR x the worst gradeable delta over the basis days and all leads, floored."""
    out = {}
    for rule in (1, 2, 3):
        deltas = [s["delta"] for d in basis_days for (r, _), s in (daily.get(d) or {}).items()
                  if r == rule and s and s["n"] >= MIN_N[rule]]
        worst = max(deltas) if deltas else 0.0
        out[rule] = round(max(BOUND_FACTOR * worst, BOUND_FLOOR_M) + 0.0049, 2)   # round UP to the cm
    return out


def fires(s: Optional[dict], rule: int, bound: float) -> bool:
    return bool(s) and s["n"] >= MIN_N[rule] and s["delta"] > bound and s["win"] < 0.50
