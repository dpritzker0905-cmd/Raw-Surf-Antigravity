"""default_on_filter.py - the PRE-MERGE history filter for default-ON fixes (D-065).

A PR that turns a served-number flag ON (a new GUARDED entry or `_RATING_FLAGS` default moving to ON, or `--flag`)
is replayed over a cached past window with the flag OFF and ON, both through the reference chain the eval harness
replays (`eval_replay.replay_arm` -> `spot_ratings.rate_one_spot`), and scored at the buoys on the harness's primary
quantity (`hs_station`). The verdict comes from `guardrail_stats.verdict` (two-way DM + block bootstrap, pooled and
per season and region, Holm, materiality margin) plus the sanity bounds.

  WORSE (or a sanity breach) -> exit 1: the PR may not merge with the flag ON (hold it at '0', "fix in progress").
  BETTER / NOT_WORSE / NO_CHANGE / UNTESTABLE -> exit 0: ON is the default; "not proven better" does not block.
  No cache for the window -> SKIPPED, exit 0, with the reason (the job never downloads on a pull_request).

CPU: two arms over the window (measured 2026-11-04 on the 10-day / 6-station / 3-lead window: ~35 s per arm after the
shared staging; the 5-arm harness run took 2 m 58 s in total). No app, no storage, no secrets, no Render.
Window: `default_on_filter_window.json`, or `--hist-index` (the backfill agent's index.json: a list of windows with
start/end[/cache_dir]; the newest settled one is used). OVERLAP (named): claude/harness-backfill owns that index
format; this reads only `start`, `end` and `cache_dir` from each entry.
"""
import argparse
import ast
import json
import os
import subprocess
import sys
from datetime import timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

REGISTRY = os.path.join("backend", "routes", "admin", "surf_forecast.py")
RUNTIME = os.path.join("backend", "services", "runtime_flags.py")
WINDOW_FILE = os.path.join(HERE, "default_on_filter_window.json")
PRIMARY = "hs_station"


# ---- which flags does the PR turn ON -----------------------------------------------------------------------------
def _dict_literal(src: str, name: str) -> dict:
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    return {}


def on_defaults(registry_src: str, runtime_src: str) -> dict:
    """{flag: default} for every flag whose code default is ON ('1') in the registry or GUARDED."""
    out = {k: v[0] for k, v in _dict_literal(registry_src, "_RATING_FLAGS").items() if v[0] == "1"}
    out.update({k: v for k, v in _dict_literal(runtime_src, "GUARDED").items() if v == "1"})
    return out


def declared_on(base: dict, head: dict) -> list:
    """Flags ON at head that were not ON at base: the PR's default-ON fixes."""
    return sorted(k for k in head if k not in base)


def _show(rev: str, path: str) -> str:
    try:
        return subprocess.run(["git", "show", f"{rev}:{path.replace(os.sep, '/')}"], cwd=REPO, check=True,
                              capture_output=True, text=True, encoding="utf-8").stdout
    except subprocess.CalledProcessError:
        return ""


def flags_from_git(base_rev: str) -> list:
    def read(p):
        with open(os.path.join(REPO, p), encoding="utf-8") as f:
            return f.read()
    base = on_defaults(_show(base_rev, REGISTRY), _show(base_rev, RUNTIME))
    head = on_defaults(read(REGISTRY), read(RUNTIME))
    return declared_on(base, head)


# ---- the window ---------------------------------------------------------------------------------------------------
def pick_window(hist_index: str = None, cache_dir: str = None) -> dict:
    if hist_index and os.path.exists(hist_index):
        with open(hist_index, encoding="utf-8") as f:
            idx = json.load(f)
        wins = idx.get("windows", idx) if isinstance(idx, dict) else idx
        wins = [w for w in wins if isinstance(w, dict) and w.get("start") and w.get("end")]
        if wins:
            w = sorted(wins, key=lambda w: w["end"])[-1]
            return {"start": w["start"], "end": w["end"], "leads": w.get("leads", "24,48,72"),
                    "cache_dir": w.get("cache_dir") or cache_dir}
    with open(WINDOW_FILE, encoding="utf-8") as f:
        w = json.load(f)
    return dict(w, cache_dir=cache_dir)


def cache_present(cache_dir) -> bool:
    return bool(cache_dir) and os.path.isdir(cache_dir) and any(os.scandir(cache_dir))


# ---- the replay (harness functions, two arms) ---------------------------------------------------------------------
def stage(window: dict, out_dir: str, offline: bool = True, decoder: str = "auto"):
    """Stage truth and forecast once for the window (the harness's own staging). Returns a context dict."""
    import eval_harness as eh
    from services.weather_pipeline import eval_gfswave as gw
    from services.weather_pipeline import eval_provenance as pv
    from services.weather_pipeline import eval_reference as rf
    from services.weather_pipeline import eval_replay as rp
    from services.weather_pipeline import eval_scoring as sc
    start, end = rp.parse_time(window["start"]), rp.parse_time(window["end"])
    leads = [int(x) for x in str(window.get("leads", "24,48,72")).split(",")]
    targets = gw.targets_between(start, end, int(window.get("step_h", 6)))
    stations = rf.load_stations(window.get("stations") or os.path.join(HERE, "eval_harness_stations.json"))["stations"]
    cache = pv.Cache(window["cache_dir"], get=pv.http_get, pause_s=0.5, offline=offline,
                     max_range_downloads=window.get("max_range_downloads"), max_total_bytes=window.get("max_bytes"))
    os.makedirs(out_dir, exist_ok=True)
    embargo = sc.clim_embargo(targets[0], targets[-1], max(leads))
    truth, _summary, hull_of = eh.stage_truth(cache, stations, embargo[0] - timedelta(days=30),
                                              end + timedelta(hours=2), out_dir)
    jobs, _fc = eh.stage_forecast(cache, stations, targets, leads, out_dir, gw.fetch_fields, "auto", decoder)
    tides = rp.TideSeries(cache, min(j["cycle"] for j in jobs) if jobs else start, end)
    served = rp.served_env(REPO)
    stray = sorted(k for k in os.environ if k.startswith(eh.FLAG_PREFIXES) and k not in served["env"])
    return {"truth": truth, "hull_of": hull_of, "jobs": jobs, "tides": tides, "served": served,
            "scrub": served["secrets_named"] + stray, "stations": stations, "embargo": embargo}


def replay_pair(ctx: dict, flag: str, on_value: str = "1", off_value: str = "0"):
    """(items, rows_off, rows_on): gate_v2 pairs with f_ref = OFF and f_cand = ON on the primary quantity."""
    from services.weather_pipeline import eval_replay as rp
    from services.weather_pipeline import eval_scoring as sc
    by_id = {s["id"]: s for s in ctx["stations"]}
    rows = {}
    for arm, val in (("off", off_value), ("on", on_value)):
        env = dict(ctx["served"]["env"], **{flag: val, "RUNTIME_FLAGS_MANIFEST": "0"})
        rows[arm] = rp.replay_arm(f"{flag}={val}", env, ctx["scrub"], ctx["jobs"], ctx["tides"], by_id)["rows"]
    off, _ = sc.build_items(PRIMARY, rows["off"], ctx["truth"], by_id, ctx["hull_of"], clim_embargo=ctx["embargo"])
    on, _ = sc.build_items(PRIMARY, rows["on"], ctx["truth"], by_id, ctx["hull_of"], clim_embargo=ctx["embargo"])
    return sc.pair(off, on), rows["off"], rows["on"]


def sweep(flag: str, value: str, lat: float = 33.38, lng: float = -117.59) -> list:
    """[(swell Hs, breaking height)] through `surf_point.estimate_surf_at` at one coordinate (default Trestles), 14 s,
    swell from 225 deg, swell Hs 0.25..12 m, with the flag at `value`; the interior of the range is what counts."""
    from services.weather_pipeline import eval_replay as rp
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    out = []
    with rp.env_context({flag: value, "RUNTIME_FLAGS_MANIFEST": "0"}, []):
        g = resolve_surf_geometry(lat, lng)
        for i in range(1, 49):
            hs = 0.25 * i
            h, _ = estimate_surf_at(lat, lng, hs, 14.0, 225.0, geometry=g, water_level_m=0.5)
            out.append((hs, h))
    return out


def evaluate(flag: str, ctx=None, on_value: str = "1") -> dict:
    """One flag's filter result: {flag, verdict, reasons, sanity, members}."""
    sanity = []
    try:
        on_sw, off_sw = sweep(flag, on_value), sweep(flag, "0")
        new = set(gs.monotone_breaches(on_sw)) - set(gs.monotone_breaches(off_sw))
        sanity += [f"monotonicity: {b}" for b in sorted(new)]
        sanity += [f"surf height out of range in the sweep: {h}" for _, h in on_sw
                   if h is not None and not 0 <= h <= gs.SURF_H_MAX_M]
    except Exception as e:                                 # noqa: BLE001 - recorded, the sweep is a sanity aid
        sanity.append(f"sweep could not run: {type(e).__name__}: {e}"[:200])
    res = {"flag": flag, "on_value": on_value, "sanity": sanity}
    if ctx is None:
        res.update({"verdict": "SKIPPED", "reasons": ["no cached history window: the replay did not run"],
                    "members": {}})
    else:
        items, rows_off, rows_on = replay_pair(ctx, flag, on_value)
        res["sanity"] += gs.sanity_rows(rows_on, rows_off)
        v = gs.verdict(items, {s["id"]: s for s in ctx["stations"]})
        res.update(v)
    res["blocks"] = res["verdict"] == gs.WORSE or any(not s.startswith("sweep could not run") for s in res["sanity"])
    return res


def markdown(results: list, window: dict) -> str:
    lines = ["<!-- raw-surf-default-on-filter -->", "## Default-ON history filter (D-065)", "",
             f"Window {window.get('start')} .. {window.get('end')}, leads {window.get('leads')}, primary `{PRIMARY}`; "
             f"ON vs OFF, two-way DM + block bootstrap, pooled / season / region, Holm, margin "
             f"max({gs.MARGIN_ABS_M} m, {gs.MARGIN_REL:.0%} of OFF MAE).", "",
             "| flag | verdict | blocks | reasons |", "|---|---|---|---|"]
    for r in results:
        why = "; ".join(r["reasons"] + r["sanity"])[:600].replace("|", "/")
        lines.append(f"| `{r['flag']}` | {r['verdict']} | {'**yes**' if r['blocks'] else 'no'} | {why} |")
    lines += ["", "WORSE or a sanity breach blocks; anything else does not (ON is the default; 'not proven better' "
              "never blocks)."]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--base", help="git rev of the PR base (flags turned ON since it are filtered)")
    p.add_argument("--flag", action="append", default=[], help="filter this flag too (FLAG or FLAG=on_value)")
    p.add_argument("--cache-dir", default=os.environ.get("EVAL_HARNESS_CACHE"))
    p.add_argument("--hist-index", default=os.environ.get("HIST_CACHE_INDEX"))
    p.add_argument("--out", required=True)
    p.add_argument("--online", action="store_true", help="allow public-data downloads (manual runs only)")
    p.add_argument("--decoder", default="auto")
    a = p.parse_args(argv)
    specs = [(f.split("=")[0], f.split("=")[1] if "=" in f else "1") for f in a.flag]
    if a.base:
        specs += [(f, "1") for f in flags_from_git(a.base) if f not in {s for s, _ in specs}]
    os.makedirs(a.out, exist_ok=True)
    window = pick_window(a.hist_index, a.cache_dir)
    if not specs:
        msg = "no served-number flag is turned ON by this change: nothing to filter"
        print(msg)
        with open(os.path.join(a.out, "filter.md"), "w", encoding="utf-8") as f:
            f.write(f"<!-- raw-surf-default-on-filter -->\n{msg}\n")
        return 0
    ctx = None
    if cache_present(window.get("cache_dir")) or a.online:
        ctx = stage(window, os.path.join(a.out, "stage"), offline=not a.online, decoder=a.decoder)
    else:
        print(f"SKIPPED the history replay: no cache at {window.get('cache_dir')!r} (sanity sweep still runs)")
    results = [evaluate(f, ctx, v) for f, v in specs]
    with open(os.path.join(a.out, "filter.json"), "w", encoding="utf-8") as f:
        json.dump({"window": window, "results": results}, f, indent=1, default=str)
    md = markdown(results, window)
    with open(os.path.join(a.out, "filter.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(md)
    return 1 if any(r["blocks"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
