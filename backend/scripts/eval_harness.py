#!/usr/bin/env python3
"""eval_harness.py - EVALUATION HARNESS v0: reference-data provenance, forecast-of-record replay, baselines, and the
regression / rollback gate, in one offline CLI. Serves nothing, writes nothing inside the repository, changes no
served number. Docs: docs/weather-program/evaluation-harness.md (how a flag flip must pass this gate).

    python scripts/eval_harness.py run --stations scripts/eval_harness_stations.json \
        --start 2026-10-20T00:00Z --end 2026-10-29T18:00Z --cache-dir C:/t/eh0-cache --out C:/t/eh0-out \
        --arm SURF_TIDE_DEPTH=1

STAGES (each writes a panel + a provenance manifest beside it, under --out):
  1. truth      every station's public record (CDIP / NDBC / CO-OPS), QC flags kept      truth.json
  2. forecast   GFS-Wave crops for every (cycle, forecast hour) the targets need            forecast_crops.json
  3. replay     the served chain under the served env, then under each candidate arm       replay_<arm>.json
  4. score      baselines, controls, every arm on every quantity, the verdicts              scorecard.json / .md
Network: public data hosts only (eval_provenance.ALLOWED_HOSTS), one request at a time, cached; never the app.
Gate: the BINDING uncertainty rule is the two-way spatial block x day CI over >= 14 UTC target days (D-066,
eval_twoway.py); it must pass its synthetic-null self-test first, else the run is REFUSED before any download.
Exit code: 0 when every candidate arm PASSES on the primary quantity (or --exit-zero), 1 otherwise, 2 on error.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import runtime_flags as _rf  # noqa: E402
from services.weather_pipeline import eval_gate as eg  # noqa: E402
from services.weather_pipeline import eval_gfswave as gw  # noqa: E402
from services.weather_pipeline import eval_provenance as pv  # noqa: E402
from services.weather_pipeline import eval_ratchet as rt  # noqa: E402
from services.weather_pipeline import eval_reference as rf  # noqa: E402
from services.weather_pipeline import eval_replay as rp  # noqa: E402
from services.weather_pipeline import eval_scoring as sc  # noqa: E402
from services.weather_pipeline import eval_twoway as tw  # noqa: E402
from services.weather_pipeline import gate_v2_truth as gt  # noqa: E402

FLAG_PREFIXES = ("SURF_", "RATING_", "SAMPLER_", "CONSENSUS_", "SHORE_NORMAL_", "SPOT_RATINGS_", "MARINE_")
NAMED_GAPS = {
    "size_reference": "RATING_LOCAL_SIZE=1 grades against a per-spot size climatology in storage; replay passes None "
                      "(the global 1.2 m curve). Scores differ from served where a spot has a climatology; heights do not.",
    "obs_gate": "RATING_OBS_GATE=1 caps model-only good/epic at 69.9 unless >= 2 models agree or a report confirms; "
                "applied after rating in the precompute merge. Replay scores are PRE-gate.",
    "best_tide": "the spot's best_tide prior (DB) is unknown, so tide_fit is neutral even with a tide state.",
    "primary_swell": "the display-only swell_1 field is not replayed (no score or height effect).",
    "tide_missing": "spot-hours where no tide series was available (tide_norm None, eta 0).",
    "tide_replayed": "spot-hours that read the served tide source (Open-Meteo sea_level_height_msl) by date "
                     "through the production tide_state_at (not a gap: counted for linkage).",
}
SUBSTITUTIONS = {
    "grid": "served /point samples the stored normalized product (regional tiles / coarse globals); the replay "
            "runs the same PointSampler on a native 0.25 deg GFS-Wave crop.",
    "wind_gfswave": "only with the built-in decoder (no pygrib, no eccodes) is the rating wind the GFS-Wave file's "
                    "UGRD/VGRD (the GFS 10 m forcing on the same grid) instead of the atmosphere file's pgrb2.0p25 "
                    "UGRD/VGRD 10 m; rows say which (input_parity.wind_sources).",
    "repo_variables": "workflow `${{ vars.X || 'd' }}` values resolve to their defaults d (repository variables are "
                      "not readable offline); listed in served_env.repo_variables_defaulted.",
    "tide_series": "served fetches forecast_days=3 at run time; replay fetches the same Open-Meteo series by "
                   "start/end date (a deterministic tide).",
}


def git_state() -> dict:
    def g(*a):
        try:
            return subprocess.run(["git", "-C", REPO, *a], capture_output=True, encoding="utf-8", timeout=30).stdout
        except Exception:                                               # noqa: BLE001
            return ""
    dirty = [ln for ln in g("status", "--porcelain").splitlines() if ln and not ln.startswith("??")]
    return {"commit": g("rev-parse", "HEAD").strip() or "unknown", "dirty": bool(dirty)}


def _coords(st: dict) -> list:
    if st["role"] == "offshore":
        return [({"name": f"{st['id']} buoy", "lat": st["lat"], "lng": st["lng"]}, True)]
    anchor = st["anchor_spot"]
    others = [s for s in st.get("spots", []) if (s["lat"], s["lng"]) != (anchor["lat"], anchor["lng"])]
    return [(anchor, True)] + [(s, False) for s in others]


def stage_truth(cache, stations, t_lo, t_hi, out_dir):
    meta = None
    if any(s["source"] == "ndbc" for s in stations):
        raw, _ = cache.fetch("ndbc/stationmetadata.xml", rf.NDBC_META, source="ndbc_station_metadata",
                             parser="gate_v2_truth.parse_station_metadata", time_standard="dates (UTC)")
        meta = gt.parse_station_metadata(raw.decode("utf-8", "replace"))
    truth, summary = {}, {}
    for st in stations:
        got = rf.fetch_station(cache, st, (t_lo, t_hi), meta)
        good = [o for o in rf.good(got["obs"]) if t_lo <= o["time"] <= t_hi]
        truth[st["id"]] = good
        qc = {}
        for o in got["obs"]:
            if t_lo <= o["time"] <= t_hi:
                qc[o["qc"]] = qc.get(o["qc"], 0) + 1
        summary[st["id"]] = {"role": st["role"], "source": st["source"], "meta": got["meta"], "qc_counts": qc,
                             "good_in_window": len(good), "extra": got["extra"]}
    panel = {st: [{"time": o["time"].strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": o["hs_m"], "tp_s": o.get("tp_s"),
                   "dp_deg": o.get("dp_deg"), "qc": o["qc"]} for o in obs] for st, obs in truth.items()}
    pv.write_json(os.path.join(out_dir, "truth.json"), {"stations": summary, "records": panel})
    pv.write_json(os.path.join(out_dir, "truth.manifest.json"), pv.manifest(cache.records, "truth"))

    def hull_of(sid, t):
        st = next(s for s in stations if s["id"] == sid)
        if st["source"] == "cdip":
            return "waverider"
        return gt.hull_at(meta or {}, sid, t)[0]
    return truth, summary, hull_of


def stage_forecast(cache, stations, targets, leads, out_dir, fields_fn, wind_source, decoder, kread=False,
                   parts_fn=gw.fetch_partitions):
    """`kread`: the served env or an arm runs SURF_SPECTRAL_K (default OFF), so each (cycle, fh) also
    fetches the partition span and crops it at every read point (spectral_k_serving.READ_POINTS); the jobs carry those
    crops as products["kread"]. A partition span that cannot be read is COUNTED (`failed`, stage "partitions") and that
    file's jobs keep the bulk chain; it never costs the file's base fields."""
    from services.weather_pipeline.spectral_k_serving import READ_POINTS
    plan = gw.plan(targets, leads)
    need = sorted({(c, fh) for c, fh, _, _ in plan})
    crops, infos, failed, n0 = {}, {}, [], len(cache.records)
    for c, fh in need:
        try:
            fields, _, info = fields_fn(cache, c, fh, wind_source=wind_source, decoder=decoder)
        except pv.BudgetExceeded:
            raise                                                       # a budget is a refusal, never a gap
        except Exception as e:                                          # noqa: BLE001 - counted, never silent
            failed.append({"cycle": f"{c:%Y-%m-%dT%HZ}", "fh": fh, "error": f"{type(e).__name__}: {e}"[:200]})
            continue
        infos[(c, fh)] = info
        for st in stations:
            for coord, _ in _coords(st):
                crops[(c, fh, coord["name"])] = gw.crop(fields, coord["lat"], coord["lng"])
        got_parts = False
        if kread:
            try:
                pf, _ = parts_fn(cache, c, fh, decoder=decoder)
                fields.update(pf)
                got_parts = True
            except pv.BudgetExceeded:
                raise
            except Exception as e:                                      # noqa: BLE001 - counted, never silent
                failed.append({"cycle": f"{c:%Y-%m-%dT%HZ}", "fh": fh, "stage": "partitions",
                               "error": f"{type(e).__name__}: {e}"[:200]})
        if got_parts:
            for region, _, _, rla, rlo in READ_POINTS:
                crops[(c, fh, f"kread:{region}")] = gw.crop(fields, rla, rlo, gw.READ_CROP_HALF_DEG,
                                                             keys=("HTSGW", "PERPW", "DIRPW") + gw.PART_KEYS)
        del fields
    pv.write_json(os.path.join(out_dir, "forecast_crops.json"),
                  {"plan": len(plan), "files": len(need), "failed": failed,
                   "infos": [dict(v, key=f"{k[0]:%Y%m%d%H}/f{k[1]:03d}") for k, v in infos.items()],
                   "crops": {f"{k[0]:%Y%m%d%H}/f{k[1]:03d}/{k[2]}": v for k, v in crops.items()}})
    pv.write_json(os.path.join(out_dir, "forecast_crops.manifest.json"),
                  pv.manifest(cache.records[n0:], "forecast_crops", {
                      "grib_backends": sorted({i.get("grib_backend") for i in infos.values() if i.get("grib_backend")}),
                      "grib_backend_versions": sorted({i.get("grib_backend_version") for i in infos.values()
                                                       if i.get("grib_backend_version")}),
                      "wind_sources": sorted({i["wind_source"] for i in infos.values()})}))
    jobs = []
    for c, fh, lead, t in plan:
        if (c, fh) not in infos:
            continue
        kprods = ({region: dict(gw.layer_products(crops[(c, fh, f"kread:{region}")], c, t), _at=(rla, rlo))
                   for region, _, _, rla, rlo in READ_POINTS} if (c, fh, "kread:socal") in crops else None)
        for st in stations:
            for coord, anchor in _coords(st):
                prods = gw.products(crops[(c, fh, coord["name"])], c, t)
                if kprods:
                    prods["kread"] = kprods
                jobs.append({"station": st["id"], "coord": coord, "anchor": anchor, "cycle": c, "fh": fh,
                             "lead": lead, "valid": t, "info": infos[(c, fh)], "products": prods})
    return jobs, {"files": len(need), "failed": failed}


def score(arms_rows, truth, stations, hull_of, primary, cfg, embargo, baseline, controls_cfg=None):
    by_id = {s["id"]: s for s in stations}
    served_rows = arms_rows["served"]["rows"]
    parity = eg.input_parity(served_rows)
    card_baselines, card_controls, arms = {}, {}, {}
    items_served = {}
    for q in sc.QUANTITIES:
        items, qc = sc.build_items(q, served_rows, truth, by_id, hull_of, clim_embargo=embargo)
        items_served[q] = (items, qc)
    ratchet = {"served_state": {}, "alarms": []}
    for q, (items, qc) in items_served.items():
        lst = list(items.values())
        thr = sc.quantile([i["obs"] for i in lst], 0.90)
        card_baselines[q] = dict(eg.baseline_block(items, cfg, thr), join_qc=qc, p90_threshold_m=thr,
                                 span=sc.hours_span(lst), leads=sc.lead_hours(lst), weeks=sc.weeks(lst))
        base = [dict(i, f_ref=i["f"]) for i in sorted(lst, key=lambda i: (i["t"], i["buoy"], i["lead"]))]
        card_controls[q] = eg.run_controls(base, controls_cfg or cfg, thr)
        ratchet["served_state"][q] = rt.served_state(lst, cfg)
        ratchet["alarms"] += rt.alarms(ratchet["served_state"][q], q)
    for arm, res in arms_rows.items():
        if arm == "served":
            continue
        arms[arm] = {"env_delta": res["env_delta"], "gaps": res["gaps"], "quantities": {},
                     "impact": eg.impact(served_rows, res["rows"]),
                     # Evidence the flag was READ: the named-gap counters differ from the served arm's when a flag
                     # adds a lookup (SURF_TIDE_DEPTH doubles the tide reads). Equal counters prove nothing.
                     "flag_reads": {k: res["gaps"][k] - arms_rows["served"]["gaps"][k] for k in res["gaps"]
                                    if res["gaps"][k] != arms_rows["served"]["gaps"][k]}}
        for q, (items, _) in items_served.items():
            cand, _ = sc.build_items(q, res["rows"], truth, by_id, hull_of, clim_embargo=embargo)
            pairs = sc.pair(items, cand)
            thr = card_baselines[q]["p90_threshold_m"]
            s = eg.summarize(pairs, cfg, thr)
            s["two_way_calibration"] = card_controls[q].get("two_way_calibration")
            v = rt.apply(eg.rules(s, cfg, card_controls[q]["ok"]), rt.candidate_rules(pairs, baseline, q, cfg))
            vs = eg.versus_baselines(pairs, cfg, thr)
            v["warnings"] += eg.baseline_warnings(vs)
            if not parity["production_parity"]:
                v["warnings"].append(f"inputs substituted (decoders {parity['decoders']}, wind {parity['wind_sources']}): "
                                     f"the verdict is scoped to the replay, not production parity")
            arms[arm]["quantities"][q] = {"summary": s, "verdict": v, "versus_baselines": vs}
    eg.holm_across_arms(arms, primary, cfg)
    return card_baselines, card_controls, arms, parity, ratchet


def run(args, get=pv.http_get, fields_fn=gw.fetch_fields, cfg=None) -> dict:
    cfg = cfg or eg.harness_config()
    # D-066: the binding two-way gate must pass its null self-test before any work (CalibrationFailed = REFUSED).
    self_test = tw.require_calibrated()
    deltas = [("served", {})] + [(a, rp.parse_arm(a)) for a in args.arm]     # refuse a bad arm before any work
    start, end = rp.parse_time(args.start), rp.parse_time(args.end)
    targets = gw.targets_between(start, end, args.step_h)
    leads = [int(x) for x in args.leads.split(",")]
    reg = rf.load_stations(args.stations)
    stations = reg["stations"]
    cache = pv.Cache(args.cache_dir, get=get, pause_s=args.pause_s, offline=args.offline,
                     max_range_downloads=args.max_range_downloads, max_total_bytes=args.max_bytes)
    os.makedirs(args.out, exist_ok=True)
    served = rp.served_env(args.served_env_root or REPO)
    # Truth reaches back clim_days BEFORE the embargo (first target - max lead): the out-of-sample climatology's span.
    embargo = sc.clim_embargo(targets[0], targets[-1], max(leads))
    t_lo = embargo[0] - timedelta(days=args.clim_days)
    t_hi = end + timedelta(hours=2)
    truth, truth_summary, hull_of = stage_truth(cache, stations, t_lo, t_hi, args.out)
    # SURF_SPECTRAL_K is GUARDED (D-065): an empty lane value defers to the code default, so the replay asks for the
    # read-point partitions whenever the EFFECTIVE value of any arm is '1'.
    kread = any((dict(served["env"], **d).get("SURF_SPECTRAL_K") or _rf.GUARDED.get("SURF_SPECTRAL_K", "0")) == "1"
                for _, d in deltas)
    jobs, fc = stage_forecast(cache, stations, targets, leads, args.out, fields_fn, args.wind_source, args.decoder,
                              kread=kread)
    tides = rp.TideSeries(cache, min(j["cycle"] for j in jobs) if jobs else start, end, enabled=not args.no_tide)
    stray = sorted(k for k in os.environ if k.startswith(FLAG_PREFIXES) and k not in served["env"])
    scrub = served["secrets_named"] + stray
    arms_rows = {}
    for name, delta in deltas:
        res = rp.replay_arm(name, dict(served["env"], **delta), scrub, jobs, tides, {s["id"]: s for s in stations})
        res["env_delta"] = delta
        arms_rows[name] = res
        pv.write_json(os.path.join(args.out, f"replay_{_slug(name)}.json"), res)
    baseline = rt.load_baseline(args.ratchet_baseline)
    baselines, controls, arms, parity, ratchet = score(arms_rows, truth, stations, hull_of, args.primary, cfg,
                                                       embargo, baseline)
    generated = pv.utc_now_iso()
    eligible = controls[args.primary]["ok"] is True and parity["production_parity"]
    ratchet.update({"baseline_path": args.ratchet_baseline, "locks_before": baseline.get("locks", {}),
                    "eligible_to_lock": eligible, "update_requested": bool(args.update_ratchet),
                    "would_lock": {q: rt.would_lock(s) for q, s in ratchet["served_state"].items()},
                    "embargo": [embargo[0].strftime("%Y-%m-%dT%H:%MZ"), "open"],
                    "climatology": {q: baselines[q]["join_qc"].get("climatology") for q in baselines}})
    newly = {}
    if args.update_ratchet:
        new = baseline
        for q, s in ratchet["served_state"].items():
            new, added = rt.update_baseline(new, s, q, eligible, {"generated_utc": generated, "code": git_state(),
                                                                  "window": [args.start, args.end],
                                                                  "stations": [x["id"] for x in stations]})
            if added:
                newly[q] = added
        if new != baseline:                        # new pending entries or locks
            rt.save_baseline(args.ratchet_baseline, new, baseline)
        baseline = new
    ratchet["newly_locked"], ratchet["locks_after"] = newly, baseline.get("locks", {})
    ratchet["pending_after"] = baseline.get("pending", {})
    env_digest = pv.sha256_bytes(json.dumps(served["env"], sort_keys=True).encode())
    card = {
        "schema": eg.SCHEMA, "generated_utc": generated, "code": git_state(), "alarms": ratchet["alarms"],
        "ratchet": ratchet,
        "primary": args.primary, "served_env": {k: served[k] for k in ("workflow", "sha256", "job", "step",
                                                                          "repo_variables_defaulted",
                                                                          "secrets_named", "other_expressions")},
        "served_env_values": served["env"], "scrubbed_env_names": scrub,
        "window": {"start": args.start, "end": args.end, "step_h": args.step_h, "leads": leads,
                   "targets": f"{len(targets)} targets {targets[0]:%Y-%m-%dT%HZ}..{targets[-1]:%Y-%m-%dT%HZ}",
                   "climatology_from": t_lo.astimezone(timezone.utc).strftime("%Y-%m-%dT%HZ"),
                   "climatology_embargo_from": embargo[0].astimezone(timezone.utc).strftime("%Y-%m-%dT%HZ")},
        "stations": [{"id": s["id"], "role": s["role"], "source": s["source"],
                      "meta_version": truth_summary[s["id"]]["meta"].get("version"),
                      "good_in_window": truth_summary[s["id"]]["good_in_window"]} for s in stations],
        "forecast": fc, "quantities": sc.QUANTITIES,
        "budget": {"range_downloads": cache.range_downloads, "max_range_downloads": args.max_range_downloads,
                   "downloaded_bytes": cache.downloaded_bytes, "max_bytes": args.max_bytes}, "config": _cfg_doc(cfg), "input_parity": parity,
        "served_env_digest": env_digest,
        "gaps": {"named": NAMED_GAPS, "substitutions": SUBSTITUTIONS,
                 "counts": arms_rows["served"]["gaps"],
                 "unreplayable_flags": rp.UNREPLAYABLE},
        "two_way_self_test": eg._cal_summary(self_test),
        "baselines": baselines, "controls": controls, "controls_ok": controls[args.primary]["ok"] is True,
        "controls_state": controls[args.primary]["ok"],
        "arms": arms,
        "provenance": {"manifests": ["truth.manifest.json", "forecast_crops.manifest.json", "scorecard.manifest.json"],
                       "files_digest": pv.manifest(cache.records, "all")["files_digest"]},
    }
    pv.write_json(os.path.join(args.out, "scorecard.json"), card)
    pv.write_json(os.path.join(args.out, "scorecard.manifest.json"),
                  pv.manifest(cache.records, "scorecard", {"served_env_sha256": served["sha256"],
                                                           "served_env_digest": env_digest, "code": card["code"],
                                                           "grib_backends": parity["decoders"],
                                                           "grib_backend_versions": parity["backend_versions"],
                                                           "config": card["config"], "input_parity": parity,
                                                           "arms": {a: r["env_delta"] for a, r in arms_rows.items()},
                                                           "panel_sha256": _panel_hashes(args.out)}))
    with open(os.path.join(args.out, "scorecard.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(eg.markdown(card))
    return card


def _panel_hashes(out_dir: str) -> dict:
    """sha256 of every panel already written (truth, crops, replays, the scorecard itself)."""
    out = {}
    for fn in sorted(os.listdir(out_dir)):
        if fn.endswith(".json") and not fn.endswith(".manifest.json"):
            with open(os.path.join(out_dir, fn), "rb") as f:
                out[fn] = pv.sha256_bytes(f.read())
    return out


def _cfg_doc(cfg) -> dict:
    d = {k: getattr(cfg, k) for k in ("alpha_overall", "alpha_harm", "primary_loss", "secondary_losses",
                                      "require_bootstrap_agree", "bootstrap_reps", "bootstrap_seed", "ci_level",
                                      "min_series_len", "min_n_overall", "min_n_decide", "leads", "required_bands")}
    d["bands"] = [{"label": b.label, "min_obs_m": b.min_obs_m, "top_share": b.top_share,
                   "max_bias_worsen_m": b.max_bias_worsen_m} for b in cfg.bands]
    return d


def _slug(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s)[:80] or "arm"


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--stations", default=os.path.join(HERE, "eval_harness_stations.json"))
    r.add_argument("--start", required=True)
    r.add_argument("--end", required=True)
    r.add_argument("--step-h", type=int, default=6)
    r.add_argument("--leads", default="24,48,72")
    r.add_argument("--cache-dir", default=os.environ.get("EVAL_HARNESS_CACHE"))
    r.add_argument("--out", required=True)
    r.add_argument("--arm", action="append", default=[], help="candidate FLAG=value[,FLAG=value]; repeatable")
    r.add_argument("--primary", default="hs_station", choices=sorted(sc.QUANTITIES))
    r.add_argument("--clim-days", type=int, default=30,
                   help="days of truth BEFORE the embargo (first target - max lead) the out-of-sample climatology reads")
    r.add_argument("--wind-source", default="auto", choices=("auto", "gfswave", "pgrb2"))
    r.add_argument("--decoder", default="auto", choices=("auto", "builtin", "pygrib", "eccodes"),
                   help="GRIB backend; auto = pygrib, else eccodes, else the built-in decoder")
    r.add_argument("--ratchet-baseline", default=os.path.join(HERE, "eval_harness_ratchet.json"),
                   help="the climatology ratchet's lock file (the floor only rises)")
    r.add_argument("--update-ratchet", action="store_true",
                   help="add locks this run earns (eligible runs only: controls pass + production parity)")
    r.add_argument("--pause-s", type=float, default=0.5)
    r.add_argument("--offline", action="store_true", help="read the cache only; never the network")
    r.add_argument("--served-env-root", default=None,
                   help="a checkout whose precompute.yml defines the SERVED env (the flip job: the merge base)")
    r.add_argument("--max-range-downloads", type=int, default=None, help="refuse past this many byte-range GETs")
    r.add_argument("--max-bytes", type=int, default=None, help="refuse past this many downloaded bytes")
    r.add_argument("--no-tide", action="store_true")
    r.add_argument("--exit-zero", action="store_true")
    r.add_argument("--allow-substitutions", action="store_true",
                   help="let a run without production input parity (pygrib + pgrb2 wind) exit 0 on PASS")
    return p


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    if not args.cache_dir:
        print("--cache-dir (or EVAL_HARNESS_CACHE) is required: downloaded data never goes in the repo")
        return 2
    try:
        card = run(args)
    except (pv.CacheRefused, pv.NetworkRefused, ValueError, rf.RegistryError) as e:
        print(f"REFUSED: {e}")
        return 2
    print(json.dumps({"controls_ok": card["controls_ok"], "verdicts": eg.verdict_line(card)}, indent=1))
    passed = card["controls_ok"] and all(
        r["quantities"][card["primary"]]["verdict"]["verdict"] == "PASS" for r in card["arms"].values())
    if not (card["input_parity"]["production_parity"] or args.allow_substitutions):
        print("inputs substituted (no production parity): exit 1 unless --allow-substitutions")
        passed = False
    return 0 if (passed or args.exit_zero) else 1


if __name__ == "__main__":
    sys.exit(main())
