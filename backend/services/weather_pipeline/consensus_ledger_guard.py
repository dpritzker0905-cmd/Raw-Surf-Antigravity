"""consensus_ledger_guard.py - G1a: the consensus guard read from the skill ledger's SCORED rows. PURE, stdlib only.

WHY. The flag guardrail's replay is GFS-only by construction (eval_replay.replay_one rates with a literal "GFS"), so every
flag that acts inside the multi-model consensus build was BLIND to it. The skill ledger already scores the built
consensus as a shadow lane (`raw_surf:CONSENSUS`) beside the served lane (`raw_surf`) at the same buoys, hours and leads,
against the same verifying observation. This module judges a consensus flag on those rows: no replay, no GFS-only limit,
the consensus exactly as it would serve.

THE RULE (registered in the G1a PR before any number was read; the research lead's points 1-8 and rulings, 2026-11-18):
  * arm = SHADOW, reference = SERVED, paired as the ledger pairs them (`scored_rows_analysis.paired`: the same buoy,
    target hour and lead bucket AND the same verifying observation row for both arms);
  * per quantity two statistics, each a paired difference arm minus served:
      mae   |arm error| - |served error|   (mean = MAE(arm) - MAE(served) on the same pairs);
      bias  arm error - served error       (mean = the change in mean signed error: a level shift for Hs, a ROTATION for
                                            direction. MAE-type statistics are sign-blind; a steady rotation is a real
                                            failure even when the circular MAE barely moves);
    Hs errors are the ledger's signed `err_m`; direction errors are (forecast - observed MWD) wrapped to (-180, 180]
    degrees, on pairs whose observed Hs >= `DIR_MIN_OBS_HS_M` (the direction-skill module's filter);
  * window: the trailing `WINDOW_DAYS` complete UTC days (today excluded); leads +24/+48/+72 h;
  * strata: the tier class of the two non-GFS members (`tier_class`). Harm is decided per lead inside each STORED class;
    `any-unknown` (a member found no stored product: the known +48/+72 h shadow defect) is a COVERAGE alarm, never a fire;
  * FIRE when, in a stored class:
      - a pooled `mae` cell (n >= `POOLED_MIN_N`) has its CI lower bound above the pooled line, or
      - a basin `mae` cell (`skill_consensus.region_of`, n >= `BASIN_MIN_N`) exceeds the basin line after Holm across that
        class's basins x leads, or
      - a basin `bias` cell's |mean| exceeds the basin line after Holm (two-sided: the bound on the side of its sign);
    CI: a paired moving-block bootstrap over UTC days (`BLOCK_DAYS` consecutive days per block, circular), `REPS` draws,
    fixed `SEED`, two-sided 95 % (lower bound = the 2.5th percentile); Holm-adjusted p < 0.025. RESOLUTION: the smallest
    bootstrap p is 1/(REPS + 1), and Holm multiplies it by the number of basin x lead cells tested, so at 2,000 draws a
    class with 50 or more such cells could never fire a basin rule; the planted basin controls would then fail and the
    verdict reads VOID, not NO_FIRE;
  * CONTROLS, on the same items every run; any one misbehaving makes the verdict VOID (never a fire):
      null            arm := served: must not fire;
      shuffled-day    the null with its UTC-day labels permuted: must not fire;
      positives       sized to the line, not far above it (see `PLANTS`): each must fire, and a rotation or level shift
                      planted in one basin must be caught by the `bias` test itself.
    With too few pairs a positive cannot fire, so the verdict is VOID or INSUFFICIENT: a guard that could not have seen
    harm says so instead of reading "no harm".

AGGREGATES ONLY (the repo and its Actions logs are public). Nothing here returns, and `render` never prints, a buoy id, a
target time, a per-pair value or a window date. A cell under `SUPPRESS_N` pairs is reduced to {"suppressed"} at birth.
"""
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence

from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline import scored_rows_analysis as sra
from services.weather_pipeline.gate_v2_stats import holm
from services.weather_pipeline.skill_consensus import region_of
from services.weather_pipeline.skill_direction_period import DIR_MIN_OBS_HS_M

SERVED, SHADOW = sra.SERVED, sra.SHADOW
ICON, EURO = "raw_surf:ICON", "raw_surf:EURO"
LEADS = (24, 48, 72)
WINDOW_DAYS = 14
REPS = 2000
SEED = 20261118
BLOCK_DAYS = 3                 # ~ 14 ** (1/3), the usual n^(1/3) block length for a short daily series
LEVEL = 0.95
ALPHA_SIDE = (1.0 - LEVEL) / 2.0
SUPPRESS_N = 10
POOLED_MIN_N = 200
BASIN_MIN_N = 100
PLANT_SHARE = 0.15

HS, DIR = "hs", "dir"
MAE, BIAS = "mae", "bias"
LINES = {HS: (0.02, 0.05, "m"), DIR: (2.0, 5.0, "deg")}       # quantity: (pooled line, basin line, unit)
POOLED_LINE = {q: v[0] for q, v in LINES.items()}
BASIN_LINE = {q: v[1] for q, v in LINES.items()}
# Positive controls, sized to the lines (the lead's ruling): (name, kind, size, the statistic that must catch it or None).
#   share      +size added to the arm's |error| on a seeded PLANT_SHARE of pairs (15 % x 15 deg = +2.25 deg pooled)
#   amplitude  the arm's forecast scaled by (1 + size) on every pair
#   basin      +size added to the arm's signed error on every pair of the most-populated basin (a rotation / level shift)
PLANTS = {
    DIR: (("+15 deg on 15 %", "share", 15.0, None), ("+30 deg on 15 %", "share", 30.0, None),
          ("+6 deg rotation in one basin", "basin", 6.0, BIAS)),
    HS: (("+10 % amplitude", "amplitude", 0.10, None), ("+0.06 m level in one basin", "basin", 0.06, BIAS)),
}

UNKNOWN = "any-unknown"
FIRE, NO_FIRE, VOID, INSUFFICIENT = "FIRE", "NO_FIRE", "VOID", "INSUFFICIENT"


def wrap180(x: float) -> float:
    """An angle difference folded to (-180, 180]."""
    y = (x + 180.0) % 360.0 - 180.0
    return 180.0 if y == -180.0 else y


# ---- rows -> items ---------------------------------------------------------------------------------------------------
def tier_class(icon_row: Optional[dict], euro_row: Optional[dict]) -> str:
    """The stratum of one key, from the tiers the two non-GFS members answered from (skill_attribution.tier_of)."""
    tiers = [(r or {}).get("tier") for r in (icon_row, euro_row)]
    if not all(tiers):
        return UNKNOWN
    if all(t == "regional" for t in tiers):
        return "stored-regional"
    if all(t == "global_mid" for t in tiers):
        return "stored-global_mid"
    return "stored-mixed"


def window_days(now: datetime, days: int = WINDOW_DAYS) -> List[str]:
    """The trailing complete UTC days, oldest first (today, still incomplete, is excluded)."""
    today = now.astimezone(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(days, 0, -1)]


def items_from_rows(rows: Sequence[dict], now: datetime, days: int = WINDOW_DAYS) -> List[dict]:
    """Paired items inside the window. An item holds its UTC day, lead, basin, tier class, the observed Hs and the two
    arms' signed errors ({q: (arm, served)}); the buoy id and the target time are dropped here."""
    keep = set(window_days(now, days))
    members = sra._index(rows, (ICON, EURO))
    out = []
    for key, served, arm in sra.paired(rows, SERVED, SHADOW):
        t = fs._parse_iso(key[1])
        lead = key[2] * 24
        if t is None or lead not in LEADS or t.date().isoformat() not in keep:
            continue
        obs, mwd = served.get("obs_hs_m"), served.get("obs_mwd_deg")
        item = {"day": t.date().isoformat(), "lead": lead, "basin": region_of(key[0]),
                "tier": tier_class(members[ICON].get(key), members[EURO].get(key)), "obs": obs,
                HS: (arm["err_m"], served["err_m"])}
        if (fs._finite_number(arm.get("dir_deg")) and fs._finite_number(served.get("dir_deg"))
                and fs._finite_number(mwd) and obs >= DIR_MIN_OBS_HS_M):
            item[DIR] = (wrap180(arm["dir_deg"] - mwd), wrap180(served["dir_deg"] - mwd))
        out.append(item)
    return out


def diff(item: dict, q: str, stat: str) -> float:
    a, s = item[q]
    return (abs(a) - abs(s)) if stat == MAE else (a - s)


# ---- statistics ------------------------------------------------------------------------------------------------------
def _block_days(days: Sequence[str], rng: random.Random, block: int = BLOCK_DAYS) -> List[str]:
    """One circular moving-block resample of the ordered day list, as long as the original."""
    n = len(days)
    out: List[str] = []
    while len(out) < n:
        start = rng.randrange(n)
        out.extend(days[(start + j) % n] for j in range(min(block, n)))
    return out[:n]


def bootstrap(values_by_day: Dict[str, List[float]], line: float, two_sided: bool = False, reps: int = REPS,
              seed: int = SEED) -> Optional[dict]:
    """Paired moving-block bootstrap over UTC days of the mean. {n, delta, lo, hi, p}: p is the bootstrap share of draws
    on the near side of `line` (one-sided: <= line; two-sided magnitude: on the far side of +/-line from the point's
    sign), or None for an empty cell."""
    days = sorted(d for d, v in values_by_day.items() if v)
    n = sum(len(values_by_day[d]) for d in days)
    if not n:
        return None
    sums = {d: (sum(values_by_day[d]), len(values_by_day[d])) for d in days}
    point = sum(s for s, _ in sums.values()) / n
    rng = random.Random(seed)
    draws = []
    for _ in range(reps):
        tot, cnt = 0.0, 0
        for d in _block_days(days, rng):
            s, c = sums[d]
            tot += s
            cnt += c
        draws.append(tot / cnt)
    draws.sort()
    lo, hi = draws[int(ALPHA_SIDE * (reps - 1))], draws[int((1.0 - ALPHA_SIDE) * (reps - 1))]
    if two_sided and point < 0:
        p = (1 + sum(1 for x in draws if x >= -line)) / (reps + 1)
    else:
        p = (1 + sum(1 for x in draws if x <= line)) / (reps + 1)
    return {"n": n, "delta": point, "lo": lo, "hi": hi, "p": p}


def _by_day(items, q, stat) -> Dict[str, List[float]]:
    out: Dict[str, List[float]] = defaultdict(list)
    for it in items:
        if q in it:
            out[it["day"]].append(diff(it, q, stat))
    return out


def _public(cell: Optional[dict]) -> dict:
    """A cell as it may leave this module: suppressed under SUPPRESS_N, never with a per-pair value or its p."""
    if not cell or cell["n"] < SUPPRESS_N:
        return {"suppressed": True}
    return {k: cell[k] for k in ("n", "delta", "lo", "hi")}


def judge(items: Sequence[dict], q: str, reps: int = REPS, seed: int = SEED) -> dict:
    """One quantity on one set of items: per class, pooled and basin cells per lead for both statistics, the fire
    decision with which statistic fired, and the any-unknown coverage alarm. Pure and seed-determined."""
    pooled_line, basin_line, unit = LINES[q]
    by_class: Dict[str, List[dict]] = defaultdict(list)
    for it in items:
        if q in it:
            by_class[it["tier"]].append(it)
    classes, reasons, coverage, fired = {}, [], [], set()
    for cls in sorted(by_class):
        rows = by_class[cls]
        pooled = {stat: {} for stat in (MAE, BIAS)}
        basins = {stat: {} for stat in (MAE, BIAS)}
        for lead in LEADS:
            at = [it for it in rows if it["lead"] == lead]
            for stat in (MAE, BIAS):
                pooled[stat][lead] = bootstrap(_by_day(at, q, stat), pooled_line, stat == BIAS, reps, seed)
                for basin in sorted({it["basin"] for it in at}):
                    basins[stat][(basin, lead)] = bootstrap(_by_day([it for it in at if it["basin"] == basin], q, stat),
                                                            basin_line, stat == BIAS, reps, seed)
        if cls == UNKNOWN:
            for lead, c in pooled[MAE].items():
                if c and c["n"] >= POOLED_MIN_N and c["lo"] > pooled_line:
                    coverage.append(f"{cls} +{lead} h: MAE lower bound above the line (coverage alarm, not a kill)")
        else:
            for lead, c in pooled[MAE].items():
                if c and c["n"] >= POOLED_MIN_N and c["lo"] > pooled_line:
                    fired.add(MAE)
                    reasons.append(f"{cls} pooled +{lead} h: MAE change lower bound {c['lo']:+.3f} > {pooled_line:+.3f} "
                                   f"{unit} (n {c['n']})")
            for stat in (MAE, BIAS):
                tested = [(k, c) for k, c in basins[stat].items() if c and c["n"] >= BASIN_MIN_N]
                for ((basin, lead), c), pa in zip(tested, holm([c["p"] for _, c in tested]) if tested else []):
                    if pa < ALPHA_SIDE:
                        fired.add(stat)
                        what = "MAE change" if stat == MAE else "|mean signed error change|"
                        reasons.append(f"{cls} {basin} +{lead} h: {what} beyond {basin_line:.3f} {unit} after Holm "
                                       f"(n {c['n']}, {c['delta']:+.3f} [{c['lo']:+.3f}, {c['hi']:+.3f}])")
        classes[cls] = {stat: {"pooled": {lead: _public(c) for lead, c in pooled[stat].items()},
                               "basins": {f"{b} +{lead} h": _public(c) for (b, lead), c in sorted(basins[stat].items())}}
                        for stat in (MAE, BIAS)}
    decidable = any(sum(1 for it in v if it["lead"] == lead) >= POOLED_MIN_N
                    for cls, v in by_class.items() if cls != UNKNOWN for lead in LEADS)
    return {"fire": bool(fired), "fired": sorted(fired), "decidable": decidable, "reasons": reasons,
            "coverage": coverage, "classes": classes}


# ---- controls ----------------------------------------------------------------------------------------------------------
def null_items(items: Sequence[dict]) -> List[dict]:
    """arm := served: every difference is exactly 0."""
    return [dict(it, **{q: (it[q][1], it[q][1]) for q in (HS, DIR) if q in it}) for it in items]


def shuffled_day_items(items: Sequence[dict], seed: int = SEED) -> List[dict]:
    """The null with the UTC-day labels permuted across pairs (breaks the day blocks the bootstrap leans on)."""
    rng = random.Random(seed + 1)
    days = [it["day"] for it in items]
    rng.shuffle(days)
    return [dict(it, day=d) for it, d in zip(null_items(items), days)]


def busiest_basin(items: Sequence[dict], q: str) -> Optional[str]:
    c = Counter(it["basin"] for it in items if q in it and it["tier"] != UNKNOWN)
    return min(c, key=lambda b: (-c[b], b)) if c else None


def planted_items(items: Sequence[dict], q: str, kind: str, size: float, seed: int = SEED) -> List[dict]:
    """One positive control: the arm made worse by a known amount (see PLANTS)."""
    rng = random.Random(seed + 2)
    basin = busiest_basin(items, q)
    out = []
    for it in items:
        if q not in it:
            out.append(dict(it))
            continue
        a, s = it[q]
        if kind == "share":
            if rng.random() < PLANT_SHARE:
                a = a + size if a >= 0 else a - size          # |arm error| grows by exactly `size`
        elif kind == "amplitude":
            a = a + size * (it["obs"] + a)                     # arm forecast x (1 + size): error += size x forecast
        elif kind == "basin" and it["basin"] == basin:
            a = wrap180(a + size) if q == DIR else a + size
        out.append(dict(it, **{q: (a, s)}))
    return out


def verdict(items: Sequence[dict], q: str, reps: int = REPS, seed: int = SEED) -> dict:
    """The decision for one quantity with all its controls. VOID beats FIRE: a guard whose controls misbehave never
    acts; INSUFFICIENT when no stored pooled cell reaches POOLED_MIN_N."""
    main = judge(items, q, reps, seed)
    controls = {"null": not judge(null_items(items), q, reps, seed)["fire"],          # True = the control behaved
                "shuffled-day null": not judge(shuffled_day_items(items, seed), q, reps, seed)["fire"]}
    bad = [name for name, ok in controls.items() if not ok]
    for name, kind, size, must in PLANTS[q]:
        j = judge(planted_items(items, q, kind, size, seed), q, reps, seed)
        ok = j["fire"] and (must is None or must in j["fired"])
        controls[name] = ok
        if not ok:
            bad.append(name)
    if not main["decidable"]:
        state, why = INSUFFICIENT, [f"no stored pooled cell reached n {POOLED_MIN_N}"]
    elif bad:
        state, why = VOID, [f"control misbehaved: {', '.join(bad)} (nulls must stay quiet; every planted harm must "
                            f"be caught)"]
    elif main["fire"]:
        state, why = FIRE, list(main["reasons"])
    else:
        state, why = NO_FIRE, []
    return dict(main, state=state, why=why, controls=controls)


# ---- one run ---------------------------------------------------------------------------------------------------------
# Which ledger quantity judges which flag, and whether the guard may act on it (the research lead's ruling, 2026-11-18):
#   CONSENSUS_DIRECTION_VECTOR  moves the consensus DIRECTION only, so it is judged on direction; it is GUARDED, so a FIRE
#                               becomes a WORSE strike in flag_guardrail.decide (2 strikes over >= 24 h disable it);
#   CONSENSUS_SERVE             not GUARDED and explicitly '0' in every rating lane: its Hs cells are READINESS evidence
#                               (pre-flip; no kill path) and are never written to control/flags.json. The flip PR's
#                               precondition: SERVE joins runtime_flags.GUARDED and the lanes pass '' so the manifest
#                               decides; these same cells then become its kill rule unchanged.
FLAGS = {"CONSENSUS_DIRECTION_VECTOR": (DIR, "guard"), "CONSENSUS_SERVE": (HS, "readiness")}


def evaluate(rows: Sequence[dict], now: datetime, reps: int = REPS, seed: int = SEED) -> dict:
    items = items_from_rows(rows, now)
    return {flag: dict(verdict(items, q, reps, seed), quantity=q, role=role) for flag, (q, role) in FLAGS.items()}


def _cell(c: Optional[dict], unit: str) -> str:
    if not c or c.get("suppressed"):
        return "n<10"
    return f"n {c['n']}, {c['delta']:+.3f} [{c['lo']:+.3f}, {c['hi']:+.3f}]"


def render(report: dict) -> str:
    """Markdown for the job summary and the issue: aggregates only, never an id, a time or a per-pair value."""
    out = ["### Consensus guard from the scored ledger (G1a)", "",
           f"Arm `{SHADOW}` minus served `{SERVED}`, paired on the same observation; trailing {WINDOW_DAYS} complete UTC "
           f"days; moving-block bootstrap over days ({BLOCK_DAYS}-day blocks, {REPS} draws, fixed seed); Holm across "
           f"basins x leads. Positive = the arm is worse (MAE) or reads higher / rotated clockwise (bias).", ""]
    for flag, r in report.items():
        q = r["quantity"]
        unit = LINES[q][2]
        role = "READINESS (pre-flip; no kill path)" if r["role"] == "readiness" else "guard"
        ctl = ", ".join(f"{k} {'ok' if v else 'FAILED'}" for k, v in r["controls"].items())
        out += [f"**`{flag}`** ({role}; {'Hs' if q == HS else 'direction'}; lines {POOLED_LINE[q]} pooled / "
                f"{BASIN_LINE[q]} basin {unit}): **{r['state']}**. Controls: {ctl}."]
        out += [f"- {w}" for w in r["why"] + r["coverage"]]
        out += ["", f"| class | statistic ({unit}) | +24 h | +48 h | +72 h |", "|---|---|---|---|---|"]
        for cls, v in r["classes"].items():
            for stat in (MAE, BIAS):
                out.append(f"| {cls} | {stat} | " + " | ".join(_cell(v[stat]["pooled"].get(lead), unit)
                                                              for lead in LEADS) + " |")
        out.append("")
    return "\n".join(out) + "\n"
