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
import os
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
        return {"ok": False, "measurable": False, "reason": "NOT MEASURABLE: no hres240_g column (the collector does not carry HRES 10fg)"}
    m = (rows["lead"] == 246) & _pop(rows)
    pair = np.isfinite(rows[f"{arm}_g"][m]) & np.isfinite(rows["hres240_g"][m])
    if not pair.any():          # an all-NaN column is a missing measurement, never a seam failure
        return {"ok": False, "measurable": False, "reason": "NOT MEASURABLE: hres240_g has no finite value at the seam rows"}
    import wind_lr2_score as SC
    s = SC.seam_ok(rows[f"{arm}_g"][m], rows["hres240_g"][m], native_changes)
    return dict(s, measurable=True, icon_seam="NOT MEASURABLE HERE: needs >= 10 live ICON runs from stored products")


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
            if tail == "EURO":
                g4 = gg4_seam(rows, arm, native_changes)
            else:       # ICON has no archive: the seam is read forward on >= 10 live runs, so it is PENDING, never passed
                g4 = {"ok": False, "measurable": False, "reason": "PENDING: needs >= 10 live ICON runs from stored products"}
            g5 = gg5_halves(rows, fg, arm, tail)
            g6 = gg6_regions(rows, arm, tail, reps)
            rest = bool(fg_pass(arm, tail, fg) and g5["ok"] and g6["ok"])
            pending = not g4.get("measurable", True)
            ok = bool(rest and g4["ok"])
            # mirrors the wind side's PASS_PENDING_ICON_SEAM: every other line holds but the seam is unread -> not shippable
            status = "PASS" if ok else ("PASS_PENDING_SEAM" if (rest and pending) else "FAIL")
            info[arm] = {"evaluated": True, "FG": fg_pass(arm, tail, fg), "GG4": g4, "GG5": g5, "GG6": g6, "pass": ok,
                         "status": status, "ships": ("WIND_AND_GUST" if ok else "WIND_ONLY")}
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


# ---------------------------------------------------------------------------------------------- the verified loader
class ClimGustRefused(Exception):
    """The CLIM_GUST table could not be verified against the committed hash. Fail closed: there is no fallback table."""


def read_committed_hash(hash_path: str) -> str:
    """The sha256 recorded in the committed `wind_lr2_clim_gust.json.sha256` ("<64 hex>  <name>"). Missing, unreadable or
    malformed -> refuse."""
    try:
        text = open(hash_path, encoding="utf-8").read()
    except OSError as e:
        raise ClimGustRefused(f"committed hash file unreadable: {hash_path} ({type(e).__name__})") from None
    parts = text.split()
    if not parts or len(parts[0]) != 64 or any(c not in "0123456789abcdef" for c in parts[0]):
        raise ClimGustRefused(f"committed hash file malformed: {hash_path}")
    return parts[0]


def _from_table(table: dict) -> "ClimGust":
    acc: Dict[str, Dict[Tuple[int, int], List[float]]] = {}
    for sid, cells in table.items():
        a = acc.setdefault(str(sid), {})
        for key, (total, n) in cells.items():
            doy, hour = key.split("-")
            a[(int(doy), int(hour))] = [float(total), int(n)]
    return ClimGust(acc)


def load_clim_gust(table_path: str, hash_path: str) -> "ClimGust":
    """Load the CLIM_GUST table ONLY if its bytes hash to the committed sha256 AND the parsed table re-serialises to the same
    hash. Any mismatch, missing file or parse failure refuses; the scorer never continues without it."""
    want = read_committed_hash(hash_path)
    try:
        body = open(table_path, "rb").read()
    except OSError as e:
        raise ClimGustRefused(f"CLIM_GUST table unreadable: {table_path} ({type(e).__name__})") from None
    got = hashlib.sha256(body).hexdigest()
    if got != want:
        raise ClimGustRefused(f"CLIM_GUST table sha256 {got} != committed {want}")
    try:
        clim = _from_table(json.loads(body))
    except (ValueError, TypeError, KeyError) as e:
        raise ClimGustRefused(f"CLIM_GUST table does not parse ({type(e).__name__})") from None
    if clim.sha256() != want:
        raise ClimGustRefused("CLIM_GUST table is not in canonical form (re-serialised hash differs)")
    return clim


def fetch_table(url: str, dest: str, get: Optional[Callable] = None, timeout: int = 300) -> str:
    """Download the table from the bucket URL to `dest` (no trust placed in it: `load_clim_gust` verifies). Any failure refuses."""
    if get is None:
        import requests
        get = requests.get
    try:
        r = get(url, timeout=timeout)
        if r.status_code != 200:
            raise ClimGustRefused(f"CLIM_GUST table download HTTP {r.status_code}")
        open(dest, "wb").write(r.content)
    except ClimGustRefused:
        raise
    except Exception as e:  # noqa: BLE001 - the body may echo request details: only the type is reported
        raise ClimGustRefused(f"CLIM_GUST table download failed ({type(e).__name__})") from None
    return dest


def fetch_and_load(url: str, hash_path: str, dest: str, get: Optional[Callable] = None) -> "ClimGust":
    return load_clim_gust(fetch_table(url, dest, get), hash_path)


# ---------------------------------------------------------------------------------------------- wiring into the score command
def wind_passed_from_doc(wind_doc: dict) -> Dict[str, Dict[str, bool]]:
    """{tail: {arm: bool}}: an arm passed the WIND gates for a tail, read ONLY from the wind result document (`tails[tail][arm]
    ["pass"]`). The gust family never feeds back into this document and no other source decides it."""
    out: Dict[str, Dict[str, bool]] = {}
    for tail in ("ICON", "EURO"):
        info = wind_doc.get("tails", {}).get(tail, {})
        out[tail] = {arm: bool(isinstance(info.get(arm), dict) and info[arm].get("pass")) for arm in S.CAL_ARMS}
    return out


def gust_stations_by_region(stations: Sequence[dict], pairing: Dict[str, dict], coverage: Dict[str, dict]) -> Dict[str, int]:
    """Stations that count toward the GUST floor, per region: NDBC (never ASOS), marine-exposed, anemometer height 1-50 m, and
    GST coverage >= 70% over the TEST window. A LOCKED id has no truth, hence zero coverage, hence is not counted."""
    out: Dict[str, int] = {}
    for st in stations:
        if st.get("kind", "ndbc") != "ndbc":
            continue
        z = st.get("anemometer_m")
        if not z or not (W.GUST_Z_MIN <= float(z) <= W.GUST_Z_MAX):
            continue
        sid = str(st["id"])
        if not pairing.get(sid, {}).get("marine") or not coverage.get(sid, {}).get("ok_gust"):
            continue
        import wind_lr2_runs as R
        r = R.region_of(st["lat"], st["lon"])
        out[r] = out.get(r, 0) + 1
    return out


def score_gust(rows: Dict[str, np.ndarray], wind_doc: dict, stations: Sequence[dict], pairing: Dict[str, dict],
               coverage: Dict[str, dict], clim: "ClimGust", native_gust_changes: Optional[np.ndarray] = None,
               reps: int = S.REPS, control_reps: int = S.REPS) -> dict:
    """The gust block of the score report (amendment G1, serial: after wind). Reads the wind document, never writes it."""
    rows = attach_clim_gust(rows, clim, [str(s["id"]) for s in stations])
    return gust_verdict(rows, wind_passed_from_doc(wind_doc),
                        native_gust_changes if native_gust_changes is not None else np.zeros(0),
                        gust_stations_by_region(stations, pairing, coverage), reps=reps, control_reps=control_reps)


def fetch_object_main(argv=None) -> int:
    """`fetch-table --object KEY --hash FILE --out FILE`: read the one archived table from the PRIVATE bucket (key by NAME from
    the environment, read-only GET), then verify it against the committed hash with `load_clim_gust` and keep it only if it
    verifies. Run only by the `fetch-clim-gust` job of wind-lr2-analyse.yml (environment supabase-service)."""
    import argparse
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch-table"])
    ap.add_argument("--object", required=True)
    ap.add_argument("--hash", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}
    url = f"{base}/storage/v1/object/weather-products/{a.object}"
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    try:
        fetch_and_load(url, a.hash, a.out, get=lambda u, timeout: requests.get(u, headers=headers, timeout=timeout))
    except ClimGustRefused as e:
        if os.path.exists(a.out):
            os.remove(a.out)                  # an unverified table is never left behind for a later step to use
        print(f"REFUSED: {e}")
        return 1
    print(f"CLIM_GUST table verified against the committed hash: {a.out}")
    return 0


# ---------------------------------------------------------------------------------------------- the one-time build (CLI)
def build_clim_gust(stations: Sequence[dict], year_reader: Callable[[str, int], dict], convert: Callable,
                    years: Tuple[int, int] = CLIM_YEARS) -> Tuple["ClimGust", dict]:
    """CLIM_GUST over the FROZEN NDBC station list. `year_reader(station_id, year) -> {time: (wspd, gst, wdir)}` is the only
    place data enters (the CLI passes the NDBC annual stdmet reader; tests pass a synthetic one). A station without a 1-50 m
    anemometer height contributes nothing; ASOS entries are skipped (no gust truth). Returns (table, report)."""
    per: Dict[str, List[Tuple[datetime, float]]] = {}
    rep: dict = {"years": list(years), "stations": {}, "skipped": {}}
    for st in stations:
        sid, z = str(st["id"]), st.get("anemometer_m")
        if st.get("kind", "ndbc") != "ndbc":
            rep["skipped"][sid] = "not NDBC (no gust truth)"
            continue
        if not z or not (W.GUST_Z_MIN <= float(z) <= W.GUST_Z_MAX):
            rep["skipped"][sid] = f"anemometer height {z!r} outside {W.GUST_Z_MIN}-{W.GUST_Z_MAX} m"
            continue
        obs: dict = {}
        empty_years = []
        for y in range(years[0], years[1] + 1):
            rec = year_reader(sid, y)
            if not rec:
                empty_years.append(y)
            obs.update(rec)
        recs = clim_gust_records(obs, float(z), convert, W.gust_window_gst, years)
        per[sid] = recs
        rep["stations"][sid] = {"records": len(recs), "empty_years": empty_years}
    clim = ClimGust.build(per)
    rep["n_stations_with_records"] = sum(1 for v in rep["stations"].values() if v["records"])
    rep["sha256_table"] = clim.sha256()
    return clim, rep


def main(argv=None):
    """`build-clim --stations frozen.json --cache DIR --out DIR`: reads the public NDBC annual stdmet files of the frozen
    list (2016-2025, cached under DIR/ndbc), writes wind_lr2_clim_gust.json, its .sha256 and the report. Run only by the
    dispatch-only workflow after the owner's typed word; the station list must be the frozen v2 list, never a superseded one."""
    import argparse
    import sys
    args = sys.argv[1:] if argv is None else list(argv)
    if args and args[0] == "fetch-table":
        return fetch_object_main(args)
    argv = args
    import wind_lr_obs as O
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build-clim"])
    ap.add_argument("--stations", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    doc = json.load(open(a.stations, encoding="utf-8"))
    stations = [s for s in doc["ndbc"] if s.get("kind", "ndbc") == "ndbc"]
    session = requests.Session()
    clim, rep = build_clim_gust(stations, lambda sid, y: O.ndbc_year(session, a.cache, sid, y), O.to_10m)
    os.makedirs(a.out, exist_ok=True)
    body = json.dumps(clim.table(), sort_keys=True, separators=(",", ":"))
    open(os.path.join(a.out, "wind_lr2_clim_gust.json"), "w", encoding="utf-8").write(body)
    open(os.path.join(a.out, "wind_lr2_clim_gust.json.sha256"), "w", encoding="utf-8").write(
        hashlib.sha256(body.encode()).hexdigest() + "  wind_lr2_clim_gust.json\n")
    json.dump(rep, open(os.path.join(a.out, "wind_lr2_clim_gust_report.json"), "w", encoding="utf-8"), indent=1, sort_keys=True)
    print(f"CLIM_GUST: {rep['n_stations_with_records']} stations with records, {len(rep['skipped'])} skipped, table sha256 {rep['sha256_table']}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
