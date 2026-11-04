"""Restore one #675 rollout snapshot (scripts/restore_rollout_snapshot.py; on demand, NEVER automatic).

Refuses, and tells the operator to regenerate (let the next ingest cycle rewrite the lane), when ANY of these holds:
  * the lane's status names a newer cycle than the snapshot (a newer run of this lane has written since);
  * the merged published head (the shared manifest every lane publishes) holds, on any touched key, an entry from ANY lane
    whose run_time is newer than what the snapshot recorded (written run_time, or the pre-op registration for a delete);
  * a touched object's CURRENT storage bytes differ from what the snapshot recorded as written (sha256), or, for a marked
    delete, from its pre-op bytes: someone (either lane) rewrote it.
Otherwise: copy each snapshot object back to its key (read back, sha256 = pre-op bytes), republish the head with every touched
key returned to its pre-op registration (keys the run created are dropped), clear their GC marks, and write state RESTORED.
If a write or its read-back fails partway, stop: state RESTORE_PARTIAL names the files restored and not restored, the manifest is
NOT republished, and nothing is rolled back (that would be more writes); the operator regenerates.

LIMITS (no bucket versioning): only the last SNAPSHOT_KEEP cycles per lane exist, and only objects the new rules touched; a
reader's stale DISK copies are cleared only by #684 + PRODUCT_REVISION_REFRESH=1 or a restart.
"""
import json
import logging
from datetime import datetime, timezone

from services.weather_pipeline import rollout_675 as r
from services.weather_pipeline.rollout_675_io import read_marks, read_status, write_marks, write_status

logger = logging.getLogger(__name__)
REGENERATE = ("refused: restoring would overwrite newer data. Regenerate instead: let the next ingest cycle rewrite the "
              "lane (or dispatch forecast-ingest), and use the kill switches ('0') to stop the #675 rules first if needed.")
PARTIAL = ("the restore STOPPED PARTWAY: the files in restored_files hold their pre-op bytes again, the files in not_restored_files "
           "do not (failed_file may hold either), and the manifest was NOT republished, so it still names the run's registrations. "
           "Nothing was rolled back (that would be more writes). Regenerate: let the next ingest cycle rewrite the lane (or "
           "dispatch forecast-ingest); do not re-run this restore over a half-restored lane.")

# Refusal KINDS (LongCat review 2026-11-03): apply_restore's late re-check decides on the kind, never on the message text, which
# interpolates filenames and may be reworded. LATE = the kinds that mean another writer registered newer data meanwhile.
NO_CYCLE, NO_INDEX, NEWER_RUN, HEAD_UNREADABLE = "no_cycle", "no_index", "newer_run", "head_unreadable"
NEWER_ENTRY, NOT_RECORDED, REVISION_CHANGED, DELETE_REWRITTEN = "newer_entry", "not_recorded", "revision_changed", "delete_rewritten"
LATE = frozenset({NEWER_RUN, NEWER_ENTRY})


class Refusal(str):
    """A refusal: the message the operator reads (it IS the string, so printing, JSON and the existing callers are unchanged)
    plus its `kind`, one of the constants above, which is what code decides on."""

    def __new__(cls, kind, message):
        self = super().__new__(cls, message)
        self.kind = kind
        return self


def plan_restore(io, lane="core", cycle_id=None) -> dict:
    status = read_status(io)
    lane_status = (status.get("lanes") or {}).get(lane) or {}
    cycle_id = cycle_id or lane_status.get("cycle_id")
    out = {"lane": lane, "cycle_id": cycle_id, "entries": [], "refusals": [], "status": status}
    if not cycle_id:
        out["refusals"].append(Refusal(NO_CYCLE, f"no cycle recorded for lane {lane}"))
        return out
    data = io.download(f"{r.SNAPSHOT_ROOT}/{lane}/{cycle_id}/_index.json")
    if data is None:
        out["refusals"].append(Refusal(NO_INDEX, f"no snapshot index for {lane}/{cycle_id} "
                                                 f"(only the last {r.SNAPSHOT_KEEP} cycles are kept)"))
        return out
    out["entries"] = entries = json.loads(data.decode("utf-8")).get("entries") or []
    if lane_status.get("cycle_id") and lane_status["cycle_id"] != cycle_id:
        out["refusals"].append(Refusal(NEWER_RUN, f"lane {lane} has a newer run ({lane_status['cycle_id']}) than snapshot "
                                                  f"{cycle_id}"))
    head = io.head_products()
    if head is None:
        out["refusals"].append(Refusal(HEAD_UNREADABLE, "published head unreadable"))
        return out
    out["head"] = head
    by_name = {}
    for raw in head:
        if isinstance(raw, dict):
            by_name.setdefault(raw.get("filename"), []).append(raw)
    for rec in entries:
        name = rec["filename"]
        ref = rec.get("written_run_time") or r.iso((rec.get("before") or {}).get("run_time"))
        newer = [r.iso(x.get("run_time")) for x in by_name.get(name, []) if ref and r.iso(x.get("run_time")) > ref]
        if newer:
            out["refusals"].append(Refusal(NEWER_ENTRY, f"{name}: the shared head holds a newer entry (run {max(newer)}) than the "
                                                        f"snapshot ({ref})"))
        current = io.download(name)
        if rec.get("kind") == "write":
            if not rec.get("written_sha256"):
                out["refusals"].append(Refusal(NOT_RECORDED, f"{name}: the written revision was never recorded"))
            elif current is None or r.sha256(current) != rec["written_sha256"]:
                out["refusals"].append(Refusal(REVISION_CHANGED, f"{name}: storage revision changed since the snapshot recorded "
                                                                 f"it as written"))
        elif current is not None and rec.get("before_sha256") and r.sha256(current) != rec["before_sha256"]:
            out["refusals"].append(Refusal(DELETE_REWRITTEN, f"{name}: a marked delete was rewritten since the snapshot"))
    return out


def _default_publish(store, products, exclude_keys):
    from services.weather_pipeline.manifest_publish_step import submit_manifest_publish
    from services.weather_pipeline.rollout_675_io import flush_manifest_publish
    from services.weather_pipeline.schemas import ManifestProduct
    manifest = store.get_manifest()
    manifest.products = [ManifestProduct.model_validate(x) for x in products]
    manifest.last_manifest_update = datetime.now(timezone.utc)
    store._save_manifest(manifest)
    submit_manifest_publish(store, manifest, exclude_keys=exclude_keys)
    flush_manifest_publish()


def _signature(plan):
    return sorted((e["filename"], e.get("kind"), e.get("before_sha256"), e.get("written_sha256"), e.get("snapshot_key"))
                  for e in plan.get("entries") or [])


def _partial(io, plan, now, restored, failed, why) -> dict:
    """A write or its read-back failed after `restored` were written and verified: record RESTORE_PARTIAL with both lists (the
    status is re-read first, so only this lane's entry changes) and return them. No rollback, no republish."""
    order = [rec["filename"] for rec in plan["entries"] if rec.get("snapshot_key")]
    not_restored = [name for name in order if name not in restored]
    out = {"restored": len(restored), "restored_files": list(restored), "not_restored_files": not_restored, "failed_file": failed,
           "republished": False, "state": r.RESTORE_PARTIAL, "refused": [f"{failed}: {why}"], "advice": PARTIAL}
    try:
        status = read_status(io)
    except Exception:
        status = plan["status"] or {}
    lanes = dict(status.get("lanes") or {})
    lane_status = dict(lanes.get(plan["lane"]) or {})
    lane_status.update(state=r.RESTORE_PARTIAL, restored_at=r.iso(now), restored_cycle=plan["cycle_id"], audit_ok=False,
                       restored_files=list(restored), not_restored_files=not_restored, failed_file=failed, republished=False,
                       reasons=[f"restore of {plan['cycle_id']} stopped at {failed} ({why}) after {len(restored)} of "
                                f"{len(order)} object(s); manifest not republished; regenerate"], entries_lost=[])
    lanes[plan["lane"]] = lane_status
    try:
        write_status(io, dict(status, lanes=lanes, updated_at=r.iso(now)))
        out["status_written"] = True
    except Exception as exc:
        logger.error("[Rollout 675] RESTORE_PARTIAL status not written (%s): the returned lists are the only record",
                     type(exc).__name__)
        out["status_written"] = False
    logger.error("[Rollout 675] RESTORE_PARTIAL: restored %s, not restored %s", restored, not_restored)
    return out


def apply_restore(io, store, plan, publish=None, now=None) -> dict:
    """Order (Codex recovery review 2026-11-03): (1) download EVERY snapshot object and check it against before_sha256;
    (2) re-run plan_restore FRESH against the current shared head and re-hash every touched live object against what the
    snapshot recorded (written sha; for a marked delete, the pre-op sha), as the LAST step before the first write; any
    refusal, or an index that differs from the operator's plan = refuse with ZERO mutation; (3) only then overwrite, each key
    read back; (4) re-check the head before republishing (defence in depth).

    RESIDUAL (not eliminated): these checks shrink the race to the gap between step (2) and the first write; a lane that writes
    inside that gap is overwritten. Supabase Storage has no conditional PUT and the bucket is unversioned, so no check here can
    make the restore atomic. Recommended (not built): an enforced exclusive-writer window, i.e. run the restore only while BOTH
    ingest workflows (forecast-ingest, forecast-ingest-pilots) and precompute are disabled or held in their concurrency group;
    storage versioning/CAS would need a storage migration and is the larger change."""
    if plan["refusals"]:
        return {"restored": 0, "refused": plan["refusals"], "advice": REGENERATE}
    now = now or datetime.now(timezone.utc)
    staged = {}
    for rec in plan["entries"]:                               # (1) preflight ALL snapshot objects: reads only
        if not rec.get("snapshot_key"):
            continue
        data = io.download(rec["snapshot_key"])
        if data is None or r.sha256(data) != rec.get("before_sha256"):
            return {"restored": 0, "refused": [f"snapshot object {rec['snapshot_key']} missing or altered"],
                    "advice": "no object was written. " + REGENERATE}
        staged[rec["filename"]] = (rec, data)
    fresh = plan_restore(io, plan["lane"], plan["cycle_id"])  # (2) the apply-boundary revalidation, last before any write
    if fresh["refusals"] or _signature(fresh) != _signature(plan):
        return {"restored": 0, "refused": fresh["refusals"] or ["the snapshot index changed since the plan"],
                "advice": "no object was written: something changed after the plan. " + REGENERATE}
    plan = dict(plan, head=fresh["head"], status=fresh["status"])
    restored = []
    for filename, (rec, data) in staged.items():             # (3) the writes; a failure stops here as RESTORE_PARTIAL
        try:
            try:
                io.copy(rec["snapshot_key"], filename)
            except Exception:
                io.upload(filename, data)
            back = io.download(filename)
        except Exception as exc:
            return _partial(io, plan, now, restored, filename, f"writing it raised {type(exc).__name__}")
        if back is None or r.sha256(back) != rec["before_sha256"]:
            return _partial(io, plan, now, restored, filename, "its read-back does not match the snapshot")
        restored.append(filename)
    # Re-read the SHARED head just before republishing (Reflection 2026-11-02): a lane that published a touched key since the
    # plan was checked wins; the objects already copied back are then reported, and the operator regenerates. After the writes
    # every written key's live sha IS the pre-op sha, so REVISION_CHANGED is expected here: only the LATE kinds count.
    again = plan_restore(io, plan["lane"], plan["cycle_id"]) if restored else plan
    late = [x for x in again["refusals"] if getattr(x, "kind", None) in LATE]
    if late:
        return {"restored": len(restored), "restored_files": list(restored), "not_restored_files": [], "republished": False,
                "refused": late, "advice": "objects were copied back but a newer registration landed meanwhile: " + REGENERATE}
    touched = {rec["filename"] for rec in plan["entries"]}
    keys = touched | {(rec.get("before") or {}).get("product_id") for rec in plan["entries"]} - {None}
    products = [raw for raw in plan["head"] if isinstance(raw, dict) and raw.get("filename") not in touched
                and (raw.get("product_id") or raw.get("filename")) not in keys]
    products += [rec["before"] for rec in plan["entries"] if rec.get("before")]
    (publish or _default_publish)(store, products, sorted(keys))
    marks = read_marks(io)
    write_marks(io, {k: v for k, v in marks.items() if k not in touched}, now.timestamp())
    status = plan["status"] or {}
    lanes = dict(status.get("lanes") or {})
    lane_status = dict(lanes.get(plan["lane"]) or {})
    lane_status.update(state=r.RESTORED, restored_at=r.iso(now), restored_cycle=plan["cycle_id"], audit_ok=False,
                       reasons=[f"restored {len(restored)} object(s) and {len(touched)} registration(s) from "
                                f"{plan['cycle_id']} by the operator"], entries_lost=[])
    lanes[plan["lane"]] = lane_status
    write_status(io, dict(status, lanes=lanes, updated_at=r.iso(now)))
    return {"restored": len(restored), "registrations": len(touched), "state": r.RESTORED}
