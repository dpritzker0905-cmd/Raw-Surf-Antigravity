# 2026-11-24 · reliability lane, PR 2: the stale-data alarm notifies the owner, off GitHub's cron

Evidence: inspection 2026-11-23 (SOTA-INSPECTION-TIME-AND-FAILURE). GitHub ran the Data Health Monitor's `*/30` about
once every 7 h, and a red run notified nobody; the 11-19/20 credential failure was silent for 21-25 h.

## Checked first: an external uptime probe?

`backend/scripts/uptime_probe.py` exists (WS-CAN-0025, a dead-man's-switch design: `--ping-url` to a free heartbeat
service). Nothing in the repo shows it running anywhere, and the monitor's own header still asks for an external
probe. Making it run needs an outside account (healthchecks.io or similar), which is the owner's to create: not done.

## What changed (no new secret)

- `services/workflow_dispatch.py`: `data-health-monitor.yml` joins the lanes the Render box dispatches when GitHub
  drops a slot (the box already holds `GITHUB_DISPATCH_TOKEN`, armed per `/api/health` at 02:51Z). A per-lane grace
  of 10 min (the default 30 would swallow every slot of a 30-min cron). GitHub's cron stays as the backup.
- `data-health-monitor.yml`: a final `always()` step turns the run's checks into ONE issue, labelled `stale-data` +
  `severity:critical|high` and assigned to `vars.REPO_OWNER_LOGIN`. It opens once, escalates once and closes on
  recovery. It is never re-commented at the same severity (one notification per outage). It uses `GITHUB_TOKEN` with
  `issues: write`.
- `scripts/staleness_alert.py` holds the decision; `tests/test_staleness_alert.py` pins it.
- `force_stale=1` (workflow_dispatch input) is the forced-stale proof: a synthetic critical body opens a `[TEST]` issue
  assigned to the owner, and the same run closes it.

## Limits

- If the Render box is down, nothing dispatches; GitHub's cron then still runs the monitor, which reads "unreachable"
  and opens a critical issue.
- If both GitHub Actions and the box are down, only an external probe would notice (see above).

## Advisor limits folded in (2026-11-24, before merge)

- **(a) One-box rule.** Measured, not load-tested: over the last 25 monitor runs (GitHub step timings) the
  `/api/health/data` poll took 1 s median (max 2 s) and the regional census, which reads `/api/weather/products`, 2 s
  median (max 24 s), consistent with the cached once-per-manifest-version encode. Even so, on box-dispatched runs the
  census now runs only every `REGION_CENSUS_EVERY_H` hours (default 3); GitHub's own schedule runs keep it every time.
  `/api/health/data` stays every 30 min.
- **(b) Hysteresis.** An issue closes only after two consecutive healthy runs (label `recovering` on the first). A
  relapse removes the label. A flapping outage reopens the issue closed within 24 h instead of opening a new one.
- **(c) [TEST] issues.** A leftover [TEST] issue is closed on the next run. It is never escalated, reopened or adopted.
- **#1261 operating condition (D-090).** When the guardrail kills a served-number flag and the committed snapshot lacks
  the kill, the guardrail issue says **P0** (title tag `P0-cold-start-snapshot-drift-24h`). It sets a 24 h deadline to
  commit AND deploy the one-file snapshot, says no new served-number fix ships ON while it is open, and gives the exact
  file text. Production (Render) deploys from `dev`: the live `/api/health` version was `f37de972a`, dev's #1261 merge.
  The snapshot protects a cold start only once it is on `dev` and deployed.
