"""Migrate gallery references using a private journal and independently readable recovery copies.

Run plan, stage, cutover, verify and (if needed) rollback with the same private
journal. Retirement is a separate operation after the rollback retention window.
Requires direct database access and a write freeze on legacy storage for retirement.
"""
import argparse
from contextlib import closing
from hashlib import sha256
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import sqlite3
import sys
from urllib.parse import quote, unquote, urlsplit

import httpx
from sqlalchemy import MetaData, Table, create_engine, select, text, update
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from gallery_migration_plan import COLUMNS, make_plan

BUCKET = "gallery_originals"
PREFIX = f"supabase://{BUCKET}/"


class Storage:
    def __init__(self, client, origin, headers, root=None):
        self.client, self.origin, self.headers, self.root = client, origin.rstrip("/"), headers, root

    def source(self, value):
        if not value:
            return None
        url = urlsplit(value)
        base = urlsplit(self.origin)
        if (url.scheme, url.netloc) == (base.scheme, base.netloc) and url.path.startswith("/storage/v1/object/public/gallery/"):
            kind, key = "public", unquote(url.path.removeprefix("/storage/v1/object/public/gallery/"))
        elif not url.scheme and not url.netloc and url.path.startswith("/api/uploads/gallery/"):
            kind, key = "local", unquote(url.path.removeprefix("/api/uploads/gallery/"))
        else:
            return None
        if not key or any(p in ("", ".", "..") for p in key.split("/")) or "\\" in key or ":" in key:
            raise ValueError("invalid source key")
        return kind, key

    @staticmethod
    def ref(key):
        return PREFIX + key

    @staticmethod
    def private_for(value, owner):
        return bool(value and owner and value.startswith(PREFIX + owner + "/")
                    and ".." not in PurePosixPath(unquote(value)).parts)

    def bucket_check(self):
        r = self.client.get(self.origin + "/storage/v1/bucket/" + BUCKET, headers=self.headers)
        r.raise_for_status()
        if r.json().get("public") is not False or r.json().get("id") != BUCKET:
            raise ValueError("expected private gallery bucket")

    def object_url(self, bucket, key):
        return self.origin + "/storage/v1/object/" + bucket + "/" + quote(key, safe="/")

    def read(self, bucket, key):
        r = self.client.get(self.object_url(bucket, key), headers=self.headers)
        if r.status_code == 404:
            return None
        # Supabase Storage can encode absence as a 400 JSON response.
        if r.status_code == 400 and r.json().get("error") in ("not_found", "NoSuchKey"):
            return None
        r.raise_for_status()
        return r.content

    def local_file(self, key):
        if not self.root:
            raise ValueError("local gallery root required")
        root = self.root.resolve()
        path = (root / key).resolve()
        if root not in path.parents:
            raise ValueError("invalid local key")
        return path

    def source_bytes(self, source):
        kind, key = source
        if kind == "local":
            path = self.local_file(key)
            return path.read_bytes() if path.exists() else None
        return self.read("gallery", key)

    def ensure_copy(self, key, data, digest, source_key):
        existing = self.read(BUCKET, key)
        if existing is None:
            r = self.client.post(self.object_url(BUCKET, key), headers={**self.headers,
                "x-upsert": "false", "Content-Type": mimetypes.guess_type(source_key)[0] or "application/octet-stream"},
                content=data)
            r.raise_for_status()
            existing = self.read(BUCKET, key)
        verify_hash(existing, digest)

    def retire(self, source):
        kind, key = source
        if kind == "local":
            self.local_file(key).unlink()
        else:
            r = self.client.request("DELETE", self.origin + "/storage/v1/object/gallery",
                                    headers=self.headers, json={"prefixes": [key]})
            r.raise_for_status()
        if self.source_bytes(source) is not None:
            raise ValueError("source retirement did not complete")


def verify_hash(data, digest):
    if data is None or sha256(data).hexdigest() != digest:
        raise ValueError("object missing or checksum mismatch")


def inventory(conn, tables):
    return {name: [dict(row) for row in conn.execute(select(*(tables[name].c[c] for c in cols))
            .order_by(tables[name].c[cols[0]])).mappings()] for name, cols in COLUMNS.items()}


def run(action, engine, storage, journal_path, identity):
    if action != "plan" and not journal_path.is_file():
        raise ValueError("existing private journal required")
    storage.bucket_check()
    # SQLite serializes operators. Commit the immutable plan before touching any objects.
    if action == "plan" and not journal_path.exists():
        os.close(os.open(journal_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    with closing(sqlite3.connect(journal_path, timeout=2)) as journal:
        journal.execute("CREATE TABLE IF NOT EXISTS manifest (id INTEGER PRIMARY KEY, identity TEXT, plan TEXT)")
        journal.execute("CREATE TABLE IF NOT EXISTS hashes (object_key TEXT PRIMARY KEY, digest TEXT NOT NULL)")
        journal.execute("BEGIN IMMEDIATE")
        meta = MetaData()
        with engine.begin() as conn:
            if conn.dialect.name == "postgresql":
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                conn.execute(text("LOCK TABLE " + ", ".join(COLUMNS) + " IN SHARE ROW EXCLUSIVE MODE"))
            tables = {name: Table(name, meta, autoload_with=conn, resolve_fks=False) for name in COLUMNS}
            current = inventory(conn, tables)
            entry = journal.execute("SELECT identity,plan FROM manifest WHERE id=1").fetchone()
            if not entry:
                if action != "plan":
                    raise ValueError("no saved migration plan")
                plan = make_plan(current, storage)
                journal.execute("INSERT INTO manifest VALUES(1,?,?)", (identity,json.dumps(plan)))
                journal.commit()
            else:
                if entry[0] != identity:
                    raise ValueError("journal belongs to another environment")
                plan = json.loads(entry[1])
            result = {"assets": len(plan["assets"]), "held": len(plan["holds"])}
            if action == "plan":
                return result
            if current not in [plan[state] for state in ("before", "primary", "recovery")]:
                raise ValueError("database inventory changed; reconcile before proceeding")
            if action in ("verify", "retire") and current not in [plan["primary"], plan["recovery"]]:
                raise ValueError("private cutover required")
            if action == "retire" and plan["holds"]:
                raise ValueError("unresolved review holds prevent retirement")
            for asset in plan["assets"]:
                source, key = asset["source"], asset["primary"]
                if action == "stage":
                    data = storage.source_bytes(source)
                    if data is None:
                        raise ValueError("source missing")
                    digest = sha256(data).hexdigest()
                    journal.execute("INSERT OR IGNORE INTO hashes VALUES(?,?)", (key,digest))
                    # Before an external write, persist source identity for crash recovery.
                    journal.commit()
                    journal.execute("BEGIN IMMEDIATE")
                    saved = journal.execute("SELECT digest FROM hashes WHERE object_key=?", (key,)).fetchone()[0]
                    verify_hash(data, saved)
                    for role in ("primary", "recovery"):
                        storage.ensure_copy(asset[role], data, saved, source[1])
                else:
                    row = journal.execute("SELECT digest FROM hashes WHERE object_key=?", (key,)).fetchone()
                    if not row:
                        raise ValueError("stage is incomplete")
                    for role in (("recovery",) if action == "rollback" else ("primary", "recovery")):
                        verify_hash(storage.read(BUCKET,asset[role]),row[0])
                    if action in ("cutover","retire"):
                        old = storage.source_bytes(source)
                        if old is not None or current == plan["before"]:
                            verify_hash(old,row[0])
                        if action == "retire" and old is not None:
                            storage.retire(source)
            if action in ("cutover", "rollback"):
                target = plan["primary" if action == "cutover" else "recovery"]
                for name, rows in current.items():
                    id_col = COLUMNS[name][0]
                    for old, new in zip(rows, target[name], strict=True):
                        delta = {c: v for c,v in new.items() if old[c] != v}
                        if delta:
                            conn.execute(update(tables[name]).where(tables[name].c[id_col] == old[id_col]).values(**delta))
                if inventory(conn,tables) != target:
                    raise ValueError("reconciliation failed")
            return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan","stage","cutover","verify","rollback","retire"))
    parser.add_argument("--journal", required=True, type=Path)
    parser.add_argument("--legacy-writers-frozen", action="store_true",
                        help="confirm legacy storage writes are stopped for switch or retirement")
    args = parser.parse_args()
    if args.action in ("cutover","retire","rollback") and not args.legacy_writers_frozen:
        parser.error("freeze legacy writers before changing live references or retiring sources")
    origin = os.environ["SUPABASE_URL"]
    if urlsplit(origin).scheme != "https":
        raise ValueError("HTTPS storage endpoint required")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key}
    if key.count(".") == 2:
        headers["Authorization"] = "Bearer " + key
    url = make_url(os.environ["DATABASE_URL"]).set(drivername="postgresql+psycopg2")
    engine = create_engine(url, hide_parameters=True)
    root = os.environ.get("GALLERY_UPLOAD_ROOT")
    try:
        with httpx.Client(timeout=120) as client:
            storage = Storage(client,origin,headers,Path(root) if root else None)
            print(run(args.action, engine, storage, args.journal,
                      json.dumps([origin,url.host,url.port,url.database,str(storage.root)])))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
