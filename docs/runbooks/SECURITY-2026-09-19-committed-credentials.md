# Committed credentials in a PUBLIC repository — 2026-09-19

**No secret value appears in this document, and none may ever be added to it.** Only locations,
exposure windows and remediation status are recorded.

## Severity

`dpritzker0905-cmd/Raw-Surf-Antigravity` is **PUBLIC** (`visibility=PUBLIC`, verified 2026-09-19).
Every credential below has therefore been world-readable for the window stated. **All of them must
be treated as compromised.** Rotation at the provider is the only effective remediation; nothing
done inside this repository reduces the exposure of a value that has already been published.

## What was asked, and what was actually found

The standing item was "rotate the `BRAIN_RULES.md` key" — one credential. Enumerating the repo's
own GitHub secret-scanning alerts found **six more, all `open` and `UNRESOLVED`**, several of which
are considerably more dangerous than the one being tracked.

### A. GitHub secret-scanning alerts — 6 open, unresolved

| # | type | location | first alerted |
|---|---|---|---|
| 6 | **Supabase Service Key** | `upload_local.py:6` | 2026-04-16 |
| 5 | OneSignal Rich API Key | `backend/.env:10` | 2026-04-15 |
| 4 | Google API Key | `frontend/src/components/MessagesPage.js:173` | 2026-04-15 |
| 3 | **Supabase Service Key** | `backend/.env:4` | 2026-04-15 |
| 2 | Mapbox Secret Access Token | `frontend/src/components/Explore.js:593` | 2026-04-15 |
| 1 | Stripe Test API Secret Key | `backend/.env:5` | 2026-04-15 |

⛔ **The two Supabase Service Keys are the worst of these.** A `service_role` key bypasses RLS
entirely — it is full read/write authority over the production database, and no amount of
route-level BOLA hardening constrains it.

### B. The Qdrant key (the originally tracked item)

`BRAIN_RULES.md:200` and `.antigravityrules` carried a Qdrant Cloud API key **inline, next to its
cluster endpoint URL**, committed `8e156c8c` on **2026-05-26 — ~116 days**, live on **both `main`
and `dev`**. Removed from both files by this change and replaced with a `QDRANT_API_KEY`
environment-variable reference.

Note the correct pattern was already present one line below, at `BRAIN_RULES.md:201`: the LangSmith
key is held in episodic memory and referenced by name, never inlined. The Qdrant line simply did
not follow it.

### C. Not detected by GitHub, and therefore easy to miss

`secret_scanning_non_provider_patterns` is **disabled** on this repository. GitHub only flags
credentials matching a known provider signature, so anything generic was never alerted on. The
Qdrant key is proof this gap is real. By the same logic the following, all present in the local
`backend/.env`, should be assumed exposed if that file was ever pushed (see §D):
`RENDER_API_KEY` (production configuration write authority),
`COPERNICUSMARINE_SERVICE_USERNAME` / `COPERNICUSMARINE_SERVICE_PASSWORD`.

## D. ⛔ The history cleanup did NOT remediate anything

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

Claude cannot perform any of these: they require provider-account authority, and handling
credential values is out of scope by policy.

1. **Rotate both Supabase `service_role` keys first.** Full DB authority, exposed ~5 months.
   Update Render (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`) and local `backend/.env`.
2. **Rotate the Stripe secret key.** Alert says *Test*; confirm no live key shares the exposure.
3. **Rotate OneSignal, Mapbox and Google API keys.** Re-apply referrer/IP restrictions on the
   Google and Mapbox keys while you are there.
4. **Rotate the Qdrant Cloud key** (the originally tracked item) and set `QDRANT_API_KEY` in the
   environment. The cluster endpoint is also public, so the key is the only remaining control.
5. **Rotate `RENDER_API_KEY` and the Copernicus service password** — undetected by GitHub, so
   never alerted, but in the same file as items 1/3/5.
6. **Close all 6 alerts** with `revoked` once rotated, so the list means something again.
7. **Enable `secret_scanning_non_provider_patterns`** — this is the gap that hid items 4 and 5.
8. **Ask GitHub Support to purge the unreachable commits.** Only GitHub can drop them from the
   public object store; deleting a branch does not. This is cleanup *after* rotation, never
   instead of it.

## What this change does and does not do

- **Does:** removes the Qdrant key from `BRAIN_RULES.md` and `.antigravityrules` at HEAD, so it
  stops being re-published in every future clone, and records the full finding.
- **Does NOT:** reduce the exposure of any already-published value, including the Qdrant key
  itself. Items 1–6 above are the remediation. This commit is bookkeeping.

⚠️ History rewriting is destructive and is **not** proposed here. It would not help — §D shows the
last rewrite left the secrets publicly fetchable — and it would require separate explicit approval.
