"""Forward archive of the served offshore partitions per 00Z run, in the SHARED point archive (gate section 5; archive schema
adopted from served-wave-verify-v1 section 0.4).

Written by a GitHub Actions job, never the Render box, through `point_archive.writer.ArchiveWriter`: one immutable gzipped JSONL
per (purpose `nearshore_eval`, member, run) at `verify/point-archive/v1/nearshore_eval/<member>/<run>.jsonl.gz`, listed in that
prefix's SHA256SUMS. Re-archiving a run is REFUSED (the writer's immutability). `missing_run` names runs that lack any
(target, lead 0..72) record: the missing-run rule drops those runs for ALL arms.
"""
from services.point_archive import core, writer as _writer
from services.weather_pipeline.nearshore_lite import records

LEAD_MAX_H = 72
PURPOSE = records.PURPOSE


def archive_run(w, run_time, member, recs):
    """Write one run's records. `w` is an ArchiveWriter. Returns (path, sha256); raises FileExistsError on a re-archive."""
    rows = sorted(recs, key=lambda r: (r["target_id"], r["lead_h"]))
    return w.write_run(PURPOSE, member, run_time, rows)


def prefix(member):
    return core.model_prefix(PURPOSE, member)


def verify_archive(store, member):
    """[] when every archived run matches the prefix's SHA256SUMS and is listed; else the problems (the shared check)."""
    return _writer.verify_archive(store, prefix(member))


def _run_files(store, member):
    base = prefix(member)
    return sorted(p for p in store.list(base) if p.rsplit("/", 1)[0] == base and p.endswith(".jsonl.gz"))


def missing_run(store, targets, member, step_h=1):
    """Run files that lack any (target, lead 0..72 step) record: dropped for all arms. Returns their sorted names."""
    want = {(t, h) for t in targets for h in range(0, LEAD_MAX_H + 1, step_h)}
    bad = []
    for path in _run_files(store, member):
        have = {(r["target_id"], r["lead_h"]) for r in _writer.read_run_rows(store.read(path)) if r.get("row_type") == "record" and r.get("status") == "ok"}
        if not want <= have:
            bad.append(path.rsplit("/", 1)[1])
    return bad
