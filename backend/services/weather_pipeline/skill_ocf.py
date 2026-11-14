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
FORECAST_SKILL_OCF=0 (read in forecast_skill.run_skill_ledger), and the off path adds nothing to the report. It runs inside the
FORECAST_SKILL_MOS gate, so FORECAST_SKILL_MOS=0 also turns it off.
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
EXPECTED_LEADS = (24, 48, 72)
# The buoys where the served point has no model cell of its own and falls back to the nearest ocean cell (the Fable
# per-buoy split's MEASURED_HOLES, backend/scripts/accuracy_per_buoy_split.py). 46267 alone reads +1.5 m high there, so a
# pooled gain can be that one buoy. `without_hole_buoys` reruns everything with them out (pre-registered rule R2).
HOLE_BUOYS = ("44090", "46254", "46267", "46274", "46285", "51201", "51206", "51208", "LJPC1")
DEPTH_SPLIT = "unavailable: ledger rows carry no station depth (OCF literature: raw models barely beat persistence under 25 m)"


def _mean(xs):
    return sum(xs) / len(xs)


def _pairs(rows, now, members, exclude=()):
    keys: Dict[tuple, Dict[str, tuple]] = {}
    skip = {str(b) for b in exclude}
    for r in rows or []:
        src = str(r.get("source"))
        if src not in members or (skip and str(r.get("buoy_id")) in skip):
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
               members=MEMBERS, expected_leads=EXPECTED_LEADS, exclude_buoys=()) -> Dict:
    """PURE: the held-out OCF-style comparison over scored ledger rows (see the module docstring).

    `exclude_buoys` drops those buoys from every pair (the hole-buoy sensitivity). Each region x lead also carries the
    day-block interval of its MAE gain over served, and the gate has a second flag `gate_met_ci` (pre-registered rule R1,
    log 2026-11-13-claude-move4-prereg): no region x lead is SIGNIFICANTLY worse (interval upper bound < 0) and the pooled
    gain's lower bound is > 0 at every lead. The point-based `gate_met` is unchanged."""
    from services.weather_pipeline.forecast_skill import obs_band      # lazy: forecast_skill imports this module
    by_lead, by_region, by_band = [], {}, {}
    scored_leads = 0
    verdict = {k: {"better_every_lead": True, "worse_regions": [], "significantly_worse_regions": [], "pooled_lower_positive_every_lead": True}
               for k in VARIANTS if k != "served"}
    for lead, pairs in sorted(_pairs(rows, now, members, exclude_buoys).items()):
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
            ci = entry["gain_over_served"][k].get("ci95_m")
            if not ci or ci[0] <= 0:
                verdict[k]["pooled_lower_positive_every_lead"] = False
        for region in sorted({p["region"] for p in test}):
            idx = [i for i, p in enumerate(test) if p["region"] == region]
            rt, rf = [test[i] for i in idx], [fcs[i] for i in idx]
            g = _grade(rt, rf, min_test)
            if g["status"] == "scored":
                g["gain_over_served"] = {k: _gain_interval(rt, rf, k) for k in verdict}
            by_region.setdefault(region, {})[str(lead)] = g
            if g["status"] == "scored":
                for k in verdict:
                    if g["variants"][k]["mae_m"] > g["variants"]["served"]["mae_m"] and f"{region}@{lead}" not in verdict[k]["worse_regions"]:
                        verdict[k]["worse_regions"].append(f"{region}@{lead}")
                    rci = g["gain_over_served"][k].get("ci95_m")
                    if rci and rci[1] < 0 and f"{region}@{lead}" not in verdict[k]["significantly_worse_regions"]:
                        verdict[k]["significantly_worse_regions"].append(f"{region}@{lead}")
        for band in sorted({obs_band(p["obs"]) for p in test} - {None}):
            idx = [i for i, p in enumerate(test) if obs_band(p["obs"]) == band]
            by_band.setdefault(band, {})[str(lead)] = _grade([test[i] for i in idx], [fcs[i] for i in idx], min_test)
    seen = {e["lead_h"] for e in by_lead}
    missing_leads = [l for l in expected_leads if l not in seen]
    if not scored_leads:
        verdict = {}
    else:
        for v in verdict.values():
            v["gate_met"] = bool(v["better_every_lead"] and not v["worse_regions"] and not missing_leads
                                 and all(e.get("status") == "scored" for e in by_lead))
            v["gate_met_ci"] = bool(v["pooled_lower_positive_every_lead"] and not v["significantly_worse_regions"]
                                    and not missing_leads and all(e.get("status") == "scored" for e in by_lead))
            v["note"] = ("a coast under the minimum n is not counted as worse; a lead with no complete member triplets blocks the gate; "
                         "gate_met_ci uses day-block intervals (R1), gate_met the point comparison")
    return {"method": "ocf_style_bias_corrected_equal_mean", "members": list(members), "variants": list(VARIANTS),
            "exclude_buoys": sorted({str(b) for b in exclude_buoys}),
            "holdout_days": holdout_days, "roll_days": ROLL_DAYS, "cutoff": (now - timedelta(days=holdout_days)).isoformat(),
            "depth_split": DEPTH_SPLIT, "by_lead": by_lead, "by_region": by_region, "by_band": by_band,
            "leads_scored": sorted(e["lead_h"] for e in by_lead if e.get("status") == "scored"),
            "expected_leads": list(expected_leads), "missing_leads": missing_leads, "gate": verdict}


# ── CONTROLS AND THE TIER SPLIT (move 4, 2026-11-12) ──────────────────────────────────────────────────
POS_DELTA_M = 0.30
SHADOW = "raw_surf:CONSENSUS"


def positive_control(rows, now: datetime, delta: float = POS_DELTA_M, holdout_days: int = HOLDOUT_DAYS,
                     min_test: int = MIN_TEST, members=MEMBERS) -> Dict:
    """PURE positive control: add a KNOWN constant bias `delta` to every forecast of the served lane (members[0]) in all
    rows, rerun the held-out scoring, and report per lead how far each variant's MAE and bias moved. A bias-removing
    variant must absorb it (MAE shift near 0, bias shift near 0); `served` must move by about `delta` in bias. If a
    variant that claims to remove bias does not, the block cannot be trusted."""
    shifted = []
    for r in rows or []:
        r2 = dict(r)
        if str(r2.get("source")) == members[0] and _ok(r2.get("hs_m")):
            r2["hs_m"] = float(r2["hs_m"]) + delta
        shifted.append(r2)
    base, bent = ocf_report(rows, now, holdout_days, min_test, members), ocf_report(shifted, now, holdout_days, min_test, members)
    out = []
    for a, b in zip(base["by_lead"], bent["by_lead"]):
        if a.get("status") != "scored" or b.get("status") != "scored":
            out.append({"lead_h": a.get("lead_h"), "status": "insufficient"})
            continue
        out.append({"lead_h": a["lead_h"], "status": "scored", "delta_m": delta,
                    "mae_shift": {k: round(b["variants"][k]["mae_m"] - a["variants"][k]["mae_m"], 4) for k in VARIANTS},
                    "bias_shift": {k: round(b["variants"][k]["bias_m"] - a["variants"][k]["bias_m"], 4) for k in VARIANTS}})
    return {"delta_m": delta, "by_lead": out}


def _gap_stats(pairs, flagged) -> Dict:
    g_in = [p["gap"] for p, f in zip(pairs, flagged) if f]
    g_out = [p["gap"] for p, f in zip(pairs, flagged) if not f]
    if not g_in or not g_out:
        return None
    return {"n_flagged": len(g_in), "n_rest": len(g_out), "mean_gap_flagged_m": round(_mean(g_in), 3),
            "mean_gap_rest_m": round(_mean(g_out), 3), "diff_m": round(_mean(g_in) - _mean(g_out), 3)}


def _buoy_null_and_ci(pairs, flagged, rng):
    """By-BUOY inference for the flagged-minus-rest mean gap (pre-registered rule R3). Rows cluster by buoy, so a row
    shuffle is the wrong null. (a) Null: each buoy keeps its pairs and gaps; the per-buoy FLAG sequences are randomly
    reassigned among buoys (a buoy given a sequence of another length reads it cyclically), so flags keep their
    within-buoy clustering and lose their link to the gaps. (b) Interval: bootstrap over buoys, keeping each buoy's pairs."""
    by_buoy: Dict[str, list] = {}
    for i, p in enumerate(pairs):
        by_buoy.setdefault(str(p["buoy"]), []).append(i)
    ids = sorted(by_buoy)
    if len(ids) < 3:
        return None, None
    seqs = [[flagged[i] for i in by_buoy[b]] for b in ids]
    gaps = [[pairs[i]["gap"] for i in by_buoy[b]] for b in ids]

    def diff(flag_seqs, gap_seqs):
        a = [g for fs, gs in zip(flag_seqs, gap_seqs) for f, g in zip(fs, gs) if f]
        b = [g for fs, gs in zip(flag_seqs, gap_seqs) for f, g in zip(fs, gs) if not f]
        return (_mean(a) - _mean(b)) if a and b else None

    null = []
    for _ in range(BOOT_DRAWS):
        order = list(range(len(ids)))
        rng.shuffle(order)
        shift = [rng.randrange(len(seqs[order[k]])) for k in range(len(ids))]
        shuffled = [[seqs[order[k]][(j + shift[k]) % len(seqs[order[k]])] for j in range(len(gaps[k]))] for k in range(len(ids))]
        d = diff(shuffled, gaps)
        if d is not None:
            null.append(d)
    boots = []
    for _ in range(BOOT_DRAWS):
        pick = [rng.randrange(len(ids)) for _ in ids]
        d = diff([seqs[k] for k in pick], [gaps[k] for k in pick])
        if d is not None:
            boots.append(d)
    null.sort()
    boots.sort()
    return ([round(null[int(0.025 * len(null))], 3), round(null[int(0.975 * len(null)) - 1], 3)] if len(null) >= 20 else None,
            [round(boots[int(0.025 * len(boots))], 3), round(boots[int(0.975 * len(boots)) - 1], 3)] if len(boots) >= 20 else None)


def hole_sensitivity(full: Dict, without: Dict) -> Dict:
    """PURE (pre-registered rule R2): per variant and lead, does the pooled MAE gain over served survive with the hole
    buoys out? `survives` = the gain's lower bound is still > 0; `driven_by_holes` = it was > 0 with them in and is <= 0
    with them out. A lead missing or unscored in either run reads None, never a verdict."""
    def lows(rep):
        return {e["lead_h"]: {k: (v.get("ci95_m") or [None])[0] for k, v in e.get("gain_over_served", {}).items()}
                for e in rep.get("by_lead", []) if e.get("status") == "scored"}
    a, b = lows(full), lows(without)
    out = {}
    for lead in sorted(set(a) | set(b)):
        row = {}
        for k in VARIANTS:
            if k == "served":
                continue
            fa, fb = a.get(lead, {}).get(k), b.get(lead, {}).get(k)
            if fa is None or fb is None:
                row[k] = None
            else:
                row[k] = {"lower_with_m": fa, "lower_without_m": fb, "survives": fb > 0, "driven_by_holes": bool(fa > 0 and fb <= 0)}
        out[str(lead)] = row
    return out


def tier_split_report(rows, now: datetime, members=MEMBERS, shadow: str = SHADOW, min_test: int = MIN_TEST,
                      since: Optional[datetime] = None, exclude_buoys=()) -> Dict:
    """PURE: where the built consensus shadow reads HIGH against the equal mean of its members, split by how many member
    lanes have an unknown serving tier (no stored product, direct-point path; the ledger row carries `tier` or nothing).

    Per lead: the signed mean of (shadow - equal) for pairs with >= 1 unknown-tier member vs the rest, and the difference
    `diff_m`. Controls on the SAME pairs: a random-row null (labels shuffled among the pairs, BOOT_DRAWS times; `diff_m`
    must sit inside `null_ci95_m` if the split means nothing), a day-block bootstrap interval on the observed difference,
    and a positive control (+POS_DELTA_M added to the shadow of the flagged pairs must come back as diff_m + POS_DELTA_M).
    A lead under min_test flagged or rest pairs prints its n and a status only. Measurement only; changes no served value."""
    need = tuple(members) + (shadow,)
    keys: Dict[tuple, Dict[str, tuple]] = {}
    skip = {str(x) for x in exclude_buoys}
    for r in rows or []:
        src = str(r.get("source"))
        if src not in need or (skip and str(r.get("buoy_id")) in skip):
            continue
        x, y, t, lead = r.get("hs_m"), r.get("obs_hs_m"), _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if not (_ok(x) and _ok(y)) or x <= 0 or y < 0 or t is None or lead is None or t > now or (since and t < since):
            continue
        keys.setdefault((r.get("buoy_id"), t, lead), {})[src] = (float(x), float(y), r.get("tier") or "unknown")
    by_lead: Dict[int, List[dict]] = {}
    for (buoy, t, lead), got in keys.items():
        if len(got) == len(need):
            eq = _mean([got[m][0] for m in members])
            by_lead.setdefault(lead, []).append({
                "t": t, "buoy": buoy, "gap": got[shadow][0] - eq, "n_unknown": sum(got[m][2] == "unknown" for m in members),
                "euro_unknown": got[members[1]][2] == "unknown" if len(members) > 1 else False})
    out = []
    for lead, pairs in sorted(by_lead.items()):
        pairs.sort(key=lambda p: (p["t"], str(p["buoy"])))
        flagged = [p["n_unknown"] >= 1 for p in pairs]
        entry = {"lead_h": lead, "n": len(pairs), "by_n_unknown": {
            str(k): {"n": sum(p["n_unknown"] == k for p in pairs),
                     **({"mean_gap_m": round(_mean([p["gap"] for p in pairs if p["n_unknown"] == k]), 3)}
                        if sum(p["n_unknown"] == k for p in pairs) >= min_test else {"status": "insufficient"})}
            for k in sorted({p["n_unknown"] for p in pairs})}}
        obs = _gap_stats(pairs, flagged)
        if not obs or obs["n_flagged"] < min_test or obs["n_rest"] < min_test:
            out.append({**entry, "status": "insufficient"})
            continue
        rng = random.Random(BOOT_SEED)
        null = []
        for _ in range(BOOT_DRAWS):
            lab = flagged[:]
            rng.shuffle(lab)
            null.append(_gap_stats(pairs, lab)["diff_m"])
        null.sort()
        days: Dict[str, list] = {}
        for p, f in zip(pairs, flagged):
            d = days.setdefault(p["t"].strftime("%Y-%m-%d"), [[], []])
            d[0 if f else 1].append(p["gap"])
        dl = list(days.values())
        boots = []
        for _ in range(BOOT_DRAWS):
            draw = [dl[rng.randrange(len(dl))] for _ in dl]
            a = [g for d in draw for g in d[0]]
            b = [g for d in draw for g in d[1]]
            if a and b:
                boots.append(_mean(a) - _mean(b))
        boots.sort()
        pos = _gap_stats([{**p, "gap": p["gap"] + (POS_DELTA_M if f else 0.0)} for p, f in zip(pairs, flagged)], flagged)
        buoy_null, buoy_ci = _buoy_null_and_ci(pairs, flagged, rng)
        entry.update({"status": "scored", **obs,
                      "buoy_null_ci95_m": buoy_null, "buoy_bootstrap_ci95_m": buoy_ci,
                      "supported": bool(buoy_null and buoy_ci and buoy_ci[0] > 0 and obs["diff_m"] > buoy_null[1]),
                      "null_ci95_m": [round(null[int(0.025 * BOOT_DRAWS)], 3), round(null[int(0.975 * BOOT_DRAWS) - 1], 3)],
                      "day_bootstrap_ci95_m": ([round(boots[int(0.025 * len(boots))], 3), round(boots[int(0.975 * len(boots)) - 1], 3)]
                                               if len(boots) >= 20 else None),
                      "n_days": len(dl), "n_buoys": len({p["buoy"] for p in pairs}),
                      "positive_control": {"injected_m": POS_DELTA_M, "diff_m": pos["diff_m"],
                                           "recovered_m": round(pos["diff_m"] - obs["diff_m"], 3)}})
        eu = [p["euro_unknown"] for p in pairs]
        if any(eu) and not all(eu):
            entry["euro_unknown_only"] = _gap_stats(pairs, eu)
        out.append(entry)
    return {"method": "shadow_minus_equal_by_unknown_member_tier", "shadow": shadow, "members": list(members),
            "since": since.isoformat() if since else None, "exclude_buoys": sorted(skip),
            "support_rule": "R3: buoy-cluster bootstrap interval excludes 0 AND diff_m exceeds the by-buoy permutation null's 97.5th percentile",
            "by_lead": out}


def ocf_block(history, now: datetime) -> Dict:
    """PURE: everything published as `forecast_skill_ocf`: the report, the controls, the tier split, and the hole-buoy
    sensitivity (pre-registered R2/R3: the same report and tier split with HOLE_BUOYS out). Bands and big-swell are dropped
    from the hole-buoy copy to keep the cached report small."""
    ocf = ocf_report(history, now)
    ocf["positive_control"] = positive_control(history, now)
    ocf["tier_split"] = tier_split_report(history, now)
    ex = ocf_report(history, now, exclude_buoys=HOLE_BUOYS)
    ex.pop("by_band", None)
    for e in ex.get("by_lead", []):
        e.pop("big_swell", None)
    ocf["without_hole_buoys"] = ex
    ocf["hole_sensitivity"] = hole_sensitivity(ocf, ex)
    ocf["tier_split_without_hole_buoys"] = tier_split_report(history, now, exclude_buoys=HOLE_BUOYS)
    return ocf
