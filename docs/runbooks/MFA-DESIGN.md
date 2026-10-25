# Multi-factor authentication: design note

Status: design for PR A (TOTP + recovery codes + login step-up) and PR B (passkeys). Owner decision 2026-10-24:
passkeys and MFA are for ALL users, not only photographers and admins. This file holds no secret values; every
credential is named by its environment variable only.

## Goals and non-goals

- A stolen or guessed password alone must not open an account that turned MFA on.
- Opt-in for everyone from day one; an owner can REQUIRE it per role with a flag that defaults OFF, so a deploy
  locks nobody out.
- Out of scope here: moving the session token out of browser storage, server-side session revocation, and email
  step-up (the email service is being built separately). They are listed under "Follow-ups" so they are not forgotten.

## Order of operations at login

```
POST /api/auth/login  {email, password}
  1. existing throttle + password check            (unchanged; the throttle is owned by another change)
  2. suspended accounts are refused                (unchanged)
  3. does the account have a confirmed second factor?
       no , role not required     -> session token, exactly as today
       no , role REQUIRED         -> {mfa_setup_required, setup_token}   (enrol-only token, 15 min, see below)
       yes                        -> {mfa_required, challenge_token, methods}   NO session token, no profile
POST /api/auth/login/mfa  {challenge_token, method: totp | recovery | (passkey, PR B), code}
  4. reserve an attempt, verify the factor, consume the challenge, then and only then -> session token + profile
```

The password step never returns a session token for an MFA account, and the challenge is useless on its own: it
authorises exactly one thing, trying a second factor for the user who just proved the password.

## Challenge token (the bridge between the two steps)

- 32 random bytes, URL-safe. The server stores only its SHA-256 (a database read cannot replay it).
- Short-lived (5 minutes) and single-use: consumed with one atomic conditional UPDATE, so two simultaneous correct
  submissions produce one session.
- At most 5 attempts per challenge. An attempt is RESERVED (counter incremented atomically) before the code is checked,
  so parallel guesses cannot exceed the limit. The fifth miss kills the challenge; the user signs in again.
- It is not a JWT on purpose: a stateless token cannot be single-use or attempt-counted.

## Token model after MFA

The session token keeps today's shape (sub, role, iat, exp) so every existing route keeps working. A session earned
with a second factor gains an `amr` claim (`["pwd","totp"]`, `["pwd","recovery"]`, `["webauthn"]`) recording how it was
earned; a password-only session is byte-for-byte what it is today (no claim). Nothing reads `amr` yet except tests, so
it is available for later step-up checks without a migration.

The enrol-only token carries `scp: "mfa_setup"`. `verify_token` rejects any token with a scope unless the caller opts
in, and only the MFA routes opt in. Every other route, including WebSockets, therefore refuses it. It lives 15 minutes.

## Session upgrade

- A password-only session becomes an MFA session only by signing in again. Enrolling does not revoke tokens already
  issued (they are stateless, 30-day). This is the honest limit; see Follow-up 1.
- Enrolling, disabling, regenerating recovery codes and (PR B) removing a passkey all require the CURRENT PASSWORD in
  the request, on top of the bearer token. A thief holding only a stolen session token cannot add their own factor and
  lock the owner out, and cannot strip MFA. Wrong step-up answers return 403, never 401, so the client does not treat
  them as an expired session.
- Disabling MFA needs the password plus a current factor (TOTP code or recovery code).

## Factors

- TOTP (RFC 6238; SHA-1, 6 digits, 30 s: what authenticator apps implement). Accepts the current step +/- 1 for clock
  skew. A step already used is refused (RFC 6238 section 5.2): a monotonic `last_used_step`, advanced with a conditional
  UPDATE. Codes are compared in constant time over all three steps.
- TOTP secrets are encrypted at rest (Fernet) with `MFA_ENCRYPTION_KEY`. It may hold several comma-separated keys: the
  first encrypts, all decrypt, so the key can be rotated. If it is unset the server logs a startup warning, refuses to
  start an enrolment, and users with no factor are unaffected. Secrets are never logged and never returned after
  enrolment.
- Recovery codes: 10, 50 bits each, shown ONCE. Stored as HMAC-SHA256 keyed from `MFA_ENCRYPTION_KEY` (a database leak
  alone cannot be brute-forced offline); each is single-use. Regenerating replaces all of them.
- Passkeys (PR B): WebAuthn via py_webauthn on the server and @simplewebauthn/browser in the client. A passkey works as a
  first factor (usernameless sign-in, phishing-resistant, user verification required) and as the second factor in the
  challenge step. Attestation is "none". Sign-count regression is refused when the authenticator reports counters.

## Recovery

1. A recovery code (the 10 codes shown at enrolment).
2. A second enrolled factor (a passkey if the authenticator app is lost, or the reverse).
3. Break-glass by the owner, after verifying the person out of band: `backend/scripts/mfa_admin_reset.py` clears every
   factor for one account (recorded in the log and as an in-app notice to the user). Email-based recovery arrives with
   the email service; until then this is the last resort and is deliberately manual.
4. The last working factor can never be removed by the user: removing a passkey or disabling TOTP is refused if it
   would leave the account with MFA "on" but no way to pass it (PR B enforces this for the passkey list).

## What blocks a lockout-DoS

Account lockout is a weapon when anyone can trigger it. The design avoids counters an outsider can run up:

- A challenge exists only after a CORRECT password, so an attacker who does not know it cannot touch any MFA counter.
- A failed code kills one challenge, never the account. The user signs in again.
- A per-account ceiling (10 wrong authenticator codes in 15 minutes) pauses TOTP ONLY. A recovery code or a passkey still
  works while TOTP is paused, so someone who knows the password can slow guessing but cannot lock the owner out.
- The sign-in throttle itself is separate and is not changed by this work; the MFA verify route has its own per-source
  limit on top of the per-challenge and per-account ones.

## Device trust

There is no "remember this device" in v1. The usual implementation is a long-lived cookie or stored token that skips the
second step. Here the app and API are on different origins (Netlify and Render), so browsers treat that cookie as
third-party and drop it, and a token kept in browser storage is exactly as stealable as the session token it would
protect. It would add risk and no protection. The 30-day session is already the "stay signed in" mechanism.

## Enforcement (default OFF)

`MFA_REQUIRED_ROLES` is a comma-separated list; empty or unset means nobody is required. Accepted names: `admin`
(accounts flagged admin or with the Admin role), `photographer`, `approved_pro`, `hobbyist`, and any other role name
(case-insensitive, spaces or underscores), plus `all`. Admins and photographers are the intended first roles. A required
role without a factor gets the enrol-only token at login and finishes enrolment before receiving a real session.
Turning the flag off restores today's behaviour for everyone immediately; existing enrolments keep working.

## Passkey relying-party configuration (PR B)

A passkey is bound to the RP ID chosen when it was created, and the browser checks it against the page's own origin,
which is the FRONTEND (Netlify), not the API (Render). One backend serves several frontends, so the server holds an
allow-list rather than one value:

- `WEBAUTHN_ALLOWED_ORIGINS`: exact origins, comma-separated (e.g. the production site and the dev branch site). A
  request's `Origin` header must match one exactly, or the ceremony is refused.
- `WEBAUTHN_RP_ID` (optional): a registrable domain shared by several origins (e.g. a custom domain and its `www`).
  When unset, the RP ID is the origin's own host, so production and dev get SEPARATE passkeys, which is what we want
  (a dev passkey must never be a production credential).
- The ceremony stores the RP ID and origin it was opened with; verification uses the stored values, never the
  request's. Credentials store their RP ID and are only offered back for the matching one.
- Tested against the dev and production origins in the unit tests; the first real registration on each site is a
  documented manual check in the PR.

## Follow-ups (not in these PRs)

1. Server-side session revocation (a per-user token version checked on a cached lookup) so enabling MFA or changing the
   password can end sessions issued earlier.
2. Move the session token out of script-readable browser storage (httpOnly cookie, same-site proxy), which is what makes
   a cross-site-scripting bug stop meaning account takeover.
3. Email: lockout notice, "MFA was turned off" mail, email-based recovery, once the email service exists.
4. A shorter session lifetime for password-only sessions.
