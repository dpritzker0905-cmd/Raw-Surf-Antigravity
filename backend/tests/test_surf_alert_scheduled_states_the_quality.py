"""THE SCHEDULED alert job must state the quality — driven through `check_surf_alerts_task` itself.

WHY A SECOND FILE. `test_surf_alert_states_the_quality.py` proves the COMPOSER is correct and, since
its census was repaired, that no emitter builds a body inline. Both are static. Neither executes the
job that actually fires.

That distinction is the entire defect. `routes/surf_data/alerts.py` was repaired on 2026-08-05 and
is a MANUAL `POST /alerts/check`; the job registered on the scheduler is `scheduler/surf_alerts.py`
(`scheduler/__init__.py:43-45`, `IntervalTrigger(minutes=15)`), confirmed live in `/api/health` as
`{"id": "check_surf_alerts", "trigger": "interval[0:15:00]"}`. For ~8 days the repaired path was the
one nobody called, and the guard was green because its census named one hard-coded file.

⇒ So this file asserts on BODIES PRODUCED BY RUNNING THE TASK, with the provider and the database
  faked and `surf_alert_body` REAL. A static guard cannot catch a caller that stops calling the
  composer; this one can.

⚠️ WHAT IS DELIBERATELY UNCHANGED: WHEN the alert fires. Both fixtures below sit inside the user's
   height bounds and BOTH must fire — the user asked to be told at a height range and that is still
   exactly the trigger. Adding a quality floor would silently drop alerts they asked for; that is a
   product decision needing a column on the alert. Only the CLAIM is fixed.
"""
import json
import os
import sys
import types

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import scheduler.surf_alerts as SA  # noqa: E402


# ── fakes ───────────────────────────────────────────────────────────────────────────────────────

class _Captured:
    """Everything the task tried to tell the user."""
    def __init__(self):
        self.notifications = []
        self.pushes = []


class _FakeSession:
    def __init__(self, alerts, captured):
        self._alerts = alerts
        self._captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, *_a, **_k):
        alerts = self._alerts

        class _R:
            def scalars(self):
                return types.SimpleNamespace(all=lambda: alerts)
        return _R()

    def add(self, obj):
        self._captured.notifications.append(obj)

    async def commit(self):
        pass


def _alert(spot_name, spot_id, user_id="u1", lo=2.0, hi=12.0):
    spot = types.SimpleNamespace(id=spot_id, name=spot_name, latitude=28.35, longitude=-80.6)
    return types.SimpleNamespace(
        id=f"alert-{spot_id}", user_id=user_id, spot=spot, spot_id=spot_id,
        min_wave_height=lo, max_wave_height=hi, notify_push=True,
        trigger_count=0, last_triggered=None, is_active=True,
    )


@pytest.fixture
def drive(monkeypatch):
    """Run the REAL task against a faked provider + DB. Returns a callable: conditions -> captured."""
    async def _run(current_conditions, alerts=None):
        captured = _Captured()
        alerts = alerts or [_alert("Cocoa Beach", "spot-1")]

        import database
        monkeypatch.setattr(database, "async_session_maker",
                            lambda: _FakeSession(alerts, captured))

        async def _resolve(**_kw):
            return {"current_conditions": dict(current_conditions)}
        monkeypatch.setattr(SA.point_resolution_service, "resolve_spot_conditions", _resolve)

        async def _push(_db, user_id, title=None, body=None, data=None):
            captured.pushes.append({"user_id": user_id, "title": title, "body": body, "data": data})
        monkeypatch.setattr(SA, "send_push_notification", _push)

        # `Notification` is imported INSIDE the task body from `models`; patch it there.
        import models
        monkeypatch.setattr(models, "Notification",
                            lambda **kw: types.SimpleNamespace(**kw))

        await SA.check_surf_alerts_task()
        return captured
    return _run


# ── the mandate, executed ───────────────────────────────────────────────────────────────────────

BLOWN = {"wave_height_ft": 6.0, "wave_period": 9, "rating": 8.4, "rating_level": "very_poor"}
GROOMED = {"wave_height_ft": 6.0, "wave_period": 15, "rating": 88.0, "rating_level": "epic"}


async def test_the_SCHEDULED_job_does_not_render_a_blown_out_6ft_like_a_groomed_6ft(drive):
    """The mandate's own sentence, asserted on the output of the job that actually fires."""
    blown = await drive(BLOWN)
    groomed = await drive(GROOMED)

    assert blown.notifications and groomed.notifications, "both should fire — same height bounds"
    assert blown.notifications[0].body != groomed.notifications[0].body, (
        f"identical push for opposite quality: {blown.notifications[0].body!r}"
    )
    assert blown.pushes and groomed.pushes
    assert blown.pushes[0]["body"] != groomed.pushes[0]["body"]


async def test_the_SCHEDULED_job_never_claims_perfection(drive):
    for cond in (BLOWN, GROOMED, {"wave_height_ft": 6.0, "wave_period": 12}):
        cap = await drive(cond)
        for n in cap.notifications:
            assert "perfect condition" not in (n.body or "").lower(), n.body
            assert "is firing" not in (n.title or "").lower(), n.title
        for p in cap.pushes:
            assert "perfect condition" not in (p["body"] or "").lower(), p["body"]
            assert "go get some" not in (p["body"] or "").lower(), p["body"]


async def test_the_quality_reaches_the_user_and_the_payload(drive):
    cap = await drive(BLOWN)
    body = cap.notifications[0].body
    assert "very poor" in body and "8/100" in body, body

    payload = json.loads(cap.notifications[0].data)
    assert payload["rating"] == 8.4 and payload["rating_level"] == "very_poor", payload
    assert payload["alert_id"] == "alert-spot-1", payload      # for the deep link


async def test_a_MISSING_quality_is_STATED_not_guessed(drive):
    """`rating` is absent whenever the chain could not grade the hour — spot_conditions.py wraps the
    rating block in a broad except precisely so a blob-read failure costs the rating, not the
    conditions read. Silence would leave the old implication ("we told you, so it must be good")."""
    cap = await drive({"wave_height_ft": 6.0, "wave_period": 12})
    body = cap.notifications[0].body
    assert "unavailable" in body.lower(), body
    assert "perfect" not in body.lower(), body
    assert "6.0ft" in body, body


async def test_the_TRIGGER_is_unchanged__THE_CONTROL(drive):
    """Without this the tests above could be passing because the job stopped firing at all. A bad
    day must still ALERT — it must merely say it is a bad day."""
    cap = await drive(BLOWN)
    assert len(cap.notifications) == 1 and len(cap.pushes) == 1

    # and outside the user's bounds it must still NOT fire
    quiet = await drive({"wave_height_ft": 0.5, "wave_period": 14, "rating": 90.0,
                         "rating_level": "epic"})
    assert quiet.notifications == [] and quiet.pushes == []


async def test_the_job_composes_via_the_SHARED_helper__THE_CONTROL(drive):
    """Byte-identity against the composer proves the task did not reimplement the sentence — the
    failure mode that produced two divergent alert paths in the first place."""
    from routes.surf_data.alerts import surf_alert_body

    cap = await drive(GROOMED)
    expected = surf_alert_body(6.0, 15, 88.0, "epic")
    assert cap.notifications[0].body == expected, (cap.notifications[0].body, expected)
    assert cap.pushes[0]["body"] == expected
