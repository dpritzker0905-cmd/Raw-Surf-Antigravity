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
      bias  |served bias + shift| - |served bias|, with shift = the paired mean of (arm - served) and served bias =
                                            the served lane's mean signed error against the OBSERVATION over the window
                                            (a level for Hs, a circular-mean rotation for direction). It is the growth of
                                            |bias| the arm causes; MAE-type statistics are sign-blind, so a steady rotation
                                            is caught here. CORRECTED 2026-11-19 on the advisor's HOLD, before any real
                                            row was read: the registered rule was the two-sided mean of (arm - served),
                                            which FIRES on an improvement (served +8 deg, arm +1 deg reads -7). Now only
                                            a LARGER absolute bias, one-sided, can fire. The bootstrap varies the paired
                                            shift and holds the served bias at its window value: re-drawing |served bias|
                                            itself put a kink at zero that cut the power of every planted control);
    Hs errors are the ledger's signed `err_m`; direction errors are (forecast - observed MWD) wrapped to (-180, 180]
    degrees, on pairs whose observed Hs >= `DIR_MIN_OBS_HS_M` (the direction-skill module's filter). Direction errors are
    never subtracted pair by pair (+175 against -175 is a 10-degree rotation, not 350): bias uses circular means;
  * window: the trailing `WINDOW_DAYS` complete UTC days (today excluded); leads +24/+48/+72 h;
  * strata: four REPORTING classes from the two non-GFS members' tiers (`tier_class`: stored-regional, stored-global_mid,
    stored-mixed, any-unknown), each printed with its n. The DECISION rows are the spec's (`DECIDE`): +24 h decides on
    stored-regional; +48/+72 h on stored-global_mid and stored-mixed together. any-unknown (a member found no stored
    product: the known +48/+72 h shadow defect) is a COVERAGE alarm only;
  * FIRE when, on a lead's decision rows:
      - pooled `mae` (n >= `POOLED_MIN_N`) beyond the pooled line, Holm across the leads that reach n (one family), or
      - a basin `mae` (`skill_consensus.region_of`, n >= `BASIN_MIN_N`) beyond the basin line, or a basin `bias` growth
        beyond it (one-sided, worse only), Holm across that lead's basins (one family per statistic x lead);
    p: a paired moving-block bootstrap over UTC days (`BLOCK_DAYS` consecutive days per block, circular), `REPS` draws,
    fixed `SEED`: the share of draws on the near side of the line. Holm-adjusted p < 0.025. CIs are 95 % two-sided;
  * RESOLUTION, checked every run: the smallest bootstrap p is 1/(REPS + 1); a family of m tests is resolved only when
    1/(REPS + 1) <= 0.025 / (m x `RESOLUTION_HEADROOM`), ten times below Holm's smallest threshold. Otherwise the verdict
    reads UNDER_RESOLVED ("raise B"), never VOID and never NO_FIRE; m, B and the floor are printed;
  * CONTROLS, on the same items every run; a misbehaving control makes the verdict VOID (never a fire):
      null            arm := served: must not fire. A null that fires is ALWAYS VOID: under-resolution never excuses it;
      shuffled-day    the null with its UTC-day labels permuted: must not fire (same rule);
      swap            the NOISY null: arm and served swap places on a seeded half of the days, keeping the data's real
                      noise and removing any one-way harm: must not fire (same rule). The two exact nulls only check the
                      plumbing; this one is what bounds a false strike on real noise;
      positives       `PLANTS`, sized with margin (2 x, and the +10 % Hs amplitude) and to the line (1.2 x). Each 2 x plant
                      must fire on every run, a rotation or level shift in one basin by the `bias` test itself; a miss is
                      VOID, or UNDER_RESOLVED when a family cannot fire at this B. The 1.2 x plants are REPORTED each run
                      (a miss on noise is expected about 1 run in 5) and their detection rate is pinned on synthetic rows
                      over 20 seeds (tests): >= 80 % for the 1.2 x plants, 100 % for the 2 x plants; the guardrail
                      prints their rolling rate over its recent runs.
    With too few pairs a positive cannot fire, so the verdict is INSUFFICIENT or VOID: a guard that could not have seen
    harm says so instead of reading "no harm".

AGGREGATES ONLY (the repo and its Actions logs are public). Nothing here returns, and `render` never prints, a buoy id, a
target time, a per-pair value or a window date. A cell under `SUPPRESS_N` pairs is reduced to {"suppressed"} at birth.
"""
import math
import random
from collections import Counter
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
REPS = 10000                   # the lead's ruling: CPU-only on aggregates, cheap in Actions
RESOLUTION_HEADROOM = 10
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
UNKNOWN = "any-unknown"
CLASSES = ("stored-regional", "stored-global_mid", "stored-mixed", UNKNOWN)
DECIDE = {24: frozenset({"stored-regional"}), 48: frozenset({"stored-global_mid", "stored-mixed"}),
          72: frozenset({"stored-global_mid", "stored-mixed"})}
# Positive controls (the lead's rulings): (name, kind, size, the statistic that must catch it or None).
#   share      +size added to the arm's |error| on a seeded PLANT_SHARE of pairs (15 % x 15 deg = +2.25 deg pooled)
#   amplitude  the arm's forecast scaled by (1 + size) on every pair
#   basin      in the busiest decision basin, the arm's error := the served error pushed `size` further from zero, in the
#              direction of the served lane's bias there (a known growth of |bias| by `size`: a rotation / level)
PLANTS = {
    DIR: (("+15 deg on 15 % (1.2x)", "share", 15.0, None), ("+30 deg on 15 % (2x)", "share", 30.0, None),
          ("+6 deg rotation in one basin (1.2x)", "basin", 6.0, BIAS),
          ("+10 deg rotation in one basin (2x)", "basin", 10.0, BIAS)),
    HS: (("+10 % amplitude", "amplitude", 0.10, None), ("+0.06 m level in one basin (1.2x)", "basin", 0.06, BIAS),
         ("+0.10 m level in one basin (2x)", "basin", 0.10, BIAS)),
}

REPORTED_ONLY = "(1.2x)"       # plants sized at 1.2x the line: reported each run, never a per-run VOID (the lead's FIX 2)
FIRE, NO_FIRE, VOID, INSUFFICIENT, UNDER_RESOLVED ="FIRE", "NO_FIRE", "VOID", "INSUFFICIENT", "UNDER_RESOLVED"


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


# ---- statistics ------------------------------------------------------------------------------------------------------
def _block_days(days: Sequence[str], rng: random.Random, block: int = BLOCK_DAYS) -> List[str]:
    """One circular moving-block resample of the ordered day list, as long as the original."""
    n = len(days)
    out: List[str] = []
    while len(out) < n:
        start = rng.randrange(n)
        out.extend(days[(start + j) % n] for j in range(min(block, n)))
    return out[:n]


def _circ_deg(s: float, c: float) -> float:
    """The circular mean angle (degrees, in (-180, 180]) of a set summarised by its sine and cosine sums."""
    return wrap180(math.degrees(math.atan2(s, c))) if (s or c) else 0.0


def _agg(it: dict, q: str, stat: str) -> tuple:
    """One pair's contribution to a day's sums; the last entry is always the count.
      mae         (|a| - |s|, 1)
      bias, Hs    (a - s, s, 1)
      bias, dir   (sin(a-s), cos(a-s), sin s, cos s, 1)    the pair's ROTATION a - s is formed on the circle, so +175
                                                           against -175 is a -10 degree rotation, never 350."""
    a, s = it[q]
    if stat == MAE:
        return (abs(a) - abs(s), 1)
    if q == DIR:
        rd, rs = math.radians(a - s), math.radians(s)
        return (math.sin(rd), math.cos(rd), math.sin(rs), math.cos(rs), 1)
    return (a - s, s, 1)


def _stat(acc: tuple, q: str, stat: str, total: tuple) -> float:
    """mae: the mean of |a| - |s|. bias: the growth of the served lane's |bias| caused by the arm's paired shift,
    |served bias + shift| - |served bias|. The shift comes from `acc` (one bootstrap draw); the served bias is the
    full-window point estimate from `total`, so the bootstrap varies only the low-noise paired shift. Positive = the
    arm's bias is further from zero than the served lane's (worse); an arm that pulls the bias toward zero reads
    negative (served +8 deg, arm +1 deg: shift -7, growth -7)."""
    n = acc[-1]
    if stat == MAE:
        return acc[0] / n
    if q == DIR:
        served = _circ_deg(total[2], total[3])
        return abs(wrap180(served + _circ_deg(acc[0], acc[1]))) - abs(served)
    served = total[1] / total[-1]
    return abs(served + acc[0] / n) - abs(served)


def _by_day(items, q, stat) -> Dict[str, tuple]:
    out: Dict[str, list] = {}
    for it in items:
        if q in it:
            v = _agg(it, q, stat)
            acc = out.setdefault(it["day"], [0.0] * len(v))
            for i, x in enumerate(v):
                acc[i] += x
    return {d: tuple(v) for d, v in out.items()}


def bootstrap(by_day: Dict[str, tuple], q: str, stat: str, line: float, reps: int = REPS,
              seed: int = SEED) -> Optional[dict]:
    """Paired moving-block bootstrap over UTC days of one statistic (`_stat` on the summed day aggregates).
    {n, delta, lo, hi, p}: p is the one-sided share of draws at or below `line` (the evidence that the arm is WORSE than
    the line), or None for an empty cell. Every statistic is oriented so that positive = the arm is worse."""
    days = sorted(d for d, v in by_day.items() if v and v[-1])
    if not days:
        return None
    width = len(by_day[days[0]])
    total = [sum(by_day[d][i] for d in days) for i in range(width)]
    rng = random.Random(seed)
    draws = []
    for _ in range(reps):
        acc = [0.0] * width
        for d in _block_days(days, rng):
            v = by_day[d]
            for i in range(width):
                acc[i] += v[i]
        draws.append(_stat(acc, q, stat, total))
    draws.sort()
    lo, hi = draws[int(ALPHA_SIDE * (reps - 1))], draws[int((1.0 - ALPHA_SIDE) * (reps - 1))]
    p = (1 + sum(1 for x in draws if x <= line)) / (reps + 1)
    return {"n": int(total[-1]), "delta": _stat(total, q, stat, total), "lo": lo, "hi": hi, "p": p}


def _public(cell: Optional[dict]) -> dict:
    """A cell as it may leave this module: suppressed under SUPPRESS_N, never with a per-pair value or its p."""
    if not cell or cell["n"] < SUPPRESS_N:
        return {"suppressed": True}
    return {k: cell[k] for k in ("n", "delta", "lo", "hi")}


def resolved(m: int, reps: int) -> bool:
    """Whether a Holm family of m tests can fire at all, with RESOLUTION_HEADROOM to spare."""
    return m == 0 or 1.0 / (reps + 1) <= ALPHA_SIDE / (m * RESOLUTION_HEADROOM)


def _family(name: str, cells: List[tuple], unit: str, line: float, stat: str, reps: int, out: dict) -> None:
    """Holm across one family [(label, cell)]; appends to out["reasons"] / out["families"] / out["fired"]."""
    m = len(cells)
    out["families"].append({"family": name, "m": m, "resolved": resolved(m, reps)})
    what = "MAE change" if stat == MAE else "|bias| growth (|arm bias| - |served bias|)"
    for (label, c), pa in zip(cells, holm([c["p"] for _, c in cells]) if cells else []):
        if pa < ALPHA_SIDE:
            out["fired"].add(stat)
            out["reasons"].append(f"{label}: {what} beyond {line:.3f} {unit} after Holm (m {m}; n {c['n']}, "
                                  f"{c['delta']:+.3f} [{c['lo']:+.3f}, {c['hi']:+.3f}])")


def judge(items: Sequence[dict], q: str, reps: int = REPS, seed: int = SEED, report: bool = True) -> dict:
    """One quantity on one set of items: the decision per lead on its DECIDE classes (pooled family across leads, basin
    families per statistic x lead), its resolution, the any-unknown coverage alarm and, with `report`, the per-class
    cells. Pure and seed-determined."""
    pooled_line, basin_line, unit = LINES[q]
    rows = [it for it in items if q in it]
    out = {"fired": set(), "reasons": [], "families": [], "coverage": [], "classes": {}, "decision_n": {}}
    pooled = []
    for lead in LEADS:
        dec = [it for it in rows if it["lead"] == lead and it["tier"] in DECIDE[lead]]
        out["decision_n"][lead] = len(dec)
        if len(dec) >= POOLED_MIN_N:
            pooled.append((f"pooled +{lead} h", bootstrap(_by_day(dec, q, MAE), q, MAE, pooled_line, reps, seed)))
        for stat in (MAE, BIAS):
            cells = []
            for basin in sorted({it["basin"] for it in dec}):
                at = [it for it in dec if it["basin"] == basin]
                if len(at) >= BASIN_MIN_N:
                    cells.append((f"{basin} +{lead} h", bootstrap(_by_day(at, q, stat), q, stat, basin_line, reps, seed)))
            _family(f"+{lead} h basins {stat}", cells, unit, basin_line, stat, reps, out)
    _family("pooled mae across leads", pooled, unit, pooled_line, MAE, reps, out)
    if report:
        for cls in CLASSES:
            for lead in LEADS:
                at = [it for it in rows if it["lead"] == lead and it["tier"] == cls]
                cells = {stat: bootstrap(_by_day(at, q, stat), q, stat, pooled_line, reps, seed) for stat in (MAE, BIAS)}
                out["classes"].setdefault(cls, {})[lead] = dict({s: _public(c) for s, c in cells.items()}, n=len(at))
                c = cells[MAE]
                if cls == UNKNOWN and c and c["n"] >= POOLED_MIN_N and c["lo"] > pooled_line:
                    out["coverage"].append(f"{cls} +{lead} h: MAE lower bound above the line (coverage alarm, not a kill)")
    out["fired"] = sorted(out["fired"])
    out["fire"] = bool(out["fired"])
    out["judged_leads"] = [lead for lead, n in out["decision_n"].items() if n >= POOLED_MIN_N]
    out["decidable"] = bool(out["judged_leads"])
    out["under_resolved"] = [f for f in out["families"] if not f["resolved"]]
    return out


# ---- controls ----------------------------------------------------------------------------------------------------------
def null_items(items: Sequence[dict]) -> List[dict]:
    """arm := served: every difference is exactly 0 (checks the plumbing; it cannot see noise)."""
    return [dict(it, **{q: (it[q][1], it[q][1]) for q in (HS, DIR) if q in it}) for it in items]


def shuffled_day_items(items: Sequence[dict], seed: int = SEED) -> List[dict]:
    """The null with the UTC-day labels permuted across pairs (breaks the day blocks the bootstrap leans on)."""
    rng = random.Random(seed + 1)
    days = [it["day"] for it in items]
    rng.shuffle(days)
    return [dict(it, day=d) for it, d in zip(null_items(items), days)]


def swap_items(items: Sequence[dict], seed: int = SEED) -> List[dict]:
    """The NOISY null (the advisor's limit, 2026-11-19): on a seeded half of the UTC days the arm and the served lane
    swap places. Under "no difference" the two are exchangeable, so this keeps the real day-to-day noise of the data
    while removing any one-way harm: it must not fire."""
    rng = random.Random(seed + 3)
    flip = {d: rng.random() < 0.5 for d in sorted({it["day"] for it in items})}
    return [dict(it, **{q: (it[q][1], it[q][0]) for q in (HS, DIR) if q in it}) if flip[it["day"]] else dict(it)
            for it in items]


NULLS = ("null", "shuffled-day null", "swap null")


def busiest_basin(items: Sequence[dict], q: str) -> Optional[str]:
    c = Counter(it["basin"] for it in items if q in it and it["tier"] in DECIDE[it["lead"]])
    return min(c, key=lambda b: (-c[b], b)) if c else None


def planted_items(items: Sequence[dict], q: str, kind: str, size: float, seed: int = SEED) -> List[dict]:
    """One positive control: the arm made worse by a known amount (see PLANTS)."""
    rng = random.Random(seed + 2)
    basin = busiest_basin(items, q)
    # The basin plant is a known growth of |bias|: the arm's error there becomes the served error pushed `size` further
    # from zero, in the direction of the served lane's own bias in that basin. Adding `size` to the arm instead would
    # plant less than `size` wherever the arm already beats the served lane (served +8 deg, arm +1: +10 grows |bias| 3).
    served = [it[q][1] for it in items if q in it and it["basin"] == basin]
    if q == DIR:
        sb = _circ_deg(sum(math.sin(math.radians(x)) for x in served), sum(math.cos(math.radians(x)) for x in served))
    else:
        sb = sum(served) / len(served) if served else 0.0
    away = 1.0 if sb >= 0 else -1.0
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
            a = wrap180(s + away * size) if q == DIR else s + away * size
        out.append(dict(it, **{q: (a, s)}))
    return out


def verdict(items: Sequence[dict], q: str, reps: int = REPS, seed: int = SEED) -> dict:
    """The decision for one quantity with all its controls. Precedence: INSUFFICIENT (no lead's decision rows reach
    POOLED_MIN_N); a null (exact, shuffled-day or the noisy swap) fired -> VOID (never excused); a 2x plant missed while
    a family is under-resolved -> UNDER_RESOLVED; a 2x plant missed -> VOID; then FIRE; then UNDER_RESOLVED; then
    NO_FIRE, but only when EVERY lead was judged (otherwise INSUFFICIENT, naming the leads judged). The 1.2x plants are
    `reported`, never a VOID trigger. A FIRE with healthy controls always stands."""
    main = judge(items, q, reps, seed)
    controls = {"null": not judge(null_items(items), q, reps, seed, report=False)["fire"],     # True = behaved
                "shuffled-day null": not judge(shuffled_day_items(items, seed), q, reps, seed, report=False)["fire"],
                "swap null": not judge(swap_items(items, seed), q, reps, seed, report=False)["fire"]}
    reported = {}                           # the 1.2x plants: reported each run, their rate pinned by the 20-seed test
    for name, kind, size, must in PLANTS[q]:
        j = judge(planted_items(items, q, kind, size, seed), q, reps, seed, report=False)
        (reported if REPORTED_ONLY in name else controls)[name] = j["fire"] and (must is None or must in j["fired"])
    bad_nulls = [name for name in NULLS if not controls[name]]
    bad_plants = [name for name, ok in controls.items() if not ok and name not in NULLS]
    under = [f"{f['family']} (m {f['m']})" for f in main["under_resolved"]]
    if not main["decidable"]:
        state, why = INSUFFICIENT, [f"no lead's decision rows reached n {POOLED_MIN_N}"]
    elif bad_nulls:                         # under-resolution never excuses a null that fired
        state, why = VOID, [f"null control fired: {', '.join(bad_nulls)} (the pipeline sees harm where there is none)"]
    elif bad_plants and under:              # it may only explain a planted harm that could not fire
        state, why = UNDER_RESOLVED, [f"raise B: {', '.join(under)} cannot fire at B {reps} "
                                      f"(missed: {', '.join(bad_plants)})"]
    elif bad_plants:
        state, why = VOID, [f"control misbehaved: {', '.join(bad_plants)} (every 2x planted harm must be caught)"]
    elif main["fire"]:
        state, why = FIRE, list(main["reasons"])
    elif under:
        state, why = UNDER_RESOLVED, [f"raise B: {', '.join(under)} cannot fire at B {reps}"]
    elif len(main["judged_leads"]) < len(LEADS):
        state, why = INSUFFICIENT, [f"only +{', +'.join(str(x) for x in main['judged_leads'])} h reached n {POOLED_MIN_N}; "
                                    f"no harm seen there, the other leads unjudged"]
    else:
        state, why = NO_FIRE, []
    return dict(main, state=state, why=why, controls=controls, reported=reported, reps=reps)


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


def _cell(c: Optional[dict]) -> str:
    if not c or c.get("suppressed"):
        return "n<10"
    return f"{c['delta']:+.3f} [{c['lo']:+.3f}, {c['hi']:+.3f}]"


def render(report: dict) -> str:
    """Markdown for the job summary and the issue: aggregates only, never an id, a time or a per-pair value."""
    out = ["### Consensus guard from the scored ledger (G1a)", "",
           f"Arm `{SHADOW}` minus served `{SERVED}`, paired on the same observation; trailing {WINDOW_DAYS} complete UTC "
           f"days; moving-block bootstrap over days ({BLOCK_DAYS}-day blocks, fixed seed); Holm per family. Decision "
           f"rows: +24 h stored-regional, +48/+72 h stored-global_mid + stored-mixed. Positive = the arm is worse (mae) "
           f"or reads higher / rotated clockwise (bias).", ""]
    for flag, r in report.items():
        q = r["quantity"]
        unit = LINES[q][2]
        reps = r.get("reps", REPS)
        role = "READINESS (pre-flip; no kill path)" if r["role"] == "readiness" else "guard"
        ctl = ", ".join(f"{k} {'ok' if v else 'FAILED'}" for k, v in r["controls"].items())
        ctl += "; reported (1.2x, not a VOID trigger): " + (", ".join(
            f"{k} {'caught' if v else 'missed'}" for k, v in (r.get("reported") or {}).items()) or "none")
        fam = "; ".join(f"{f['family']} m {f['m']}{'' if f['resolved'] else ' UNDER-RESOLVED'}" for f in r["families"])
        out += [f"**`{flag}`** ({role}; {'Hs' if q == HS else 'direction'}; lines {POOLED_LINE[q]} pooled / "
                f"{BASIN_LINE[q]} basin {unit}): **{r['state']}**. Controls: {ctl}.",
                f"Resolution: B {reps}, floor 1/(B+1) = {1.0 / (reps + 1):.6f}, needs <= 0.025 / (10 m). Families: {fam}."]
        out += [f"- {w}" for w in r["why"] + r["coverage"]]
        out += ["", f"| class | n +24/+48/+72 h | mae +24/+48/+72 ({unit}) | bias +24/+48/+72 ({unit}) |",
                "|---|---|---|---|"]
        for cls, per in r["classes"].items():
            ns = " / ".join(str(per[lead]["n"]) for lead in LEADS)
            out.append(f"| {cls} | {ns} | " + " / ".join(_cell(per[lead][MAE]) for lead in LEADS) + " | "
                       + " / ".join(_cell(per[lead][BIAS]) for lead in LEADS) + " |")
        out.append("")
    return "\n".join(out) + "\n"
