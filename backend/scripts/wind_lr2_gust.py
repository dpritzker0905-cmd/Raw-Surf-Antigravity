"""wind_lr2_gust.py - the gust family FG of the long-range wind v2 registration (amendment G1, gust-lr2). Serves nothing;
reads no data by itself; nothing in here has been run on real rows.

Frozen here (every constant is pinned by tests/test_wind_lr2_gust_scorer.py):
  * CLIM_GUST: station-record climatology of the 6 h window max of ADJUSTED NDBC GST (the truth of wind_lr2_rows
    .gust_window_gst), years 2016-2025, day of year +-15 d, 6-hourly UTC hour, >= 20 records per cell, mean (the CLIM_STN
    construction). A cell with fewer records returns None: that station-row is dropped from the CLIM_GUST lines, never filled.
  * FIX140: the arm's OWN served speed x 1.40 (frozen at the #1063 factor, never refitted).
  * FG, ONE Holm family of 20 lines: arm {GRAND_CAL, AIGEFS_CAL} x [CLIM_GUST x 5 cells (FG1) + FIX140 x 5 cells (FG2)].
    FG1: better (CI upper < 0) in B1/B2, not significantly worse in B3. FG2: non-inferior with the fixed margin
    DELTA_FG2 = 0.10 m/s (the CI upper of arm - FIX140 must be <= delta; tested as the line "arm - FIX140 - delta < 0").
    The adjustment is over all 20 lines whether or not an arm has rows (an empty line has p = 1).
  * GG4 seam, GG5 halves, GG6 regions, the gust controls, and the FIT-only power note (never changes a bar).
The serial order (gust only for an arm that passed wind for the tail) is applied by `gust_verdict`.
"""
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

import wind_lr2_rows as W
import wind_lr2_stats as S

UTC = timezone.utc
CLIM_YEARS = (2016, 2025)              # inclusive; frozen, TEST and FIT lie after it, so the table cannot leak either
HALF_DAYS = 15
MIN_RECORDS = 20
CLIM_HOURS = (0, 6, 12, 18)
FIX140_FACTOR = 1.40
DELTA_FG2 = 0.10                       # m/s, the FG2 non-inferiority margin (amendment G1, advisor hold at 5342b125b)
MG_CELLS = {"ICON": ("B1", "B2", "B3"), "EURO": ("B2>240", "B3")}
CELLS = tuple((t, b) for t in ("ICON", "EURO") for b in MG_CELLS[t])        # the five cells
SPEED_FLOOR_GUST = 3.0
MDE_Z = 1.959964 + 0.841621            # one-sided 0.025 + 80% power, normal approximation (~12% low at 9 df)
POWER_BLOCKS = 10


# ---------------------------------------------------------------------------------------------- CLIM_GUST
def clim_gust_records(obs: dict, z: Optional[float], convert: Callable, gust_window: Callable,
                      years: Tuple[int, int] = CLIM_YEARS) -> List[Tuple[datetime, float]]:
    """[(valid time, adjusted 6 h max GST)] at 00/06/12/18 UTC of `years` for one station. A station outside the 1-50 m
    anemometer rule (or with no height) contributes nothing; a window that is not fully present contributes nothing."""
    if not z or not (W.GUST_Z_MIN <= z <= W.GUST_Z_MAX):
        return []
    out = []
    t0 = datetime(years[0], 1, 1, tzinfo=UTC)
    t1 = datetime(years[1], 12, 31, 23, tzinfo=UTC)
    days = int((t1 - t0).days) + 1
    for d in range(days):
        for h in CLIM_HOURS:
            v = t0 + timedelta(days=d, hours=h)
            g = gust_window(obs, v, 6)
            if g is not None and g == g:
                out.append((v, float(convert(g, z))))
    return out


class ClimGust:
    """Per-station accumulator {sid: {(doy, hour): [sum, n]}}; `get(sid, valid)` is the mean over days of year within
    +-HALF_DAYS of the valid day (circular on 366) at the valid UTC hour, or None below MIN_RECORDS."""

    def __init__(self, acc: Dict[str, Dict[Tuple[int, int], List[float]]]):
        self.acc = acc

    @classmethod
    def build(cls, per_station: Dict[str, List[Tuple[datetime, float]]]) -> "ClimGust":
        acc: Dict[str, Dict[Tuple[int, int], List[float]]] = {}
        for sid, recs in per_station.items():
            a = acc.setdefault(str(sid), {})
            for t, g in recs:
                if not (CLIM_YEARS[0] <= t.year <= CLIM_YEARS[1]) or t.hour not in CLIM_HOURS or g != g:
                    continue
                c = a.setdefault((t.timetuple().tm_yday, t.hour), [0.0, 0])
                c[0] += g
                c[1] += 1
        return cls(acc)

    def get(self, sid: str, valid: datetime) -> Optional[float]:
        a = self.acc.get(str(sid))
        if not a:
            return None
        doy, h = valid.timetuple().tm_yday, valid.hour
        tot, n = 0.0, 0
        for d in range(doy - HALF_DAYS, doy + HALF_DAYS + 1):
            c = a.get((((d - 1) % 366) + 1, h))
            if c:
                tot += c[0]
                n += int(c[1])
        return tot / n if n >= MIN_RECORDS else None

    def table(self) -> dict:
        """Canonical, order-free form of the accumulator (what is hashed and committed)."""
        return {sid: {f"{d:03d}-{h:02d}": [round(c[0], 6), int(c[1])] for (d, h), c in sorted(a.items())}
                for sid, a in sorted(self.acc.items())}

    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.table(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def stations_without(self, ids: Sequence[str], probe: datetime) -> List[str]:
        """Stations with no CLIM_GUST at the probe time: dropped from CLIM_GUST lines and reported, never filled."""
        return [str(i) for i in ids if self.get(str(i), probe) is None]


def attach_clim_gust(rows: Dict[str, np.ndarray], clim: ClimGust, station_ids: Sequence[str]) -> Dict[str, np.ndarray]:
    """Add `CLIM_GUST_g` (NaN where no record cell) and `vhour`. Valid hour = (init hour + lead) mod 24; valid day = vday."""
    n = len(rows["lead"])
    vhour = (np.asarray(rows["hour"]).astype(int) + np.asarray(rows["lead"]).astype(int)) % 24
    out = np.full(n, np.nan)
    cache: Dict[tuple, float] = {}
    for i in range(n):
        key = (int(rows["st"][i]), int(rows["vday"][i]), int(vhour[i]))
        if key not in cache:
            valid = datetime.fromordinal(key[1]).replace(hour=key[2], tzinfo=UTC)
            g = clim.get(station_ids[key[0]], valid)
            cache[key] = float("nan") if g is None else float(g)
        out[i] = cache[key]
    return dict(rows, CLIM_GUST_g=out, vhour=vhour)


# ---------------------------------------------------------------------------------------------- row errors
def _pop(rows) -> np.ndarray:
    return np.asarray(rows["marine"], bool) & np.isfinite(rows["o_g"])


def gust_err(rows, arm: str, truth: str = "o_g") -> np.ndarray:
    """|arm gust - observed gust|: the arm's gust is its served gust column `{arm}_g` (max(f_s, f_s*GF))."""
    return np.abs(rows[f"{arm}_g"] - rows[truth])


def clim_err(rows, truth: str = "o_g") -> np.ndarray:
    return np.abs(rows["CLIM_GUST_g"] - rows[truth])


def fix140_err(rows, arm: str, truth: str = "o_g") -> np.ndarray:
    return np.abs(FIX140_FACTOR * rows[f"{arm}_s"] - rows[truth])


def _cell(rows, b: str) -> np.ndarray:
    return W.cell_mask(rows, b, _pop(rows))


def fg_lines(arms: Sequence[str] = S.CAL_ARMS) -> List[Tuple[str, str, str, str]]:
    """The 20 lines (arm, 'FG1'|'FG2', comparator, 'TAIL:bin'). The B3 cell appears under both tails (the comparators here are
    the same for both tails, so those two lines read the same rows; the registration counts them as separate cells)."""
    return [(a, fam, comp, f"{t}:{b}") for a in arms for fam, comp in (("FG1", "CLIM_GUST"), ("FG2", "FIX140"))
            for t, b in CELLS]


def _line_diff(rows, key) -> np.ndarray:
    arm, fam, comp, tb = key
    m = _cell(rows, tb.split(":")[1])
    if fam == "FG1":
        d = gust_err(rows, arm) - clim_err(rows)
    else:
        d = gust_err(rows, arm) - fix140_err(rows, arm) - DELTA_FG2      # FG2 holds when this shifted mean is < 0
    return np.where(m, d, np.nan)


def compute_fg(rows, arms: Sequence[str] = S.CAL_ARMS, reps: int = S.REPS) -> Dict[tuple, dict]:
    """The one 20-line Holm family. FG1 B1/B2 and FG2 lines: p of 'mean < 0'. FG1 B3: p of 'arm significantly worse'.
    Lines with no rows carry p = 1 and stay in the family."""
    out: Dict[tuple, dict] = {}
    for key in fg_lines(arms):
        d = _line_diff(rows, key)
        if key[1] == "FG1" and key[3].endswith(":B3"):
            out[key] = S.b3_not_worse(d, rows["vday"], reps)
        else:
            out[key] = S.paired_line(d, rows["vday"], reps)
    return S.adjust_family(out)


def fg_pass(arm: str, tail: str, fg: Dict[tuple, dict]) -> bool:
    """Every FG1 and FG2 line of the tail holds for the arm (missing lines fail)."""
    for b in MG_CELLS[tail]:
        r1, r2 = fg.get((arm, "FG1", "CLIM_GUST", f"{tail}:{b}")), fg.get((arm, "FG2", "FIX140", f"{tail}:{b}"))
        if r1 is None or r2 is None:
            return False
        if b == "B3":
            if r1["sig"]:                       # significantly worse than CLIM_GUST
                return False
        elif not r1["sig"]:
            return False
        if not r2["sig"]:                       # not shown non-inferior within delta
            return False
    return True


# ---------------------------------------------------------------------------------------------- GG4 / GG5 / GG6
def gg4_seam(rows, arm: str, native_changes: np.ndarray) -> dict:
    """EURO: p95 over cell-runs of |arm gust at 246 h - HRES 10fg at 240 h| <= p95 of within-native 6 h gust changes. The
    HRES gust at 240 h is the column `hres240_g`; without it the seam is NOT MEASURABLE (never passed by default). ICON is
    read forward on >= 10 live runs from stored products."""
    if "hres240_g" not in rows:
        return {"ok": False, "reason": "NOT MEASURABLE: no hres240_g column (the collector does not carry HRES 10fg)"}
    m = (rows["lead"] == 246) & _pop(rows)
    import wind_lr2_score as SC
    s = SC.seam_ok(rows[f"{arm}_g"][m], rows["hres240_g"][m], native_changes)
    return dict(s, icon_seam="NOT MEASURABLE HERE: needs >= 10 live ICON runs from stored products")


def gg5_halves(rows, fg: Dict[tuple, dict], arm: str, tail: str) -> dict:
    """FG1 B1/B2 lines keep their (negative) sign with a point estimate >= half the pooled size in BOTH TEST halves."""
    import wind_lr2_score as SC
    h = SC.halves(rows)
    bad = []
    for b in MG_CELLS[tail]:
        if b == "B3":
            continue
        key = (arm, "FG1", "CLIM_GUST", f"{tail}:{b}")
        pooled = fg.get(key, {}).get("mean", float("nan"))
        if not np.isfinite(pooled) or pooled >= 0:
            bad.append(f"{b}:pooled")
            continue
        d = _line_diff(rows, key)
        for tag, sel in (("first", h), ("last", ~h)):
            x = np.where(sel, d, np.nan)
            mean = float(np.nanmean(x)) if np.isfinite(x).any() else float("nan")
            if not (np.isfinite(mean) and mean < 0 and abs(mean) >= 0.5 * abs(pooled)):
                bad.append(f"{b}:{tag}")
    return {"ok": not bad, "failed": bad}


def gg6_regions(rows, arm: str, tail: str, reps: int = S.REPS, min_stations: int = S.MIN_STATIONS_PER_REGION) -> dict:
    """No region with sufficient gust data is Holm-significantly worse than CLIM_GUST on MG in any bin (Holm within each
    arm x bin across regions). A region below `min_stations` gust stations is insufficient, never a verdict."""
    pop = _pop(rows)
    flagged, insufficient = [], []
    e_arm, e_clim = gust_err(rows, arm), clim_err(rows)
    for b in MG_CELLS[tail]:
        lines = {}
        for r in sorted({str(x) for x in rows["region"][pop]}):
            sel = pop & (rows["region"] == r) & W.cell_mask(rows, b)
            n_st = len(np.unique(rows["st"][sel])) if sel.any() else 0
            if n_st < min_stations:
                insufficient.append(f"{r}:{b}")
                continue
            lines[r] = S.b3_not_worse(np.where(sel, e_arm - e_clim, np.nan), rows["vday"], reps)
        for r, v in S.adjust_family(lines).items():
            if v["sig"]:
                flagged.append(f"{r}:CLIM_GUST:{b}")
    return {"ok": not flagged, "flagged": flagged, "insufficient": sorted(set(insufficient))}


# ---------------------------------------------------------------------------------------------- floors and controls
MIN_GUST_STATIONS_PER_REGION = 10
MIN_GUST_REGIONS = 3


def check_gust_floors(stations_by_region: Dict[str, int]) -> List[str]:
    """Reasons the GUST verdict is VOID (wind floors are checked by wind_lr2_stats.check_floors). Regions are counted
    sufficient with >= 10 ADJUSTED gust stations (each with >= 70% hourly GST coverage, applied by the caller)."""
    ok = sum(1 for n in stations_by_region.values() if n >= MIN_GUST_STATIONS_PER_REGION)
    return [] if ok >= MIN_GUST_REGIONS else [f"gust-sufficient regions {ok} < {MIN_GUST_REGIONS}"]


def gust_controls(rows, arms: Sequence[str] = S.CAL_ARMS, reps: int = S.REPS) -> Dict[str, dict]:
    """Amendment G1 controls on gust rows. A misbehaving control voids the GUST verdict only."""
    pop = _pop(rows)
    out: Dict[str, dict] = {}
    # null: an arm identical to FIX140 gives exactly zero with a zero-width CI
    e = fix140_err(rows, arms[0])
    r = S.paired_line(np.where(pop, e - e, np.nan), rows["vday"], reps)
    out["null"] = {"ok": bool(r["mean"] == 0.0 and r["ci"] == [0.0, 0.0])}
    # shuffled pairing (+7 d truth): the arm's gain over CLIM_GUST disappears in B1, B2
    sh = {}
    for arm in arms:
        for b in ("B1", "B2"):
            m = W.cell_mask(rows, b, pop) & np.isfinite(rows["o_g_p7"])
            d = np.where(m, gust_err(rows, arm, "o_g_p7") - clim_err(rows, "o_g_p7"), np.nan)
            ln = S.paired_line(d, rows["vday"], reps)
            sh[f"{arm}:{b}"] = {"ci": ln["ci"], "n": ln["n"], "leaks": bool(ln["n"] > 0 and ln["ci"][1] < 0)}
    out["shuffled"] = {"ok": not any(v["leaks"] for v in sh.values()), "lines": sh}
    # shifted valid time (+48 h): HIGHER MG than the unshifted arm in B1 and B2
    st = {}
    for arm in arms:
        for b in ("B1", "B2"):
            m = W.cell_mask(rows, b, pop) & np.isfinite(rows["o_g_p48"])
            if m.any():
                st[f"{arm}:{b}"] = bool(np.mean(gust_err(rows, arm, "o_g_p48")[m]) > np.mean(gust_err(rows, arm)[m]))
    out["shifted"] = {"ok": bool(st) and all(st.values()), "lines": st}
    # +1 m/s plant on the arm's gust: signed-bias difference whose CI contains +1.0 and excludes 0, every bin
    pl = {}
    g = rows[f"{arms[0]}_g"]
    for b in ("B1", "B2", "B3"):
        m = W.cell_mask(rows, b, pop)
        d = np.where(m, (g + 1.0 - rows["o_g"]) - (g - rows["o_g"]), np.nan)
        ln = S.paired_line(d, rows["vday"], reps)
        pl[b] = bool(ln["n"] > 0 and ln["ci"][0] <= 1.0 <= ln["ci"][1] and not (ln["ci"][0] <= 0.0 <= ln["ci"][1]))
    out["plant_gust"] = {"ok": all(pl.values()), "bins": pl}
    return out


# ---------------------------------------------------------------------------------------------- the serial verdict
def gust_verdict(rows, wind_passed: Dict[str, Dict[str, bool]], native_changes: np.ndarray,
                 stations_by_region: Dict[str, int], reps: int = S.REPS, control_reps: int = S.REPS) -> dict:
    """wind_passed[tail][arm] = the arm passed the wind gates for the tail. Gust is evaluated only for such arms; a gust fail
    ships WIND ONLY. Never changes a wind verdict. Floors/controls void the gust verdict only."""
    doc: dict = {"void_reasons": check_gust_floors(stations_by_region)}
    ctl = gust_controls(rows, reps=control_reps)
    doc["controls"] = ctl
    doc["void_reasons"] += [f"gust control {k} misbehaved" for k, v in ctl.items() if not v["ok"]]
    fg = compute_fg(rows, reps=reps)
    doc["fg"] = {"|".join(k): v for k, v in fg.items()}
    doc["tails"] = {}
    for tail in ("ICON", "EURO"):
        info = {}
        for arm in S.CAL_ARMS:
            if not wind_passed.get(tail, {}).get(arm):
                info[arm] = {"evaluated": False, "ships": "WIND_ONLY_OR_NONE", "why": "arm did not pass wind for this tail"}
                continue
            g4 = gg4_seam(rows, arm, native_changes) if tail == "EURO" else {"ok": True, "icon_seam": "PENDING live read"}
            g5 = gg5_halves(rows, fg, arm, tail)
            g6 = gg6_regions(rows, arm, tail, reps)
            ok = fg_pass(arm, tail, fg) and g4["ok"] and g5["ok"] and g6["ok"]
            info[arm] = {"evaluated": True, "FG": fg_pass(arm, tail, fg), "GG4": g4, "GG5": g5, "GG6": g6, "pass": ok,
                         "ships": ("WIND_AND_GUST" if ok else "WIND_ONLY")}
        doc["tails"][tail] = info
    doc["verdict"] = "VOID" if doc["void_reasons"] else "READ"
    return doc


# ---------------------------------------------------------------------------------------------- power note (FIT only)
def block_ids(vday: np.ndarray, block: int = S.BLOCK_DAYS) -> np.ndarray:
    return np.asarray(vday).astype(int) // block


def power_note(fit_rows, arms: Sequence[str] = S.CAL_ARMS, n_blocks: int = POWER_BLOCKS) -> dict:
    """From FIT rows ONLY (never TEST): per arm, line type (FG1 vs CLIM_GUST, FG2 vs FIX140) and cell, the SD of the paired
    per-block mean differences (non-overlapping 5-day blocks) and the minimum detectable effect at 80% power, one-sided
    0.025, with `n_blocks` blocks: MDE = (z_.975 + z_.80) * SD / sqrt(n_blocks) (normal approximation; about 12% low at 9
    df). Reported before dispatch so a gust fail reads as 'not shown'. It never changes a bar. Cells with < 3 blocks are
    reported as insufficient. The FG2 margin DELTA_FG2 is stated beside the FG2 MDE for comparison."""
    out: dict = {"n_blocks_assumed": n_blocks, "delta_fg2": DELTA_FG2, "lines": {}, "basis": "FIT rows only; in-sample gust"}
    pop = _pop(fit_rows)
    blk = block_ids(fit_rows["vday"])
    for arm in arms:
        for fam, comp in (("FG1", "CLIM_GUST"), ("FG2", "FIX140")):
            for _tail, b in CELLS:
                m = W.cell_mask(fit_rows, b, pop)
                d = (gust_err(fit_rows, arm) - (clim_err(fit_rows) if fam == "FG1" else fix140_err(fit_rows, arm)))
                d = np.where(m & np.isfinite(d), d, np.nan)
                means = []
                for k in np.unique(blk[np.isfinite(d)]):
                    sel = np.isfinite(d) & (blk == k)
                    means.append(float(np.mean(d[sel])))
                key = f"{arm}|{fam}|{comp}|{_tail}:{b}"
                if len(means) < 3:
                    out["lines"][key] = {"insufficient": True, "fit_blocks": len(means)}
                    continue
                sd = float(np.std(means, ddof=1))
                out["lines"][key] = {"fit_blocks": len(means), "mean_diff": float(np.mean(means)), "sd_block": sd,
                                     "mde_80": MDE_Z * sd / math.sqrt(n_blocks)}
    return out
