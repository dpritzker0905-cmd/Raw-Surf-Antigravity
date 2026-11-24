"""The TIDE family of the flag guardrail (gates/tide-guard-v1.md + amendment 1): the tester that can see and auto-disable
SURF_TIDE_A_HARCON.

T1/T2 are D-090 rule 2's two tests (a WORSE result disables; a breach disables). T3 pins the transitions, T4 the planted
controls' machinery on a synthetic two-arm table (the gate's real-build T4 runs in the job), T5 the runtime network guard,
plus amendment 1: staleness judged every cycle, the blind report counted in cycles over >= 24 h, and ONE dedicated issue
whose title no other guardrail search matches."""
import argparse
import math
import os
import urllib.request
from datetime import datetime, timedelta, timezone

import pytest

from scripts import flag_guardrail as fg
from scripts import flag_guardrail_tide as T
from services import runtime_flags as rf
from services.weather_pipeline import guardrail_stats as gs
from services.weather_pipeline import tide as TD

FLAG = "SURF_TIDE_A_HARCON"
NOW = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
ON = {"schema": rf.SCHEMA, "flags": {FLAG: {"state": "on"}}}
REPO = os.path.join(os.path.dirname(__file__), "..", "..")


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv(T.RELEASE_ENV, "1")
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")


# ---- a synthetic two-arm table and its NOAA truth ------------------------------------------------------------------
STRATA = {"HARBOR_BAY": [f"M{i}" for i in range(20)], "OPEN_COAST": [f"M{i}" for i in range(20, 40)]}
KEYS = {f"M{i}": f"{30 + i * 0.1:.1f},{-80.0:.1f}" for i in range(40)}
MONITORS = (STRATA, {"HARBOR_BAY": [], "OPEN_COAST": []}, KEYS)
STAMP = NOW - timedelta(hours=2)
START = datetime(2026, 11, 28, tzinfo=timezone.utc)
HOURS = 24 * 20


def _level(i, h):
    amp = 0.5 + 0.025 * i
    return amp * math.cos(2 * math.pi * (h - i * 0.3) / 12.42) + 0.15 * amp * math.cos(2 * math.pi * h / 12.0)


def _doc(on=None):
    keys = {KEYS[f"M{i}"]: [round(1000 * _level(i, h)) for h in range(HOURS)] for i in range(40)}
    return {"schema": "raw-surf/tide-own/2", "start": START.strftime("%Y-%m-%dT%H:%M"), "hours": HOURS,
            "generated_at": T.iso(STAMP), "keys": keys, "am_h": on if on is not None else dict(keys)}


def _noaa(sid, begin, end):
    """NOAA's events: the OFF arm's own (so OFF is perfect and every plant's effect is the plant)."""
    i = int(sid[1:])
    times = [(START + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00") for h in range(HOURS)]
    ev = TD.tide_extrema(times, [round(1000 * _level(i, h)) / 1000.0 for h in range(HOURS)])
    return [(e["time"], e["type"], e["level_m"]) for e in ev if begin <= e["time"] < end]


def _cycle(doc, watch=None, now=NOW):
    return T.cycle(FLAG, watch or {}, now, read=lambda etag: (doc, "e1", False), fetch=_noaa, monitors=MONITORS)


# ---- registration ---------------------------------------------------------------------------------------------------
def test_the_flag_is_registered_held_off_and_seen_by_the_tide_family():
    from routes.admin.surf_forecast import _RATING_FLAGS
    assert rf.GUARDED[FLAG] == "0" and _RATING_FLAGS[FLAG][0] == "0" and FLAG in rf.FIX_VERSION
    assert fg.coverage(FLAG)[0] == fg.TIDE == T.TIDE and FLAG not in fg.NEVER_AUTO_DISABLE
    assert T.TIDE_FLAGS[FLAG] == "am_h"


def test_the_frozen_monitor_list_loads_as_twenty_per_stratum_with_keys():
    strata, reserve, keys = T.load_monitors()
    assert {k: len(v) for k, v in strata.items()} == {"HARBOR_BAY": 20, "OPEN_COAST": 20}
    assert all(len(v) == 10 for v in reserve.values()) and "9418686" in strata["HARBOR_BAY"]
    assert all(i in keys for v in list(strata.values()) + list(reserve.values()) for i in v)


def test_score_flags_never_stages_the_replay_for_a_tide_flag():
    staged = []
    r = fg.score_flags([FLAG], NOW, "c", "o", stage=lambda *a, **k: staged.append(1), ledger=lambda n: {})
    assert not staged and r[FLAG]["coverage"] == fg.TIDE and r[FLAG]["verdict"] == gs.UNTESTABLE


# ---- T1 / T2: D-090 rule 2 --------------------------------------------------------------------------------------------
def _decide(verdict, now, watch=None, sanity=(), manifest=ON):
    res = {"verdict": verdict, "sanity": list(sanity), "coverage": T.TIDE, "reasons": [f"synthetic {verdict}"]}
    return fg.decide(FLAG, res, dict(manifest, watch=watch or {}), "v1", now)


def test_T1_two_worse_builds_a_day_apart_disable_the_flag():
    first = _decide(gs.WORSE, NOW)
    assert first["action"] == "strike"
    second = _decide(gs.WORSE, NOW + timedelta(hours=25), fg.next_watch({}, FLAG, first))
    assert second["action"] == "disable" and second["entry"]["state"] == "off" and second["entry"]["set_by"] == fg.SET_BY
    assert "WORSE" in second["reason"]


def test_T2_a_sanity_breach_disables_at_once():
    d = _decide(gs.NOT_WORSE, NOW, sanity=["b5 ON-OFF mean offset > 0.05 m at 40 keys"])
    assert d["action"] == "disable" and "b5" in d["reason"]


# ---- T3: transitions --------------------------------------------------------------------------------------------------
def test_T3_two_worse_builds_under_24_h_apart_do_not_disable():
    first = _decide(gs.WORSE, NOW)
    assert _decide(gs.WORSE, NOW + timedelta(hours=6), fg.next_watch({}, FLAG, first))["action"] == "strike"


def test_T3_cached_and_untestable_keep_strikes_and_not_worse_resets():
    w = fg.next_watch({}, FLAG, _decide(gs.WORSE, NOW))
    for v in (T.CACHED, gs.UNTESTABLE):
        d = _decide(v, NOW + timedelta(hours=6), w)
        assert d["action"] == "none" and fg.next_watch(w, FLAG, d)[FLAG]["strikes"] == 1
    d = _decide(gs.NOT_WORSE, NOW + timedelta(hours=6), w)
    assert d["action"] == "none" and FLAG not in fg.next_watch(w, FLAG, d)
    # WORSE, CACHED, WORSE a day later still disables: the cached cycle neither struck nor cleared
    kept = fg.next_watch(w, FLAG, _decide(T.CACHED, NOW + timedelta(hours=6), w))
    assert _decide(gs.WORSE, NOW + timedelta(hours=25), kept)["action"] == "disable"


def test_T3_a_second_cycle_on_the_same_build_returns_cached_and_adds_no_strike():
    r1, w = _cycle(_doc())
    assert r1["verdict"] == gs.NOT_WORSE and r1["build"] == T.iso(STAMP)
    r2, _ = _cycle(_doc(), w, NOW + timedelta(hours=6))
    assert r2["verdict"] == T.CACHED and r2["cached_verdict"] == gs.NOT_WORSE


def test_T3_one_window_worse_is_not_a_build_worse():
    on = _doc()["keys"]
    shifted = dict(on)
    for i in range(40):                     # ON = OFF shifted +60 min in W2 only
        v = on[KEYS[f"M{i}"]]
        t0 = int((STAMP.replace(minute=0) + timedelta(hours=1) - START).total_seconds() // 3600) + 24 * 7
        shifted[KEYS[f"M{i}"]] = v[:t0] + [v[t0 - 1]] + v[t0:-1]
    r, _ = _cycle(_doc(shifted))
    assert r["verdict"] == gs.NOT_WORSE and any("one-window WORSE" in x for x in r["reasons"])


def test_T3_shadow_counts_not_worse_passes_and_never_counts_a_cached_cycle():
    entry = {"state": "off", "set_by": fg.SET_BY, "fix_version": "v1",
             "shadow": {"feature_id": FLAG, "version": "v1", "passes": 0, "fails": 0, "required_passes": 3, "verdicts": []}}
    man = {"schema": rf.SCHEMA, "flags": {FLAG: entry}}
    d = _decide(gs.NOT_WORSE, NOW, manifest=man)
    assert d["entry"]["shadow"]["passes"] == 1
    d = _decide(T.CACHED, NOW, manifest=man)
    assert d["entry"]["shadow"]["passes"] == 0 and "no evidence" in d["reason"]


def test_T3_nothing_ever_re_enables():
    man = {"schema": rf.SCHEMA, "flags": {FLAG: {"state": "off", "set_by": fg.SET_BY, "fix_version": "v1"}}}
    for v in (gs.NOT_WORSE, gs.BETTER, T.CACHED, gs.UNTESTABLE):
        d = _decide(v, NOW, manifest=man)
        assert (d.get("entry") or {}).get("state") != "on"


# ---- amendment 1 --------------------------------------------------------------------------------------------------
def test_staleness_is_judged_every_cycle_never_from_the_cached_verdict():
    _, w = _cycle(_doc())
    late = STAMP + timedelta(hours=37)
    r, _ = _cycle(_doc(), w, late)
    assert r["verdict"] == gs.UNTESTABLE and "stale" in r["reasons"][0]
    r, _ = T.cycle(FLAG, w, late, read=lambda etag: (None, etag, True), fetch=_noaa, monitors=MONITORS)  # a 304 too
    assert r["verdict"] == gs.UNTESTABLE


def _blind_run(hours, watch):
    res = {FLAG: {"verdict": gs.UNTESTABLE, "coverage": T.TIDE}}

    def down(etag):
        raise OSError("bucket down")
    return T.tide_pass(res, watch, NOW + timedelta(hours=hours), read=down, fetch=_noaa, monitors=MONITORS)


def test_the_blind_report_counts_cycles_spanning_24_h_not_builds():
    w = {}
    for h in (0, 6, 12):
        _, w, blind, _ = _blind_run(h, w)
    assert not blind                                   # 3 cycles over 12 h: no report
    for h in (18, 24):
        _, w, blind, _ = _blind_run(h, w)
    assert blind and blind[0].startswith("TIDE GUARD-BLIND") and "5 cycles over 24 h" in blind[0]
    res = {FLAG: {"verdict": gs.UNTESTABLE, "coverage": T.TIDE}}
    _, w2, blind, judged = T.tide_pass(res, w, NOW + timedelta(hours=30), read=lambda e: (_doc(), "e", False),
                                       fetch=_noaa, monitors=MONITORS)
    assert not blind and judged == [FLAG] and FLAG not in w2[T.K_BLIND]


def test_one_dedicated_issue_whose_title_no_other_search_matches():
    titles = {"flag": "[dry run] Flag guardrail: SURF_X", "physics": "PHYSICS guard blind: a physics guard has judged "
              "nothing for 24 h", "p0": fg.P0_DRIFT_TITLE, "tide": T.BLIND_TITLE}
    filters = {"flag": lambda t: "Flag guardrail" in t and "PHYSICS guard blind" not in t
               and not t.startswith("P0 cold-start snapshot drift"),
               "physics": lambda t: t.startswith("PHYSICS guard blind"),
               "p0": lambda t: t.startswith("P0 cold-start snapshot drift"),
               "tide": lambda t: t.startswith("TIDE guard blind")}
    for name, title in titles.items():
        assert [k for k, f in filters.items() if f(title)] == [name], title
    words = T.BLIND_TITLE.lower().replace(":", " ").split()
    assert not {"flag", "guardrail", "physics", "p0", "cold-start", "snapshot", "drift"} & set(words)
    wf = open(os.path.join(REPO, ".github", "workflows", "flag-guardrail.yml"), encoding="utf-8").read()
    assert f'--title "{T.BLIND_TITLE}"' in wf and 'startswith("TIDE guard blind")' in wf
    assert "TIDE_GUARD_RELEASED: ${{ vars.TIDE_GUARD_RELEASED || '0' }}" in wf


def test_the_near_lineage_monitor_is_reported_with_and_without():
    r, _ = _cycle(_doc())
    assert r["near_lineage"]["verdict_without"] == gs.NOT_WORSE
    assert any("near-lineage 9418686" in x for x in r["reasons"]) and "worse_builds_14d" in r


# ---- T4 machinery: the five planted controls on a synthetic table ---------------------------------------------------
def test_T4_every_planted_control_gives_exactly_its_required_verdict():
    r, _ = _cycle(_doc())
    pl = r["planted"]
    assert {k: v["pass"] for k, v in pl.items()} == {k: True for k in T.PLANTS}, pl
    assert pl["identity"]["verdict"] == gs.NOT_WORSE and not pl["identity"]["sanity"]
    assert pl["shift_60min"]["verdict"] == gs.WORSE and pl["amp_x1.25"]["verdict"] == gs.WORSE
    assert pl["sign_flip"]["sanity"] and any(s.startswith("b5") for s in pl["offset_0.10m"]["sanity"])


def test_the_planted_run_is_a_sandbox_never_fed_to_decide():
    r, w = _cycle(_doc())
    assert r["verdict"] == gs.NOT_WORSE and not r["sanity"]            # the real arms, not the plants
    assert set(w) >= {T.K_CACHE} and "planted" in w[T.K_CACHE][FLAG]["result"]


def test_real_breaches_reach_decide_on_the_real_arm():
    doc = _doc()
    doc["am_h"] = {k: [v + 100 for v in vals] for k, vals in doc["keys"].items()}     # +0.10 m on the served ON arm
    r, _ = _cycle(doc)
    assert any(s.startswith("b5") for s in r["sanity"])


def test_report_only_before_release(monkeypatch):
    monkeypatch.setenv(T.RELEASE_ENV, "0")
    doc = _doc()
    doc["am_h"] = {k: [v + 100 for v in vals] for k, vals in doc["keys"].items()}
    res = {FLAG: {"verdict": gs.UNTESTABLE, "coverage": T.TIDE}}
    out, _, blind, judged = T.tide_pass(res, {}, NOW, read=lambda e: (doc, "e", False), fetch=_noaa, monitors=MONITORS)
    assert out[FLAG]["verdict"] == gs.UNTESTABLE and not out[FLAG]["sanity"] and out[FLAG]["report_only"]
    assert judged == [FLAG] and not blind                              # report-only is judged, not blind
    assert fg.decide(FLAG, out[FLAG], dict(ON, watch={}), "v1", NOW)["action"] == "none"


# ---- T5: the runtime network guard ----------------------------------------------------------------------------------
@pytest.mark.parametrize("url,method", [("https://raw-surf-backend.onrender.com/api/health", "GET"),
                                        ("https://example.com/x", "GET"),
                                        ("https://proj.supabase.co/storage/v1/object/weather-products/x", "POST")])
def test_T5_the_tide_pass_can_reach_only_the_bucket_and_coops_with_gets(url, method):
    import scored_rows_gate as srg
    with pytest.raises(srg.ReadOnlyViolation):
        with T.guarded():
            urllib.request.urlopen(urllib.request.Request(url, data=b"x" if method == "POST" else None,
                                                          method=method), timeout=5)


def test_T5_the_module_names_no_backend_host():
    src = open(T.__file__, encoding="utf-8").read().lower()
    assert "onrender" not in src and "/api/weather" not in src and "raw-surf-backend" not in src


# ---- run() end to end -------------------------------------------------------------------------------------------------
def test_run_judges_the_tide_flag_and_reports_it(monkeypatch):
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    args = argparse.Namespace(enforce="0", reenable="", owner_words="", actor="", cache_dir="c", out="o", alert_cap=2,
                              run_url="run")
    rep = fg.run(args, now=NOW, manifest=ON, watch={}, volumes=lambda *a: {},
                 scorer=lambda flags, n, c, o: {f: {"verdict": gs.UNTESTABLE, "coverage": fg.TIDE, "sanity": []}
                                                for f in flags},
                 tide={"read": lambda e: (_doc(), "e", False), "fetch": _noaa, "monitors": MONITORS})
    assert rep["results"][FLAG]["verdict"] == gs.NOT_WORSE and rep["decisions"][FLAG]["action"] == "none"
    md = fg.markdown(rep)
    assert f"TIDE `{FLAG}`" in md and "planted (sandbox)" in md and "without near-lineage" in md
