"""The owner's export retention rule (2026-11-18): 3 newest; a fresh export within 7 days of an account deletion; a key
rotation removes the old key's exports; orphans go after a grace."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import SurfTruthAdminAction
from services import surf_truth_export as ste
from services import surf_truth_retention as ret

NOW = datetime(2026, 11, 20, 4, 15, tzinfo=timezone.utc)
FP = "fp-current"


def _run(run_id, cut_h_ago, fp=FP, manifest=True, data=True, created_h_ago=None):
    """Objects and manifests for one export run."""
    day = f"surf-truth/exports/2026-11-{20 - cut_h_ago // 24:02d}"
    created = (NOW - timedelta(hours=created_h_ago if created_h_ago is not None else cut_h_ago)).isoformat()
    objects, manifests = [], {}
    if data:
        objects.append((f"{day}/{run_id}.jsonl", created))
    if manifest:
        key = f"{day}/{run_id}.manifest.json"
        objects.append((key, created))
        manifests[key] = {"cut_at": (NOW - timedelta(hours=cut_h_ago)).isoformat(), "key_fingerprint": fp}
    return objects, manifests


def _runs(*specs):
    objects, manifests = [], {}
    for spec in specs:
        o, m = _run(*spec[:2], **spec[2] if len(spec) > 2 else {})
        objects += o
        manifests.update(m)
    return ret.collect_runs(objects, manifests)


def test_keeps_the_three_newest_and_deletes_older():
    runs = _runs(("aaaaaa", 1), ("bbbbbb", 30), ("cccccc", 60), ("dddddd", 90), ("eeeeee", 120))
    p = ret.plan(runs, NOW, FP, last_erasure=None)
    assert p["keep"] == ["aaaaaa", "bbbbbb", "cccccc"] and not p["fresh_export"]
    assert set(p["delete"]) == {"dddddd", "eeeeee"}


def test_an_account_deletion_after_an_export_forces_a_fresh_export_and_removes_all_older():
    runs = _runs(("aaaaaa", 1), ("bbbbbb", 30))
    p = ret.plan(runs, NOW, FP, last_erasure=NOW - timedelta(hours=10))   # after bbbbbb, before aaaaaa
    assert p["fresh_export"] and p["keep"] == [] and set(p["delete"]) == {"aaaaaa", "bbbbbb"}
    p2 = ret.plan(runs, NOW, FP, last_erasure=NOW - timedelta(hours=100))  # before every export: nothing pending
    assert not p2["fresh_export"] and p2["keep"] == ["aaaaaa", "bbbbbb"]


def test_without_the_key_a_pending_deletion_removes_every_export():
    runs = _runs(("aaaaaa", 1), ("bbbbbb", 30))
    p = ret.plan(runs, NOW, None, last_erasure=NOW - timedelta(hours=2))
    assert not p["fresh_export"] and set(p["delete"]) == {"aaaaaa", "bbbbbb"}


def test_a_key_rotation_removes_the_old_keys_exports_and_orphans_wait_for_their_grace():
    runs = _runs(("aaaaaa", 1), ("bbbbbb", 30, {"fp": "fp-old"}),
                 ("cccccc", 1, {"manifest": False, "created_h_ago": 1}),     # being written: inside the grace
                 ("dddddd", 50, {"manifest": False}), ("eeeeee", 50, {"data": False}))
    p = ret.plan(runs, NOW, FP, last_erasure=None)
    assert p["keep"] == ["aaaaaa"]
    assert set(p["delete"]) == {"bbbbbb", "dddddd", "eeeeee"}
    assert "previous pseudonym key" in p["delete"]["bbbbbb"]


class FakeStore:
    def __init__(self, objects, manifests):
        self._objects, self._manifests, self.deleted = objects, manifests, []

    def objects(self):
        return list(self._objects)

    def manifest(self, key):
        return self._manifests.get(key)

    def delete(self, keys):
        self.deleted.extend(keys)


@pytest.fixture
def maker():
    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: SurfTruthAdminAction.__table__.create(c))
        return async_sessionmaker(engine, expire_on_commit=False)
    return asyncio.run(build())


def test_enforce_writes_a_fresh_export_after_a_deletion_deletes_the_rest_and_logs(maker, monkeypatch):
    monkeypatch.setenv(ste.KEY_ENV, "k" * 40)
    objects, manifests = [], {}
    for spec in (("aaaaaa", 1), ("bbbbbb", 30)):
        o, m = _run(*spec, fp=ste.key_fingerprint(b"k" * 40))
        objects += o
        manifests.update(m)
    store = FakeStore(objects, manifests)

    async def fake_build(db, key, since=None):
        return [{"row": 1}], {"schema": "s", "rows": 1}

    async def fake_write(rows, manifest, now=None):
        return {"run_id": "ffffff", "data_object": "x/ffffff.jsonl", "manifest_object": "x/ffffff.manifest.json",
                "rows": len(rows)}
    monkeypatch.setattr(ste, "build_export", fake_build)
    monkeypatch.setattr(ste, "write_export", fake_write)

    async def go():
        async with maker() as db:
            db.add(SurfTruthAdminAction(admin_id="system", action="account_erasure", target_type="account",
                                        target_id="r" * 32, at=NOW - timedelta(hours=10)))
            await db.commit()
            summary = await ret.enforce(db, store=store, now=NOW)
            assert summary["fresh_export"] == "ffffff" and summary["kept"] == ["ffffff"]
            assert summary["deleted_runs"] == 2 and len(store.deleted) == 4
            actions = [(a.action, a.admin_id) for a in (await db.execute(
                select(SurfTruthAdminAction).order_by(SurfTruthAdminAction.at))).scalars().all()]
            assert ("export", "system") in actions and ("retention", "system") in actions
    asyncio.run(go())


def test_enforce_with_nothing_pending_keeps_three(maker, monkeypatch):
    monkeypatch.setenv(ste.KEY_ENV, "k" * 40)
    fp = ste.key_fingerprint(b"k" * 40)
    objects, manifests = [], {}
    for rid, h in (("aaaaaa", 1), ("bbbbbb", 30), ("cccccc", 60), ("dddddd", 90)):
        o, m = _run(rid, h, fp=fp)
        objects += o
        manifests.update(m)
    store = FakeStore(objects, manifests)

    async def go():
        async with maker() as db:
            summary = await ret.enforce(db, store=store, now=NOW)
            assert summary["kept"] == ["aaaaaa", "bbbbbb", "cccccc"] and summary["fresh_export"] is None
            assert sorted(store.deleted) == sorted(k for k, _ in objects if "dddddd" in k)
    asyncio.run(go())
