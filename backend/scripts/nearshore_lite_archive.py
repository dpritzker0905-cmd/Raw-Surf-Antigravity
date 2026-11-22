#!/usr/bin/env python3
"""Forward-archive job for the MOP-lite gate (docs/weather-program/gates/nearshore-moplite-v1.md section 5). CI only, NEVER Render.

One run archives ONE 00Z init:
  * ETA: our own tide table, series `am` (read-only; `nearshore_lite.eta`), sliced per target and hashed;
  * TRUTH: an NDBC realtime2 snapshot per station (the feed keeps only 45 days), hashed into its own SHA256SUMS;
  * PARTITIONS: the served offshore partitions, through a `PartitionSource`. That source is an UNBUILT INTERFACE until the advisor
    rules which offshore sea drives the EURO member (total-sea, MFWAM, or period bands). Without one the run is INCOMPLETE: the aux
    files (ETA, truth) are written, NO archive init is written (archives are immutable, so a partial init would block the real one),
    and the exit code is 3.

Exit codes: 0 archived · 2 refused (no owner word reference, or bad input) · 3 INCOMPLETE (no partition source) · 1 error.
`--dry-run` (the default) reads and prints a plan and writes nothing. The job reads the tide bucket with SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY from the environment (secrets by NAME only; no value appears here or in the workflow).
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from services.weather_pipeline.nearshore_lite import archive, eta, truth   # noqa: E402

EXIT_OK, EXIT_ERROR, EXIT_REFUSED, EXIT_INCOMPLETE = 0, 1, 2, 3
PLACEHOLDERS = {"", "tbd", "todo", "none", "n/a", "na", "-"}


class PartitionSource:
    """INTERFACE (unbuilt): `rows(init, targets) -> [dict(target, lead_h, partitions=[{h, tp, dir, kind}])]` for leads 0..72.
    The implementation waits for the advisor's ruling on the EC input; do not add a fetcher here."""

    def rows(self, init, targets):
        raise NotImplementedError("offshore partition source not ruled (total-sea vs MFWAM vs period bands)")


def refuse_unless_owner_word(ref):
    if (ref or "").strip().lower() in PLACEHOLDERS or len((ref or "").strip()) < 8:
        raise ValueError("--owner-word-ref must cite David's word for this dispatch (who, when, where); refusing")


def run(init, targets, stations, out_dir, owner_word_ref, tide_table, ndbc_opener, partition_source=None, member="EURO",
        dry_run=True):
    """The whole job with every I/O injected. Returns (exit_code, summary dict)."""
    summary = {"init": init.isoformat(), "targets": [t["id"] for t in targets], "stations": list(stations),
               "owner_word_ref": owner_word_ref, "dry_run": dry_run}
    if not dry_run:
        refuse_unless_owner_word(owner_word_ref)
    etas = {}
    for t in targets:
        etas[t["id"]] = eta.eta_for_init(tide_table, t["lat"], t["lon"], init)
    summary["eta"] = {k: {"missing": v["missing"], "sha256": v["slice_sha256"]} for k, v in etas.items()}
    if dry_run:
        summary["plan"] = "dry run: nothing written"
        return EXIT_OK, summary
    iso = init.strftime("%Y-%m-%dT%H:%MZ")
    aux = os.path.join(out_dir, "aux")
    os.makedirs(aux, exist_ok=True)
    eta_body = json.dumps({"init": iso, "targets": etas}, sort_keys=True, separators=(",", ":")) + "\n"
    eta_path = os.path.join(aux, f"eta_{iso.replace(':', '').replace('-', '')}.json")
    with open(eta_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(eta_body)
    summary["eta_file_sha256"] = hashlib.sha256(eta_body.encode("utf-8")).hexdigest()
    snaps = {}
    for sid in stations:
        _, h = truth.snapshot(os.path.join(out_dir, "truth"), sid, iso, truth.fetch_realtime(sid, ndbc_opener))
        snaps[sid] = h
    summary["truth_sha256"] = snaps
    if partition_source is None:
        summary["status"] = "INCOMPLETE: no partition source (EC input not ruled); aux files written, no archive init"
        return EXIT_INCOMPLETE, summary
    rows = partition_source.rows(init, targets)
    for r in rows:
        e = etas.get(r["target"])
        if e is not None and 0 <= r["lead_h"] < len(e["eta_m"]):
            r["eta_m"] = e["eta_m"][r["lead_h"]]
    meta = {"owner_word_ref": owner_word_ref, "eta_slice_sha256": {k: v["slice_sha256"] for k, v in etas.items()},
            "tide_table_generated_at": tide_table["generated_at"].isoformat(), "tide_source": eta.SOURCE,
            "truth_sha256": snaps}
    if hasattr(partition_source, "meta"):
        meta.update(partition_source.meta())                 # per-region source, model per target, basis counts, stored-only
    _, sha = archive.archive_init(os.path.join(out_dir, "archive"), iso, member, rows, meta=meta)
    summary["archive_sha256"] = sha
    summary["status"] = "ARCHIVED"
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


def _partition_source(a):
    """None until asked for; `served` builds the stored-only service lazily (never on a dry run's import path)."""
    if a.partition_source != "served":
        return None
    from services.weather_pipeline.nearshore_lite import partition_source as ps
    return ps.ServedPartitionSource(ps.build_service(), default_model=a.model)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--init", required=True, help="00Z init, ISO e.g. 2027-01-15T00:00Z")
    ap.add_argument("--targets", required=True, help="JSON list of {id, lat, lon}")
    ap.add_argument("--stations", default="", help="comma-separated NDBC station ids")
    ap.add_argument("--out", default="nearshore_lite_archive_out")
    ap.add_argument("--owner-word-ref", default="")
    ap.add_argument("--partition-source", choices=("none", "served"), default="none",
                    help="served = the served chain's partitions from our STORED products only (CI, needs the bucket secrets)")
    ap.add_argument("--model", default="EURO", help="model member the served chain uses for these targets")
    ap.add_argument("--go", action="store_true", help="write (default: dry run)")
    a = ap.parse_args(argv)
    try:
        init = datetime.strptime(a.init, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        with open(a.targets, encoding="utf-8") as f:
            targets = json.load(f)
        stations = [s for s in a.stations.split(",") if s]
        code, summary = run(init, targets, stations, a.out, a.owner_word_ref, _load_tide_table(), _urlopen_ndbc,
                            partition_source=_partition_source(a), dry_run=not a.go)
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
