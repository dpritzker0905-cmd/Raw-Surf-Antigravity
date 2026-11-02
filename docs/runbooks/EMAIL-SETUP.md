# Email service setup (owner runbook)

**Status: provider setup is required. Nothing sends until the OWNER does the steps below.** The code supplies a sender,
an outbox, templates and a webhook. Guardian linking and support events use this outbox. With no
configuration every caller gets a plain `not_configured` result: no crash, no silent success, no row written.

Support ticket creation queues one generic `support_created` receipt; public staff replies queue `support_reply`.
Both respect the owner's `email_messages` opt-in and link directly to the authenticated ticket in the app.
Support subjects, descriptions and reply text stay in-app; email replies are not ingested and no Reply-To is attached.
Customer follow-up replies do not email that same customer. Both support notices retain the low-priority delay and quota
controls described below; a saved ticket, queued row or provider acceptance is not proof of inbox delivery.

This file names environment variables only. Never paste a key, secret or token value into the repo, a PR, a chat log or
this runbook. Values live in Render's environment and nowhere else.

**Decisions already made (owner, 2026-10-25):** provider is **Resend**; mail is sent from a **subdomain**
(`notify.raw.surf`), never from the apex `raw.surf`; DNS is hosted at **SiteGround**, which also hosts the apex mailboxes
and the apex SPF record. **Do not touch, replace or merge the apex SPF record.** Resend's SPF lives on its own
`send.notify` hostname, so the two never meet.

## What the owner must do (the code cannot)

1. Create the Resend account and add the domain `notify.raw.surf` (below).
2. Add the DNS records Resend shows, in SiteGround's DNS Zone Editor (below), then verify the domain in Resend.
3. Add a DMARC record on the apex, starting at `p=none` (below).
4. Create an API key and a webhook in Resend, and set the environment variables in Render (below).
5. Send the staging test (below) before enabling production.

## Environment variables (Render, backend service)

| Variable | Purpose | Shape (not a value) |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `resend` to send for real, `console` for local dev, unset = disabled | `resend` |
| `EMAIL_API_KEY` | Resend API key (a "sending access" key is enough) | Resend's key |
| `EMAIL_FROM` | sender shown to recipients, on the subdomain | `Raw Surf <no-reply@notify.raw.surf>` |
| `REPLY_TO` | optional; **must be a monitored mailbox** (a SiteGround mailbox someone reads: guardians will reply to invites). Unset = no Reply-To header | `help@raw.surf` |
| `FRONTEND_URL` | base of every emailed link; must be `https://` | the app's public URL |
| `EMAIL_WEBHOOK_SECRET` | signing secret of the bounce/complaint webhook | Resend's `whsec_...` secret |
| `EMAIL_DAILY_CAP` | sends per UTC day the budget guard plans around; default `100` (Resend free plan). Raise it only after upgrading | `100` |
| `EMAIL_DIGEST_WINDOW_MINUTES` | optional; how long routine notices wait to be merged into one email; default `30` | `30` |
| `EMAIL_RATE_PER_RECIPIENT_PER_HOUR` | optional, default `5`, counted separately for security and routine mail | |
| `EMAIL_RATE_GLOBAL_PER_HOUR` | optional, default `200`, counted separately per class | |
| `EMAIL_MAX_ATTEMPTS` | optional, default `3` (retries wait 2 s, 4 s ... capped at 30 s) | |
| `EMAIL_CONSOLE_DIR` | dev only: folder the console sender writes message text into | |

With `EMAIL_PROVIDER=resend` but a missing `EMAIL_API_KEY` or `EMAIL_FROM`, email stays **disabled** and a warning is
logged: a half-configured sender never pretends to work. Set the variables on the **dev** service first.

## Resend: add and verify `notify.raw.surf`

1. In Resend: **Domains -> Add Domain**, name `notify.raw.surf` (Resend recommends a subdomain for sending; it isolates
   reputation from the apex). Pick the region closest to the backend.
2. Resend then lists the DNS records on the domain's **Records** tab. The exact set depends on when the domain was
   created: typically a **DKIM** TXT record, plus the return-path records (an **MX** and an **SPF TXT** on a `send`
   host), or CNAME equivalents on newer domains. **Copy exactly what the Records tab shows**; the shapes below are
   illustrative.
3. Add them in SiteGround (next section), wait, then click **Verify DNS Records** in Resend. Verification often completes
   within about 15 minutes but can take longer; if it has not completed after 72 hours use **Restart verification**.
4. The domain status must read **Verified** before you set `EMAIL_PROVIDER=resend`.

Resend's records are written relative to the domain you added. For `notify.raw.surf` they look like this (values come
from the dashboard, never from this file):

| Type | Host (relative to `raw.surf`) | Value |
| --- | --- | --- |
| TXT | `resend._domainkey.notify` | the `p=...` DKIM public key Resend shows |
| MX | `send.notify` (priority 10) | the `feedback-smtp...amazonses.com` host Resend shows |
| TXT | `send.notify` | `v=spf1 include:amazonses.com ~all` (as shown by Resend) |

## SiteGround: add the records

This works only while `raw.surf` uses SiteGround's name servers (it does today).

1. SiteGround **Site Tools -> Domain -> DNS Zone Editor**. Make sure the domain selected is `raw.surf`.
2. In **Create New Record**, pick the record type tab. For each Resend record:
   - **TXT** (DKIM): Name `resend._domainkey.notify`, Value = the DKIM string (without surrounding quotes unless the
     editor asks for them), then **Create**.
   - **MX**: Name `send.notify`, Priority `10`, Destination = the feedback host Resend shows (keep a trailing dot if the
     editor appends the domain to it), then **Create**. Do **not** use the "SiteGround mail" shortcut buttons, and do
     **not** delete the three existing apex MX records: they carry the SiteGround mailboxes.
   - **TXT** (SPF for the return path): Name `send.notify`, Value = the `v=spf1 include:amazonses.com ~all` Resend shows.
     This is a **new record on a different hostname**. Leave the apex `raw.surf` SPF TXT record exactly as it is.
   - If Resend shows CNAME records instead: SiteGround refuses a CNAME on a host that already has other records, so add
     the CNAME only on a host with nothing else, and never turn on any proxying.
3. Enter hosts exactly as written above (the zone editor appends `raw.surf`). Entering the full name would produce
   `notify.raw.surf.raw.surf`.
4. Check from any terminal that the records are public, then verify in Resend:

   ```bash
   nslookup -type=TXT resend._domainkey.notify.raw.surf
   ```

## DMARC (on the apex, starting at `p=none`)

DMARC is added after the domain verifies. In the same zone editor:

1. First look for an existing TXT record whose value starts with `v=DMARC1` on `_dmarc`. If one exists, **edit it** (pencil
   icon) instead of adding a second: two DMARC records at one host invalidate both.
2. Otherwise create a TXT record: Name `_dmarc`, Value
   `v=DMARC1; p=none; rua=mailto:<a mailbox you actually read>`. `p=none` only collects reports; it blocks nothing, so it
   cannot break existing SiteGround mail.
3. Read the aggregate reports for a few weeks. When every legitimate source (SiteGround mail, Resend) shows
   SPF/DKIM alignment, move to `p=quarantine`, later `p=reject`. A subdomain with no DMARC record of its own follows the
   apex policy.

## Webhook and the rest of the Render variables

1. Resend: **Webhooks -> Add Endpoint** `https://<backend host>/api/email/webhook`, events `email.bounced`,
   `email.complained`, `email.suppressed`. Copy its signing secret into `EMAIL_WEBHOOK_SECRET`. Until that variable is set
   the endpoint answers `503` and ignores everything (it fails closed); a wrong or stale signature is `400`.
2. Resend: **API Keys -> Create** (sending access, restricted to the `notify.raw.surf` domain). Put it in `EMAIL_API_KEY`.
3. Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `REPLY_TO`, `FRONTEND_URL`, `EMAIL_DAILY_CAP` as in the table.

## Free-tier budget (what the code does about it)

Resend's free plan allows **3,000 emails a month and 100 a day** (the day is a UTC calendar day; paid plans have no daily
cap: re-check [Resend's pricing](https://resend.com/pricing) before launch). The sender is built to live inside that:

- **Two priority classes.** *Security* mail (guardian invite and confirmation, new-device sign-in, lockout notice, password
  reset) is sent immediately, never merged, and never held by the budget. *Routine* notices (for example "a dispute was
  opened") wait `EMAIL_DIGEST_WINDOW_MINUTES`, and everything waiting for one recipient goes out as **one** digest email.
- **Daily budget guard.** Routine mail may use 80% of `EMAIL_DAILY_CAP`. Past that it is held to the next UTC day, and a
  warning is logged once that day. The last 20% is reserved for security mail. If a security burst still reaches the
  provider's hard cap, Resend answers `429`; the worker retries with backoff and then records `http_429`.
- **Rate limits** per recipient and overall, counted separately per class, so a flood of notices to one address cannot use
  up the allowance a guardian invite needs, and one address cannot burn the day's budget.
- Digests and the day's counts use sends, not rows: a digest of three notices is one email against the cap.
- Held and waiting mail is re-driven by a small background sweeper (every 5 minutes, only while a provider is configured).

## Staging test (no real users)

1. On the **dev** backend set the variables with an `EMAIL_API_KEY` created for dev only.
2. Send to an address you own or to Resend's test addresses (`delivered@resend.dev`, `bounced@resend.dev`,
   `complained@resend.dev`). For local development use `EMAIL_PROVIDER=console` and `EMAIL_CONSOLE_DIR=<folder>`: it
   records the message and writes its text to the folder, and logs only a hash reference.
3. In your inbox's "show original" view confirm SPF, DKIM and DMARC all read `pass` and the From domain is
   `notify.raw.surf`. Reply once to confirm `REPLY_TO` lands in the SiteGround mailbox.
4. Send to the bounce test address and confirm the webhook added a row to `email_suppressions`, and that a later send to
   that address returns status `suppressed` with no provider call.
5. Check the outbox shape (no addresses are kept after a terminal state):

   ```sql
   select status, priority, count(*) from email_outbox group by status, priority;
   select template, priority, status, attempts, last_error from email_outbox order by created_at desc limit 20;
   ```

   `last_error` holds short codes only (`http_503`, `timeout`, `template:...`), never a message body or an address.

## Rotating keys

- **API key:** create a second key in Resend, set `EMAIL_API_KEY` in Render to the new one, wait for the deploy, send one
  test message, then revoke the old key. Queued messages are unaffected (the key is read at send time).
- **Webhook secret:** Resend can show two secrets during rotation and the endpoint accepts a request that carries either
  signature. Add the new secret, update `EMAIL_WEBHOOK_SECRET` in Render, then retire the old one.
- If a key is ever pasted anywhere public, treat it as compromised and rotate it at the provider; do not rely on deleting
  it from history (see `SECURITY-2026-09-19-committed-credentials.md`).

## How it behaves (for the next developer)

- API: `from services.mailer import enqueue_email, deliver_outbox_entry`. Inside the request, in the same
  transaction as the data change, call `result = await enqueue_email(db, template, to, params, idempotency_key)`, commit,
  then `background_tasks.add_task(deliver_outbox_entry, result.outbox_id)` if `result.queued`. Statuses: `queued`,
  `duplicate` (same key already accepted: nothing new is sent), `suppressed`, `rate_limited`, `not_configured`,
  `invalid`. Build the key from the thing being sent, for example `guardian_invite:<invite id>`.
- A template's class is set in `templates.py` (`TemplateSpec.priority`). Anything that must reach the person promptly
  (anything with a token, anything about their security) stays `security`; give a `low` template a one-line `summary`
  so it can join a digest.
- The outbox keeps `recipient_hash` for lookups; the address and the template parameters (which include any single-use
  token) are kept only until the message is `sent`, `failed` or `suppressed`, then cleared.
- Links are `FRONTEND_URL` + a fixed path, and carry at most `?token=<opaque single-use token>`. The paths in
  `templates.py` (`/guardian/accept`, `/security/secure-account`, `/forgot-password`, `/reset-password`, `/family`,
  `/disputes`, `/notifications`) are placeholders to align with the frontend routes when the first caller ships.
- Templates render in the reader's client scheme (light, using the warm sand surface, or dark). An inbox cannot select the
  app's beach theme.
- Tables are created by the startup self-heal (`ensure_database_tables`); the Alembic revision `e1a0c5f2b7d4` exists so a
  migrated database matches.
- The package is `services/mailer`, **not** `services/email` (fetchers run by path with `services/` first on `sys.path`,
  so it would shadow the standard library) and **not** `services/email_service` (that module already exists: the SendGrid
  session-recap helper). Tests guard both, and that the tests stay out of the forecast-chain CI lane.

## Existing email code this PR does not touch (read before turning anything on)

The app already sends some mail by other routes. None of it goes through this service yet:

- `routes/auth_pkg/password_reset.py`, `scheduler/grom.py`, `scheduler/financial.py` and `services/admin_notifications.py`
  use the `resend` SDK keyed on **`RESEND_API_KEY`**, and the reset email is sent **From `noreply@raw.surf` (the apex)**.
  **Owner decision (2026-10-25): these stay as they are, on `noreply@raw.surf`; their From addresses are not changed
  by this work.** The new mailer sends from `notify.raw.surf` only. Resend sends only from a verified domain, so whether
  those existing calls deliver depends on whether the apex is (or becomes) verified in Resend, which is the owner's
  call and is not part of this PR.
- `services/email_service.py` is a SendGrid helper (`SENDGRID_API_KEY`) used for photographer session recaps.
- This service uses `EMAIL_*` variables so it can be switched on and off independently. Moving the existing senders onto
  it (one place for suppression, rate limits and the daily budget, and one From identity) is a follow-up, as is retiring
  `RESEND_API_KEY` once nothing reads it.
