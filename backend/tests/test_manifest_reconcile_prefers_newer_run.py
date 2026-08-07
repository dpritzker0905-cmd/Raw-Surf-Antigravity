"""THE LANE THAT AGED OUT WAS A KEY COLLISION INSIDE THE ANTI-CLOBBER MERGE.

WHY THIS EXISTS (MASTER-AUDIT-10.0 §1.8/§1.8a). ICON/weather went stale for 14.2 h and crossed the
paging bound while its own fetcher logged `steps_ok=61 steps_failed=0 ... wrote=yes`. The audit
narrowed it to "two overlapping workflows read-modify-write one shared manifest, last writer wins"
and then REFUTED that with its own control: the core run's 01:18Z GFS/marine write survived the same
overlap, which no simple clobber story explains. It concluded the mechanism was not established and
prescribed a logging instrument for the next cycle.

★ THE MECHANISM, AND IT IS NOT A CLOBBER — it is a collision inside the merge that exists to PREVENT
clobbers:
  1. `_build_product_filename` keys a product by **valid_time**, never run_time, and
     `product_id = filename`. So the same lane+forecast-hour has the SAME key on every run.
  2. `reconcile_manifest_products_for_upload` folded in a remote entry only when the key was ABSENT
     locally. Its own docstring named the residual risk: "for keys both sides hold, OUR copy wins
     even if theirs is newer -> their metadata update reverts until their next registration."
  3. The pilots workflow runs `INGEST_PILOTS='only'` and never ingests the global lanes. For
     ICON/weather it therefore holds ONLY a STALE RESTORED copy — and "until their next
     registration" is NEVER, so the lane ages until it pages.

⇒ AND THAT IS EXACTLY THE CONTROL THE AUDIT COULD NOT EXPLAIN. GFS/marine survived because the
pilots DO write it themselves, so their copy really was the newest. A lane is lost precisely when the
second writer does NOT re-ingest it but DOES carry a restored entry for it.

Fix: on a key collision keep whichever entry has the NEWER `run_time`. For slices a process actually
touched its own copy is newest by construction, so the original intent is untouched — test 2 pins
that, and it is what stops a future edit "simplifying" this into always-take-remote.
Kill switch: MANIFEST_MERGE_PREFER_NEWER=0.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import store as store_mod  # noqa: E402
from services.weather_pipeline.schemas import (  # noqa: E402
    CoverageBounds, ManifestProduct, PipelineManifest,
)

T_OLD = datetime(2026, 8, 7, 0, 0, tzinfo=timezone.utc)    # the run BOTH sides restored from
T_NEW = datetime(2026, 8, 7, 1, 38, tzinfo=timezone.utc)   # the core ingest's fresh write
VALID = datetime(2026, 8, 7, 6, 0, tzinfo=timezone.utc)
GLOBE = CoverageBounds(west=-180.0, south=-90.0, east=180.0, north=90.0)

ICON_KEY = "icon_weather_pressure_20260807T060000Z.json"


def _item(model, domain, layer, run_time):
    """Filename built exactly as `_build_product_filename` builds it — VALID-time keyed, which is
    the whole reason two runs collide on one key."""
    fn = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{VALID.strftime('%Y%m%dT%H%M%SZ')}.json"
    return ManifestProduct(
        model=model, provider="test", domain=domain, layer=layer,
        run_time=run_time, valid_time_start=VALID, valid_time_end=VALID,
        resolution=0.25, freshness_sec=1800, is_forecast_authoritative=True,
        coverage=GLOBE, filename=fn, product_id=fn,
    )


def _remote(*items):
    return [p.model_dump(mode="json") for p in items]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("MANIFEST_MERGE_ON_UPLOAD", raising=False)
    monkeypatch.delenv("MANIFEST_MERGE_PREFER_NEWER", raising=False)


def _run(local_items, remote_items, monkeypatch, exclude_keys=None):
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: remote_items)
    manifest = PipelineManifest(last_manifest_update=T_OLD, products=list(local_items))
    folded = store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=exclude_keys)
    by_key = {(p.product_id or p.filename): p for p in manifest.products}
    return manifest, folded, by_key


def test_a_STALE_RESTORED_copy_does_not_revert_the_other_writers_fresh_run(monkeypatch):
    """THE ONE THAT WOULD HAVE CAUGHT IT. We hold a 00:00Z restored copy and never re-ingested this
    lane; the remote carries the core run's 01:38Z. Ours must NOT win."""
    _, _, by_key = _run(
        [_item("ICON", "weather", "pressure", T_OLD)],
        _remote(_item("ICON", "weather", "pressure", T_NEW)),
        monkeypatch,
    )
    assert by_key[ICON_KEY].run_time == T_NEW, (
        "a stale restored local entry overwrote a concurrent writer's newer run — this is the "
        "ICON/weather lane ageing out while its own fetcher logged a successful write")


def test_our_OWN_fresher_write_still_wins__THE_INTENT_IS_PRESERVED(monkeypatch):
    """⛔ NOT A BUG, and the reason this is a run_time comparison rather than always-take-remote.
    For a slice we actually touched, our copy IS the newest and must survive."""
    ours_newer = datetime(2026, 8, 7, 2, 30, tzinfo=timezone.utc)
    _, _, by_key = _run(
        [_item("ICON", "weather", "pressure", ours_newer)],
        _remote(_item("ICON", "weather", "pressure", T_NEW)),
        monkeypatch,
    )
    assert by_key[ICON_KEY].run_time == ours_newer, (
        "our own fresh registration was reverted to an older remote run — the merge must never "
        "move a lane backwards")


def test_a_key_we_hold_no_copy_of_is_still_folded_in__PRE_EXISTING_BEHAVIOUR(monkeypatch):
    manifest, folded, by_key = _run(
        [_item("GFS", "marine", "waves", T_NEW)],
        _remote(_item("ICON", "weather", "pressure", T_NEW)),
        monkeypatch,
    )
    assert folded == 1 and ICON_KEY in by_key


def test_a_PRUNED_key_is_never_resurrected_even_when_the_remote_run_is_newer(monkeypatch):
    """⛔ THE INVARIANT THAT MUST SURVIVE THE FIX. Prune sites pass the ids they just deleted; the
    remote still lists them because our prune has not uploaded yet. Folding one back in mints a
    manifest entry whose L2 object is gone (the dangling-entry 404 class, audit #28)."""
    _, folded, by_key = _run(
        [_item("GFS", "marine", "waves", T_NEW)],
        _remote(_item("ICON", "weather", "pressure", T_NEW)),
        monkeypatch,
        exclude_keys=[ICON_KEY],
    )
    assert folded == 0 and ICON_KEY not in by_key


def test_an_UNPARSEABLE_remote_run_time_never_displaces_a_known_good_local_entry(monkeypatch):
    raw = _remote(_item("ICON", "weather", "pressure", T_NEW))
    raw[0]["run_time"] = "not-a-timestamp"
    _, _, by_key = _run([_item("ICON", "weather", "pressure", T_OLD)], raw, monkeypatch)
    assert by_key[ICON_KEY].run_time == T_OLD, (
        "an unreadable remote timestamp displaced our entry — refuse rather than guess")


def test_the_kill_switch_restores_the_pre_fix_behaviour(monkeypatch):
    monkeypatch.setenv("MANIFEST_MERGE_PREFER_NEWER", "0")
    _, _, by_key = _run(
        [_item("ICON", "weather", "pressure", T_OLD)],
        _remote(_item("ICON", "weather", "pressure", T_NEW)),
        monkeypatch,
    )
    assert by_key[ICON_KEY].run_time == T_OLD


def test_the_filename_is_VALID_time_keyed__the_root_that_makes_keys_COLLIDE(monkeypatch):
    """Pins the mechanism itself. If filenames ever became run-keyed, two runs would stop colliding
    and this whole class would change shape — re-measure before trusting the reconcile logic."""
    from services.weather_pipeline.store_helpers import _build_product_filename

    class _P:
        model, domain, layer, region_id = "ICON", "weather", "pressure", None
        valid_time = VALID
        is_estimated = False

    name = _build_product_filename(_P())
    assert VALID.strftime("%Y%m%dT%H%M%SZ") in name, "filename is no longer valid-time keyed"
    assert name == ICON_KEY
