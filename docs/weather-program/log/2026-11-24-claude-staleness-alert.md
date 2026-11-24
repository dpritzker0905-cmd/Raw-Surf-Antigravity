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
