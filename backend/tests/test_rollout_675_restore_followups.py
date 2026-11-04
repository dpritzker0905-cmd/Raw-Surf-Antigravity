"""#675 restore follow-ups (LongCat review of apply_restore, 2026-11-03):

  * a concurrent NEWER registration on an UNTOUCHED key, landing after the apply-boundary revalidation, survives the republish
    (the products are built from the revalidated head, but the publish MERGES into the current head: union, exclude_keys=touched);
  * a write or read-back that fails partway records RESTORE_PARTIAL naming exactly the files restored and not restored, and
    republishes nothing;
  * the late re-check decides on a refusal's KIND, never on its message text.

Synthetic fixtures only (FakeIO, the in-memory pointer Chain); any real HTTP request fails the test."""
import importlib.util
import json
import os
from datetime import timedelta
from pathlib import Path

import pytest

import services.weather_pipeline.manifest_publish_step as mps
from services.weather_pipeline import rollout_675 as r
from services.weather_pipeline import rollout_675_restore as restore
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse here)
from tests._manifest_chain_harness import FakeStore, chain  # noqa: F401  (fixture)
from tests.test_estimate_continuity import NEW, T0, _prod
from tests.test_prune_shared_objects import ImmediateExecutor
from tests.test_rollout_675 import _env, _written_run  # noqa: F401  (_env: autouse here)

OTHER = "euro_marine_waves_global_coarse_20261111T210000Z.json"        # a key the restore does not touch


def _status(io):
    return json.loads(io.objects[r.STATUS_KEY])["lanes"]["core"]


# ── finding 2: a newer registration on an untouched key is folded in, not lost ─────────────────────────────────────────


class _MovesBeforeTheMerge(ImmediateExecutor):
    """The manifest executor; before the FIRST job (the one-step read-merge-CAS) runs, another writer commits."""

    def __init__(self, move):
        self.move = move

    def submit(self, fn, *args, **kwargs):
        move, self.move = self.move, None
        if move:
            move()
        return super().submit(fn, *args, **kwargs)


@pytest.mark.parametrize("when", ["during_the_writes", "between_the_last_check_and_the_merge"])
def test_a_newer_untouched_registration_after_the_revalidation_survives_the_republish(tmp_path, monkeypatch, chain, when):  # noqa: F811
    """Production's publish path (MANIFEST_PUBLISH_ONE_STEP=1 in all four CI writers): real _default_publish ->
    submit_manifest_publish -> read-merge-CAS against the pointer Chain."""
    import services.weather_pipeline.store as store_mod
    store, io, _ = _written_run(tmp_path)
    monkeypatch.setattr(store, "_upload_to_supabase", FakeStore(chain)._upload_to_supabase)
    chain.foreign_publish(lambda _: [dict(x) for x in io.head])                   # the shared head = the run's published head
    monkeypatch.setattr(io, "head_products", lambda: json.loads(chain.objects[chain.head_key])["products"])
    plan = restore.plan_restore(io, "core")
    assert plan["refusals"] == []
    other = dict(_prod(T0 + timedelta(hours=6), NEW + timedelta(hours=1), OTHER).model_dump(mode="json"), product_id=OTHER)

    def pilots_registers():
        chain.foreign_publish(lambda products: products + [other])
    if when == "during_the_writes":                                              # after step (2), before the last re-check
        real_copy = io.copy

        def copy_then_register(src, dst):
            real_copy(src, dst)
            if OTHER not in chain.head_files():
                pilots_registers()
        monkeypatch.setattr(io, "copy", copy_then_register)
    else:                                                                        # after every check the restore makes
        monkeypatch.setattr(store_mod, "_manifest_executor", _MovesBeforeTheMerge(pilots_registers))
    handed = []
    real_submit = mps.submit_manifest_publish

    def spy(st, manifest, exclude_keys=None):
        handed.append(sorted(p.filename for p in manifest.products))
        return real_submit(st, manifest, exclude_keys=exclude_keys)
    monkeypatch.setattr(mps, "submit_manifest_publish", spy)

    out = restore.apply_restore(io, store, plan)

    assert out["state"] == r.RESTORED
    assert handed == [["d.json", "w.json"]], "the products were not built from the revalidated (pre-registration) head"
    ours = [c for c in chain.cas_calls if c["won"] and c["expected"] == 7]       # g5 base, g6 run head, g7 pilots, then OURS
    assert len(ours) == 1 and OTHER in ours[0]["files"], "the restore's own merged candidate did not carry the registration"
    assert chain.head_files() == sorted(["d.json", "w.json", OTHER]), "the concurrent registration was lost"
    assert chain.head_entry(OTHER)["run_time"].startswith("2026-11-01T21:30")    # theirs, unchanged
    assert chain.head_entry("w.json")["run_time"].startswith("2026-11-01T16:30")  # the touched keys: pre-op registrations
    assert chain.head_entry("d.json")["run_time"].startswith("2026-11-01T16:30")
    assert io.objects["w.json"] == b"w-old" and io.objects["d.json"] == b"d-old"


# ── finding 3: a failure partway is RESTORE_PARTIAL, with both lists, and no republish ───────────────────────────────


@pytest.mark.parametrize("how", ["torn_read_back", "write_raises"])
def test_a_failure_on_the_second_key_records_restore_partial_with_both_lists(tmp_path, monkeypatch, how):
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    assert [e["filename"] for e in plan["entries"]] == ["d.json", "w.json"]       # d.json is written first, w.json second
    marks_before = io.objects.get(r.MARKS_KEY)
    if how == "torn_read_back":
        real_copy = io.copy

        def copy_tears_w(src, dst):
            real_copy(src, dst)
            if dst == "w.json":
                io.objects["w.json"] = b"torn"
        monkeypatch.setattr(io, "copy", copy_tears_w)
    else:
        io.fail_keys.add("w.json")                                              # copy and the upload fallback both refuse

    out = restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("republished after a partial restore"))

    assert out["state"] == r.RESTORE_PARTIAL and out["republished"] is False
    assert out["restored_files"] == ["d.json"] and out["not_restored_files"] == ["w.json"] and out["failed_file"] == "w.json"
    assert out["restored"] == 1 and out["status_written"] is True and "w.json" in out["refused"][0]
    assert "Nothing was rolled back" in out["advice"] and "Regenerate" in out["advice"]
    lane = _status(io)
    assert lane["state"] == r.RESTORE_PARTIAL and lane["republished"] is False
    assert lane["restored_files"] == ["d.json"] and lane["not_restored_files"] == ["w.json"] and lane["failed_file"] == "w.json"
    assert lane["restored_cycle"] == plan["cycle_id"] and lane["audit_ok"] is False
    assert io.objects["d.json"] == b"d-old"                                       # kept: no rollback (that is more writes)
    assert io.objects.get(r.MARKS_KEY) == marks_before                            # marks untouched


def test_a_partial_restore_whose_status_write_fails_still_returns_both_lists(tmp_path, monkeypatch):
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    io.fail_keys.update({"w.json", r.STATUS_KEY})
    out = restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("republished"))
    assert out["state"] == r.RESTORE_PARTIAL and out["status_written"] is False
    assert out["restored_files"] == ["d.json"] and out["not_restored_files"] == ["w.json"]


# ── finding 4: refusals carry a KIND, and only the LATE kinds stop the republish ─────────────────────────────────────


@pytest.mark.parametrize("how,kind", [
    ("bytes", restore.REVISION_CHANGED), ("marked_delete_rewritten", restore.DELETE_REWRITTEN),
    ("newer_cycle", restore.NEWER_RUN), ("newer_entry", restore.NEWER_ENTRY), ("not_recorded", restore.NOT_RECORDED),
    ("head_unreadable", restore.HEAD_UNREADABLE), ("no_index", restore.NO_INDEX), ("no_cycle", restore.NO_CYCLE),
])
def test_every_refusal_carries_its_kind_and_reads_as_before(tmp_path, monkeypatch, how, kind):
    store, io, run = _written_run(tmp_path)
    lane, cycle = "core", "20261101T203000Z-1"
    if how == "bytes":
        io.objects["w.json"] = b"rewritten"
    elif how == "marked_delete_rewritten":
        io.objects["d.json"] = b"d-rewritten"
    elif how == "newer_cycle":
        io.objects[r.STATUS_KEY] = json.dumps({"lanes": {"core": {"cycle_id": "20261102T003000Z-2"}}}).encode()
    elif how == "newer_entry":
        io.head.append(dict(_prod(T0, NEW + timedelta(hours=1), "w.json").model_dump(mode="json"), product_id="pilots-key"))
    elif how == "not_recorded":
        index = json.loads(io.objects[f"{run.prefix}/_index.json"])
        index["entries"] = [dict(e, written_sha256=None) if e["filename"] == "w.json" else e for e in index["entries"]]
        io.objects[f"{run.prefix}/_index.json"] = json.dumps(index).encode()
    elif how == "head_unreadable":
        io.head = None
    elif how == "no_index":
        del io.objects[f"{run.prefix}/_index.json"]
    else:
        lane, cycle = "nobody", None
    plan = restore.plan_restore(io, lane, cycle)
    assert [x.kind for x in plan["refusals"]] == [kind]
    assert all(isinstance(x, str) for x in plan["refusals"])                      # still the message: printing and JSON unchanged
    assert json.loads(json.dumps(plan["refusals"])) == [str(x) for x in plan["refusals"]]


def _with_late_recheck(monkeypatch, *extra):
    """plan_restore as usual, except the LAST re-check (the one after the writes) also returns `extra`."""
    real, calls = restore.plan_restore, []

    def plan_restore(io, lane="core", cycle_id=None):
        out = real(io, lane, cycle_id)
        calls.append(out)
        if len(calls) == 2:                                                      # 1 = the revalidation, 2 = the late re-check
            out["refusals"] = list(out["refusals"]) + list(extra)
        return out
    monkeypatch.setattr(restore, "plan_restore", plan_restore)
    return calls


def test_the_expected_revision_changed_refusals_after_the_writes_do_not_stop_the_republish(tmp_path, monkeypatch):
    """After the writes every written key's live sha IS its pre-op sha, so the late re-check reports REVISION_CHANGED for it:
    expected, and it must not stop the republish."""
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    calls, published = _with_late_recheck(monkeypatch), []
    out = restore.apply_restore(io, store, plan, publish=lambda st, products, keys: published.append(keys))
    assert [x.kind for x in calls[1]["refusals"]] == [restore.REVISION_CHANGED]   # w.json (d.json's pre-op sha matches)
    assert out["state"] == r.RESTORED and published


@pytest.mark.parametrize("extra,late", [
    (restore.Refusal(restore.REVISION_CHANGED, "w.json: a newer entry and a newer run, in the TEXT only"), False),
    ("a plain string that says newer entry and newer run", False),
    (restore.Refusal(restore.NEWER_ENTRY, "w.json: reworded"), True),
    (restore.Refusal(restore.NEWER_RUN, "lane moved on (reworded)"), True),
])
def test_the_late_recheck_decides_on_the_kind_not_the_message(tmp_path, monkeypatch, extra, late):
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    _with_late_recheck(monkeypatch, extra)
    published = []
    out = restore.apply_restore(io, store, plan, publish=lambda st, products, keys: published.append(keys))
    if late:
        assert out["republished"] is False and out["refused"] == [extra] and published == []
        assert out["restored_files"] == ["d.json", "w.json"] and out["not_restored_files"] == []
    else:
        assert out["state"] == r.RESTORED and published


def test_a_newer_run_of_the_lane_during_the_writes_stops_the_republish(tmp_path, monkeypatch):
    """The real NEWER_RUN case (the NEWER_ENTRY one is test_restore_rechecks_the_shared_head_before_republishing)."""
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    real_copy = io.copy

    def copy_then_the_lane_runs(src, dst):
        real_copy(src, dst)
        io.objects[r.STATUS_KEY] = json.dumps({"lanes": {"core": {"cycle_id": "20261102T003000Z-2", "state": r.RUNNING}}}).encode()
    monkeypatch.setattr(io, "copy", copy_then_the_lane_runs)
    out = restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("published over a newer run"))
    assert out["republished"] is False and [x.kind for x in out["refused"]] == [restore.NEWER_RUN]
    assert _status(io)["state"] == r.RUNNING                                      # the newer run's status is not overwritten


@pytest.mark.parametrize("operator_env,expected", [(None, "1"), ("0", "0")])
def test_the_restore_script_republishes_through_the_one_step_lane(monkeypatch, operator_env, expected):
    """Finding 2's proof holds on the one-step lane; on the old path (the variable unset) a registration landing between the
    caller-thread merge and the queued PUT is lost. So --yes defaults the lane on, like every CI writer; an explicit '0' wins."""
    for name in ("L2_WRITER", "MANIFEST_PUBLISH_ONE_STEP"):
        monkeypatch.setenv(name, "placeholder")                                  # so teardown restores the original either way
        monkeypatch.delenv(name)
    if operator_env is not None:
        monkeypatch.setenv("MANIFEST_PUBLISH_ONE_STEP", operator_env)
    seen = {}

    class Stop(Exception):
        pass

    class IO:
        def __init__(self, store):
            seen["lane"] = os.environ.get("MANIFEST_PUBLISH_ONE_STEP")
            raise Stop

    class Store:
        def restore_from_supabase(self):
            pass
    import services.weather_pipeline.rollout_675_io as rio
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(rio, "SupabaseIO", IO)
    monkeypatch.setattr(store_mod, "ProductStore", Store)
    script = Path(__file__).resolve().parents[1] / "scripts" / "restore_rollout_snapshot.py"
    spec = importlib.util.spec_from_file_location("restore_cli", script)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    with pytest.raises(Stop):
        cli.main(["--yes"])
    assert seen["lane"] == expected
