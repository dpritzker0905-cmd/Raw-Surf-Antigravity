# LV12.2-07 — The repaired alert path is the one nobody calls, and its guard names the wrong file

**Severity: CRITICAL.** A binding project mandate is violated on a **user-facing push notification**
that fires **every 15 minutes in production**, and the regression guard written to prevent exactly
this **passes**.

Surfaced by this audit's cross-feature sweep; **independently re-verified below**, plus live
corroboration from the running backend.

---

## The mandate

`CLAUDE.md`, ONE FORECAST COMPOSITION (user mandate 2026-07-28), naming the surface explicitly:

> every surface that shows surf height or quality — spot hubs, infoboxes, map glyphs, the weather
> sim, **alerts, notifications**, any new endpoint — must go through the SAME chain …
> ★ **A size without a quality is also incomplete: a blown-out 6 ft and a groomed 6 ft must not
> render identically.**

## Two implementations of one job

| | `backend/routes/surf_data/alerts.py` | `backend/scheduler/surf_alerts.py` |
|---|---|---|
| Repaired to state quality? | ✅ **yes** — a 15-line comment quotes the mandate verbatim | ❌ **no** |
| Calls `surf_alert_body` / reads `rating` / `rating_level` | ✅ **8 matches** | ❌ **0 matches** |
| Live "perfect conditions" literal | none | **`:94`** |
| How is it invoked? | **manual `POST /alerts/check`** — no scheduler registration | **registered on the 15-minute scheduler** |

### Which one actually runs — three independent confirmations

**1. The registration, in source:**

```python
# backend/scheduler/__init__.py:14
from .surf_alerts import check_surf_alerts_task
# :43-45
scheduler.add_job(
    tracked('check_surf_alerts', 'Check surf alerts against conditions', 'Every 15 minutes',
            check_surf_alerts_task),
    IntervalTrigger(minutes=15),
    id='check_surf_alerts', name='Check surf alerts against conditions', replace_existing=True)
```

**2. The live production backend**, from this audit's own `/api/health` capture
(`../network/health-791fdf78-window.json`):

```json
{"id": "check_surf_alerts", "name": "Check surf alerts against conditions",
 "next_run": "2026-08-14T00:42:42.776871+00:00", "trigger": "interval[0:15:00]"}
```

**3. The admin surface** agrees: `routes/admin/system.py:350` —
`"Check surf alerts against conditions", "Every 15 minutes"`.

### What production therefore sends

```python
# backend/scheduler/surf_alerts.py:94   (in-app)
body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!"
# :111                                   (WEB PUSH)
body=f"Waves are {wave_height_ft:.1f}ft - Go get some!"
```

Measured with a paired positive control so the zero is a measurement:

```
grep -c "surf_alert_body\|compute_surf_rating\|rating_level"  backend/scheduler/surf_alerts.py    → 0
grep -c "surf_alert_body\|compute_surf_rating\|rating_level"  backend/routes/surf_data/alerts.py  → 8
```

**`rating` and `rating_level` are sitting unread in the same `current_conditions` dict the scheduled
job already fetched.** The quality is retrieved and discarded, and the message asserts *perfection*
from height alone. A blown-out 6 ft and a groomed 6 ft produce **the identical push notification** —
the exact sentence the mandate forbids.

## The guard passes because its census names one file, and it is the wrong one

`backend/tests/test_surf_alert_states_the_quality.py` is a **good** test. It parses the AST, it
excludes docstrings so the record of a defect does not itself read as the defect, and it asserts both
that no live "perfection" literal survives and that `surf_alert_body` is actually *called*.

Its census is one hard-coded path:

```python
# :105
src = open(os.path.join(backend_dir, "routes/surf_data/alerts.py"), encoding="utf-8").read()
# :125  f"a LIVE string literal in alerts.py still claims perfection: {offenders}"
# :133  assert called, "alerts.py defines surf_alert_body but never CALLS it"
```

Applying that test's own logic to both files:

```
routes/surf_data/alerts.py    live perfection literals: []                          calls helper: True
scheduler/surf_alerts.py      live perfection literals: [(94, 'ft - perfect conditions!')]   calls helper: False
```

**The guard is green and the defect is live.** This is this repository's own recorded defect class —
*"THE CENSUS IS THE DEFECT, NOT THE ASSERTION"* — and it is the same shape that produced 3-vs-4-vs-5
rating surfaces once already. The assertion is not the weak part; **an exact file list in a guard is
the bug.**

## A second, smaller defect on the same notification

The one notification deep-links to two different destinations depending on how it arrives:

| arrival | destination | source |
|---|---|---|
| **Web push** | `/map?spot=${data.spot_id}` | `frontend/public/service-worker.js`, `notificationclick`, `type === 'surf_alert'` |
| In-app drawer / page | `/alerts?alert_id=…` | `frontend/src/utils/notificationDeepLinks.js:210-214` |

And **`/map?spot=` is read by nothing**: `components/MapPage.js` and all of `components/map/` contain
zero `useSearchParams` / `location.search` / `URLSearchParams(window…)` — positive control, ~20 files
elsewhere in `src/` do use `useSearchParams`. `/alerts` exists (`App.js:174` → `SurfAlerts`).

**Tapping the push lands the user on a generic map at whatever viewport they left**, not on the spot
the alert was about.

## Coverage

| Candidate owner | Why it does not cover this |
|---|---|
| **WS-OBJ-201** one forecast composition — CERTIFIED COMPLETE | Its evidence (LV-06) traced the *serving* chain: nearshore height, quality, `surf_height_m` write, sim. It never enumerated the **notification** consumer, which the mandate names explicitly. **The certificate is sound for what it checked and its scope was too narrow.** |
| **WS-OBJ-204** readout and legend truth | Concerns map legends, units and readouts — not the notification body |
| **WS-CAN-0015** readout/legend truth batch | Its seven items do not include alerts |
| **WS-OBJ-401** one authority per responsibility | Right *shape* — this is a genuine accidental duplicate — but the convergence map's inventory does not contain the alerts pair, so nothing in that objective points here |

⇒ **This needs a new canonical task and it reopens WS-OBJ-201's scope.** It is the only finding in
Audit 12.2 that reaches a user with a wrong statement about the surf.

## Acceptance criteria

1. `backend/scheduler/surf_alerts.py` composes its body through the same helper as the repaired
   route, consuming `rating` / `rating_level` from the dict it already has.
2. Either consolidate the two implementations to one authority, or — if both must exist — the guard
   **discovers** its census (walk the tree for files defining or sending an alert body) rather than
   hard-coding a path. **A file list in a guard is the defect.**
3. The guard demonstrably **fails** against the pre-fix `scheduler/surf_alerts.py`. Verify the
   failing direction, not only the passing one.
4. The push `notificationclick` destination and the in-app deep link agree, and the destination
   actually reads the parameter it is given.

## Rollback

Revert the message-composition change in `scheduler/surf_alerts.py`. Blast radius is the alert body
only: no forecast quantity, no render path, no served endpoint.
