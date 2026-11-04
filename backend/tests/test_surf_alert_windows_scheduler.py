"""The ALERTS_FORECAST_WINDOWS branch of the REAL scheduled job, with the database and the horizon faked.

Pins: (1) flag off is today's loop, call for call and byte for byte; (2) flag on reads the precomputed horizon,
never the live point resolver, and never names a model; (3) one push per window, de-duplicated across runs by the
notifications it already wrote; (4) a missing horizon sends nothing and LOGS why; (5) the producer is inert off.
"""
import json
import logging
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import scheduler.surf_alerts as SA  # noqa: E402
import scheduler.surf_alert_windows as SW  # noqa: E402
from test_surf_alert_windows import NOW, entry, horizon  # noqa: E402


@pytest.fixture(autouse=True)
def _no_lead_gate(monkeypatch):
    monkeypatch.setenv("ALERTS_NOTIFY_LEAD_H", "0")     # gated separately in test_surf_alert_windows.py


class _Session:
    """Answers the three statements the window task issues, by their shape; records everything."""
    def __init__(self, alerts, notif_rows, store, claim_ok=True):
        self.alerts, self.notif_rows, self.store, self.claim_ok = alerts, notif_rows, store, claim_ok

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, stmt, *_a, **_k):
        text = str(stmt).lower()
        self.store.setdefault("sql", []).append(text.split()[0])
        alerts, rows, ok = self.alerts, self.notif_rows, self.claim_ok

        class _R:
            def scalars(self):
                data = rows if "notifications" in text else alerts
                return types.SimpleNamespace(all=lambda: list(data))

            def all(self):
                # (user_id, data, created_at): a bare data string is user u1's row, sent at an unknown time.
                return [r if isinstance(r, tuple) else ("u1", r, None) for r in rows]

            def scalar_one_or_none(self):
                return "claimed" if ok else None
        return _R()

    def add(self, obj):
        self.store.setdefault("notifications", []).append(obj)

    async def commit(self):
        self.store["commits"] = self.store.get("commits", 0) + 1


def _alert(**kw):
    spot = types.SimpleNamespace(id="s1", name="Cocoa Beach", latitude=28.35, longitude=-80.6)
    base = dict(id="a1", user_id="u1", spot=spot, spot_id="s1", min_wave_height=2.0, max_wave_height=12.0,
                time_windows=None, tide_states=None, preferred_conditions=None, notify_push=True,
                trigger_count=0, last_triggered=None, is_active=True,
                user=types.SimpleNamespace(subscription_tier="premium"))
    base.update(kw)
    return types.SimpleNamespace(**base)


@pytest.fixture
def run_windows(monkeypatch):
    async def _run(obj, alerts=None, rows=(), claim_ok=True):
        store = {"pushes": []}
        import database
        import models
        monkeypatch.setattr(database, "async_session_maker",
                            lambda: _Session(alerts or [_alert()], rows, store, claim_ok))

        async def _push(_db, user_id, title=None, body=None, data=None):
            store["pushes"].append({"user_id": user_id, "title": title, "body": body, "data": data})
        import scheduler.base as base
        monkeypatch.setattr(base, "send_push_notification", _push)
        await SW.check_surf_alert_windows_task(now=NOW, load_horizon=lambda: obj, capabilities=[])
        return store
    return _run


# ── flag off: today's loop, unchanged ───────────────────────────────────────────────────────────────────
async def _legacy_run(monkeypatch, env):
    if env is None:
        monkeypatch.delenv("ALERTS_FORECAST_WINDOWS", raising=False)
    else:
        monkeypatch.setenv("ALERTS_FORECAST_WINDOWS", env)
    store, calls = {"pushes": []}, []
    import database
    import models
    monkeypatch.setattr(database, "async_session_maker", lambda: _Session([_alert()], [], store))
    monkeypatch.setattr(models, "Notification", lambda **kw: types.SimpleNamespace(**kw))

    async def _resolve(**kw):
        calls.append(kw)
        return {"current_conditions": {"wave_height_ft": 6.0, "wave_period": 12, "rating": 61.0,
                                       "rating_level": "fair_good"}}
    monkeypatch.setattr(SA.point_resolution_service, "resolve_spot_conditions", _resolve)

    async def _push(_db, user_id, title=None, body=None, data=None):
        store["pushes"].append((user_id, title, body, data))
    monkeypatch.setattr(SA, "send_push_notification", _push)

    async def _never(*a, **k):
        raise AssertionError("the window task ran with the flag off")
    monkeypatch.setattr(SW, "check_surf_alert_windows_task", _never)
    await SA.check_surf_alerts_task()
    return calls, [(n.title, n.body, n.data) for n in store.get("notifications", [])], store["pushes"]


@pytest.mark.parametrize("env", [None, "0", "", "true", "2"])
async def test_flag_off_is_todays_loop_byte_for_byte(monkeypatch, env):
    calls, notes, pushes = await _legacy_run(monkeypatch, env)
    assert calls == [{"model": "GFS", "lat": 28.35, "lng": -80.6, "forecast_days": 1, "spot_id": "s1"}]
    from routes.surf_data.alerts import surf_alert_body
    body = surf_alert_body(6.0, 12, 61.0, "fair_good")
    assert notes == [("🌊 Cocoa Beach — 6.0ft", body, json.dumps({
        "spot_id": "s1", "spot_name": "Cocoa Beach", "wave_height_ft": 6.0, "wave_period": 12,
        "rating": 61.0, "rating_level": "fair_good", "alert_id": "a1", "type": "surf_alert"}))]
    assert pushes == [("u1", "🌊 Cocoa Beach — 6.0ft", body, {"type": "surf_alert", "spot_id": "s1",
                                                              "alert_id": "a1"})]


async def test_flag_on_routes_to_the_window_task_and_skips_the_live_resolver(monkeypatch):
    monkeypatch.setenv("ALERTS_FORECAST_WINDOWS", "1")
    seen = []

    async def _windows(*a, **k):
        seen.append(1)

    async def _resolve(**kw):
        raise AssertionError("the live resolver ran with the flag on")
    monkeypatch.setattr(SW, "check_surf_alert_windows_task", _windows)
    monkeypatch.setattr(SA.point_resolution_service, "resolve_spot_conditions", _resolve)
    await SA.check_surf_alerts_task()
    assert seen == [1]


def test_the_window_branch_names_no_model():
    """Outside the tier mirror (which must list models), no file of the branch may pick one."""
    import re
    for path in ("scheduler/surf_alert_windows.py", "services/surf_alert_windows.py",
                 "services/weather_pipeline/alert_horizon.py"):
        src = open(os.path.join(backend_dir, path), encoding="utf-8").read()
        src = re.sub(r"TIER_ACCESS = \{.*?\n\}", "", src, flags=re.S)
        src = re.sub(r'""".*?"""', "", src, flags=re.S)                # prose may name models
        code = "\n".join(line.split("#")[0] for line in src.splitlines())
        hits = re.findall(r"[\"'](GFS|EURO|ICON)[\"']", code)
        assert hits == [], (path, hits)


# ── flag on ─────────────────────────────────────────────────────────────────────────────────────────────
async def test_a_window_fires_once_with_the_briefs_message_and_a_window_payload(run_windows):
    store = await run_windows(horizon())
    (note,) = store["notifications"]
    assert note.type == "surf_alert" and note.title == "🌊 Good window at Cocoa Beach"
    assert note.body == "Good window at Cocoa Beach: Tue 07:00-18:00, 4 ft, fair good"
    data = json.loads(note.data)
    assert data["alert_window"]["start"] == "2026-11-03T12:00:00Z" and data["alert_window"]["model"] == "GFS"
    assert data["alert_window"]["model_source"] == "served_default"
    assert data["alert_id"] == "a1" and data["rating_level"] == "fair_good"
    assert [p["body"] for p in store["pushes"]] == [note.body]
    assert store["sql"].count("update") == 1


async def test_dedup_across_runs_reads_back_the_window_already_sent(run_windows):
    first = await run_windows(horizon())
    sent = first["notifications"][0].data
    second = await run_windows(horizon(), rows=[sent])
    (note,) = second["notifications"]
    assert json.loads(note.data)["alert_window"]["start"] == "2026-11-04T12:00:00Z"
    third = await run_windows(horizon(), rows=[sent, second["notifications"][0].data,
                                               json.dumps({"alert_id": "a1", "spot_id": "s1", "alert_window": {
                                                   "start": "2026-11-05T00:00:00Z", "end": "2026-11-06T00:00:00Z"}})])
    assert "notifications" not in third and third["pushes"] == []


def _row(alert_id="a2", user_id="u1", spot_id="s1", start="2026-11-03T12:00:00Z", end="2026-11-03T23:00:00Z",
         created_at=None):
    return (user_id, json.dumps({"alert_id": alert_id, "spot_id": spot_id,
                                 "alert_window": {"start": start, "end": end}}), created_at)


async def test_the_same_window_sent_by_another_of_the_users_alerts_at_this_spot_is_not_sent_again(run_windows):
    """Suppression is per (user, spot): one session announced once, whichever alert announced it."""
    store = await run_windows(horizon(), rows=[_row(), "not json", None])
    (note,) = store["notifications"]
    assert json.loads(note.data)["alert_window"]["start"] == "2026-11-04T12:00:00Z"


@pytest.mark.parametrize("row", [_row(user_id="u2"), _row(spot_id="s9")])
async def test_another_users_or_another_spots_window_does_not_suppress_this_one(run_windows, row):
    store = await run_windows(horizon(), rows=[row])
    (note,) = store["notifications"]
    assert json.loads(note.data)["alert_window"]["start"] == "2026-11-03T12:00:00Z"


async def test_kill_switch_restores_704s_per_alert_dedup(run_windows, monkeypatch):
    monkeypatch.setenv("ALERTS_WINDOW_SUPPRESSION", "0")
    store = await run_windows(horizon(), rows=[_row()])                 # a2's window no longer suppresses a1
    (note,) = store["notifications"]
    assert json.loads(note.data)["alert_window"]["start"] == "2026-11-03T12:00:00Z"


def _spot_alert(i, score):
    spot = types.SimpleNamespace(id=f"s{i}", name=f"Spot {i}", latitude=28.35, longitude=-80.6)
    return _alert(id=f"a{i}", spot=spot, spot_id=f"s{i}"), score


def _scored_horizon(scores):
    h = horizon()
    for fr in h["frames"]:
        fr["spots"] = [{**fr["spots"][0], "spot_id": sid, "score": sc} for sid, sc in scores.items()]
    return h


async def test_the_daily_cap_is_a_hard_limit_spent_on_the_best_rated_windows(run_windows, caplog):
    """Three of one user's alerts fire in one run: the cap (2) sends the two best-rated, logs the third."""
    alerts = [_spot_alert(i, s)[0] for i, s in ((1, 55.0), (2, 80.0), (3, 70.0))]
    caplog.set_level(logging.INFO, logger="scheduler.surf_alert_windows")
    store = await run_windows(_scored_horizon({"s1": 55.0, "s2": 80.0, "s3": 70.0}), alerts=alerts)
    assert [json.loads(n.data)["alert_id"] for n in store["notifications"]] == ["a2", "a3"]
    assert len(store["pushes"]) == 2 and store["sql"].count("update") == 2
    assert "'daily_cap': 1" in caplog.text


async def test_the_cap_counts_sends_already_made_today_and_not_yesterdays(run_windows):
    alerts = [_spot_alert(i, 60.0)[0] for i in (1, 2)]
    today = (NOW - timedelta(hours=1)).isoformat()                        # local 18:00 Mon: the same local day
    earlier = (NOW - timedelta(hours=6)).isoformat()                      # local 13:00 Mon: the same day too
    old = (NOW - timedelta(hours=30)).isoformat()                         # local Sun: another day
    h = _scored_horizon({"s1": 60.0, "s2": 60.0})
    one_today = await run_windows(h, alerts=alerts, rows=[_row(spot_id="s7", created_at=today)])
    assert len(one_today["notifications"]) == 1
    two_today = await run_windows(h, alerts=alerts, rows=[_row(spot_id="s7", created_at=today),
                                                          _row(spot_id="s8", created_at=earlier)])
    assert "notifications" not in two_today
    two_old = await run_windows(h, alerts=alerts, rows=[_row(spot_id="s7", created_at=old),
                                                        _row(spot_id="s8", created_at=old)])
    assert len(two_old["notifications"]) == 2


async def test_two_of_a_users_alerts_on_one_spot_in_one_run_send_one_window(run_windows):
    store = await run_windows(horizon(), alerts=[_alert(), _alert(id="a2", min_wave_height=1.0)])
    (note,) = store["notifications"]
    assert len(store["pushes"]) == 1


async def test_cap_zero_or_the_kill_switch_means_no_cap(run_windows, monkeypatch):
    alerts = [_spot_alert(i, 60.0)[0] for i in (1, 2, 3)]
    h = _scored_horizon({"s1": 60.0, "s2": 60.0, "s3": 60.0})
    for env in (("ALERTS_MAX_PER_USER_DAY", "0"), ("ALERTS_WINDOW_SUPPRESSION", "0")):
        monkeypatch.setenv(*env)
        assert len((await run_windows(h, alerts=alerts))["notifications"]) == 3
        monkeypatch.delenv(env[0])
    assert len((await run_windows(h, alerts=alerts))["notifications"]) == 2   # control: the default caps


async def test_a_lost_claim_sends_nothing(run_windows):
    store = await run_windows(horizon(), claim_ok=False)
    assert "notifications" not in store and store["pushes"] == []


async def test_notify_push_false_records_in_app_only(run_windows):
    store = await run_windows(horizon(), alerts=[_alert(notify_push=False)])
    assert len(store["notifications"]) == 1 and store["pushes"] == []


async def test_a_missing_horizon_sends_nothing_and_logs_the_reason(run_windows, caplog):
    caplog.set_level(logging.INFO, logger="scheduler.surf_alert_windows")
    store = await run_windows(None)
    assert "notifications" not in store and store["pushes"] == []
    assert "horizon object unavailable" in caplog.text and "fail safe" in caplog.text


async def test_a_stale_horizon_sends_nothing_and_counts_the_reason(run_windows, caplog):
    caplog.set_level(logging.INFO, logger="scheduler.surf_alert_windows")
    store = await run_windows(horizon(generated=NOW - timedelta(days=1)))
    assert "notifications" not in store
    assert "'horizon_stale': 1" in caplog.text
    assert any(r.levelname == "WARNING" and "NO forecast" in r.getMessage() for r in caplog.records)


async def test_the_users_tier_reaches_the_decision(run_windows, monkeypatch):
    monkeypatch.setenv("ALERTS_FORECAST_HORIZON_H", "168")
    late = horizon(lambda vt: entry() if vt >= NOW + timedelta(hours=96) else entry(h_ft=0.5, score=5,
                                                                                    level="very_poor"), hours=168)
    free = await run_windows(late, alerts=[_alert(user=types.SimpleNamespace(subscription_tier="free"))])
    paid = await run_windows(late, alerts=[_alert(user=types.SimpleNamespace(subscription_tier="premium"))])
    assert "notifications" not in free and len(paid["notifications"]) == 1


# ── producer ────────────────────────────────────────────────────────────────────────────────────────────
def test_the_producer_is_inert_with_the_flag_off(monkeypatch):
    monkeypatch.delenv("ALERTS_FORECAST_WINDOWS", raising=False)
    from services.weather_pipeline import alert_horizon as AH

    def _boom(*a, **k):
        raise AssertionError("network touched with the flag off")
    monkeypatch.setattr(AH, "fetch_alert_spot_ids_via_rest", _boom)
    assert AH.run_alert_horizon_precompute() == (0, 0)


async def test_the_producer_rates_through_the_reference_path_nearest_hours_first_and_slims(monkeypatch):
    from services.weather_pipeline import alert_horizon as AH
    monkeypatch.setenv("ALERTS_HORIZON_CHUNK", "2")
    monkeypatch.setenv("RATING_OBS_GATE", "0")
    calls = []

    async def _rate(resolver, spots, models, offsets, base_dt=None):
        calls.append((tuple(models), tuple(offsets)))
        return {"frames": [{"model": models[0], "valid_time": f"t{o}", "hour_offset": o,
                            "spots": [{"spot_id": "s1", "score": 50, "level": "fair", "surf_height_m": 1.0,
                                       "why": "x" * 200, "inputs": {"wind_ms": 2.0, "offshore_hs_m": 1.4}}]}
                           for o in offsets]}
    ticks = iter([0, 0, 10_000, 10_000])
    obj = await AH.build_alert_horizon(None, [{"id": "s1"}], ["GFS", "EURO"], [0, 3, 6, 9], rate=_rate,
                                       base_dt=NOW, budget_s=60, clock=lambda: next(ticks))
    assert calls == [(("GFS",), (0, 3)), (("EURO",), (0, 3))]            # budget cut after the first chunk
    assert obj["truncated"] is True and obj["default_model"] == "GFS" and obj["models"] == ["GFS", "EURO"]
    assert obj["step_h"] == 3 and obj["kind"] == "alert_horizon"
    s = obj["frames"][0]["spots"][0]
    assert "why" not in s and s["inputs"] == {"wind_ms": 2.0}


async def test_the_producer_applies_the_same_observation_gate_as_the_glyphs(monkeypatch):
    from services.weather_pipeline import alert_horizon as AH
    import services.weather_pipeline.rating_confirmation as RC
    monkeypatch.setenv("RATING_OBS_GATE", "1")
    gated = []
    monkeypatch.setattr(RC, "apply_gate_to_frames", lambda frames, reports: gated.append(len(frames)) or 0)
    monkeypatch.setattr(RC, "fetch_recent_reports_via_rest", lambda: {})

    async def _rate(resolver, spots, models, offsets, base_dt=None):
        return {"frames": [{"model": models[0], "valid_time": "t", "spots": []} for _ in offsets]}
    await AH.build_alert_horizon(None, [], ["GFS", "EURO", "ICON"], [0, 3], rate=_rate, base_dt=NOW)
    assert gated == [6]                                                   # every model's frames, gated together


def test_the_inputs_override_is_scoped_and_restored(monkeypatch):
    from services.weather_pipeline import alert_horizon as AH
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "5")
    with AH._all_inputs():
        assert os.environ["SPOT_RATINGS_INPUTS_SAMPLE_PCT"] == "100"
    assert os.environ["SPOT_RATINGS_INPUTS_SAMPLE_PCT"] == "5"
    monkeypatch.delenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT")
    with AH._all_inputs():
        pass
    assert "SPOT_RATINGS_INPUTS_SAMPLE_PCT" not in os.environ


def test_the_default_models_follow_the_glyph_precompute(monkeypatch):
    from services.weather_pipeline import alert_horizon as AH
    monkeypatch.delenv("ALERTS_HORIZON_MODELS", raising=False)
    monkeypatch.setenv("SPOT_RATINGS_PRECOMPUTE_MODELS", "EURO, gfs")
    assert AH.horizon_models() == ["EURO", "GFS"]
    monkeypatch.delenv("ALERTS_FORECAST_HORIZON_H", raising=False)
    monkeypatch.delenv("ALERTS_HORIZON_STEP_H", raising=False)
    assert AH.horizon_offsets() == list(range(0, 73))           # hourly: see horizon_offsets()
