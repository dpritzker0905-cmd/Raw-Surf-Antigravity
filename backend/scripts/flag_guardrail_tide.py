"""The TIDE family of flag_guardrail (gates/tide-guard-v1.md + amendment 1, 2026-11-24): the tester that can see and
auto-disable SURF_TIDE_A_HARCON.

Once per NEW tide build it scores the served table's two A arms against NOAA CO-OPS High/Low predictions at 40 frozen
SUBORDINATE monitors (research/tide-guard-v1-stations.json), in two disjoint 7-day windows, and checks sanity bounds on
the ON arm. The OFF arm is the table's `keys` (am: FES2022b); the ON arm is `am_h` (the harcon blend), which the A build
writes at every key where its weight w > 0. Reads: the table object from the weather bucket (GET only, conditional on
its ETag) and the CO-OPS data API. Never the Render backend: every request runs inside scored_rows_gate.read_only_http
with exactly those two hosts (T5). Fetched as a sibling of flag_guardrail (scripts/ on sys.path).

Verdicts feed flag_guardrail.decide():
  WORSE      some stratum WORSE in BOTH windows (gate s5 w1-w4). Two WORSE builds >= 24 h apart disable.
  NOT_WORSE  otherwise.            UNTESTABLE  unreadable / stale (> 36 h, judged EVERY cycle) / n < 15.
  CACHED     a cycle on an already-judged fresh build: no new strike, no pass, no reset (keeps_strikes()).
  sanity     b2-b6, any one disables at once.
REPORT-ONLY until the repo variable TIDE_GUARD_RELEASED='1' (after a human READ of a real run with T4 passing).
"""
from __future__ import annotations

import gzip
import json
import math
import os
import statistics as st
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.weather_pipeline import guardrail_stats as gs

TIDE = "tide"
TIDE_FLAGS = {"SURF_TIDE_A_HARCON": "am_h"}           # flag -> the table field of its ON arm; OFF is 'keys' (am)
REPO = Path(__file__).resolve().parents[2]
STATIONS_FILE = REPO / "docs" / "weather-program" / "research" / "tide-guard-v1-stations.json"
SERIES_KEY = "tide_own/series.json.gz"
COOPS_HOST = "api.tidesandcurrents.noaa.gov"
COOPS = f"https://{COOPS_HOST}/api/prod/datagetter"
STALE_H, WIN_D, MIN_N, MATCH_H = 36, 7, 15, 3.0
MARGIN_H, MARGIN_T, WORSE_H, WORSE_T, MAX_WORSE, MAX_LOSS = 0.02, 5.0, 0.05, 15.0, 2, 1
B3_T, B3_T1, B3_N, B4_N, B5_M, B5_N, B6_LO, B6_HI, B6_N = 90.0, 180.0, 3, 3, 0.05, 3, 0.5, 2.0, 3
MISS_BUILDS = 2                                       # a monitor missing data for 2 consecutive builds is replaced
NEAR_LINEAGE = ("9418686",)                           # amendment 1 s4: reported every run, verdict with and without
RELEASE_ENV = "TIDE_GUARD_RELEASED"
CACHED = "CACHED"
BLIND_TITLE = "TIDE guard blind: the tide tester could not judge the served tide for 24 h"
BLIND_CYCLES, BLIND_SPAN_H = 3, 24
K_CACHE, K_BLIND, K_WORSE, K_MISS, K_REPL, K_ETAG = ("__tide_build__", "__tide_untestable_cycles__",
                                                      "__tide_worse_builds__", "__tide_misses__",
                                                      "__tide_replaced__", "__tide_etag__")
_MISSING = -32768


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(s):
    """Aware UTC; a naive stamp (the table's 'start') is UTC, never local time."""
    t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)


def released() -> bool:
    return os.environ.get(RELEASE_ENV, "0") == "1"


# ---- pure scoring --------------------------------------------------------------------------------------------------
def match(noaa, ours):
    """PURE, verbatim from scripts/tide_datum/parity_coops.match (#1171): [(height error m, time error min)] per NOAA
    event (None, None when unmatched within MATCH_H)."""
    res = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] != kind:
                continue
            dt = abs((e["time"] - t0).total_seconds()) / 60.0
            if dt <= MATCH_H * 60 and (best is None or dt < best[1]):
                best = (e["level_m"] - v, dt)
        res.append(best if best else (None, None))
    return res


def p90(vals):
    """Nearest rank: the ceil(0.9 n)-th smallest (inf allowed)."""
    v = sorted(vals)
    return v[max(0, math.ceil(0.9 * len(v)) - 1)] if v else None


def station_score(noaa, ours_events):
    """PURE: one monitor, one arm, one window. MEASURED = >= 70 % and >= 8 NOAA events matched (#1183 s8). Height is
    datum-free: signed errors minus their own median; |residual| scored."""
    rows = [r for r in match(noaa, ours_events) if r[0] is not None]
    n = len(noaa)
    measured = len(rows) >= 8 and len(rows) >= 0.7 * n
    if not rows:
        return {"measured": False, "n_noaa": n, "matched": 0, "h": None, "t": None}
    med = st.median(h for h, _ in rows)
    return {"measured": measured, "n_noaa": n, "matched": len(rows),
            "h": st.median(abs(h - med) for h, _ in rows), "t": st.median(t for _, t in rows)}


def window_legs(on: dict, off: dict, ids: list) -> dict:
    """PURE: gate s5 w1-w4 for one stratum and window over the monitors MEASURED under OFF (same n both arms)."""
    base = [i for i in ids if (off.get(i) or {}).get("measured")]
    n = len(base)
    if n < MIN_N:
        return {"n": n, "untestable": True, "worse": False, "legs": {}}
    inf = float("inf")
    on_h = [on[i]["h"] if (on.get(i) or {}).get("measured") else inf for i in base]
    on_t = [on[i]["t"] if (on.get(i) or {}).get("measured") else inf for i in base]
    off_h, off_t = [off[i]["h"] for i in base], [off[i]["t"] for i in base]
    loss = [i for i in base if not (on.get(i) or {}).get("measured")]
    worse_st = [i for i, a, b, c, d in zip(base, on_h, off_h, on_t, off_t) if a - b > WORSE_H or c - d > WORSE_T]
    legs = {"w1": p90(on_h) > p90(off_h) + MARGIN_H, "w2": p90(on_t) > p90(off_t) + MARGIN_T,
            "w3": len(worse_st) > MAX_WORSE, "w4": len(loss) > MAX_LOSS}
    return {"n": n, "untestable": False, "worse": any(legs.values()), "legs": legs, "loss": loss, "worse_monitors": worse_st,
            "p90": {"on_h": p90(on_h), "off_h": p90(off_h), "on_t": p90(on_t), "off_t": p90(off_t)}}


def build_verdict(scores: dict, strata: dict, drop=()) -> dict:
    """PURE: scores[window][arm][id] -> the build's verdict. WORSE only if some stratum is WORSE in BOTH windows."""
    per = {w: {k: window_legs(scores[w]["on"], scores[w]["off"], [i for i in ids if i not in drop])
               for k, ids in strata.items()} for w in ("W1", "W2")}
    if any(per[w][k]["untestable"] for w in per for k in strata):
        return {"verdict": gs.UNTESTABLE, "per": per, "reasons": ["a stratum has n < %d in W1 or W2" % MIN_N]}
    worse = [k for k in strata if per["W1"][k]["worse"] and per["W2"][k]["worse"]]
    one = [f"{k} {w}" for k in strata for w in per if per[w][k]["worse"] and k not in worse]
    reasons = ([f"WORSE in both windows: {', '.join(worse)}"] if worse else ["NOT_WORSE"]) + (
        [f"one-window WORSE (reported only): {', '.join(one)}"] if one else [])
    return {"verdict": gs.WORSE if worse else gs.NOT_WORSE, "per": per, "reasons": reasons}


def sanity(w1: dict, arms_w1: dict, ids: list) -> list:
    """PURE: gate s5 b2-b6 over W1. w1 = {'on': {id: score}, 'off': {...}}; arms_w1 = {id: (on levels, off levels)}."""
    out = []
    nonfinite = [i for i, (a, b) in arms_w1.items() if any(x is None and y is not None for x, y in zip(a, b))]
    if nonfinite:
        out.append(f"b2 ON arm has missing/non-finite values where OFF has values: {', '.join(nonfinite[:5])}")
    on, off = w1["on"], w1["off"]
    ok = [i for i in ids if (off.get(i) or {}).get("measured") and off[i]["t"] <= B3_T]
    gross = [i for i in ok if (on.get(i) or {}).get("measured") and on[i]["t"] > B3_T]
    single = [i for i in ok if (on.get(i) or {}).get("measured") and on[i]["t"] > B3_T1]
    if len(gross) >= B3_N or single:
        out.append(f"b3 gross time error: {len(gross)} monitors > {B3_T:.0f} min, {len(single)} > {B3_T1:.0f} min")
    loss = [i for i in ids if (off.get(i) or {}).get("measured") and not (on.get(i) or {}).get("measured")]
    if len(loss) >= B4_N:
        out.append(f"b4 ON matching loss at {len(loss)} monitors")
    off_m, rng = [], []
    for i, (a, b) in arms_w1.items():
        pa = [x for x, y in zip(a, b) if x is not None and y is not None]
        pb = [y for x, y in zip(a, b) if x is not None and y is not None]
        if len(pa) < 24:
            continue
        if abs(st.fmean(pa) - st.fmean(pb)) > B5_M:
            off_m.append(i)
        ra, rb = max(pa) - min(pa), max(pb) - min(pb)
        if rb > 0 and not (B6_LO <= ra / rb <= B6_HI):
            rng.append(i)
    if len(off_m) >= B5_N:
        out.append(f"b5 ON-OFF mean offset > {B5_M} m at {len(off_m)} keys")
    if len(rng) >= B6_N:
        out.append(f"b6 ON/OFF range ratio outside [{B6_LO}, {B6_HI}] at {len(rng)} keys")
    return out


# ---- the table -----------------------------------------------------------------------------------------------------
def arm(doc: dict, field: str) -> dict:
    """{key_str: [metres or None]} for one table field ('keys' = am, 'am_h' = the blend). Compact base64 int16 or list."""
    from services.weather_pipeline import tide_own as TO
    out = {}
    for k, a in TO._pack(doc.get(field) or {}).items():
        out[k] = [None if v == _MISSING else v / 1000.0 for v in a]
    return out


def slice_hours(doc: dict, vals: list, t0: datetime, t1: datetime):
    """(iso times, levels) of the table's hours in [t0, t1)."""
    start = parse(doc["start"])
    i0 = max(0, int((t0 - start).total_seconds() // 3600))
    i1 = min(len(vals), int(math.ceil((t1 - start).total_seconds() / 3600)))
    return ([(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(i0, i1)], vals[i0:i1])


def events(doc, vals, t0, t1):
    from services.weather_pipeline import tide as T
    times, levels = slice_hours(doc, vals, t0 - timedelta(hours=6), t1 + timedelta(hours=6))
    return T.tide_extrema(times, levels)


def score_doc(doc: dict, on_field: str, noaa: dict, monitors: dict, t0: datetime, on_override=None) -> dict:
    """PURE given its inputs: per-window, per-arm station scores, W1 arm levels for sanity, and the missing-data ids.
    noaa = {id: [(aware time, type, metres)]}; monitors = {id: key_str}; on_override = {key: levels} (planted runs)."""
    off_a, on_a = arm(doc, "keys"), (on_override if on_override is not None else arm(doc, on_field))
    wins = {"W1": (t0, t0 + timedelta(days=WIN_D)), "W2": (t0 + timedelta(days=WIN_D), t0 + timedelta(days=2 * WIN_D))}
    scores = {w: {"on": {}, "off": {}} for w in wins}
    arms_w1, missing = {}, []
    for sid, key in monitors.items():
        if key not in off_a or key not in on_a or not noaa.get(sid):
            missing.append(sid)
            continue
        for w, (a, b) in wins.items():
            ev = [e for e in noaa[sid] if a <= e[0] < b]
            scores[w]["off"][sid] = station_score(ev, events(doc, off_a[key], a, b))
            scores[w]["on"][sid] = station_score(ev, events(doc, on_a[key], a, b))
        arms_w1[sid] = (slice_hours(doc, on_a[key], *wins["W1"])[1], slice_hours(doc, off_a[key], *wins["W1"])[1])
    return {"scores": scores, "arms_w1": arms_w1, "missing": missing}


def judge(doc, on_field, noaa, monitors, strata, t0, on_override=None) -> dict:
    """PURE: the full per-build result (verdict, sanity, near-lineage, missing)."""
    s = score_doc(doc, on_field, noaa, monitors, t0, on_override)
    ids = [i for v in strata.values() for i in v]
    v = build_verdict(s["scores"], strata)
    nl = build_verdict(s["scores"], strata, drop=NEAR_LINEAGE)
    nl_rows = {i: {w: {a: s["scores"][w][a].get(i) for a in ("on", "off")} for w in ("W1", "W2")}
               for i in NEAR_LINEAGE if i in ids}
    return {"verdict": v["verdict"], "per": v["per"], "sanity": sanity(s["scores"]["W1"], s["arms_w1"], ids),
            "reasons": v["reasons"] + [f"near-lineage {', '.join(NEAR_LINEAGE)}: without it {nl['verdict']}"],
            "near_lineage": {"verdict_without": nl["verdict"], "rows": nl_rows}, "missing": s["missing"]}


# ---- planted controls (T4): a SANDBOX, never fed to decide() --------------------------------------------------------
PLANTS = {"identity": ("NOT_WORSE", False), "shift_60min": ("WORSE", None), "amp_x1.25": ("WORSE", None),
          "sign_flip": (None, True), "offset_0.10m": ("NOT_WORSE", True)}


def _plant(name, vals):
    good = [v for v in vals if v is not None]
    m = st.fmean(good) if good else 0.0
    if name == "identity":
        return list(vals)
    if name == "shift_60min":
        return [None] + list(vals[:-1])
    if name == "amp_x1.25":
        return [None if v is None else m + 1.25 * (v - m) for v in vals]
    if name == "sign_flip":
        return [None if v is None else 2 * m - v for v in vals]
    return [None if v is None else v + 0.10 for v in vals]


def planted(doc, noaa, monitors, strata, t0) -> dict:
    """{plant: {verdict, sanity, pass}} with the ON arm replaced by a transform of OFF at every monitor key. A plant
    passes iff its verdict (when required) and its breach state (when required) are exactly the gate's (s6 T4)."""
    off_a = arm(doc, "keys")
    out = {}
    for name, (want_v, want_b) in PLANTS.items():
        over = {k: _plant(name, off_a[k]) for k in set(monitors.values()) if k in off_a}
        r = judge(doc, None, noaa, monitors, strata, t0, on_override=over)
        ok = (want_v is None or r["verdict"] == want_v) and (want_b is None or bool(r["sanity"]) == want_b)
        out[name] = {"verdict": r["verdict"], "sanity": r["sanity"], "pass": ok}
    return out


# ---- I/O (inside the read-only guard) ------------------------------------------------------------------------------
def load_monitors(path=STATIONS_FILE):
    """(strata {name: [monitor ids]}, reserve {name: [ids]}, keys {id: key_str}) from the frozen selection."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    keys, strata, reserve = {}, {}, {}
    for k, v in doc["strata"].items():
        strata[k], reserve[k] = list(v["monitor"]), list(v["reserve"])
        for i, key in v["key"].items():
            keys[i] = f"{float(key[0]):.1f},{float(key[1]):.1f}"
    return strata, reserve, keys


def noaa_hilo(sid, begin, end, opener=urllib.request.urlopen):
    q = (f"{COOPS}?product=predictions&application=raw_surf_tide_guard&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum=MLLW&units=metric&time_zone=gmt"
         f"&interval=hilo&format=json").replace(" ", "%20")
    with opener(urllib.request.Request(q, headers={"User-Agent": "raw-surf-tide-guard/1"}), timeout=60) as r:
        rows = json.loads(r.read().decode("utf-8")).get("predictions", [])
    return [(datetime.strptime(x["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc),
             "High" if x["type"] == "H" else "Low", float(x["v"]))
            for x in rows if x.get("type") in ("H", "L") and x.get("v") not in (None, "")]


def read_table(etag=None, opener=urllib.request.urlopen):
    """(doc or None, etag, not_modified) of the served table: GET only, If-None-Match on the cached ETag."""
    import urllib.error
    from services.weather_pipeline.store import WEATHER_BUCKET
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    h = {"apikey": key, **({"Authorization": "Bearer " + key} if key.startswith("eyJ") else {})}
    if etag:
        h["If-None-Match"] = etag
    try:
        with opener(urllib.request.Request(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{SERIES_KEY}", headers=h),
                    timeout=60) as r:
            raw = r.read()
            new_etag = r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return None, etag, True
        raise
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8")), new_etag, False


def guarded():
    """T5: every request in the TIDE pass is a body-less GET to the bucket host or CO-OPS, nothing else."""
    from urllib.parse import urlparse
    import scored_rows_gate as srg
    return srg.read_only_http(urlparse(os.environ.get("SUPABASE_URL", "")).hostname, extra_hosts=(COOPS_HOST,))


# ---- one cycle -----------------------------------------------------------------------------------------------------
def active_monitors(strata, reserve, replaced):
    """The frozen monitors with logged replacements applied (reserve order, same stratum)."""
    out = {k: list(v) for k, v in strata.items()}
    for old, new in replaced:
        for k, v in out.items():
            if old in v:
                v[v.index(old)] = new
    return out


def cycle(flag: str, watch: dict, now: datetime, read=None, fetch=None, monitors=None) -> tuple:
    """(result, watch) for one TIDE flag this cycle. Staleness is judged EVERY cycle on the build stamp (amendment 1 s1);
    a fresh, already-judged build returns CACHED (no strike, no pass, no reset); a new build is scored once."""
    strata0, reserve, keys = monitors or load_monitors()
    cache = dict((watch.get(K_CACHE) or {}).get(flag) or {})
    etag = (watch.get(K_ETAG) or {}).get(flag)
    try:
        doc, etag, not_modified = (read or read_table)(etag if cache.get("stamp") else None)
    except Exception as e:                                   # noqa: BLE001 - an unreadable table is UNTESTABLE, never a breach
        return {"verdict": gs.UNTESTABLE, "sanity": [], "coverage": TIDE,
                "reasons": [f"tide table unreadable: {type(e).__name__}"]}, watch
    stamp = cache.get("stamp") if not_modified else (doc or {}).get("generated_at")
    if not stamp:
        return {"verdict": gs.UNTESTABLE, "sanity": [], "coverage": TIDE, "reasons": ["no tide table"]}, watch
    age_h = (now - parse(stamp)).total_seconds() / 3600.0
    if age_h > STALE_H:
        return {"verdict": gs.UNTESTABLE, "sanity": [], "coverage": TIDE, "build": stamp,
                "reasons": [f"tide build {stamp} is {age_h:.0f} h old (> {STALE_H} h): stale, judged every cycle"]}, watch
    if cache.get("stamp") == stamp and cache.get("result"):
        r = dict(cache["result"])
        return dict(r, verdict=CACHED, cached_verdict=r.get("verdict"), sanity=[], coverage=TIDE,
                    reasons=[f"build {stamp} already judged {r.get('verdict')}: no new strike"]), watch
    if doc is None:
        return {"verdict": gs.UNTESTABLE, "sanity": [], "coverage": TIDE, "reasons": ["table not re-read"]}, watch
    replaced = list((watch.get(K_REPL) or {}).get(flag) or [])
    strata = active_monitors(strata0, reserve, replaced)
    mon = {i: keys[i] for v in strata.values() for i in v}
    t0 = parse(stamp).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    noaa = {}
    for sid in mon:
        try:
            noaa[sid] = (fetch or noaa_hilo)(sid, t0 - timedelta(hours=3), t0 + timedelta(days=2 * WIN_D, hours=3))
        except Exception:                                    # noqa: BLE001 - a missing station is counted, never fatal
            noaa[sid] = []
    r = judge(doc, TIDE_FLAGS[flag], noaa, mon, strata, t0)
    r.update(coverage=TIDE, build=stamp, planted=planted(doc, noaa, mon, strata, t0))
    misses = dict((watch.get(K_MISS) or {}).get(flag) or {})
    for sid in mon:
        misses[sid] = misses.get(sid, 0) + 1 if sid in r["missing"] else 0
    for k, v in strata.items():
        pool = [x for x in reserve[k] if x not in v and x not in [b for _, b in replaced]]
        for sid in [x for x in v if misses.get(x, 0) >= MISS_BUILDS]:
            if pool:
                replaced.append([sid, pool.pop(0)])
                r["reasons"].append(f"monitor {sid} replaced by {replaced[-1][1]} ({MISS_BUILDS} builds without data)")
    worse_log = [s for s in (watch.get(K_WORSE) or {}).get(flag) or [] if parse(s) >= now - timedelta(days=14)]
    if r["verdict"] == gs.WORSE:
        worse_log.append(stamp)
    r["worse_builds_14d"] = len(worse_log)
    store = {k: r[k] for k in ("verdict", "per", "reasons", "near_lineage", "missing", "planted", "build")}
    watch = dict(watch, **{K_CACHE: dict(watch.get(K_CACHE) or {}, **{flag: {"stamp": stamp, "result": store}}),
                           K_ETAG: dict(watch.get(K_ETAG) or {}, **{flag: etag}),
                           K_MISS: dict(watch.get(K_MISS) or {}, **{flag: misses}),
                           K_REPL: dict(watch.get(K_REPL) or {}, **{flag: replaced}),
                           K_WORSE: dict(watch.get(K_WORSE) or {}, **{flag: worse_log})})
    return r, watch


def report_only(r: dict) -> dict:
    """Before release: a WORSE or a breach is printed, never a strike or a disable (gate s7)."""
    if released() or not (r.get("verdict") == gs.WORSE or r.get("sanity")):
        return r
    held = ([f"WORSE ({'; '.join(r.get('reasons') or [])})"] if r.get("verdict") == gs.WORSE else []) + list(r["sanity"])
    return dict(r, verdict=gs.UNTESTABLE, sanity=[], report_only=held,
                reasons=list(r.get("reasons") or []) + [f"REPORT-ONLY until {RELEASE_ENV}=1: {'; '.join(held)}"[:600]])


def keeps_strikes(result: dict, breach: list) -> bool:
    """A TIDE UNTESTABLE or CACHED cycle (no breach): decide() must neither strike nor clear."""
    return result.get("coverage") == TIDE and result.get("verdict") in (gs.UNTESTABLE, CACHED) and not breach


def tide_pass(results: dict, watch: dict, now: datetime, read=None, fetch=None, monitors=None):
    """Judge every TIDE flag in `results`; count consecutive UNTESTABLE CYCLES (amendment 1 s2: >= 3 spanning >= 24 h
    opens the ONE 'TIDE guard blind' issue). Returns (results, watch, blind lines, judged flags). Never disables on
    blindness. Every request runs inside the read-only guard (T5)."""
    flags = [f for f in results if f in TIDE_FLAGS]
    blind_state, blind, judged = dict(watch.get(K_BLIND) or {}), [], []
    for f in flags:
        with guarded():
            r, watch = cycle(f, watch, now, read, fetch, monitors)
        results[f] = dict(results[f], **report_only(r))
        if results[f]["verdict"] == gs.UNTESTABLE and not results[f].get("sanity") and not results[f].get("report_only"):
            b = dict(blind_state.get(f) or {"n": 0, "first": iso(now)})
            b["n"] += 1
            blind_state[f] = b
            span = (now - parse(b["first"])).total_seconds() / 3600.0
            if b["n"] >= BLIND_CYCLES and span >= BLIND_SPAN_H:
                blind.append((f"TIDE GUARD-BLIND: {f} has not been judged for {b['n']} cycles over {span:.0f} h "
                              f"({'; '.join(results[f].get('reasons') or [])})")[:600])
        else:
            blind_state.pop(f, None)
            judged.append(f)
    for f in [x for x in blind_state if x not in flags]:
        blind_state.pop(f)
    return results, dict(watch, **{K_BLIND: blind_state}), blind, judged


def lines(report: dict) -> list:
    """Markdown lines for the TIDE family (near-lineage, the 14-day WORSE count and the planted controls every run)."""
    out = []
    for f, r in sorted((report.get("results") or {}).items()):
        if r.get("coverage") != TIDE:
            continue
        nl = (r.get("near_lineage") or {}).get("verdict_without")
        pl = ", ".join("%s %s%s %s" % (k, v["verdict"], " breach" if v["sanity"] else "", "ok" if v["pass"] else "FAIL")
                       for k, v in (r.get("planted") or {}).items()) or "not run"
        out += ["", f"TIDE `{f}`: build {r.get('build')}, verdict {r.get('cached_verdict') or r.get('verdict')}; "
                f"without near-lineage {', '.join(NEAR_LINEAGE)}: {nl}; WORSE builds in 14 d: {r.get('worse_builds_14d')}; "
                f"planted (sandbox) {pl}"]
        if r.get("report_only"):
            out.append(f"REPORT-ONLY (not acted on until {RELEASE_ENV}=1): {'; '.join(r['report_only'])}"[:600])
    for line in report.get("tide_blind") or []:
        out += ["", f"**{line}** (reported only; blindness never disables a flag)"]
    return out


def write_files(out: str, report: dict) -> None:
    """tide-blind.txt (non-empty -> the workflow opens ONE 'TIDE guard blind' issue) and tide-judged.txt (non-empty and no
    blind line -> it closes it). Both always written, so a stale file never speaks for this run."""
    for name, rows in (("tide-blind.txt", report.get("tide_blind") or []),
                       ("tide-judged.txt", report.get("tide_judged") or [])):
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(rows))
    for line in report.get("tide_blind") or []:
        print(f"::warning title=TIDE guard blind::{line[:300]}", file=sys.stdout)
