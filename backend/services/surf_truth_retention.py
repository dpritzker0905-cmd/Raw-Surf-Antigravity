"""Retention of the private surf-truth exports (T1 P3; owner's rule, David 2026-11-18).

THE RULE, enforced daily by the scheduler job `surf_truth_retention` (well inside the 7-day bound):
1. Keep the 3 newest exports (by manifest `cut_at`) made under the CURRENT pseudonym key; delete every older one.
2. After any account deletion: within 7 days, write a FRESH export (the person's rows are already erased, so it no
   longer contains them) and delete every older export.
3. A key rotation removes every export made under the old key (its manifest's key fingerprint no longer matches).
4. Orphans (a data object with no manifest, or a manifest with no data) are deleted once they are older than a
   6-hour grace, so an export being written is never caught half-way.
Without the key, no fresh export can be written; then a pending deletion removes EVERY export (fail safe).

Account deletions are recorded by `services.surf_truth_erasure` as an `account_erasure` line in the append-only admin
action log with a random target id: when, never who. Every enforcement run is logged as `retention` with counts.
The planner (`plan`) is pure; storage access goes through a small injectable store.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select

from models import SurfTruthAdminAction

logger = logging.getLogger(__name__)

KEEP = 3
ERASURE_BOUND = timedelta(days=7)
ORPHAN_GRACE = timedelta(hours=6)
SYSTEM_ACTOR = "system"
_RUN_RE = re.compile(r"^(?P<run>[0-9a-f]{6,32})(?P<kind>\.manifest\.json|\.jsonl)$")


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _parse(ts) -> Optional[datetime]:
    if isinstance(ts, datetime):
        return _aware(ts)
    try:
        return _aware(datetime.fromisoformat(str(ts).replace("Z", "+00:00")))
    except (TypeError, ValueError):
        return None


@dataclass
class Run:
    run_id: str
    data_key: Optional[str] = None
    manifest_key: Optional[str] = None
    created_at: Optional[datetime] = None          # earliest object time (for the orphan grace)
    manifest: Optional[dict] = None
    keys: list = field(default_factory=list)

    @property
    def cut_at(self) -> Optional[datetime]:
        return _parse((self.manifest or {}).get("cut_at"))

    @property
    def complete(self) -> bool:
        return bool(self.data_key and self.manifest_key and self.cut_at)


def collect_runs(objects: list, manifests: dict) -> dict:
    """objects: [(key, created_at)] under the export prefix; manifests: {manifest_key: parsed manifest}."""
    runs: dict = {}
    for key, created in objects:
        m = _RUN_RE.match(key.rsplit("/", 1)[-1])
        if not m:
            continue
        run = runs.setdefault(m["run"], Run(run_id=m["run"]))
        run.keys.append(key)
        if m["kind"] == ".jsonl":
            run.data_key = key
        else:
            run.manifest_key = key
            run.manifest = manifests.get(key)
        t = _parse(created)
        if t and (run.created_at is None or t < run.created_at):
            run.created_at = t
    return runs


def plan(runs: dict, now: datetime, fingerprint: Optional[str], last_erasure: Optional[datetime]) -> dict:
    """PURE. {'fresh_export': bool, 'keep': [run ids], 'delete': {run id: reason}}. With a fresh export pending, every
    complete run is deleted once the fresh one exists (the caller keeps only that one)."""
    delete, valid = {}, []
    for run in runs.values():
        if not run.complete:
            if run.created_at is None or now - run.created_at >= ORPHAN_GRACE:
                delete[run.run_id] = "orphan (data without manifest, or manifest without data)"
            continue
        fp = (run.manifest or {}).get("key_fingerprint")
        if fingerprint is not None and fp != fingerprint:
            delete[run.run_id] = "made under a previous pseudonym key"
            continue
        valid.append(run)
    valid.sort(key=lambda r: r.cut_at, reverse=True)
    pending = last_erasure is not None and any(r.cut_at <= last_erasure for r in valid)
    if pending:
        if fingerprint is None:                     # cannot write a fresh export: remove everything (fail safe)
            for r in valid:
                delete[r.run_id] = "account deleted since this export, and no key to write a fresh one"
            return {"fresh_export": False, "keep": [], "delete": delete}
        for r in valid:
            delete[r.run_id] = "an account was deleted since; replaced by a fresh export"
        return {"fresh_export": True, "keep": [], "delete": delete}
    for r in valid[KEEP:]:
        delete[r.run_id] = f"older than the {KEEP} newest exports"
    return {"fresh_export": False, "keep": [r.run_id for r in valid[:KEEP]], "delete": delete}


class StorageStore:
    """The private bucket under surf-truth/exports/ (list, read a manifest, delete). Blocking: call off the loop."""

    def __init__(self):
        from services.private_media import _storage_auth_headers, _storage_settings
        from services.surf_truth_export import BUCKET, PREFIX
        self.base, key = _storage_settings()
        if not self.base or not key:
            raise RuntimeError("private storage is not configured")
        self.headers = _storage_auth_headers(key)
        self.bucket, self.prefix = BUCKET, PREFIX

    def _list(self, prefix: str) -> list:
        import requests
        r = requests.post(f"{self.base}/storage/v1/object/list/{self.bucket}", headers=self.headers, timeout=20,
                          json={"prefix": prefix, "limit": 1000, "offset": 0, "sortBy": {"column": "name", "order": "asc"}})
        r.raise_for_status()
        return r.json() if isinstance(r.json(), list) else []

    def objects(self) -> list:
        out = []
        for folder in self._list(self.prefix):
            if folder.get("id") is not None:          # a file directly under the prefix (not expected)
                continue
            day = f"{self.prefix}/{folder.get('name')}"
            for obj in self._list(day):
                if obj.get("id") is not None:
                    out.append((f"{day}/{obj['name']}", obj.get("created_at")))
        return out

    def manifest(self, key: str) -> Optional[dict]:
        import requests
        r = requests.get(f"{self.base}/storage/v1/object/{self.bucket}/{key}", headers=self.headers, timeout=20)
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        return json.loads(r.text)

    def delete(self, keys: list) -> None:
        import requests
        for i in range(0, len(keys), 100):
            r = requests.delete(f"{self.base}/storage/v1/object/{self.bucket}", headers=self.headers, timeout=30,
                                json={"prefixes": keys[i:i + 100]})
            if r.status_code not in (200, 204):
                raise RuntimeError(f"storage refused the delete (status {r.status_code})")


async def last_erasure_at(db) -> Optional[datetime]:
    at = (await db.execute(select(func.max(SurfTruthAdminAction.at))
                           .where(SurfTruthAdminAction.action == "account_erasure"))).scalar_one_or_none()
    return _aware(at) if at else None


async def enforce(db, store=None, now: Optional[datetime] = None) -> dict:
    """Apply the rule once. Logs a `retention` action with counts (and an `export` action if it wrote one). Commits."""
    import asyncio
    from services import surf_truth_admin, surf_truth_export as ste
    now = now or datetime.now(timezone.utc)
    store = store or await asyncio.to_thread(StorageStore)
    try:
        key = ste.export_key()
    except ste.ExportUnavailable:
        key = None
    fingerprint = ste.key_fingerprint(key) if key else None
    objects = await asyncio.to_thread(store.objects)
    manifest_keys = [k for k, _ in objects if k.endswith(".manifest.json")]
    manifests = {}
    for k in manifest_keys:
        try:
            manifests[k] = await asyncio.to_thread(store.manifest, k)
        except Exception as e:  # an unreadable manifest makes its run an orphan, never a crash
            logger.warning("[surf-truth retention] manifest unreadable %s: %s", k, e)
    runs = collect_runs(objects, manifests)
    decision = plan(runs, now, fingerprint, await last_erasure_at(db))
    fresh = None
    if decision["fresh_export"]:
        rows, manifest = await ste.build_export(db, key)
        fresh = await ste.write_export(rows, manifest, now=now)
        surf_truth_admin.log_action(db, SYSTEM_ACTOR, "export", "surf_truth_export", fresh["run_id"],
                                    detail={"rows": fresh["rows"], "object": fresh["data_object"],
                                            "why": "fresh export after an account deletion"})
    doomed = [k for rid in decision["delete"] for k in runs[rid].keys]
    if doomed:
        await asyncio.to_thread(store.delete, doomed)
    summary = {"kept": decision["keep"] + ([fresh["run_id"]] if fresh else []), "deleted_runs": len(decision["delete"]),
               "deleted_objects": len(doomed), "fresh_export": fresh["run_id"] if fresh else None,
               "reasons": sorted(set(decision["delete"].values()))}
    surf_truth_admin.log_action(db, SYSTEM_ACTOR, "retention", "surf_truth_export", "retention",
                                detail={"kept": len(summary["kept"]), "deleted_runs": summary["deleted_runs"],
                                        "fresh_export": summary["fresh_export"]})
    await db.commit()
    return summary
