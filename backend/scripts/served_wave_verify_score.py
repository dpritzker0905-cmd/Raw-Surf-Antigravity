#!/usr/bin/env python3
"""The served-wave-verify-v1 scorer job (gate sections 0.1, 7, 7a, 10; workflow served-wave-verify-score.yml). DARK unless
SERVED_WAVE_VERIFY=1. Each mode is one workflow step; only the steps that need the private archive get the key (by NAME):

  --snapshot-truth          fetch NDBC realtime2 .txt + .spec once per listed station; write ONE immutable hashed snapshot of
                            each into verify/point-archive/v1/truth/<station>/ (kept indefinitely; closes the 45-day gap)
  --download DIR            copy the served run files of the last 90 days (+ 10 d of lead) and the truth snapshots to DIR
  --score DIR --out OUT     score (no credentials): OUT/scores.json (30 d and 90 d windows)
  --publish OUT             upload OUT/scores.json to the PUBLIC weather-frames bucket, verify/served-wave/v1/scores/
                            (latest.json + a dated copy); raw records are never published
  --verify                  verify_archive over every prefix under verify/point-archive/v1 (mismatch / missing / unlisted)

LOCKED holdout (#1199 section 1a; amendment 2). Collection (--snapshot-truth, the sampler) keeps archiving EVERY buoy. The
reading modes go through holdout.state(): while #1199's LOCKED list is not frozen and committed (or does not verify against
its recorded SHA-256), --download reads nothing, --score writes a NOT_READ document and reads nothing, and --publish
publishes nothing. Once it is READY, locked truth is never downloaded or opened, locked rows are dropped on load (and again
inside the scorer), --publish refuses a body that names a locked id, and every printed line is redacted (this repository's
Actions logs are PUBLIC).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.point_archive import buoys as buoylist  # noqa: E402
from services.point_archive import core, holdout, qc  # noqa: E402
from services.point_archive import served_scorer as sc  # noqa: E402
from services.point_archive.storage import FRAMES_BUCKET, LocalStore, SupabaseStore  # noqa: E402
from services.point_archive.writer import ArchiveWriter, archive_prefixes, read_run_rows, verify_archive  # noqa: E402

UA = "raw-surf-served-wave-verify/1 (daily buoy snapshot)"
SCORES_PREFIX = "verify/served-wave/v1/scores"
LOOKBACK_DAYS = 90 + 10
MODELS = ("gfs", "icon", "euro")


def ndbc_get(url):
    if not url.startswith(f"https://{qc.NDBC_HOST}/"):
        raise ValueError(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def say(text, locked=frozenset(), file=None):
    """print, with locked ids redacted (Actions logs are public)."""
    print(holdout.redact(str(text), locked), file=file or sys.stdout)


def not_read_doc(doc, now, info):
    return {"schema": sc.TABLE_SCHEMA, "scorer_version": sc.SCORER_VERSION, "asof": core.iso_z(now), "status": holdout.NOT_READ,
            "reason": info["reason"], "buoy_list_version": doc["version"], "buoy_list_hash": buoylist.list_hash(doc)}


def snapshot_truth(writer, doc, now, opener=ndbc_get, pause=0.3):
    """COLLECTION (#1199: locked buoys are still archived): every listed station's realtime2 files, locked included; the
    printed report is redacted by main(). Every other mode reads through holdout.state() / buoy_holdout."""
    out = {"written": 0, "missing": [], "failed": []}
    for s in buoylist.stations(doc):
        for kind in ("txt", "spec"):
            try:
                text = opener(qc.realtime_url(s["id"], kind))
            except Exception as e:  # counted; the scorer marks the gap fetch_gap
                out["failed"].append(f"{s['id']}.{kind}: {type(e).__name__}")
                continue
            if not text:
                out["missing"].append(f"{s['id']}.{kind}")
                continue
            try:
                writer.write_truth(s["id"], kind, now, text)
                out["written"] += 1
            except FileExistsError:
                pass
            time.sleep(pause)
    return out


def download(store, dest, now, locked=frozenset()):
    """Copy the run files and the truth snapshots of every NON-locked station (a locked station's truth is never fetched)."""
    dest = Path(dest)
    cutoff = core.run_stamp(now - timedelta(days=LOOKBACK_DAYS))
    n = 0
    for m in MODELS:
        for p in store.list(core.model_prefix("served", m)):
            name = p.rsplit("/", 1)[1]
            if name.endswith(".jsonl.gz") and p.count("/") == core.model_prefix("served", m).count("/") + 1 and name >= cutoff:
                (dest / p).parent.mkdir(parents=True, exist_ok=True)
                (dest / p).write_bytes(store.read(p))
                n += 1
    for p in store.list(core.TRUTH_ROOT):
        if p.endswith(".gz") and not holdout.is_locked_path(p, locked):
            (dest / p).parent.mkdir(parents=True, exist_ok=True)
            (dest / p).write_bytes(store.read(p))
    return n


def load_local(src, locked=frozenset()):
    """(records, {station: Truth}) from a downloaded folder, with every LOCKED station's rows dropped and its truth files
    left unopened."""
    src = Path(src)
    records = []
    for p in sorted(src.glob(f"{core.ROOT}/served/*/*.jsonl.gz")):
        records += [r for r in read_run_rows(p.read_bytes())          # slim or plain layout -> the full schema rows
                    if str(r.get("station_id", "")).upper() not in locked]
    texts = {}
    for p in sorted(src.glob(f"{core.TRUTH_ROOT}/*/*.gz")):
        station, rest = p.name.split("_", 1)
        if station.upper() in locked:
            continue
        stamp, kind = rest.split(".")[0], rest.split(".")[1]
        fetched = datetime.strptime(stamp, "%Y%m%dT%H%MZ").replace(tzinfo=timezone.utc)
        texts.setdefault(station, {"txt": [], "spec": []})[kind].append((fetched, gzip.decompress(p.read_bytes()).decode("utf-8")))
    truth = {s: sc.Truth(v["txt"], v["spec"]) for s, v in texts.items()}
    return records, truth


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot-truth", action="store_true")
    ap.add_argument("--download")
    ap.add_argument("--score")
    ap.add_argument("--out")
    ap.add_argument("--publish")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--asof")
    ap.add_argument("--local-store", help="use this folder instead of the private bucket (offline runs)")
    ap.add_argument("--buoy-list", help="use this buoy list file (tests)")
    ap.add_argument("--repo-root", help="resolve the locked list's path under this folder (tests)")
    a = ap.parse_args(argv)
    if os.environ.get("SERVED_WAVE_VERIFY", "0") != "1":
        print("[swv-score] SERVED_WAVE_VERIFY is not '1': dark; nothing read, nothing written")
        return 0
    now = core.parse_time(a.asof) if a.asof else datetime.now(timezone.utc)
    doc = buoylist.load(a.buoy_list) if a.buoy_list else buoylist.load()
    status, info = holdout.state(doc, a.repo_root) if a.repo_root else holdout.state(doc)
    locked = info.get("locked", frozenset())
    rc = 0
    if status == holdout.NOT_READ:
        say(f"[swv-score] holdout {holdout.NOT_READ}: {info['reason']}")
        rc = 1 if info["error"] else 0

    def archive():
        return LocalStore(a.local_store) if a.local_store else SupabaseStore()
    if a.snapshot_truth:                                  # collection: every buoy is archived; the printed lists are redacted
        say(json.dumps(snapshot_truth(ArchiveWriter(archive()), doc, now), sort_keys=True), locked)
    if a.download:
        if status == holdout.READY:
            say(f"[swv-score] downloaded {download(archive(), a.download, now, locked)} run files", locked)
        else:
            say("[swv-score] download skipped: collect-only (NOT_READ); no record or truth read")
    if a.score:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        if status == holdout.READY:
            records, truth = load_local(a.score, locked)
            out = {**sc.score(records, truth, doc, now, locked=locked, locked_sha256=info["sha256"]), "status": "scored"}
            say(f"[swv-score] {len(records)} rows scored ({len(locked)} LOCKED buoys excluded) -> {a.out}/scores.json", locked)
        else:
            out = not_read_doc(doc, now, info)
            say(f"[swv-score] {holdout.NOT_READ}: nothing scored -> {a.out}/scores.json")
        (Path(a.out) / "scores.json").write_text(core.canon(out) + "\n", encoding="utf-8", newline="\n")
    if a.publish:
        body = (Path(a.publish) / "scores.json").read_bytes()
        text = body.decode("utf-8")
        got = json.loads(text)
        if status != holdout.READY or got.get("status") != "scored":
            say(f"[swv-score] nothing published: holdout {status}, scores {got.get('status')}")
        elif holdout.redact(text, locked) != text:
            say("[swv-score] publish REFUSED: the score document names a LOCKED station")
            return 1
        else:
            pub = SupabaseStore(bucket=FRAMES_BUCKET)
            pub.write(f"{SCORES_PREFIX}/{now.strftime('%Y-%m-%d')}.json", body, "application/json", "public, max-age=300")
            pub.write(f"{SCORES_PREFIX}/latest.json", body, "application/json", "no-cache")
            say(f"[swv-score] published {SCORES_PREFIX}/latest.json")
    if a.verify:                                          # integrity of the bytes only; problem lines are redacted
        store = archive()
        problems = [p for prefix in archive_prefixes(store) for p in verify_archive(store, prefix)]
        say("\n".join(problems) or "[swv-score] verify_archive: clean", locked)
        if problems:
            return 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
