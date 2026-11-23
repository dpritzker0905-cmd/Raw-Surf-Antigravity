#!/usr/bin/env python3
"""Freeze the served-wave-verify-v1 buoy list (gate section 3) from committed inputs only.

  --boxes-from-public <boxes.json>   read the regional box bounds from the PUBLISHED v1/latest.json and indexes (anonymous
                                     public read, the client's path; section 2a "read from the published latest.json and
                                     indexes at freeze") and write them, so the freeze itself is reproducible offline
  --freeze                           pool + catalogue + boxes -> the list (+ its .sha256)
  --tag                              amendment 2: the version 1 freeze (same inputs, same frozen_at) + the committed fit-used
                                     census -> the version 2 list (fit_used / fit_used_by / locked tags, holdout block)

Selection uses the gate's rules ONLY (no skill, no forecast read):
  * ACTIVE: the probe saw >= ACTIVE_MIN_ROWS realtime2 rows with a QC-passing WVHT,
    the last within ACTIVE_MAX_AGE_D days of the probe, and the station page gave a position and a water depth (a station
    whose page gives no depth cannot show depth >= 20 m and is left out);
  * NDBC: depth >= 20 m; per region, the most completely reporting stations (WVHT rows, then id) up to the gate's target;
  * the remainder (to TOTAL) covers gaps: the `other` pool first (Europe, East Asia), then a round-robin over the regions;
  * CDIP: exam_only, never in a pooled cell; at most CDIP_CAP per region; depth < 20 m only as the `nearshore` stratum;
  * WMO ids distinct (an NDBC 5-character id is its WMO id);
  * stratum: nearshore (< 20 m) | sheltered (SHELTER_RULE) | exposed;
  * regional_box per "<MODEL>/<layer>": buoys.pick_box over the published bounds.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.point_archive import buoys as buoylist  # noqa: E402
from services.point_archive import core  # noqa: E402

GATES = Path(__file__).resolve().parents[2] / "docs" / "weather-program" / "gates"
POOL = GATES / "served-wave-verify-v1-buoys.pool.json"
CATALOGUE = GATES / "served-wave-verify-v1-buoys.catalogue.json"
BOXES = GATES / "served-wave-verify-v1-boxes.json"
FIT_USED = GATES / "served-wave-verify-v1-fit-used.json"
VERSION = "served-wave-verify-v1-buoys/1"
VERSION_2 = "served-wave-verify-v1-buoys/2"
HOLDOUT_GATE = "docs/weather-program/gates/served-wave-skill-v1.md"
HOLDOUT_RULE = ("#1199 section 1a: LOCKED buoys are archived like every other, but the scorer reads none of them and every "
                "published table and printed line excludes them, keyed to the frozen LOCKED list by its SHA-256. Until "
                "locked_list is recorded, the scorer is collect-only (NOT_READ) and publishes nothing. fit_used buoys stay in "
                "this lane's indicative tables, tagged, and #1199's P1 excludes them.")
TARGETS = {"us_west": 20, "us_east": 15, "gulf": 8, "hawaii": 8, "alaska": 5, "canada": 8, "caribbean": 6, "open_ocean": 10}
TOTAL = 100
CDIP_CAP = 2
ACTIVE_MIN_ROWS = 20            # at least 20 rows with a QC-passing WVHT in the realtime2 file
ACTIVE_MAX_AGE_D = 3
MIN_DEPTH_M = 20.0
SHELTER_RULE = ("sheltered = the station lies inside a named bay, sound, strait or channel, or in the lee of a named island "
                "chain or headland, as written per station in the pool file's `sheltered` map (the feature is recorded); "
                "absent = exposed")
NEARSHORE_EVAL_RULE = ("#1156 truth.select_stations: directional, 10-40 m, not USACE FRF Duck, not assimilated into the "
                       "driving model, no unresolved harbour structure within 1 km. The first four are evaluated here; the "
                       "harbour criterion is the nearshore lane's (gate 0.4), so no station carries the tag yet.")
BOX_LAYERS = {"GFS": ("waves", "swell_1", "swell_2", "wind_waves"), "EURO": ("waves",), "ICON": ("waves", "swell_1", "wind_waves")}


def active(c, probed_at):
    """Reporting WVHT now. realtime2 holds 45 days for NDBC-run stations but only the last ~24 h for the ECCC (Canadian)
    stations NDBC mirrors (probe 2026-11-23: 11-25 rows), and met rows come every 10 min while WVHT is hourly (a share of rows
    reads ~0.48 at a healthy station), so the test is a floor of WVHT reports plus a recent report; ranking does the rest."""
    if c.get("error") or c.get("lat") is None or c.get("depth_m") is None or not c.get("last_time"):
        return False
    age = probed_at - core.parse_time(c["last_time"])
    return c.get("wvht_rows", 0) >= ACTIVE_MIN_ROWS and age <= timedelta(days=ACTIVE_MAX_AGE_D)


def _order(c):
    return (-c.get("wvht_rows", 0), c["id"])


def select(pool, catalogue):
    """[(station catalogue row, region, source)] by the rules above. PURE."""
    probed_at = core.parse_time(catalogue["probed_at"])
    cat = {c["id"]: c for c in catalogue["stations"]}
    picked, used = [], set()

    def ok(i, ndbc=True):
        c = cat.get(i)
        return c is not None and i not in used and active(c, probed_at) and (not ndbc or c["depth_m"] >= MIN_DEPTH_M)

    for region, target in TARGETS.items():
        for c in sorted((cat[i] for i in pool["regions"].get(region, []) if ok(i)), key=_order)[:target]:
            picked.append((c, region, "ndbc"))
            used.add(c["id"])
    cdip = []
    for region, ids in sorted(pool["cdip"].items()):
        for c in sorted((cat[i] for i in ids if ok(i, ndbc=False)), key=_order)[:CDIP_CAP]:
            cdip.append((c, region, "cdip"))
            used.add(c["id"])
    room = TOTAL - len(picked) - len(cdip)
    other = sorted((cat[i] for i in pool["regions"].get("other", []) if ok(i)), key=_order)
    for c in other[:max(0, room)]:
        picked.append((c, "other", "ndbc"))
        used.add(c["id"])
    room = TOTAL - len(picked) - len(cdip)
    # then ROUND-ROBIN over the regions in TARGETS order, each region's next most completely reporting leftover in turn, so
    # the remainder spreads across regions instead of piling into the one with the most spare stations
    left = {r: sorted((cat[i] for i in pool["regions"].get(r, []) if ok(i)), key=_order) for r in TARGETS}
    while room > 0 and any(left.values()):
        for r in TARGETS:
            if room <= 0:
                break
            while left[r] and left[r][0]["id"] in used:
                left[r].pop(0)
            if left[r]:
                c = left[r].pop(0)
                picked.append((c, r, "ndbc"))
                used.add(c["id"])
                room -= 1
    return picked + cdip


def nearshore_checks(c):
    return {"directional": bool(c.get("mwd_rows")) and bool(c.get("spec")),
            "depth_10_40_m": c["depth_m"] is not None and 10.0 <= c["depth_m"] <= 40.0,
            "not_usace_frf": "FRF" not in str(c.get("owner") or "").upper() and c["id"] not in ("44056", "44100"),
            "not_assimilated": True, "harbour_unresolved_within_1km": "pending (nearshore lane, gate 0.4)"}


def freeze(pool, catalogue, boxes, frozen_at):
    rows = []
    for c, region, source in select(pool, catalogue):
        shelter = pool["sheltered"].get(c["id"])
        stratum = "nearshore" if c["depth_m"] < MIN_DEPTH_M else ("sheltered" if shelter else "exposed")
        rows.append({"id": c["id"], "wmo_id": c["id"], "name": c.get("name"), "owner": c.get("owner"),
                     "lat": round(c["lat"], 4), "lon": round(c["lon"], 4), "depth_m": c["depth_m"], "region": region,
                     "source": source, "exam_only": source == "cdip", "sheltered": shelter, "stratum": stratum,
                     "purposes": ["served"], "nearshore_eval_checks": nearshore_checks(c),
                     "gulf": region == "gulf", "wvht_rows_at_probe": c.get("wvht_rows"), "spec": bool(c.get("spec"))})
    rows.sort(key=lambda r: r["id"])
    sets = {k: v for k, v in boxes["sets"].items()}
    assign = buoylist.assign_boxes(rows, sets)
    for r in rows:
        r["regional_box"] = assign[r["id"]]
    return {"version": VERSION, "frozen_at": frozen_at, "gate": "docs/weather-program/gates/served-wave-verify-v1.md",
            "inputs": {"pool": pool["version"], "catalogue_probed_at": catalogue["probed_at"],
                       "boxes_read_at": boxes["read_at"], "boxes_latest_written_at": boxes.get("latest_written_at")},
            "rules": {"targets": TARGETS, "total": TOTAL, "cdip_cap_per_region": CDIP_CAP, "active_min_wvht_rows": ACTIVE_MIN_ROWS,                      "active_max_age_days": ACTIVE_MAX_AGE_D, "min_depth_m": MIN_DEPTH_M, "sheltered": SHELTER_RULE,
                      "nearshore_eval": NEARSHORE_EVAL_RULE, "regional_box": buoylist.__doc__.split("Regional box rule")[1].strip()},
            "stations": rows}


def tag(doc, census, locked_list=None):
    """The version 2 list: `doc` (a version 1 freeze) with each station's fit_used / fit_used_by from `census` (consumer ->
    ids; intersected with the list) and `locked` (None until #1199's freeze), plus the holdout block."""
    by = {}
    for name, c in sorted(census["consumers"].items()):
        for i in c["ids"]:
            by.setdefault(str(i).upper(), []).append(name)
    rows = []
    for s in doc["stations"]:
        users = sorted(by.get(s["id"].upper(), []))
        rows.append({**s, "fit_used": bool(users), "fit_used_by": users, "locked": None})
    return {**doc, "version": VERSION_2, "stations": rows,
            "holdout": {"gate": HOLDOUT_GATE, "rule": HOLDOUT_RULE, "locked_list": locked_list,
                        "fit_used_census": {"path": "docs/weather-program/gates/" + FIT_USED.name, "taken_at": census["taken_at"],
                                            "canon_sha256": core.sha256_hex(core.canon(census).encode("utf-8")),
                                            "open": [o["consumer"] for o in census.get("open", [])]}}}


def boxes_from_public(frames):
    latest = json.loads(frames.get("v1/latest.json", bust=True))
    sets = {}
    for key in sorted(latest["sets"]):
        model, _domain, layer, region = key.split("/")
        rec = latest["sets"][key]
        if layer not in BOX_LAYERS.get(model, ()) or not rec.get("bundle") or not rec.get("index"):
            continue
        if region.endswith(("_rated", "_filled")):
            continue
        g = (json.loads(frames.get(rec["index"])).get("grid") or {}).get("bounds")
        if g:
            sets.setdefault(f"{model}/{layer}", {})[region] = {k: float(g[k]) for k in ("west", "south", "east", "north")}
    return {"about": "Regional box bounds (index grid = tile lattice) read anonymously from the published v1/latest.json",
            "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "latest_written_at": latest.get("written_at"), "sets": sets}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--boxes-from-public", metavar="OUT")
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--tag", action="store_true")
    ap.add_argument("--out", default=str(buoylist.LIST_PATH))
    a = ap.parse_args(argv)
    if a.boxes_from_public:
        from services.point_archive.storage import PublicFrames
        doc = boxes_from_public(PublicFrames())
        Path(a.boxes_from_public).write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        print(f"[freeze] boxes: {sum(len(v) for v in doc['sets'].values())} across {len(doc['sets'])} sets")
    if a.freeze:
        load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))  # noqa: E731
        doc = freeze(load(POOL), load(CATALOGUE), load(BOXES), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        problems = buoylist.validate(doc)
        if problems:
            raise SystemExit("freeze refused: " + "; ".join(problems))
        Path(a.out).write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        h = buoylist.list_hash(buoylist.load(a.out))
        Path(a.out + ".sha256").write_text(f"{h}  {Path(a.out).name}\n", encoding="utf-8", newline="\n")
        print(f"[freeze] {len(doc['stations'])} stations; buoy_list_hash {h}")
    if a.tag:
        load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))  # noqa: E731
        current = buoylist.load(a.out)
        doc = tag(freeze(load(POOL), load(CATALOGUE), load(BOXES), current["frozen_at"]), load(FIT_USED),
                  (current.get("holdout") or {}).get("locked_list"))
        problems = buoylist.validate(doc)
        if problems:
            raise SystemExit("tag refused: " + "; ".join(problems))
        Path(a.out).write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        h = buoylist.list_hash(buoylist.load(a.out))
        Path(a.out + ".sha256").write_text(f"{h}  {Path(a.out).name}\n", encoding="utf-8", newline="\n")
        print(f"[tag] {sum(s['fit_used'] for s in doc['stations'])} fit_used of {len(doc['stations'])}; buoy_list_hash {h}")


if __name__ == "__main__":
    main()
