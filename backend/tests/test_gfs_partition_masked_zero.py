"""Plan 4 (2026-11-24): a MASKED GFS-Wave partition subcell is zero energy where the total is valid (GFS_PARTITION_MASKED_AS_ZERO).

Pins: the helper's arithmetic; heights only fall and a block with no masked subcell is bit-identical; a block with no train
stays NaN; the TOTAL, every period and every direction are bit-identical through the REAL fetch loop; the confidence's
denominator (Fix B) reads 1/64 for a train in 1 of 64 subcells; the flag reaches the fetcher only through the parent's
payload (so a manifest auto-off reaches it); and the guardrail's PHYSICS rails, with the two D-090 decide() tests."""
import json
import math
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import flag_guardrail as fg  # noqa: E402
from services import _fetch_partition_mask as pm  # noqa: E402
from services import _fetch_common as fc  # noqa: E402
from services import _fetch_blockmean_vec as fv  # noqa: E402
from services import _fetch_region_reduce as rr  # noqa: E402
from services import runtime_flags as rf  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

FLAG = "GFS_PARTITION_MASKED_AS_ZERO"
T0 = datetime(2026, 11, 25, tzinfo=timezone.utc)


def _height_blocks(arr, half=4):
    """Every interior block centre of `arr` through the production batch height reduction."""
    n, m = arr.shape
    rs, cs = np.meshgrid(np.arange(half, n - half + 1, 2 * half), np.arange(half, m - half + 1, 2 * half), indexing="ij")
    rs, cs = rs.ravel(), cs.ravel()
    out, _ = rr.variable(arr, None, True, None, None, arr, rs, cs, half, False)
    return out


# ------------------------------------------------------------------ the helper

def test_fill_zeroes_only_where_the_total_is_valid():
    p = np.array([[1.0, np.nan, np.nan], [np.nan, 2.0, 0.5]])
    h = np.array([[2.0, 1.5, np.nan], [np.nan, 2.5, 1.0]])
    got = pm.fill_masked(p, h)
    assert got[0, 1] == 0.0 and np.isnan(got[0, 2]) and np.isnan(got[1, 0])
    assert got[0, 0] == 1.0 and got[1, 1] == 2.0 and got[1, 2] == 0.5
    assert np.isnan(p[0, 1])                                     # a copy: the decoded array is never changed


def test_prepare_fills_the_three_partition_heights_and_nothing_else():
    a = {om: np.array([[np.nan, 1.0]]) for om in pm.PARTITION_HEIGHTS + ("swell_wave_period", "swell_wave_direction")}
    a["wave_height"] = np.array([[2.0, 2.0]])
    got = pm.prepare(a)
    assert set(got) == set(pm.PARTITION_HEIGHTS)
    assert all(got[om][0, 0] == 0.0 for om in got)
    assert pm.prepare({"swell_wave_height": a["swell_wave_height"]}) == {}   # no total: nothing to anchor a zero to


def test_payload_value_defaults_to_the_code_default_and_honours_a_kill():
    assert pm.payload_value({}) is True and rf.GUARDED[FLAG] == "1"
    for off in ("0", 0, False, "false", "off"):
        assert pm.payload_value({pm.PAYLOAD_KEY: off}) is False
    assert pm.payload_value({pm.PAYLOAD_KEY: "1"}) is True


# ------------------------------------------------------------------ heights: only fall, unchanged without masks, empty stays NaN

def _sea(seed=1, shape=(40, 64), mask_p=0.35):
    rng = np.random.default_rng(seed)
    total = rng.uniform(0.3, 6.0, shape)
    total[:, :5] = np.nan                                         # a coast: land where the total is NaN
    part = total * rng.uniform(0.2, 0.9, shape)
    part[rng.uniform(size=shape) < mask_p] = np.nan               # masked: no train in this subcell
    return total, part


def test_partition_height_only_falls_and_unmasked_blocks_are_bit_identical():
    total, part = _sea()
    old = _height_blocks(part)
    new = _height_blocks(pm.fill_masked(part, total))
    both = np.isfinite(old) & np.isfinite(new)
    assert both.sum() > 20 and np.all(new[both] <= old[both])
    assert np.any(new[both] < old[both])                          # the fix does something on a masked sea
    clean_total, clean = _sea(seed=2, mask_p=0.0)
    assert np.array_equal(_height_blocks(clean), _height_blocks(pm.fill_masked(clean, clean_total)), equal_nan=True)


def test_union_support_a_partition_where_the_total_is_nan_cannot_make_it_rise():
    """SubQ's counterexample: p finite where the total is NaN. It stays IN the support (never zeroed, never dropped)."""
    p = np.full((8, 8), np.nan)
    h = np.full((8, 8), 2.0)
    h[0, 0] = np.nan
    p[0, 0] = 0.0                                                 # finite partition, total NaN
    p[1, 1] = p[2, 2] = 4.0
    old = _height_blocks(p)
    new = _height_blocks(pm.fill_masked(p, h))
    assert new[0] <= old[0]


def test_a_block_with_no_train_stays_nan_but_a_real_zero_stays_zero():
    total = np.full((8, 16), 1.5)
    part = np.full((8, 16), np.nan)
    part[:, 8:] = 0.0                                            # right block: a REAL calm train (0.0 present)
    filled = _height_blocks(pm.fill_masked(part, total))
    assert list(filled) == [0.0, 0.0]
    rs, cs = np.array([4, 4]), np.array([4, 12])
    got = pm.keep_absent(filled, rs, cs, lambda a, b: rr.variable(part, None, True, None, None, part, a, b, 4, False)[0])
    assert np.isnan(got[0]) and got[1] == 0.0


def test_on_the_measured_sea_shape_closure_returns():
    """A block where swell is present in a quarter of the subcells: before, its RMS read the full local height; after, the
    block's energy, so sum(p^2) <= H^2 holds again (the 2-deg R2 24.5 % -> 1.05 % mechanism, in miniature)."""
    total = np.full((8, 8), 2.0)
    swell = np.full((8, 8), np.nan)
    swell[:4, :4] = 1.9
    ww = np.full((8, 8), np.nan)
    ww[4:, 4:] = 1.9
    H = _height_blocks(total)[0]
    old = [_height_blocks(a)[0] for a in (swell, ww)]
    new = [_height_blocks(pm.fill_masked(a, total))[0] for a in (swell, ww)]
    assert sum(x * x for x in old) > 1.1 * H * H
    assert sum(x * x for x in new) <= H * H


# ------------------------------------------------------------------ Fix B: the confidence denominator

def test_a_train_in_1_of_64_subcells_reads_coverage_one_64th():
    total = np.full((8, 8), 2.0)
    h = np.full((8, 8), np.nan)
    d = np.full((8, 8), np.nan)
    h[3, 3], d[3, 3] = 1.0, 270.0
    rs, cs = np.array([4]), np.array([4])
    _, conf_old = fv.partition_dir_conf_batch(d, h, rs, cs, 4, True, lambda r, c: (np.nan, 0.0))
    dirs, conf_new = fv.partition_dir_conf_batch(d, pm.fill_masked(h, total), rs, cs, 4, True,
                                                 lambda r, c: (np.nan, 0.0), support="height")
    assert conf_old[0] == pytest.approx(1.0)
    assert conf_new[0] == pytest.approx(1 / 64) and 0.0 <= conf_new[0] <= 1.0
    assert dirs[0] == pytest.approx(270.0)                        # the direction itself is unchanged
    s_dir, s_conf = fc.energy_mean_direction_block_partition_conf(d, pm.fill_masked(h, total), 4, 4, 4, True, "height")
    assert s_conf == pytest.approx(1 / 64) and s_dir == pytest.approx(270.0)   # scalar twin agrees


def test_default_support_is_bit_identical_to_before():
    rng = np.random.default_rng(5)
    d = rng.uniform(0, 360, (16, 16))
    h = rng.uniform(0, 3, (16, 16))
    h[rng.uniform(size=h.shape) < 0.3] = np.nan
    d[np.isnan(h)] = np.nan
    rs, cs = np.array([4, 8, 12]), np.array([4, 8, 12])
    a = fv.partition_dir_conf_batch(d, h, rs, cs, 4, True, lambda r, c: (np.nan, 0.0))
    b = fv.partition_dir_conf_batch(d, h, rs, cs, 4, True, lambda r, c: (np.nan, 0.0), support="finite")
    assert all(np.array_equal(x, y, equal_nan=True) for x, y in zip(a, b))


# ------------------------------------------------------------------ the REAL fetch loop: totals, periods, directions identical

class _AbsentTrainGrbs:
    """The shadow suite's structured fields, except: the total is valid everywhere off the land band, and swell_2 is
    MASKED everywhere (a train absent from every block) - the case `empty_as_nan` exists for."""

    def read(self):
        from tests.test_vector_blockmean_loop_shadow import _Grbs
        import services.noaa_gfs_wave_fetcher as fetcher
        msgs = _Grbs().read()
        order = fetcher.OM_ORDER
        tot = msgs[order.index("wave_height")].values
        tot[np.isnan(tot)] = 1.7
        tot[4:10, :] = np.nan
        msgs[order.index("secondary_swell_wave_height")].values = np.full_like(tot, np.nan)
        return msgs

    def close(self):
        pass


def _loop(monkeypatch, on, grbs=None):
    from tests.test_vector_blockmean_loop_shadow import _Grbs, _idx_text, _INTERIOR_BBOX, _INTERIOR_RES
    import services.noaa_gfs_wave_fetcher as fetcher
    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: (grbs or _Grbs)()))
    for k, v in (("NOAA_COARSE_DIR_BLOCKMEAN", "1"), ("NOAA_COARSE_SCALAR_BLOCKMEAN", "1"),
                 ("NOAA_COARSE_DIR_CONFIDENCE", "1"), ("NOAA_PARTITION_DIR_CONFIDENCE", "1"), ("FETCH_VECTOR_BLOCKMEAN", "1")):
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(fetcher, "_pick_cycle", lambda *_a: (datetime(2026, 8, 2, tzinfo=timezone.utc), "https://stub/gfswave."))

    def _get(url, **kw):
        if url.endswith(".idx"):
            return types.SimpleNamespace(text=_idx_text(), status_code=200)
        rng = (kw.get("headers") or {}).get("Range", "")
        a, _, b = rng[6:].partition("-")
        return types.SimpleNamespace(status_code=206, content=b"\x00" * (int(b) - int(a) + 1 if a.isdigit() and b.isdigit() else 8))

    monkeypatch.setattr(__import__("requests"), "get", _get)
    payload = {"bbox": _INTERIOR_BBOX, "resolution": _INTERIOR_RES, "forecast_days": 1, "output_path": "",
               pm.PAYLOAD_KEY: "1" if on else "0"}
    points, ok, _f, _t = fetcher.fetch_global_coarse(payload)
    assert ok > 0 and points
    return points


def _series(points, key):
    return [v for p in points for v in (p.get("hourly") or p).get(key, [])]


def test_real_loop_totals_periods_directions_identical_heights_fall(monkeypatch):
    off, on = _loop(monkeypatch, False), _loop(monkeypatch, True)
    keys = set().union(*[set((p.get("hourly") or p).keys()) for p in off])
    same = [k for k in keys if k not in pm.PARTITION_HEIGHTS and not k.endswith("_direction_confidence")]
    for k in same:                                                 # wave_height, every period, every direction
        assert _series(off, k) == _series(on, k), k
    moved = 0
    for k in pm.PARTITION_HEIGHTS:
        a, b = _series(off, k), _series(on, k)
        assert len(a) == len(b)
        for x, y in zip(a, b):
            if x is None:
                assert y is None                                   # no train before -> still none (never 0 m)
            elif y is not None:
                assert y <= x + 1e-9
                moved += y < x
    assert moved > 0
    lower = 0
    for k in [k for k in keys if k.endswith("_direction_confidence") and k != "wave_direction_confidence"]:
        for x, y in zip(_series(off, k), _series(on, k)):     # Fix B: a bigger denominator can only lower R x coverage
            if x is not None and y is not None:
                assert y <= x + 1e-9
                lower += y < x - 1e-9
    assert lower > 0
    assert _series(off, "wave_direction_confidence") == _series(on, "wave_direction_confidence")


def test_real_loop_a_train_absent_from_every_block_stays_none_not_zero(monkeypatch):
    off = _loop(monkeypatch, False, _AbsentTrainGrbs)
    on = _loop(monkeypatch, True, _AbsentTrainGrbs)
    a, b = _series(off, "secondary_swell_wave_height"), _series(on, "secondary_swell_wave_height")
    assert a and all(x is None for x in a)
    assert all(y is None for y in b), "a block with no train must stay no-data, never 0 m"
    assert _series(off, "wave_height") == _series(on, "wave_height")


# ------------------------------------------------------------------ the parent passes the flag (manifest reaches the fetcher)

def _captured_payload(monkeypatch, manifest_state=None, env=None):
    from services import noaa_marine_service as nms
    import asyncio
    import subprocess
    seen = {}
    monkeypatch.setattr(rf, "_manifest", lambda: ({FLAG: {"state": manifest_state}} if manifest_state else {}))
    monkeypatch.delenv(FLAG, raising=False)
    if env is not None:
        monkeypatch.setenv(FLAG, env)

    def fake_run(cmd, **kw):
        seen.update(json.loads(cmd[-1]))
        return subprocess.CompletedProcess(cmd, 1, "", "stub")
    monkeypatch.setattr(subprocess, "run", fake_run)
    fn = [getattr(nms, n) for n in dir(nms) if n.startswith("fetch_") and asyncio.iscoroutinefunction(getattr(nms, n))]
    assert fn, "noaa_marine_service has no async fetch_ entry point"
    import inspect
    f = nms.fetch_gfs_marine_global_coarse
    params = inspect.signature(f).parameters
    kw = {k: v for k, v in {"bbox": {"west": 0, "south": 0, "east": 1, "north": 1}, "resolution": 2.0,
                            "forecast_days": 1}.items() if k in params}
    monkeypatch.setattr(nms, "_is_test_environment", lambda: False, raising=False)
    try:
        asyncio.run(f(**kw))
    except Exception:  # noqa: BLE001 - only the payload matters
        pass
    return seen


def test_the_parent_resolves_the_flag_and_a_manifest_off_reaches_the_fetcher(monkeypatch):
    on = _captured_payload(monkeypatch)
    if not on:
        pytest.skip("the entry point returned before spawning in this environment")
    assert on[pm.PAYLOAD_KEY] == "1"
    off = _captured_payload(monkeypatch, manifest_state="off")
    assert off[pm.PAYLOAD_KEY] == "0" and pm.payload_value(off) is False
    killed = _captured_payload(monkeypatch, env="0")
    assert killed[pm.PAYLOAD_KEY] == "0"


def test_no_fetcher_reads_the_flag_from_the_environment():
    src = open(os.path.join(os.path.dirname(HERE), "services", "noaa_gfs_wave_fetcher.py"), encoding="utf-8").read()
    src += open(pm.__file__, encoding="utf-8").read()
    assert f'environ.get("{FLAG}"' not in src and f"environ.get('{FLAG}'" not in src


# ------------------------------------------------------------------ the guard: PHYSICS rails and the two D-090 decide() tests

def _report(r2, r1, run_time="2026-11-25T06:00:00Z", cells=9000):
    s = {"GFS": {"energy_closure": {"rate": r2, "cells": cells}, "partition_le_total": {"rate": r1, "cells": cells}}}
    return {"summary": s, "frames_read": 60,
            "index_run_times": {f"GFS/marine/{lay}/global_mid": run_time for lay in ("waves", "swell_1", "swell_2", "wind_waves")}}


ON_SINCE = "2026-11-25T00:00:00Z"


def test_physics_rails_are_pre_registered_and_cover_the_flag():
    assert fg.coverage(FLAG)[0] == fg.PHYSICS
    rails = fg.PHYSICS_RAILS[FLAG]
    assert rails["worse"] == {"energy_closure": 0.05, "partition_le_total": 0.005}
    assert rails["breach"] == {"energy_closure": 0.15, "partition_le_total": 0.02}
    assert rf.FIX_VERSION[FLAG] == "2026-11-24"


def test_physics_result_classes():
    ok = fg.physics_result(FLAG, _report(0.0105, 0.0), ON_SINCE)
    assert ok["verdict"] == gs.NOT_WORSE and not ok["sanity"]
    worse = fg.physics_result(FLAG, _report(0.08, 0.0), ON_SINCE)
    assert worse["verdict"] == gs.WORSE and not worse["sanity"]
    breach = fg.physics_result(FLAG, _report(0.22, 0.025), ON_SINCE)
    assert breach["sanity"] and "energy_closure 22.00%" in breach["sanity"][0]
    stale = fg.physics_result(FLAG, _report(0.22, 0.025, run_time="2026-11-24T18:00:00Z"), ON_SINCE)
    assert stale["verdict"] == gs.UNTESTABLE and not stale["sanity"]          # frames built before the flag: not judged
    assert fg.physics_result(FLAG, {"error": "x"}, ON_SINCE)["verdict"] == gs.UNTESTABLE
    assert fg.physics_result(FLAG, _report(0.22, 0.0), None)["verdict"] == gs.UNTESTABLE


def test_decide_a_worse_physics_r2_disables_the_flag_after_its_strikes():
    """D-090 test 1: a WORSE result for THIS flag makes decide() disable it (2 strikes over >= 24 h, as every WORSE)."""
    worse = fg.physics_result(FLAG, _report(0.08, 0.0), ON_SINCE)
    m = fg.empty_manifest()
    d1 = fg.decide(FLAG, worse, m, rf.FIX_VERSION[FLAG], T0)
    assert d1["action"] == "strike"
    m2 = dict(m, watch={FLAG: d1["watch"]})
    d2 = fg.decide(FLAG, worse, m2, rf.FIX_VERSION[FLAG], T0 + timedelta(hours=fg.STRIKE_SPAN_H))
    assert d2["action"] == "disable" and d2["entry"]["state"] == "off" and d2["entry"]["set_by"] == fg.SET_BY


def test_decide_a_physics_sanity_breach_disables_the_flag_at_once():
    """D-090 test 2: a sanity breach for THIS flag makes decide() disable it, without strikes."""
    breach = fg.physics_result(FLAG, _report(0.22, 0.025), ON_SINCE)
    d = fg.decide(FLAG, breach, fg.empty_manifest(), rf.FIX_VERSION[FLAG], T0)
    assert d["action"] == "disable" and "physics breach" in d["reason"]


def test_after_an_auto_off_only_the_owner_re_enables_d087():
    off = {"state": "off", "reason": "r", "set_by": fg.SET_BY, "set_at": "x", "evidence": "e", "fix_version": "old"}
    m = fg.empty_manifest()
    m["flags"][FLAG] = off
    d = fg.decide(FLAG, fg.physics_result(FLAG, _report(0.01, 0.0), ON_SINCE), m, rf.FIX_VERSION[FLAG], T0)
    assert d["action"] == "version_hold" and d["entry"]["state"] == "off"
    m["flags"][FLAG] = d["entry"]
    for _ in range(4):                                             # clean physics while OFF is not evidence for the fix
        d = fg.decide(FLAG, dict(fg.physics_result(FLAG, _report(0.01, 0.0), ON_SINCE), coverage=fg.PHYSICS), m,
                      rf.FIX_VERSION[FLAG], T0)
        assert d["action"] == "hold" and d["entry"]["state"] == "off"
        m["flags"][FLAG] = d["entry"]


def test_run_records_when_the_flag_was_first_on_and_judges_only_newer_frames(monkeypatch, tmp_path):
    args = types.SimpleNamespace(enforce="0", reenable=None, cache_dir=str(tmp_path), out=str(tmp_path), run_url="u",
                                 alert_cap=5, commit="c")

    def scorer(flags, now, c, o):
        return {f: {"verdict": gs.NOT_WORSE, "reasons": [], "sanity": []} for f in flags}
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    old_frames = _report(0.22, 0.025, run_time="2026-11-24T00:00:00Z")
    rep = fg.run(args, T0, fg.empty_manifest(), scorer, lambda *a: {}, watch={}, physics=lambda since=None: old_frames)
    assert rep["watch"][fg.PHYSICS_ON_KEY][FLAG] == fg.iso(T0)
    assert rep["decisions"][FLAG]["action"] == "none"              # frames older than the first ON sighting: never judged
    new_frames = _report(0.22, 0.025, run_time=fg.iso(T0 + timedelta(hours=4)))
    rep2 = fg.run(args, T0 + timedelta(hours=6), fg.empty_manifest(), scorer, lambda *a: {}, watch=rep["watch"],
                  physics=lambda since=None: new_frames)
    assert rep2["decisions"][FLAG]["action"] == "disable"


def test_the_guard_reads_physics_through_the_same_rule_module_as_the_report():
    src = open(fg.__file__, encoding="utf-8").read()
    assert "import frame_physics_report as fpr" in src and "fpr.run_check" in src
    assert not math.isnan(fg.PHYSICS_RAILS[FLAG]["worse"]["energy_closure"])


# ------------------------------------------------------------------ advisor hold on #1267: strikes survive UNTESTABLE; GUARD-BLIND

UNTESTABLE = {"verdict": gs.UNTESTABLE, "reasons": ["outage"], "sanity": [], "coverage": fg.PHYSICS}


def _step(flag, result, watch, now):
    d = fg.decide(flag, result, dict(fg.empty_manifest(), watch=watch), rf.FIX_VERSION[flag], now)
    return d, fg.next_watch(watch, flag, d)


def test_worse_untestable_worse_still_disables():
    worse = fg.physics_result(FLAG, _report(0.08, 0.0), ON_SINCE)
    d1, w = _step(FLAG, worse, {}, T0)
    assert d1["action"] == "strike"
    d2, w = _step(FLAG, UNTESTABLE, w, T0 + timedelta(hours=6))
    assert d2["action"] == "none" and w[FLAG]["strikes"] == 1 and w[FLAG]["first_worse_at"] == fg.iso(T0)
    d3, w = _step(FLAG, worse, w, T0 + timedelta(hours=fg.STRIKE_SPAN_H))
    assert d3["action"] == "disable"


def test_only_a_judged_not_worse_clears_the_strikes():
    worse = fg.physics_result(FLAG, _report(0.08, 0.0), ON_SINCE)
    _, w = _step(FLAG, worse, {}, T0)
    _, w = _step(FLAG, fg.physics_result(FLAG, _report(0.01, 0.0), ON_SINCE), w, T0 + timedelta(hours=6))
    assert FLAG not in w


def test_untestable_alone_never_disables():
    w = {}
    for i in range(12):
        d, w = _step(FLAG, UNTESTABLE, w, T0 + timedelta(hours=6 * i))
        assert d["action"] == "none" and "entry" not in d


def _args(tmp_path):
    return types.SimpleNamespace(enforce="0", reenable=None, cache_dir=str(tmp_path), out=str(tmp_path), run_url="u",
                                 alert_cap=5, commit="c")


def _scorer(flags, now, c, o):
    return {f: {"verdict": gs.NOT_WORSE, "reasons": [], "sanity": []} for f in flags}


def test_four_untestable_runs_open_guard_blind_and_a_judged_run_closes_it(monkeypatch, tmp_path):
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    watch, t = {}, T0
    for i in range(fg.PHYSICS_BLIND_RUNS):
        rep = fg.run(_args(tmp_path), t, fg.empty_manifest(), _scorer, lambda *a: {}, watch=watch,
                     physics=lambda since=None: {"error": "storage 503"})
        watch, t = rep["watch"], t + timedelta(hours=6)
        assert rep["decisions"][FLAG]["action"] == "none"          # blindness never disables
        assert bool(rep["guard_blind"]) == (i + 1 >= fg.PHYSICS_BLIND_RUNS)
    assert "GUARD-BLIND" in rep["guard_blind"][0] and "GUARD-BLIND" in fg.markdown(rep)
    fg.write_guard_files(str(tmp_path), rep)
    assert (tmp_path / "guard-blind.txt").read_text().startswith("GUARD-BLIND") and (tmp_path / "guard-judged.txt").read_text() == ""
    fresh = _report(0.01, 0.0, run_time=fg.iso(t))
    rep = fg.run(_args(tmp_path), t + timedelta(hours=1), fg.empty_manifest(), _scorer, lambda *a: {}, watch=watch,
                 physics=lambda since=None: fresh)
    assert rep["guard_blind"] == [] and rep["guard_judged"] == [FLAG]
    assert FLAG not in rep["watch"][fg.PHYSICS_BLIND_KEY]
    fg.write_guard_files(str(tmp_path), rep)
    assert (tmp_path / "guard-blind.txt").read_text() == "" and (tmp_path / "guard-judged.txt").read_text() == FLAG


def test_the_workflow_opens_one_guard_blind_issue_and_closes_it_on_a_judged_run():
    wf = open(os.path.join(os.path.dirname(os.path.dirname(HERE)), ".github", "workflows", "flag-guardrail.yml"),
              encoding="utf-8").read()
    step = wf[wf.index("- name: Open or close the GUARD-BLIND issue"):]
    assert "guard-blind.txt" in step and "guard-judged.txt" in step
    assert '[ -n "$n" ] || gh issue create' in step                 # ONE issue: never a second while one is open
    assert "gh issue close" in step


def test_fresh_layers_are_judged_and_stale_ones_named():
    import frame_physics_report as fpr
    latest = {"sets": {f"GFS/marine/{lay}/global_mid": {"index": f"i/{lay}.json"} for lay in ("waves", "swell_1", "swell_2")}}
    idx = {f"i/{lay}.json": {"run": "2026-11-25T00:00:00Z", "frames": [],
                             "run_time": "2026-11-24T00:00:00Z" if lay == "swell_2" else "2026-11-25T03:00:00Z"}
           for lay in ("waves", "swell_1", "swell_2")}
    store = dict(idx, **{"v1/latest.json": latest})
    rd = fpr.Reader(lambda p: json.dumps(store[p]).encode() if p in store else None, 10)
    rep = fpr.run_check(rd, models=("GFS",), fresh_since=ON_SINCE)
    assert set(rep["stale_skipped"]) == {"GFS/marine/swell_2/global_mid"}
    assert set(rep["index_run_times"]) == {"GFS/marine/waves/global_mid", "GFS/marine/swell_1/global_mid"}
    r = fg.physics_result(FLAG, dict(_report(0.01, 0.0), stale_skipped=rep["stale_skipped"]), ON_SINCE)
    assert r["verdict"] == gs.NOT_WORSE and "swell_2" in " ".join(r["reasons"])


def _jq_of(line):
    return line.split("--jq '", 1)[1].rsplit("'", 1)[0]


def test_the_blind_issue_and_the_main_guardrail_issue_never_share_a_search():
    """Advisor hold on #1267: a DISABLE notice must never be appended to the blind issue (a judged run auto-closes it)."""
    import shutil
    import subprocess
    wf = open(os.path.join(os.path.dirname(os.path.dirname(HERE)), ".github", "workflows", "flag-guardrail.yml"),
              encoding="utf-8").read()
    main_line = next(ln for ln in wf.splitlines() if '--search "Flag guardrail in:title"' in ln)
    blind_line = next(ln for ln in wf.splitlines() if '--search "\\"PHYSICS guard blind\\" in:title"' in ln)
    blind_step = wf[wf.index("- name: Open or close the GUARD-BLIND issue"):]
    title = blind_step.split('--title "', 1)[1].split('"', 1)[0]
    assert "flag guardrail" not in title.lower() and title.startswith("PHYSICS guard blind")
    assert 'contains("PHYSICS guard blind") | not' in _jq_of(main_line)         # the main search excludes the blind issue
    assert 'startswith("PHYSICS guard blind")' in _jq_of(blind_line)             # the blind search finds only its own
    issues = [{"number": 5, "title": title}, {"number": 7, "title": "[dry run] Flag guardrail: SURF_TIDE_DEPTH"}]
    if shutil.which("jq"):                                                       # CI runners have jq: run the real filters
        run = lambda f: subprocess.run(["jq", "-r", f], input=json.dumps(issues), capture_output=True, text=True).stdout.strip()
        assert run(_jq_of(main_line)) == "7"
        assert run(_jq_of(blind_line)) == "5"
        assert run(_jq_of(main_line)) and subprocess.run(["jq", "-r", _jq_of(main_line)], input=json.dumps(issues[:1]),
                                                          capture_output=True, text=True).stdout.strip() == ""
