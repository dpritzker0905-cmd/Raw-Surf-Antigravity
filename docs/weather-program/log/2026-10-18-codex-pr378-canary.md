# 2026-10-18: isolated #378 diagnostic canary

Owner authorization: "Go ahead and deploy the isolated #378 canary pinned to 6fbf439ac.
Keep the guard disabled, verify it over HTTP, and don't touch production or Claude's work."

This session owns only this log and the isolated canary artifacts. No merge, main promotion,
production service reconfiguration, existing dev frontend configuration change, or change to
Claude's checkout/work was authorized or performed.

## Preparation and creation (17:35Z)

- Separate local clone and `codex/pr378-isolated-canary` branch based on
  `6fbf439ac2bb2da5337f9a45864ffd3af8be8423`. No branch switch in either active checkout.
- Adapter deployment commit `cd4253652c53047f138b1237ac5f9fa3da1cd18d` adds only `canary/pr378/`.
  The complete backend Git tree `6899f987ec78b500f0b8b53897944791b012c487` remains identical to #378.
  Build and runtime check source identity separately from adapter identity.
- Public metadata capture:11,339 products, fixed as-of2026-10-18T13:30Z, SHA256
  `3aa2f06c0d5a42a5196116a6a7aacfe5703414fb86b599e64e12cee291fa1932`.
  Synthetic controls generated offline with actual #378 estimator/manifest helpers.
- Clean dependency environment: localhost HTTP12 provenance controls+5 negative routes passed;
  startup refused enabled guard and configured database (2 controls). Fixture unchanged,
  no database/server import, no application outbound network attempts. Local child server stopped.
- Render connector/plugin discovery unavailable; authenticated dashboard used in a separate tab.
  Created a fresh Free web service in Oregon (existing shared service is in Ohio), no project
  environment, secret files, inherited environment groups, datastores, disks, cron or workers.
  Only eight explicit non-secret variables; `ESTIMATE_COHERENT_TRENDS=0`, testing/fixture controls,
  Python version and no-bytecode setting. Auto-deploy Off; readiness `/healthz`.
- Deployment BUILDING at creation readback. Hosted qualification pending, not PASS yet.
  Service/deploy identifiers stay in the private receipt. No credential values recorded.

The actual #378 HTTP handler runs with an explicit in-memory ProductStore seam and the actual
unmodified health/provenance helpers. No full server startup, migrations, quarantine, ingestion,
live storage clients, production credentials, full application routes, or scheduler.
The application socket tripwire is not an OS firewall; provider network policy is not claimed.
The diagnostic fixture has genuine critical/stale/conflicting conditions; expected capture
HTTP503 is a negative control, not a healthy-weather claim. No served forecast number changes,
no scientific skill or full application/E2E acceptance, and no guard-enabled qualification.

Ledger1428 records the separate publication;1429 records creation/configuration and pending verification.

## Initial hosted acceptance and restart check

Render reported initial deployment Live at17:36:18Z. Hosted HTTPS verification completed
at17:36:50Z:12 provenance controls and5 negative route checks PASS; `/healthz`200;
`/identity` before/after unchanged and attests exact base6fbf439ac, adaptercd4253652,
guard0,11,339 captured products, matching source/control/capture hashes, no database/server
imports and zero application network attempts. Capture returned expected503 with real ICON
conflict warnings retained and EURO contributors verified. No generic overflow error.

A single Restart service action was then triggered for this new canary only, to test
identity/fixture/guard persistence across process startup. It preserves deployed source and
configuration. Post-restart terminal status and HTTP verification are pending at this entry.
Ledger1430 records initial hosted acceptance and the scoped restart action.

## Final hosted acceptance after restart (17:39Z)

The new-service event says Service restarted by you. Runtime logs show replacement instance
startup17:37:59Z and original instance shutdown17:38:03Z. This restart retained the live
deployment/source identity; the dashboard did not create a second deploy-history entry.
Post-restart HTTPS again passed all12 provenance controls and5 negative route checks;
process readiness200, exact base/adapter identity and source/control/capture hashes unchanged,
guard0, no database/server imports, zero application network attempts, fixture unchanged.
Both successful runs are retained privately; sanitized evidence is tracked alongside this log.

Deployment is LIVE and qualified for its fixture-only diagnostic contract. Full server,
live ingestion, browser E2E, scientific accuracy and guard-enabled behavior remain unqualified.
The Free service can spin down while idle and cold-start slowly. Auto-deploy is Off.
Production/main, existing dev configuration, production credentials/data, and Claude's work
were not modified. No customer data, photos or accounts were copied. No forecast number or
formula changed. Rollback is suspend/delete only this new diagnostic service; its resource
identifiers and dashboard URL stay in the private receipt. The deployment branch stays unmerged.

Ledger1431 records final acceptance;1432 records this documentation closeout. The records extend
this chat's pending receipt lineage through1427; remote dev still ended at1418 when checked.

## Adapter request-isolation check (17:43Z)

Eight HTTPS requests at concurrency4 mixed valid, stale-donor and UTC-underflow fixtures.
Every response matched its serial response and fixture-case header; identity and integrity
remained unchanged. This checks the adapter's per-request context while offloading the actual
health computation. No further runtime/source/configuration change was needed. Saved environment
readback showed exactly the eight allowlisted names, no secret files and no linked environment groups.

## Publication closeout

Receipt commit `fbcd7d4d2294b3a28dd84ec9040278f8c95135c1` was pushed to this chat's
documentation branch. GitHub readback confirmed PR381 OPEN/draft, with that exact head;
its description now includes the canary and labels the earlier shared-backend hold as
historical. Ledger1433 closes the pending publication readback from1432. No merge,
promotion, existing service change, or further canary configuration change occurred.
The closeout bookkeeping extends the same receipt lineage and keeps the draft unmerged.
