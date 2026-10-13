# Committed credentials in a PUBLIC repository — 2026-09-19, second checked 2026-09-20

**No secret value appears in this document, and none may ever be added to it.** Only locations,
exposure windows and remediation status are recorded.

## Severity

`dpritzker0905-cmd/Raw-Surf-Antigravity` is **PUBLIC** (`visibility=PUBLIC`, verified 2026-09-19).
The confirmed credential entries below have been publicly readable. **Treat published credentials
as compromised until their revocation is verified.** All six scanner alerts report validity
`unknown`; current provider acceptance, privileges and associated production resources were not
tested. Removing current file contents does not revoke a credential or erase Git history.

## What was asked, and what was actually found

The standing item was "rotate the `BRAIN_RULES.md` key" — one credential. Enumerating the repo's
own GitHub secret-scanning alerts found **six more, all `open` and `UNRESOLVED`**, several of which
may carry broader authority than the one being tracked. The independent second check also found
a retained Supermemory key in the same two instruction files: eight credential entries in total
(six scanner alerts plus Qdrant and Supermemory), not a complete repository-wide secret census.

### A. GitHub secret-scanning alerts — 6 open, unresolved

| # | type | location | first alerted |
|---|---|---|---|
| 6 | **Supabase Service Key** | `upload_local.py:6` | 2026-04-16 |
| 5 | OneSignal Rich API Key | `backend/.env:10` | 2026-04-15 |
| 4 | Google API Key | `frontend/src/components/MessagesPage.js:173` | 2026-04-15 |
| 3 | **Supabase Service Key** | `backend/.env:4` | 2026-04-15 |
| 2 | Mapbox Secret Access Token | `frontend/src/components/Explore.js:593` | 2026-04-15 |
| 1 | Stripe Test API Secret Key | `backend/.env:5` | 2026-04-15 |

⛔ **Prioritize the two Supabase Service Key alerts.** An accepted `service_role` credential can
bypass RLS. The alerts do not establish current validity, project association or current database
grants; full production access was not tested. Route-level authorization is not evidence that an
exposed provider credential has been revoked.

### B. The Qdrant key (the originally tracked item)

`BRAIN_RULES.md:200` and `.antigravityrules` carried a Qdrant Cloud API key **inline, next to its
cluster endpoint URL**, committed `8e156c8c` on **2026-05-26 — ~116 days**, present in the tracked
contents of **both `main` and `dev`** at the audit baseline. Removed from both files by this change and replaced with a `QDRANT_API_KEY`
environment-variable reference.

This change replaces the inline value with an environment-variable reference. It does not change
the user's local provider configuration or verify that a replacement credential is configured.

### B2. The retained Supermemory key found by the second check

`BRAIN_RULES.md:58` and `.antigravityrules:58` still contained a credential-shaped 90-character
value under **Supermemory MCP / API Key** on the first cleanup branch. Its provider URL is
`https://mcp.supermemory.ai/mcp`. Blame attributes both lines to `58f7e87d`, committed
2026-05-28 04:35 UTC; the value is present on the inspected `main`, `dev`, and original cleanup
head `3d599eb7`.

The second check removes both inline occurrences and references `SUPERMEMORY_API_KEY` instead.
Provider URL and local configuration-location instructions remain intact. No key was printed,
submitted to the provider or otherwise exercised; validity and permissions remain unknown.

### C. Not detected by GitHub, and therefore easy to miss

`secret_scanning_non_provider_patterns` is **disabled** on this repository. The six alerts are not
a complete credential inventory: the two inline keys above were found separately. Broader pattern
coverage may help discovery, but does not prove that every credential type will be detected.

The first audit also reported the following names in local `backend/.env`. Their historical values
need comparison with published copies before claiming confirmed exposure; treat them as potentially
exposed while that check is outstanding (see §D):
`RENDER_API_KEY` (production configuration write authority),
`COPERNICUSMARINE_SERVICE_USERNAME` / `COPERNICUSMARINE_SERVICE_PASSWORD`.

## D. ⛔ History cleanup did not establish credential revocation

`backend/.env` is **not tracked at HEAD and is correctly gitignored today**, and `git log --all`
finds **zero** commits touching it. That appears clean. It is not.

GitHub's alert locations name real commits that still contain it — `1efc0086`, `d4dc6dc0`,
`2a633370` (2026-03-14/15). Those commits exist in the local object store **reachable from 0 refs**:
history was rewritten or the branches deleted. But:

```
GET https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/commit/1efc00866835
  -> HTTP 200   (unauthenticated)
```

**GitHub still serves the unreachable commit publicly.** Anyone with the SHA — which the alert
list, forks, caches and scrapers all have — can still read it.

⇒ **A rewritten history is not a revoked credential.** Unreachable is not unreadable. This is the
same defect shape this codebase keeps meeting: a written value mistaken for a live one. Checking
`git log` would have reported "clean" and been wrong; only an unauthenticated fetch settles it.

## Remediation — owner actions, in priority order

These actions require authorized provider-account access. This cleanup did not exercise provider
credentials, rotate keys, modify deployments, close alerts or rewrite history.

1. **Revoke/rotate the exposed Supabase service keys first.** Confirm associated projects and scope.
   Update Render (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`) and local `backend/.env`.
2. **Rotate the Stripe secret key.** Alert says *Test*; confirm no live key shares the exposure.
3. **Rotate OneSignal, Mapbox and Google API keys.** Re-apply referrer/IP restrictions on the
   Google and Mapbox keys while you are there.
4. **Rotate the Qdrant Cloud key** and configure `QDRANT_API_KEY` in the authorized local environment.
5. **Revoke/rotate the Supermemory key** and configure `SUPERMEMORY_API_KEY`; update the authorized
   local integrations that previously used the published value.
6. **Check historical `RENDER_API_KEY` and Copernicus password values for exposure** and revoke/rotate
   any published values, updating their authorized consumers. Their exposure is not established by
   the six provider alerts alone.
7. **Close all 6 alerts** with `revoked` only after revocation is verified.
8. **Enable broader secret-scanning patterns** as a discovery improvement, not a remediation claim.
9. **Ask GitHub Support to purge the unreachable commits.** Only GitHub can drop them from the
   public object store; deleting a branch does not. This is cleanup *after* rotation, never
   instead of it.

## What this change does and does not do

- **Does:** removes the identified Qdrant and Supermemory values from the current tracked contents
  of `BRAIN_RULES.md` and `.antigravityrules`, replacing them with environment-variable references.
- **Does NOT:** revoke any value, remove it from historical commits, or prove all repository secrets
  have been found. Ordinary full-history clones can still contain the old values. Provider
  revocation is still required; this file cleanup is not evidence of completed incident response.

⚠️ History rewriting is destructive and is **not** proposed here. The earlier rewrite left values
publicly fetchable, so removing refs cannot be substituted for provider revocation.
