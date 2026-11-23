"""The ONE writer of the point archive (gate served-wave-verify-v1 section 0.1).

  * one immutable gzipped JSONL per (purpose, model, run): canonical JSON (sorted keys), one object per line, rows in a
    fixed order, gzip with mtime 0, so the same rows always make the same bytes; in the SLIM layout (slim.py: run, frame and
    cell provenance written once per file; lossless, so readers get the full schema rows back);
  * re-writing an existing file is REFUSED (as #1156's archive_init refuses to re-archive an init), first by a read, then
    by the store itself (x-upsert false);
  * each prefix carries a SHA256SUMS (`<sha256>  <name>`), appended AFTER the file lands, so a crash between the two shows
    as an "unlisted file" in verify_archive, never as a silent gap;
  * verify_archive reports a mismatch, a listed-but-missing file and an unlisted file;
  * truth snapshots: one immutable gzipped copy of each fetched NDBC realtime2 file, under truth/<station>/.
Raw records are never edited after writing; the scorer adds its statuses on the JOINED row only.
"""
from __future__ import annotations

import gzip
import json

from services.point_archive import core, slim

JSONL_TYPE = "application/gzip"
IMMUTABLE = "private, max-age=31536000, immutable"


def gzip_bytes(raw):
    return gzip.compress(raw, compresslevel=9, mtime=0)


def jsonl_bytes(rows):
    """Canonical JSONL bytes (no gzip): one canonical object per line, '\\n'-terminated."""
    return "".join(core.canon(r) + "\n" for r in rows).encode("utf-8")


def read_jsonl_gz(data):
    return [json.loads(line) for line in gzip.decompress(data).decode("utf-8").splitlines() if line.strip()]


def parse_sums(data):
    out = {}
    for line in (data or b"").decode("utf-8").splitlines():
        line = line.strip()
        if line:
            h, name = line.split(None, 1)
            out[name.strip()] = h
    return out


class ArchiveWriter:
    """Writes through a store (storage.LocalStore / SupabaseStore)."""

    def __init__(self, store):
        self.store = store

    def exists(self, path):
        return self.store.read(path) is not None

    def write_immutable(self, path, data, content_type=JSONL_TYPE):
        """Write `data` at `path` once, then list it in its folder's SHA256SUMS. Returns its sha256."""
        if self.exists(path):
            raise FileExistsError(f"{path} is already archived: archives are immutable")
        self.store.write(path, data, content_type, IMMUTABLE, upsert=False)
        h = core.sha256_hex(data)
        folder, name = path.rsplit("/", 1)
        sums_path = f"{folder}/{core.SUMS}"
        sums = self.store.read(sums_path) or b""
        if name not in parse_sums(sums):
            sums += f"{h}  {name}\n".encode("utf-8")
            self.store.write(sums_path, sums, "text/plain", "no-cache", upsert=True)
        return h

    def write_run(self, purpose, model, run_time, rows):
        """(path, sha256) of the run file for (purpose, model, run), in the SLIM layout (slim.py, amendment 1 A2; lossless:
        read_run returns `rows` exactly). Rows keep the order the caller gives (callers sort them)."""
        path = core.run_path(purpose, model, run_time)
        data = gzip_bytes(jsonl_bytes(slim.pack(rows)))
        return path, self.write_immutable(path, data)

    def write_truth(self, station_id, kind, fetched_at, text):
        """One immutable gzipped snapshot of a fetched NDBC file. Returns (path, sha256)."""
        name = f"{str(station_id).upper()}_{core.run_stamp(fetched_at)}.{kind}.gz"
        path = f"{core.truth_prefix(station_id)}/{name}"
        return path, self.write_immutable(path, gzip_bytes(text.encode("utf-8")), "application/gzip")

    def read_run(self, path):
        data = self.store.read(path)
        return None if data is None else read_run_rows(data)


def read_run_rows(data):
    """The full `point-archive/1` rows of a run file (slim or plain layout)."""
    return slim.unpack(read_jsonl_gz(data))


def verify_archive(store, prefix):
    """Problems under one prefix's SHA256SUMS ([] = clean): sha mismatch, listed but missing, present but unlisted.
    Only the files directly in `prefix` are its SHA256SUMS' business (sub-folders carry their own)."""
    prefix = prefix.rstrip("/")
    sums = parse_sums(store.read(f"{prefix}/{core.SUMS}"))
    present = [p.rsplit("/", 1)[1] for p in store.list(prefix) if p.rsplit("/", 1)[0] == prefix]
    problems = []
    for name in sorted(present):
        if name == core.SUMS:
            continue
        if name not in sums:
            problems.append(f"{prefix}/{name}: not in {core.SUMS}")
            continue
        if core.sha256_hex(store.read(f"{prefix}/{name}")) != sums[name]:
            problems.append(f"{prefix}/{name}: sha256 mismatch")
    for name in sorted(sums):
        if name not in present:
            problems.append(f"{prefix}/{name}: listed but missing")
    return problems


def archive_prefixes(store, root=core.ROOT):
    """Every folder under `root` that holds a SHA256SUMS (what the weekly verify walks)."""
    return sorted({p.rsplit("/", 1)[0] for p in store.list(root) if p.endswith("/" + core.SUMS)})
