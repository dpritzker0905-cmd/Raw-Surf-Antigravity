"""consensus_flip_sweep.py -- what the CONSENSUS_SERVE flip would do to the DISPLAYED catalogue, measured before it.

Consensus PR C (STATE "Next fixes" 3; owner, 2026-10-02: "go, build PR C").

WHY. The flip (`CONSENSUS_SERVE` '1' + `CONSENSUS_SERVE_KEEP_GFS` 'hawaii', consensus_serve.py) is graded OFFSHORE: the
skill ledger reads the built shadow 0.135 m against served GFS 0.175 m at +24 h on the same pairs (ledger seq 196), and
the Hawaii-only rule -1.9% against the equal mean out of sample (seq 215). Nothing has said what it does to the number a
user READS, the breaking height and level on every spot glyph. The equal mean moves calm seas most (1.31x the served
height at the median Florida cell, 2026-09-29), so the flip is a product event whose size is known before it is taken,
as RATING_LOCAL_SIZE's was (47.6% of levels moved, scripts/local_size_gonogo.py).

WHY NOT science_shadow_ab.py. It replays each spot-hour's PERSISTED inputs, and the offshore height is one of them: the
flip changes that input itself, and the consensus value at a spot-hour is persisted nowhere.

HOW, WITHOUT A SECOND FORECAST PATH. Both arms are the PRODUCTION precompute, `precompute_spot_ratings` ->
`rate_one_spot` (the reference composition), over one restored manifest, one spot list and one set of valid times:
  A   today's lane: precompute.yml's own env, CONSENSUS_SERVE '0'.
  B   the candidate: the same env with CONSENSUS_SERVE '1' and CONSENSUS_SERVE_KEEP_GFS=<keep>.
  A2  the null control: arm A again, AFTER B, on the first hour, so it brackets B in time.
The one difference between A and B is which product a GFS regional waves frame LOADS as (consensus_serve.ServedStore).
`ObservedResolver` passes every call through unchanged and records, per marine point, the answer's `product_id` (-> the
manifest's region) and `source_dataset` ('consensus:equal_mean' marks a swapped frame: merge() carries it).

FLAGS ARE NOT DECLARED HERE. A third lane of science flags would drift (test_flag_lane_parity's whole subject), so the
sweep reads precompute.yml's env literals at run time and rates under exactly those.

THE CONTROLS REFUSE (exit 3); they do not annotate:
  * no paired spot-hour                          blind is never a result
  * A2 differs from A                            the inputs moved mid-run (an ingest landed); re-run
  * a kept-region spot-hour moved or swapped     KEEP_GFS is not doing what the flip relies on
  * a kept region with no attributed spot-hour   its control would be blind
  * a spot-hour that did NOT swap moved          something other than the switch differs between the arms
  * no spot-hour swapped                         the positive control: nothing to measure (no twin of the served run?)
READ-ONLY: main() makes ProductStore's upload and delete raise before anything runs, and counts any attempt.

Usage (CI: .github/workflows/consensus-flip-sweep.yml):
  python scripts/consensus_flip_sweep.py --hours 0,24,48,72 --keep hawaii --json sweep.json
Exit 0 = report; 3 = REFUSED; 1 = setup failed (no credentials, nothing restored). ASCII output only.
"""
import argparse
import asyncio
import copy
import json
import logging
import math
import os
import re
import sys
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

LANE_WORKFLOW = os.path.join(os.path.dirname(BACKEND_DIR), ".github", "workflows", "precompute.yml")
SWAPPED_DATASET = "consensus:equal_mean"     # consensus_ingest's source_dataset; merge() stamps it on a served frame
FT_PER_M = 3.28084
MIN_HEIGHT_FOR_RATIO_M = 0.05                # a ratio of two near-zero heights is noise, not a change
OFFSHORE_BANDS = ((0.0, 0.5, "<0.5 m"), (0.5, 1.0, "0.5-1 m"), (1.0, 2.0, "1-2 m"), (2.0, 3.0, "2-3 m"),
                  (3.0, math.inf, ">=3 m"))
# The regex test_flag_lane_parity reads lanes with, widened from its science prefixes to every quoted upper-case
# literal: RENDER and the PREFETCH/POINT settings change resolution paths too. Secrets are `${{ }}` expressions, never
# quoted literals, so none is collected.
LANE_LITERAL = re.compile(r"^\s+([A-Z][A-Z0-9_]*):\s*'([^']*)'")
COMPARED = ("offshore_hs_m", "surf_height_m", "score", "level")
# Log signatures counted per arm (run 36963244735 refused on its null control with Supabase and tide 429s in the log;
# these say which arm met which failure, so a refusal can be attributed instead of guessed at).
SIGNATURES = {"storage_429": "too_many_connections", "product_missing": "Stored product path not found",
              "dynamic_l2_failed": "Dynamic L2 download failed", "tide_unavailable": "tide] acquisition unavailable"}


class Refused(Exception):
    pass


def lane_env(path: str = LANE_WORKFLOW) -> Dict[str, str]:
    """precompute.yml's env literals as {NAME: value}. A name set twice to different values is ambiguous and raises,
    as does a lane that does not declare the switch this sweep toggles."""
    out: Dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = LANE_LITERAL.match(line)
            if not m:
                continue
            name, value = m.group(1), m.group(2)
            if name in out and out[name] != value:
                raise ValueError(f"{os.path.basename(path)} sets {name} twice ({out[name]!r} and {value!r})")
            out[name] = value
    if "CONSENSUS_SERVE" not in out:
        raise ValueError(f"{os.path.basename(path)} does not declare CONSENSUS_SERVE")
    return out


def arm_envs(lane: Dict[str, str], keep: str, max_hour: int) -> Tuple[Dict[str, str], Dict[str, str]]:
    """(A, B). A is the lane with the switch off, B the same with it on and `keep` kept on GFS; nothing else differs.
    PREFETCH_WINDOW_DAYS is widened to cover the last hour asked (warming, not composition): at the lane's '1' a +48 h
    frame is not in L1, and both arms would be answered by a fallback instead of the regional tiles the flip swaps."""
    a = dict(lane)
    a["CONSENSUS_SERVE"], a["CONSENSUS_SERVE_KEEP_GFS"] = "0", ""
    days = max(int(a.get("PREFETCH_WINDOW_DAYS") or 1), math.ceil((max_hour + 1) / 24) + 1)
    a["PREFETCH_WINDOW_DAYS"] = str(days)
    b = dict(a)
    b["CONSENSUS_SERVE"], b["CONSENSUS_SERVE_KEEP_GFS"] = "1", keep
    return a, b


def keep_set(keep: str) -> frozenset:
    return frozenset(r.strip() for r in (keep or "").split(",") if r.strip())


@contextmanager
def patched_env(env: Dict[str, str]):
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def point_key(lat, lng, valid_time) -> tuple:
    return (round(float(lat), 5), round(float(lng), 5), str(valid_time))


class ObservedResolver:
    """Pass-through around the production resolver. Every attribute goes to it unchanged; each marine waves answer is
    recorded on the way back as {point_key: {product_id, source_dataset, source, run_time, ...}}.

    SHARED INPUTS (run 36969307841). With `shared`, every answer the flip does NOT act on (any domain/layer other than
    marine waves: the wind, partitions) is resolved ONCE, by the first arm, and every arm receives a deep copy of that
    one answer. A live upstream wind point can differ between calls; held identical, the switch stays the only
    difference between the arms (science_shadow_ab's shared-inputs rule)."""

    def __init__(self, inner, shared: Optional[dict] = None):
        self._inner = inner
        self._shared = shared
        self.seen: Dict[tuple, dict] = {}

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def resolve_point(self, *args, **kwargs):
        waves = kwargs.get("domain") == "marine" and kwargs.get("layer") == "waves"
        if self._shared is not None and not waves and kwargs.get("lat") is not None:
            key = (kwargs.get("model"), kwargs.get("domain"), kwargs.get("layer"),
                   point_key(kwargs["lat"], kwargs["lng"], kwargs.get("valid_time_str")))
            if key not in self._shared:
                self._shared[key] = await self._inner.resolve_point(*args, **kwargs)
            return copy.deepcopy(self._shared[key])
        resp = await self._inner.resolve_point(*args, **kwargs)
        if waves and kwargs.get("lat") is not None:
            run = getattr(resp, "run_time", None)
            self.seen[point_key(kwargs["lat"], kwargs["lng"], kwargs.get("valid_time_str"))] = {
                "product_id": getattr(resp, "product_id", None),
                "source_dataset": getattr(resp, "source_dataset", None),
                "source": getattr(resp, "source", None),
                "run_time": run.isoformat() if isinstance(run, datetime) else run,
                "coverage_status": getattr(resp, "coverage_status", None),
                "dynamic": bool(getattr(resp, "is_dynamic_viewport_product", False)),
                "fallback_reason": getattr(resp, "fallback_reason", None)}
        return resp


class SignatureCounter(logging.Handler):
    """Counts log records carrying each of SIGNATURES while attached (one arm)."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.counts = dict.fromkeys(SIGNATURES, 0)

    def emit(self, record):
        try:
            msg = record.getMessage()
        except Exception:
            return
        for name, sig in SIGNATURES.items():
            if sig in msg:
                self.counts[name] += 1


def manifest_regions(manifest) -> Dict[str, str]:
    """{product_id and filename: region label}: the region_id of a regional tile, else its coverage mode."""
    out: Dict[str, str] = {}
    for p in getattr(manifest, "products", None) or []:
        label = p.region_id if (p.coverage_mode == "regional_tile" and p.region_id) else (p.coverage_mode or "unknown")
        for key in (p.product_id, p.filename, os.path.splitext(p.filename or "")[0]):
            if key:
                out[key] = label
    return out


def arm_rows(obj: dict, seen: Dict[tuple, dict], regions: Dict[str, str]) -> Dict[Tuple[str, str], dict]:
    """{(spot_id, valid_time): record} from a precompute object, run_time restored, joined to what the observer saw."""
    from services.weather_pipeline.spot_ratings_precompute import expand_frame_runs
    out: Dict[Tuple[str, str], dict] = {}
    for frame in obj.get("frames") or []:
        vt = frame.get("valid_time")
        for rec in expand_frame_runs(frame.get("spots") or [], frame):
            obs = seen.get(point_key(rec.get("latitude"), rec.get("longitude"), vt)) or {}
            pid = obs.get("product_id")
            out[(str(rec.get("spot_id")), vt)] = dict(
                rec, valid_time=vt, hour_offset=frame.get("hour_offset"),
                region=regions.get(pid, "unattributed") if pid else "unattributed",
                swapped=obs.get("source_dataset") == SWAPPED_DATASET, _obs=obs)
    return out


def is_direct(rec: dict) -> bool:
    """Answered by a LIVE upstream point query, not a stored product (point_resolution PATH 2c, `backend_direct_point`):
    the flip cannot reach it (consensus_serve swaps only what a GFS regional tile LOADS as), and a live query can return
    another run on the next call. Run 36967271748: all 388 run-skew pairs and 97 of the 101 null-control differences."""
    obs = rec.get("_obs") or {}
    return obs.get("source") == "backend_direct_point" or str(obs.get("coverage_status") or "").endswith("direct_point")


def _differs(a: dict, b: dict) -> bool:
    for k in COMPARED:
        x, y = a.get(k), b.get(k)
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            if abs(float(x) - float(y)) > 1e-9:
                return True
        elif x != y:
            return True
    return False


def pair(a_rows: dict, b_rows: dict, keep: frozenset) -> Tuple[List[dict], Dict[str, int]]:
    """Rows rated in both arms from the same marine run; the rest counted, never silently dropped."""
    counts = {"unpaired": 0, "upstream_direct": 0, "unrated": 0, "run_skew": 0}
    rows = []
    for key in sorted(set(a_rows) | set(b_rows)):
        a, b = a_rows.get(key), b_rows.get(key)
        if a is None or b is None:
            counts["unpaired"] += 1
            continue
        if is_direct(a) or is_direct(b):
            counts["upstream_direct"] += 1
            continue
        if None in (a.get("score"), b.get("score"), a.get("surf_height_m"), b.get("surf_height_m")):
            counts["unrated"] += 1
            continue
        if a.get("run_time") != b.get("run_time"):
            counts["run_skew"] += 1
            continue
        rows.append({"spot_id": key[0], "valid_time": key[1], "name": a.get("name"), "region": a["region"],
                     "hour_offset": a.get("hour_offset"), "kept": a["region"] in keep,
                     "swapped": bool(b.get("swapped")), "a_swapped": bool(a.get("swapped")),
                     "coverage": (b.get("_obs") or {}).get("coverage_status"),
                     "moved": _differs(a, b),
                     **{f"a_{k}": a.get(k) for k in COMPARED}, **{f"b_{k}": b.get(k) for k in COMPARED}})
    return rows, counts


def null_control(a_rows: dict, a2_rows: dict) -> Dict[str, int]:
    """A vs A2 on the hours A2 rated: every shared product-served spot-hour must be identical, run included. Live
    upstream answers are counted apart: the flip cannot move them, and a live query is not expected to repeat."""
    shared = [k for k in a2_rows if k in a_rows]
    direct = [k for k in shared if is_direct(a_rows[k]) or is_direct(a2_rows[k])]
    stored = [k for k in shared if k not in set(direct)]
    # A spot-hour rated in only one pass has no value to compare: its product failed to load there (run 37040224655:
    # arm A met 13 Supabase 429s on product downloads). pair() excludes it from the measurement and counts it; so does
    # this, so the null control judges exactly the spot-hours the report measures.
    rated = [k for k in stored if _rated(a_rows[k]) and _rated(a2_rows[k])]
    differ = sum(1 for k in rated if _differs(a_rows[k], a2_rows[k])
                 or a_rows[k].get("run_time") != a2_rows[k].get("run_time"))
    return {"compared": len(rated), "differ": differ, "upstream_direct": len(direct),
            "unrated": len(stored) - len(rated)}


def _rated(rec: dict) -> bool:
    return rec.get("score") is not None and rec.get("surf_height_m") is not None


def _diag_entry(key, x: dict, y: dict) -> dict:
    return {"spot_id": key[0], "valid_time": key[1], "name": x.get("name"), "region": x.get("region"),
            "fields": [k for k in COMPARED + ("run_time",) if x.get(k) != y.get(k)],
            "x": dict(x.get("_obs") or {}, run_time_rated=x.get("run_time"), tide=x.get("tide"),
                      reference_size_m=x.get("reference_size_m"), **{k: x.get(k) for k in COMPARED}),
            "y": dict(y.get("_obs") or {}, run_time_rated=y.get("run_time"), tide=y.get("tide"),
                      reference_size_m=y.get("reference_size_m"), **{k: y.get(k) for k in COMPARED})}


def _aggregate(entries: List[dict]) -> dict:
    return {"n": len(entries),
            "same_product": sum(e["x"].get("product_id") == e["y"].get("product_id") for e in entries),
            "dynamic_either": sum(bool(e["x"].get("dynamic") or e["y"].get("dynamic")) for e in entries),
            "fields": dict(Counter(f for e in entries for f in e["fields"]).most_common()),
            "by_region": dict(Counter(e["region"] for e in entries).most_common(12)),
            "status_pairs": dict(Counter(f"{e['x'].get('coverage_status')} -> {e['y'].get('coverage_status')}"
                                         for e in entries).most_common(8)),
            "source_pairs": dict(Counter(f"{e['x'].get('source')} -> {e['y'].get('source')}"
                                         for e in entries).most_common(8))}


def diagnose(a_rows: dict, b_rows: dict, a2_rows: dict, cap: int = 400) -> dict:
    """What the excluded pairs (run skew, A vs B) and the null control's differences (A vs A2) were made of: each
    side's product, run, coverage status and dynamic flag, so a refusal names its cause."""
    def stored(x, y):        # product-served and rated on both sides: what pair() and null_control() compare
        return not (is_direct(x) or is_direct(y)) and None not in (
            x.get("score"), y.get("score"), x.get("surf_height_m"), y.get("surf_height_m"))
    skew = [_diag_entry(k, a_rows[k], b_rows[k]) for k in sorted(a_rows) if k in b_rows
            and stored(a_rows[k], b_rows[k]) and a_rows[k].get("run_time") != b_rows[k].get("run_time")]
    null = [_diag_entry(k, a_rows[k], a2_rows[k]) for k in sorted(a2_rows) if k in a_rows
            and stored(a_rows[k], a2_rows[k])
            and (_differs(a_rows[k], a2_rows[k]) or a_rows[k].get("run_time") != a2_rows[k].get("run_time"))]
    leak = [_diag_entry(k, a_rows[k], b_rows[k]) for k in sorted(a_rows) if k in b_rows
            and stored(a_rows[k], b_rows[k]) and a_rows[k].get("run_time") == b_rows[k].get("run_time")
            and not b_rows[k].get("swapped") and _differs(a_rows[k], b_rows[k])]
    direct_spots = {k[0] for k, r in a_rows.items() if is_direct(r)}
    return {"run_skew": {"agg": _aggregate(skew), "rows": skew[:cap]},
            "null_diff": {"agg": _aggregate(null), "rows": null[:cap]},
            "moved_without_swap": {"agg": _aggregate(leak), "rows": leak[:cap]},
            "upstream_direct": {"spot_hours": sum(is_direct(r) for r in a_rows.values()),
                                "spots": len(direct_spots)}}


def refusals(rows: List[dict], null: Dict[str, int], keep: frozenset) -> List[str]:
    out = []
    if not rows:
        return ["no paired spot-hour: blind is never a result"]
    if null["compared"] == 0 or null["differ"]:
        out.append(f"null control: {null['differ']} of {null['compared']} spot-hours differ between A and A2 "
                   f"(the inputs moved mid-run, or A2 compared nothing); re-run")
    if any(r["a_swapped"] for r in rows):
        out.append("arm A answered a swapped frame: the switch was not off in today's arm")
    kept = [r for r in rows if r["kept"]]
    bad = [r for r in kept if r["moved"] or r["swapped"]]
    if bad:
        out.append(f"kept region moved: {len(bad)} of {len(kept)} kept spot-hours moved or swapped "
                   f"(e.g. {bad[0]['name']} {bad[0]['valid_time']})")
    for region in sorted(keep - {r["region"] for r in rows}):
        out.append(f"kept region {region!r} has no attributed spot-hour: its control is blind")
    leak = [r for r in rows if r["moved"] and not r["swapped"]]
    if leak:
        out.append(f"{len(leak)} spot-hours moved without a swap (e.g. {leak[0]['name']} {leak[0]['valid_time']}): "
                   f"something other than the switch differs between the arms")
    if not any(r["swapped"] for r in rows):
        tiles = sum(r.get("coverage") == "inside_regional_tile" for r in rows)
        out.append(f"no spot-hour swapped ({tiles} of {len(rows)} pairs were answered from a GFS regional tile): the "
                   f"positive control failed; no CONSENSUS twin matches the served GFS run (the pilots lane builds a "
                   f"run's twins after its ingest, and until then the flip serves GFS)")
    return out


def _pct(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, max(0, int(math.ceil(q * len(s))) - 1))]


def _level_index(level) -> Optional[int]:
    from services.weather_pipeline.surf_rating import LEVELS
    return LEVELS.index(level) if level in LEVELS else None


def stats(rows: List[dict]) -> dict:
    n = len(rows)
    ratios = [r["b_surf_height_m"] / r["a_surf_height_m"] for r in rows
              if r["a_surf_height_m"] >= MIN_HEIGHT_FOR_RATIO_M]
    dft = [(r["b_surf_height_m"] - r["a_surf_height_m"]) * FT_PER_M for r in rows]
    dscore = [r["b_score"] - r["a_score"] for r in rows]
    ups = downs = 0
    for r in rows:
        ia, ib = _level_index(r["a_level"]), _level_index(r["b_level"])
        if ia is not None and ib is not None:
            ups += ib > ia
            downs += ib < ia
    share = (lambda k: round(k / n, 4) if n else None)
    return {"n": n, "swapped": share(sum(r["swapped"] for r in rows)), "moved": share(sum(r["moved"] for r in rows)),
            "level_changed": share(sum(r["a_level"] != r["b_level"] for r in rows)), "level_up": share(ups),
            "level_down": share(downs),
            "height_ratio": {q: _round(_pct(ratios, v)) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
            "abs_dheight_ft": {q: _round(_pct([abs(x) for x in dft], v)) for q, v in (("p50", .5), ("p90", .9))},
            "dheight_ge_1ft": share(sum(abs(x) >= 1.0 for x in dft)),
            "dscore": {q: _round(_pct(dscore, v)) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}}


def _round(x, nd=3):
    return None if x is None else round(x, nd)


def band_of(offshore_m) -> str:
    for lo, hi, label in OFFSHORE_BANDS:
        if offshore_m is not None and lo <= offshore_m < hi:
            return label
    return "unknown"


def summarize(rows: List[dict], top: int = 12) -> dict:
    def group(key):
        out: Dict[str, List[dict]] = {}
        for r in rows:
            out.setdefault(str(key(r)), []).append(r)
        return {k: stats(v) for k, v in sorted(out.items())}
    movers = sorted(rows, key=lambda r: -abs(r["b_surf_height_m"] - r["a_surf_height_m"]))[:top]
    return {"overall": stats(rows), "by_region": group(lambda r: r["region"]),
            "by_offshore_band": group(lambda r: band_of(r["a_offshore_hs_m"])),
            "by_hour": group(lambda r: f"+{r['hour_offset']}h"),
            "top_movers": [{k: r[k] for k in ("name", "region", "valid_time", "a_surf_height_m", "b_surf_height_m",
                                              "a_level", "b_level", "a_offshore_hs_m", "b_offshore_hs_m")}
                           for r in movers]}


async def run_arms(spots: list, hours: List[int], env_a: dict, env_b: dict, base_dt, regions: dict,
                   concurrency: int = 8) -> Dict[str, dict]:
    """The three arms, in order A, B, A2, each on a fresh production resolver under its own env."""
    from services.weather_pipeline import spot_ratings_precompute as pc
    from services.weather_pipeline import tide as tide_module
    out: Dict[str, dict] = {"meta": {}}
    shared: dict = {}
    tides: dict = {}
    live_tide = tide_module.tide_norm_at

    async def shared_tide(lat, lng, valid_time, *args, **kwargs):
        """rate_one_spot's tide, fetched once per spot-hour and replayed to every arm (run 36969307841: a tide outage
        in arm A and none in A2 moved Flagler Beach 46.3 -> 23.2 with the same product and run)."""
        key = point_key(lat, lng, valid_time)
        if key not in tides:
            tides[key] = await live_tide(lat, lng, valid_time, *args, **kwargs)
        return copy.deepcopy(tides[key])

    from services.weather_pipeline import spot_size_climatology as size_module
    live_size = size_module.load_size_climatology_for_rating
    sizes: dict = {}

    def shared_size(*args, **kwargs):
        """Each spot's size reference (RATING_LOCAL_SIZE), loaded once and replayed. Run 36972188101: production
        precompute 36969618212 rewrote the climatology at 06:12:25Z, between arm A's load (06:11:12) and B's
        (06:27:34), and 7 spot-hours moved 0.1 point with every other input identical."""
        if "loaded" not in sizes:
            sizes["loaded"] = live_size(*args, **kwargs)
        return copy.deepcopy(sizes["loaded"])

    tide_module.tide_norm_at = shared_tide
    size_module.load_size_climatology_for_rating = shared_size
    try:
        for name, env, hrs in (("A", env_a, hours), ("B", env_b, hours), ("A2", env_a, hours[:1])):
            counter, root = SignatureCounter(), logging.getLogger()
            root.addHandler(counter)
            started = datetime.now(timezone.utc)
            try:
                with patched_env(env):
                    resolver = ObservedResolver(pc._make_point_resolver(), shared)
                    obj = await pc.precompute_spot_ratings(resolver, spots, ["GFS"], hrs, base_dt=base_dt,
                                                           concurrency=concurrency)
            finally:
                root.removeHandler(counter)
            out["meta"][name] = {"start": started.strftime("%H:%M:%SZ"),
                                 "end": datetime.now(timezone.utc).strftime("%H:%M:%SZ"), **counter.counts}
            if obj.get("refused"):
                raise Refused(f"arm {name}: the precompute refused ({obj['refused']})")
            out[name] = arm_rows(obj, resolver.seen, regions)
    finally:
        tide_module.tide_norm_at = live_tide
        size_module.load_size_climatology_for_rating = live_size
    out["shared"] = {"tide_answers": len(tides), "tide_missing": sum(v is None for v in tides.values()),
                     "other_answers": len(shared), "size_reference_loads": len(sizes)}
    return out


def _f(x, fmt="{:.2f}"):
    return "-" if x is None else fmt.format(x)


def _tide(t) -> str:
    if not isinstance(t, dict):
        return "none"
    return "/".join(str(t.get(k)) for k in ("state", "norm", "height_m") if t.get(k) is not None) or "present"


def render(summary: dict, counts: dict, null: dict, refused: List[str], meta: dict) -> str:
    lines = [f"CONSENSUS FLIP SWEEP  keep={meta['keep'] or '(none)'}  hours={meta['hours']}  base={meta['base']}  "
             f"spots={meta['spots']}  sha={meta['sha']}",
             f"pairs excluded: {counts}   null control (A vs A2): {null['differ']}/{null['compared']} differ "
             f"({null.get('unrated', 0)} unrated in one pass)   "
             f"write attempts blocked: {meta['writes_blocked']}", ""]
    hdr = (f"{'group':<26}{'n':>6}{'swap':>7}{'lvl chg':>8}{'up':>6}{'down':>6}{'ratio p10/p50/p90':>21}"
           f"{'|dft| p50/p90':>15}{'>=1ft':>7}")
    def row(label, s):
        hr, dh = s["height_ratio"], s["abs_dheight_ft"]
        return (f"{label[:25]:<26}{s['n']:>6}{_f(s['swapped'], '{:.1%}'):>7}{_f(s['level_changed'], '{:.1%}'):>8}"
                f"{_f(s['level_up'], '{:.1%}'):>6}{_f(s['level_down'], '{:.1%}'):>6}"
                f"{_f(hr['p10']) + '/' + _f(hr['p50']) + '/' + _f(hr['p90']):>21}"
                f"{_f(dh['p50']) + '/' + _f(dh['p90']):>15}{_f(s['dheight_ge_1ft'], '{:.1%}'):>7}")
    lines += [hdr, row("ALL", summary["overall"])]
    groups = (("by region", "by_region"), ("by offshore band (A)", "by_offshore_band"), ("by hour", "by_hour"))
    for title, key in groups:
        lines += ["", f"-- {title}"] + [row(k, v) for k, v in summary[key].items()]
    lines += ["", "-- largest displayed-height moves (A -> B)"]
    for m in summary["top_movers"]:
        a_ft, b_ft = m["a_surf_height_m"] * FT_PER_M, m["b_surf_height_m"] * FT_PER_M
        lines.append(f"  {str(m['name'])[:30]:<31}{m['region']:<22}{m['valid_time']}  "
                     f"{_f(a_ft, '{:.1f}')} -> {_f(b_ft, '{:.1f}')} ft  {m['a_level']} -> {m['b_level']}  "
                     f"offshore {_f(m['a_offshore_hs_m'])} -> {_f(m['b_offshore_hs_m'])} m")
    lines += ["", "-- arms (UTC, log signatures met while each ran)"]
    for name, m in (meta.get("arms") or {}).items():
        lines.append(f"  {name:<3}{m['start']} -> {m['end']}  " + "  ".join(f"{k}={m[k]}" for k in SIGNATURES))
    sh = meta.get("shared")
    if sh:
        lines.append(f"  shared inputs, fetched once and replayed to every arm: {sh['tide_answers']} tide answers "
                     f"({sh['tide_missing']} without a tide), {sh['other_answers']} non-wave resolver answers, "
                     f"{sh['size_reference_loads']} size-reference load(s)")
    direct = (meta.get("diag") or {}).get("upstream_direct")
    if direct:
        lines += ["", f"-- live upstream point answers (outside the flip's reach; excluded from pairs and the null "
                      f"control): {direct['spot_hours']} spot-hours at {direct['spots']} spots"]
    for title, key in (("run skew among stored products, A vs B (excluded)", "run_skew"),
                       ("null control differences, A vs A2", "null_diff"),
                       ("moved without a swap, A vs B", "moved_without_swap")):
        agg = (meta.get("diag") or {}).get(key)
        if agg and agg["n"]:
            lines += ["", f"-- {title}: n={agg['n']} same_product={agg['same_product']} "
                          f"dynamic_either={agg['dynamic_either']}",
                      f"   fields {agg['fields']}", f"   regions {agg['by_region']}",
                      f"   coverage {agg['status_pairs']}", f"   source {agg['source_pairs']}"]
            for e in (meta.get("diag_rows") or {}).get(key, []):
                x, y = e["x"], e["y"]
                lines.append(f"   {str(e['name'])[:24]:<25}{e['valid_time']} {e['fields']}  "
                             + "  ".join(f"{k} {x.get(k)}->{y.get(k)}" for k in COMPARED if x.get(k) != y.get(k))
                             + f"  run {x.get('run_time_rated')}->{y.get('run_time_rated')}"
                             + f"  tide {_tide(x.get('tide'))}->{_tide(y.get('tide'))}"
                             + f"  ref {x.get('reference_size_m')}->{y.get('reference_size_m')}")
    lines += ["", "VERDICT: " + ("REFUSED" if refused else "report (the flip itself is the owner's word)")]
    lines += [f"  - {r}" for r in refused]
    return "\n".join(lines)


def forbid_writes(store_cls) -> Dict[str, int]:
    """Make the store's Supabase upload and delete raise; returns the live attempt counter."""
    attempts = {"n": 0}

    def _blocked(self, filename, *args, **kwargs):
        attempts["n"] += 1
        raise PermissionError(f"consensus_flip_sweep is read-only (blocked a write of {filename!r})")
    store_cls._upload_to_supabase = _blocked
    store_cls._delete_from_supabase = _blocked
    return attempts


def parse_hours(text: str) -> List[int]:
    hours = sorted({int(h) for h in str(text).split(",") if h.strip()})
    if not hours or hours[0] < 0:
        raise argparse.ArgumentTypeError(f"bad --hours {text!r}")
    return hours


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--hours", type=parse_hours, default=parse_hours("0,24,48,72"))
    ap.add_argument("--keep", default="hawaii", help="regions kept on GFS ('none' = the global equal mean)")
    ap.add_argument("--limit-spots", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--json", dest="json_path")
    ap.add_argument("--summary", dest="summary_path", help="append the report here (GITHUB_STEP_SUMMARY)")
    args = ap.parse_args(argv)
    keep = "" if args.keep.strip().lower() == "none" else args.keep.strip()
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")   # precompute_ci's format

    env_a, env_b = arm_envs(lane_env(), keep, max(args.hours))
    os.environ.update(env_a)               # module imports and the prefetch below run under today's lane
    if not (os.environ.get("SUPABASE_URL") and
            (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))):
        print("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required (read-only use).")
        return 1
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.prefetcher import prefetch_supabase_products
    from services.weather_pipeline import spot_ratings_precompute as pc
    writes = forbid_writes(ProductStore)
    restored, _errors = ProductStore().restore_from_supabase()
    if not restored:
        print("nothing restored from L2: no products to rate")
        return 1
    asyncio.run(prefetch_supabase_products())
    spots = pc.fetch_active_spots_via_rest()
    if args.limit_spots:
        spots = spots[:args.limit_spots]
    regions = manifest_regions(ProductStore().get_manifest())
    base = pc._top_of_hour_utc()
    meta = {"keep": keep, "hours": ",".join(map(str, args.hours)), "base": base.strftime("%Y-%m-%dT%H:%MZ"),
            "spots": len(spots), "sha": (os.environ.get("GITHUB_SHA") or "local")[:8]}
    diag: dict = {}
    try:
        arms = asyncio.run(run_arms(spots, args.hours, env_a, env_b, base, regions, args.concurrency))
        rows, counts = pair(arms["A"], arms["B"], keep_set(keep))
        null = null_control(arms["A"], arms["A2"])
        refused = refusals(rows, null, keep_set(keep))
        diag = diagnose(arms["A"], arms["B"], arms["A2"])
        meta["arms"] = arms["meta"]
        meta["shared"] = arms["shared"]
        meta["diag"] = {k: v.get("agg", v) for k, v in diag.items()}
        meta["diag_rows"] = {k: v["rows"][:15] for k, v in diag.items() if "rows" in v}
    except Refused as e:
        rows, counts, null, refused = [], {}, {"compared": 0, "differ": 0}, [str(e)]
    meta["writes_blocked"] = writes["n"]
    summary = summarize(rows)
    report = render(summary, counts, null, refused, meta)
    print(report)
    if args.summary_path:
        with open(args.summary_path, "a", encoding="utf-8") as fh:
            fh.write("```\n" + report + "\n```\n")
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump({"meta": meta, "counts": counts, "null_control": null, "refused": refused,
                       "lane_env_applied": {k: v for k, v in env_b.items()}, "summary": summary,
                       "diagnostics": diag, "rows": rows}, fh, indent=1, default=str)
    return 3 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
