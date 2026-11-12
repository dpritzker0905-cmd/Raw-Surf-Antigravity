"""skill_ocf.py — an Operational-Consensus-Forecast style shadow, scored at the buoys (measurement only).

WHY (move 4, 2026-11-12). The served height trails its own source and every model reads low on 3 m+ days. The ledger already
scores a pooled linear MOS (`skill_mos`) and an equal/debiased/weighted mean (`skill_consensus`). Neither tests the method
operational centres actually use: OCF (Woodcock et al. 2007; Durrant et al. 2008, abstracts only) removes each member's
RECENT error, per site type, and only then averages with EQUAL weights. This block scores that on the same pairs, the same
held-out days, in one table, so the variants are comparable and nothing is cherry-picked:

  served         members[0], the raw served GFS lane
  equal          plain mean of GFS + EURO + ICON
  mos_served     the served lane through a pooled linear MOS (obs = a + b x), fit on rows older than the held-out week
  ocf_pooled     each member minus its mean error per lead (older rows), then the equal mean (== skill_consensus `debiased`)
  ocf_region     the same, bias per (member, lead, COAST); a coast with < MIN_TRAIN training pairs falls back to the pooled bias
  ocf_rolling    per (member, lead, coast) bias from errors OBSERVABLE at issue time only: pairs whose target hour is in
                 (t - lead - ROLL_DAYS, t - lead], so no row ever sees its own or a later observation; a thin window (< MIN_WINDOW
                 pairs) falls back to ocf_region

Equal weights after correction (D-006 rejected a skill-weighted mean for flattening big-swell peaks). Corrected forecasts are
clipped at 0. Pairs: (buoy, target hour, lead) where ALL members were scored. Held out by TIME (the last HOLDOUT_DAYS), never by
row. Intervals: a bootstrap over target DAYS (the correlated unit: nearby buoys share a day's weather) for the MAE gain over
served; `n_buoys` and `n_days` printed beside it. Big swell is reported BY OBSERVATION (paired, fair across variants) and BY
FORECAST (each variant's own >= 3 m calls). A group under MIN_TEST pairs prints its n and a status, never a number.

NOT available: station depth. Woodcock 2007 found raw models barely beat persistence at shallow sites (< 25 m); the ledger rows
carry no depth, so deep and shallow buoys cannot be split here (`depth_split` says so). Changes no served number; kill switch
FORECAST_SKILL_OCF=0 (read in forecast_skill.run_skill_ledger), and the off path adds nothing to the report.
"""
import bisect
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from services.weather_pipeline.skill_consensus import BIG_SWELL_M, MEMBERS, MIN_TEST, _ok, _stats, region_of
from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, MIN_TRAIN, _lead, _parse, fit_linear

ROLL_DAYS = 14
MIN_WINDOW = 20
BOOT_DRAWS = 400
BOOT_SEED = 20261112
VARIANTS = ("served", "equal", "mos_served", "ocf_pooled", "ocf_region", "ocf_rolling")
DEPTH_SPLIT = "unavailable: ledger rows carry no station depth (OCF literature: raw models barely beat persistence under 25 m)"


def _mean(xs):
    return sum(xs) / len(xs)


def _pairs(rows, now, members):
    keys: Dict[tuple, Dict[str, tuple]] = {}
    for r in rows or []:
        src = str(r.get("source"))
        if src not in members:
            continue
        x, y, t, lead = r.get("hs_m"), r.get("obs_hs_m"), _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if not (_ok(x) and _ok(y)) or x <= 0 or y < 0 or t is None or lead is None or t > now:
            continue
        keys.setdefault((r.get("buoy_id"), t, lead), {})[src] = (float(x), float(y))
    out: Dict[int, List[dict]] = {}
    for (buoy, t, lead), got in keys.items():
        if len(got) == len(members):
            out.setdefault(lead, []).append({"t": t, "buoy": buoy, "region": region_of(buoy), "obs": got[members[0]][1],
                                              "fc": {m: got[m][0] for m in members}})
    for lst in out.values():
        lst.sort(key=lambda p: (p["t"], str(p["buoy"])))
    return out


class _Rolling:
    """Prefix sums of each member's error over time-sorted pairs, per coast, for window means by bisect."""

    def __init__(self, pairs, members):
        self.members = members
        self.t: Dict[str, list] = {}
        self.cum: Dict[str, Dict[str, list]] = {}
        for p in pairs:
            r = p["region"]
            self.t.setdefault(r, []).append(p["t"])
            c = self.cum.setdefault(r, {m: [0.0] for m in members})
            for m in members:
                c[m].append(c[m][-1] + p["fc"][m] - p["obs"])

    def bias(self, region, lo, hi):
        """Mean error per member over targets in (lo, hi], and the pair count; None when the coast has no pairs."""
        ts = self.t.get(region)
        if not ts:
            return None, 0
        i, j = bisect.bisect_right(ts, lo), bisect.bisect_right(ts, hi)
        n = j - i
        if n <= 0:
            return None, 0
        return {m: (self.cum[region][m][j] - self.cum[region][m][i]) / n for m in self.members}, n


def _forecasts(lead, pairs, now, holdout_days, members):
    """Per held-out pair, every variant's forecast; plus training counts and how often each fallback fired."""
    cutoff = now - timedelta(days=holdout_days)
    train = [p for p in pairs if p["t"] < cutoff]
    test = [p for p in pairs if p["t"] >= cutoff]
    info = {"n_train": len(train), "n_test": len(test)}
    if len(train) < MIN_TRAIN or len(test) < MIN_TEST:
        return info, [], []
    pooled = {m: _mean([p["fc"][m] - p["obs"] for p in train]) for m in members}
    by_region: Dict[str, Dict[str, float]] = {}
    for region in {p["region"] for p in train}:
        grp = [p for p in train if p["region"] == region]
        if len(grp) >= MIN_TRAIN:
            by_region[region] = {m: _mean([p["fc"][m] - p["obs"] for p in grp]) for m in members}
    a, b = fit_linear([(p["fc"][members[0]], p["obs"]) for p in train])
    roll = _Rolling(pairs, members)
    fell_region = fell_window = 0
    out = []
    for p in test:
        fc = p["fc"]
        reg = by_region.get(p["region"])
        fell_region += reg is None
        reg = reg or pooled
        issue = p["t"] - timedelta(hours=lead)
        rb, n = roll.bias(p["region"], issue - timedelta(days=ROLL_DAYS), issue)
        if rb is None or n < MIN_WINDOW:
            fell_window += 1
            rb = reg
        v = {"served": fc[members[0]],
             "equal": _mean([fc[m] for m in members]),
             "mos_served": max(0.0, a + b * fc[members[0]]),
             "ocf_pooled": max(0.0, _mean([fc[m] - pooled[m] for m in members])),
             "ocf_region": max(0.0, _mean([fc[m] - reg[m] for m in members])),
             "ocf_rolling": max(0.0, _mean([fc[m] - rb[m] for m in members]))}
        out.append(v)
    info.update({"mos_a": round(a, 3), "mos_b": round(b, 3), "coasts_with_own_bias": sorted(by_region),
                 "fallback_to_pooled_bias": fell_region, "rolling_fallback_to_region_bias": fell_window})
    return info, test, out


def _grade(test, fcs, min_test: int) -> Dict:
    if len(test) < min_test:
        return {"n": len(test), "status": "insufficient"}
    obs = [p["obs"] for p in test]
    return {"n": len(test), "status": "scored",
            "variants": {k: _stats([f[k] - o for f, o in zip(fcs, obs)]) for k in VARIANTS}}


def _gain_interval(test, fcs, variant: str) -> Dict:
    """MAE gain over served (positive = better) with a bootstrap 95% interval over target DAYS."""
    days: Dict[str, list] = {}
    for p, f in zip(test, fcs):
        d = days.setdefault(p["t"].strftime("%Y-%m-%d"), [0.0, 0])
        d[0] += abs(f["served"] - p["obs"]) - abs(f[variant] - p["obs"])
        d[1] += 1
    vals = list(days.values())
    n = sum(c for _, c in vals)
    out = {"n_days": len(vals), "n_buoys": len({p["buoy"] for p in test}), "gain_m": round(sum(g for g, _ in vals) / n, 4)}
    if len(vals) >= 3:
        rng = random.Random(BOOT_SEED)
        means = []
        for _ in range(BOOT_DRAWS):
            draw = [vals[rng.randrange(len(vals))] for _ in vals]
            means.append(sum(g for g, _ in draw) / sum(c for _, c in draw))
        means.sort()
        out["ci95_m"] = [round(means[int(0.025 * BOOT_DRAWS)], 4), round(means[int(0.975 * BOOT_DRAWS) - 1], 4)]
    else:
        out["ci95_m"] = None
    return out


def _big(test, fcs, min_test: int) -> Dict:
    idx = [i for i, p in enumerate(test) if p["obs"] >= BIG_SWELL_M]
    out: Dict = {"threshold_m": BIG_SWELL_M, "paired_n": len(idx), "by_observation": {}, "by_forecast": {}}
    for k in VARIANTS:
        if len(idx) >= min_test:
            out["by_observation"][k] = _stats([fcs[i][k] - test[i]["obs"] for i in idx])
        sel = [fcs[i][k] - test[i]["obs"] for i in range(len(test)) if fcs[i][k] >= BIG_SWELL_M]
        out["by_forecast"][k] = {"n": len(sel), **(_stats(sel) if len(sel) >= min_test else {})}
    if len(idx) < min_test:
        out["status"] = "insufficient"
    return out


def ocf_report(rows, now: datetime, holdout_days: int = HOLDOUT_DAYS, min_test: int = MIN_TEST,
               members=MEMBERS) -> Dict:
    """PURE: the held-out OCF-style comparison over scored ledger rows (see the module docstring)."""
    from services.weather_pipeline.forecast_skill import obs_band      # lazy: forecast_skill imports this module
    by_lead, by_region, by_band = [], {}, {}
    scored_leads = 0
    verdict = {k: {"better_every_lead": True, "worse_regions": []} for k in VARIANTS if k != "served"}
    for lead, pairs in sorted(_pairs(rows, now, members).items()):
        info, test, fcs = _forecasts(lead, pairs, now, holdout_days, members)
        if not test:
            by_lead.append({"lead_h": lead, **info, "status": "insufficient"})
            continue
        scored_leads += 1
        grade = _grade(test, fcs, min_test)
        entry = {"lead_h": lead, **info, **grade,
                 "gain_over_served": {k: _gain_interval(test, fcs, k) for k in VARIANTS if k != "served"},
                 "big_swell": _big(test, fcs, min_test)}
        by_lead.append(entry)
        for k in verdict:
            if grade["variants"][k]["mae_m"] >= grade["variants"]["served"]["mae_m"]:
                verdict[k]["better_every_lead"] = False
        for region in sorted({p["region"] for p in test}):
            idx = [i for i, p in enumerate(test) if p["region"] == region]
            g = _grade([test[i] for i in idx], [fcs[i] for i in idx], min_test)
            by_region.setdefault(region, {})[str(lead)] = g
            if g["status"] == "scored":
                for k in verdict:
                    if g["variants"][k]["mae_m"] > g["variants"]["served"]["mae_m"] and f"{region}@{lead}" not in verdict[k]["worse_regions"]:
                        verdict[k]["worse_regions"].append(f"{region}@{lead}")
        for band in sorted({obs_band(p["obs"]) for p in test} - {None}):
            idx = [i for i, p in enumerate(test) if obs_band(p["obs"]) == band]
            by_band.setdefault(band, {})[str(lead)] = _grade([test[i] for i in idx], [fcs[i] for i in idx], min_test)
    if not scored_leads:
        verdict = {}
    else:
        for v in verdict.values():
            v["gate_met"] = bool(v["better_every_lead"] and not v["worse_regions"]
                                 and all(e.get("status") == "scored" for e in by_lead))
    return {"method": "ocf_style_bias_corrected_equal_mean", "members": list(members), "variants": list(VARIANTS),
            "holdout_days": holdout_days, "roll_days": ROLL_DAYS, "cutoff": (now - timedelta(days=holdout_days)).isoformat(),
            "depth_split": DEPTH_SPLIT, "by_lead": by_lead, "by_region": by_region, "by_band": by_band,
            "gate": verdict}
