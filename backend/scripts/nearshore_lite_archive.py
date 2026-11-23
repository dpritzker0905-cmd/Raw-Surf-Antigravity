#!/usr/bin/env python3
"""Forward-archive job for the MOP-lite gate (docs/weather-program/gates/nearshore-moplite-v1.md section 5). CI only, NEVER Render.

One run archives ONE 00Z run of ONE member (EURO, explicit), through the SHARED point archive (`point_archive.writer`; gate
served-wave-verify-v1 section 0.4):
  * RECORDS: one `point-archive/1` record per (target, lead 0..72), purpose `nearshore_eval`, written to
    verify/point-archive/v1/nearshore_eval/<member>/<run>.jsonl.gz and listed in that prefix's SHA256SUMS (immutable: a re-run of
    the same run is refused);
  * ETA: our own tide table, series `am` (read-only; `nearshore_lite.eta`), sliced per target and hashed into each record;
  * TRUTH: an NDBC realtime2 snapshot per station, written once to the SHARED truth/ prefix. The stations are the frozen buoy list's
    `nearshore_eval` tag (NOT a dispatch input); a list that tags none refuses the run;
  * PARTITIONS: the served offshore partitions through a `PartitionSource`. Without one the run is INCOMPLETE: truth is written, NO
    run file is written (archives are immutable, so a partial run would block the real one), and the exit code is 3.

Exit codes: 0 archived, 2 refused (no owner word reference, no nearshore_eval stations, or bad input), 3 INCOMPLETE (no partition
source), 1 error. `--go` writes; the default is a dry run that reads and prints a plan. The job reads and writes the archive bucket
with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (secrets by NAME only; no value appears here or in the workflow).
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from services.point_archive import buoys, core, storage, writer as point_writer   # noqa: E402
from services.weather_pipeline.nearshore_lite import archive, eta, records, truth   # noqa: E402

EXIT_OK, EXIT_ERROR, EXIT_REFUSED, EXIT_INCOMPLETE = 0, 1, 2, 3
PLACEHOLDERS = {"", "tbd", "todo", "none", "n/a", "na", "-"}
PURPOSE = records.PURPOSE


class PartitionSource:
    """INTERFACE: `rows(init, targets) -> [dict(target, lead_h, partitions=[{h, tp, dir, kind}], basis, total)]` for leads 0..72."""

    def rows(self, init, targets):
        raise NotImplementedError("offshore partition source not ruled (total-sea vs MFWAM vs period bands)")


def refuse_unless_owner_word(ref):
    if (ref or "").strip().lower() in PLACEHOLDERS or len((ref or "").strip()) < 8:
        raise ValueError("--owner-word-ref must cite the owner's word for this dispatch (who, when, where); refusing")


def nearshore_stations(buoy_doc):
    """The frozen list's `nearshore_eval` stations (ids)."""
    return [s["id"] for s in buoys.stations(buoy_doc, PURPOSE)]


def run(init, targets, buoy_doc, store, owner_word_ref, tide_table, ndbc_opener, partition_source=None, member="EURO",
        coefficient_freeze_hash=None, fetched_at=None, dry_run=True):
    """The whole job with every I/O injected (`store`: a point_archive store). Returns (exit_code, summary dict)."""
    stations = nearshore_stations(buoy_doc)
    summary = {"init": core.iso_z(init), "member": member, "targets": [t["id"] for t in targets], "stations": stations,
               "buoy_list_version": buoy_doc.get("version"), "buoy_list_hash": buoys.list_hash(buoy_doc),
               "owner_word_ref": owner_word_ref, "dry_run": dry_run}
    if not dry_run:
        refuse_unless_owner_word(owner_word_ref)
        if not stations:
            raise ValueError("the frozen buoy list tags no nearshore_eval station; refusing (stations come from the list, "
                             "never from the dispatch)")
    etas = {t["id"]: eta.eta_for_init(tide_table, t["lat"], t["lon"], init) for t in targets}
    summary["eta"] = {k: {"missing": v["missing"], "sha256": v["slice_sha256"]} for k, v in etas.items()}
    if dry_run:
        summary["plan"] = "dry run: nothing written"
        return EXIT_OK, summary
    w = point_writer.ArchiveWriter(store)
    fetched = fetched_at or datetime.now(timezone.utc)
    snaps = {}
    for sid in stations:
        _, h = truth.snapshot(w, sid, fetched, truth.fetch_realtime(sid, ndbc_opener))
        snaps[sid] = h
    summary["truth_sha256"] = snaps
    if partition_source is None:
        summary["status"] = "INCOMPLETE: no partition source (EC input not ruled); truth written, no run file"
        return EXIT_INCOMPLETE, summary
    rows = partition_source.rows(init, targets)
    run_hash = core.sha256_hex(core.canon({"run": core.iso_z(init), "member": member, "list": summary["buoy_list_hash"],
                                           "eta": {k: v["slice_sha256"] for k, v in sorted(etas.items())}}))
    by_id = {t["id"]: t for t in targets}
    recs = []
    for r in rows:
        e = etas.get(r["target"])
        if e is not None and 0 <= r["lead_h"] < len(e["eta_m"]):
            r = {**r, "eta_m": e["eta_m"][r["lead_h"]]}
        recs.append(records.build_record(
            init, member, by_id[r["target"]], r, summary["buoy_list_version"], summary["buoy_list_hash"], run_hash,
            eta_slice_sha256=(etas[r["target"]]["slice_sha256"] if r["target"] in etas else None),
            tide_table_generated_at=tide_table["generated_at"].isoformat(),
            coefficient_freeze_hash=coefficient_freeze_hash, owner_word_ref=owner_word_ref))
    path, sha = archive.archive_run(w, init, member, recs)
    summary.update({"archive_path": path, "archive_sha256": sha, "tide_source": eta.SOURCE, "status": "ARCHIVED"})
    return EXIT_OK, summary


def _urlopen_ndbc(url):
    import urllib.request
    with urllib.request.urlopen(url, timeout=60) as r:                                   # noqa: S310  (host checked by truth.fetch_realtime)
        return r.read().decode("utf-8", "replace")


def _load_tide_table():
    from services.weather_pipeline import tide_own
    doc = tide_own._fetch_bucket()
    table = tide_own.validate(doc) if doc else None
    if table is None:
        raise eta.EtaUnavailable("the tide_own table is missing or invalid (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set?)")
    return table


def _make_store(kind, out):
    if kind == "local":
        return storage.LocalStore(out)
    return storage.SupabaseStore()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--init", required=True, help="00Z run, ISO e.g. 2027-01-15T00:00Z")
    ap.add_argument("--targets", required=True, help="JSON list of {id, lat, lon[, station_id]}")
    ap.add_argument("--list", default=str(buoys.LIST_PATH), help="the frozen buoy list (its nearshore_eval tag names the stations)")
    ap.add_argument("--store", choices=("supabase", "local"), default="supabase")
    ap.add_argument("--out", default="nearshore_lite_archive_out", help="folder of the local store (--store local)")
    ap.add_argument("--owner-word-ref", default="")
    ap.add_argument("--go", action="store_true", help="write (default: dry run)")
    a = ap.parse_args(argv)
    try:
        init = datetime.strptime(a.init, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        with open(a.targets, encoding="utf-8") as f:
            targets = json.load(f)
        doc = buoys.load(a.list)
        store = _make_store(a.store, a.out) if a.go else None
        code, summary = run(init, targets, doc, store, a.owner_word_ref, _load_tide_table(), _urlopen_ndbc,
                            partition_source=None, dry_run=not a.go)
    except ValueError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return EXIT_REFUSED
    except Exception as e:                                                                 # noqa: BLE001
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_ERROR
    print(json.dumps(summary, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
