"""Re-score cached harness runs offline (no download): replay_*.json + truth.json -> eval_harness.score().
usage: python rescore.py <backend dir> <out json>"""
import json
import os
import sys
from datetime import datetime, timezone

BACKEND = sys.argv[1]
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
import eval_harness as eh  # noqa: E402
from services.weather_pipeline import eval_gate as eg  # noqa: E402
from services.weather_pipeline import eval_ratchet as rt  # noqa: E402
from services.weather_pipeline import eval_scoring as sc  # noqa: E402
from services.weather_pipeline import gate_v2_truth as gt  # noqa: E402

SCR = "C:/Users/David/AppData/Local/Temp/claude/C--Users-David-App-raw-surf/3285d99c-2bfe-40f6-8698-6474419931cc/scratchpad"
RUNS = {
    "pr712-inventory dev10t (10-18..10-31)": ("C:/t/flip-run/dev10t", "C:/t/eh0-cache"),
    "surf-spectral-k #706 (10-06..10-15)": ("C:/t/ssk-eh-out", "C:/t/ssk-ehcache"),
    "bight-hs-consensus #707 h5 (W1)": (SCR + "/bhc/h5", "C:/t/eh0-cache"),
}
STATION_FILES = ["C:/t/h2w-scr/stations10.json", "C:/t/h2w-scr/stations_r5.json",
                 os.path.join(BACKEND, "scripts", "eval_harness_stations.json")]


def P(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def main():
    pool = {}
    for f in STATION_FILES:
        for s in json.load(open(f, encoding="utf-8"))["stations"]:
            pool.setdefault(s["id"], s)
    out = {}
    for name, (d, cache) in RUNS.items():
        if not os.path.exists(os.path.join(d, "scorecard.json")):
            continue
        old = json.load(open(os.path.join(d, "scorecard.json"), encoding="utf-8"))
        stations = [pool[s["id"]] for s in old["stations"]]
        tj = json.load(open(os.path.join(d, "truth.json"), encoding="utf-8"))
        truth = {sid: sorted([dict(o, time=P(o["time"])) for o in recs], key=lambda o: o["time"])
                 for sid, recs in tj["records"].items()}
        meta = gt.parse_station_metadata(open(os.path.join(cache, "ndbc", "stationmetadata.xml"),
                                              encoding="utf-8", errors="replace").read())

        def hull_of(sid, t):
            st = next(s for s in stations if s["id"] == sid)
            return "waverider" if st["source"] == "cdip" else gt.hull_at(meta, sid, t)[0]
        arms_rows = {}
        for fn in sorted(os.listdir(d)):
            if fn.startswith("replay_") and fn.endswith(".json"):
                r = json.load(open(os.path.join(d, fn), encoding="utf-8"))
                arm = "served" if fn == "replay_served.json" else r.get("arm") or r.get("name")
                if arm != "served":
                    arm = next((a for a in old["arms"] if eh._slug(a) == fn[7:-5]), arm)
                    r["env_delta"] = old["arms"][arm]["env_delta"]
                arms_rows[arm] = r
        w = old["window"]
        targets = sorted({r["valid"] for r in arms_rows["served"]["rows"]})
        emb = sc.clim_embargo(datetime.strptime(targets[0], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc),
                              datetime.strptime(targets[-1], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc),
                              max(w["leads"]))
        cfg = eg.harness_config()
        b, ctl, arms, parity, ratchet = eh.score(arms_rows, truth, stations, hull_of, old["primary"], cfg, emb,
                                                rt.empty_baseline())
        res = {"window": w["targets"], "controls_state": {q: c["ok"] for q, c in ctl.items()},
               "calibration": {q: c.get("two_way_calibration") for q, c in ctl.items()}, "arms": {}}
        for a, v in arms.items():
            for q, r in v["quantities"].items():
                s = r["summary"]
                res["arms"][f"{a} | {q}"] = {
                    "old": old["arms"][a]["quantities"][q]["verdict"]["verdict"],
                    "new": r["verdict"]["verdict"], "gain": s.get("crps_gain"), "block_ci": s.get("crps_gain_ci"),
                    "station_ci": (s.get("station_cluster") or {}).get("ci"),
                    "two_way": {k: (s.get("two_way") or {}).get(k) for k in ("computable", "ci", "blocks", "days",
                                                                              "df", "reason", "block_names")},
                    "reasons": r["verdict"]["reasons"][:4]}
        out[name] = res
        print(name, json.dumps({k: (x["old"], x["new"], x["two_way"]["ci"], x["two_way"]["days"])
                                for k, x in res["arms"].items()}), flush=True)
    json.dump(out, open(sys.argv[2], "w"), indent=1, default=str)


if __name__ == "__main__":
    main()
