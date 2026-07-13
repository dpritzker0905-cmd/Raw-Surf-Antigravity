# User-ID Auth Architecture Deep Dive — Handoff Report

**Date:** 2026-07-12
**Trigger:** Found while sweeping the backend for the admin-panel Jacobian audit (round 4); user asked for a dedicated, comprehensive review before any fix work starts.
**Classification:** OWASP API Security Top 10 (2023) — **API1: Broken Object Level Authorization (BOLA)**, also commonly called IDOR (Insecure Direct Object Reference). BOLA has been the #1 API security risk since 2019 and is present in ~40% of real-world API attacks. [Source: OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
**Method:** Direct source reading, AST-based static analysis (not regex — see §2.1 for why), full git archaeology, live behavioral confirmation of the frontend's request flow, and grounding against current external best-practice literature. Every specific claim below was independently re-derived from source, not carried over from an earlier pass's summary.

---

## 1. Executive summary

This app has **two parallel authentication patterns living side by side**:

1. **A correct, modern JWT system** (`backend/core/security.py`) — `get_current_user_id` verifies a signed Bearer token and returns the real, cryptographically-authenticated user ID. It is already used correctly in **361 routes** (132 non-admin + 229 admin).
2. **A legacy pattern** — a bare `user_id: str` function parameter, trusted as-is with zero verification. Confirmed present in **221 routes** (24% of the 930-route backend) after correcting an initial miscount (§2.1).

**This is not a codebase that never thought about the problem.** Git history shows this exact issue was explicitly worked on and declared "complete" **twice** — April 21 (`c1526cdc`, "close user_id query param backdoor") and April 30 (`84236b0c`, "complete JWT-only auth migration ... Removed all legacy user_id/admin_id query parameters"). Both commits are real, both made real fixes, and today — 2.5 months later — 221 routes still have the old pattern. This is a **governance and drift problem**, not a one-time oversight: without some enforcement mechanism, the pattern keeps reappearing as new routes get added or files get refactored, exactly as OWASP's own guidance predicts for exactly this failure mode (§4).

**The actual exploitability is real but bounded**, and this materially changes how urgent and how risky a fix is:
- The frontend's `apiClient.js` **already** attaches a real, verified Bearer token to every single request, unconditionally, via an axios interceptor (§3). In normal app usage, the `user_id` a route receives always matches the token's subject.
- The exploit requires **bypassing the frontend entirely** (curl, Postman, browser devtools, a script) — trivial for a technically-competent attacker, invisible to a normal user, and not exploitable through the UI itself.
- Because the frontend already sends real tokens, **fixing this is lower-risk than it looks**: the existing "migration bridge" helper (`get_user_id_from_jwt_or_query`, already used 97 times) would immediately start verifying identity for every real user with **zero frontend changes**, since the token it needs is already present on every request today.

**What this session did:** research and documentation only, per explicit instruction — **no code was changed**. This report is the deliverable.

---

## 2. What was actually found

### 2.1 Methodology, and a self-correction worth recording

The first scan (done during the admin-audit round 4, before this dedicated dive) used a naive regex to detect "does this route have an auth dependency," checking only for the substring `get_current_user`. That flagged **309 routes**. While building this deeper review, I found a route (`toggle_like_post` in `routes/posts/interactions.py`) that the first scan flagged as vulnerable but that, read directly, clearly has `Depends(get_user_id_from_jwt_or_query)` — a real, working auth dependency that just doesn't contain the substring `get_current_user`. The first scan's substring check missed the entire "migration bridge" family of helper functions.

**Corrected methodology:** an AST-based scanner (Python's `ast` module, not regex — regex breaks on nested parentheses like `Query(None, description="...")`, which produced separate false positives in the admin-only sweep too, see the runbook's §21.2) checking every one of the 930 `@router.*`-decorated functions for **any** of the five real auth-dependency names used in this codebase:
`get_current_admin`, `get_current_user_id`, `get_user_id_from_jwt_or_query`, `get_optional_user_id_from_jwt_or_query`, `get_optional_user_id`.

**Corrected count: 221 routes** (not 309) have a bare `user_id` parameter and none of the five markers. This is still large and still real — but reporting the wrong number in a security document is itself a failure mode worth naming, so it's recorded here rather than quietly swapped.

**Final-pass due diligence on the scanner itself** (2026-07-12, closing verification): confirmed the 5-marker list is exhaustive by grepping `deps/` and `core/` for every function definition matching an auth-dependency naming shape (`get_current_*`, `get_optional_*`, `get_user_id_*`, `require_*`) — exactly 5 exist, matching the scanner's list precisely; no 6th pattern was missed. Also spot-checked two more flagged routes specifically for a *manual*, non-`Depends()`-based auth check inside the function body (a failure mode the AST scan structurally can't see) — `create_identity_verification_session` and `boost_dispatch_request` (§3.1) — confirmed neither has one. No further scanner corrections found; 221 stands.

### 2.2 The existing auth infrastructure (`backend/core/security.py`)

```python
async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    """Verifies a JWT Bearer token, returns the real user_id. Raises 401 if missing/invalid."""

async def get_optional_user_id(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Same, but returns None instead of raising — for routes that work differently when logged out."""

def get_user_id_from_jwt_or_query(authorization: Optional[str] = Header(None), user_id: Optional[str] = None) -> str:
    """MIGRATION BRIDGE. Priority: (1) verified JWT subject, (2) legacy user_id param, (3) raise 401.
    Docstring: 'Once the frontend is fully migrated, the query param fallback can be removed.'"""

def get_optional_user_id_from_jwt_or_query(...) -> Optional[str]:
    """Same bridge, non-raising variant."""
```

This is a genuinely well-designed piece of infrastructure — HS256 JWT (`python-jose`), 30-day expiry (documented as an intentional "mobile-style UX" choice), `sub` claim set to the real `profile.id` (a UUID, not an email/username — already matching current best practice: *"Use UUIDs as the sub claim, not usernames or emails"* [source](https://davidmuraya.com/blog/fastapi-jwt-authentication/)), and a deliberate three-tier migration path (strict / bridged / optional) rather than a single hard cutover. The `get_current_admin` dependency used throughout the admin-audit arc is built on the same foundation.

**Usage counts across the 930-route backend:**
| Dependency | Count | Meaning |
|---|---|---|
| `get_current_admin` | 229 | Admin-only routes, JWT + role check |
| `get_user_id_from_jwt_or_query` | 97 | The "migration bridge" — dominant pattern for user-facing routes |
| `get_current_user_id` | 30 | Fully migrated, JWT-only, no fallback |
| `get_optional_user_id_from_jwt_or_query` | 4 | Bridge, non-raising |
| `get_optional_user_id` | 1 | Fully migrated, non-raising |
| **Total properly authed** | **361 / 930 (39%)** | |
| **Bare `user_id`, zero auth** | **221 / 930 (24%)** | This report's subject |
| (remainder: legitimately public routes — search, public feeds, health checks, etc.) | ~348 | Not evaluated here; presumed intentionally public |

### 2.3 The frontend already sends real tokens on every request

`frontend/src/lib/apiClient.js`, lines 51-77 — a request interceptor that runs on **every** API call made through the shared axios instance:

```javascript
apiClient.interceptors.request.use((config) => {
  const stored = localStorage.getItem('raw-surf-user');
  if (stored) {
    const user = JSON.parse(stored);
    if (user?.access_token) {
      config.headers['Authorization'] = `Bearer ${user.access_token}`;
    }
  }
  return config;
});
```

This is unconditional and global — there is no per-call opt-in/opt-out. `user.access_token` is issued by `/auth/login` and `/auth/signup` via `create_access_token()` in `core/security.py`. **This is the single most important fact governing both severity and remediation risk** (§5).

### 2.4 Git history — this exact problem, twice, "closed," and drift since

| Commit | Date | Claim | What it actually did |
|---|---|---|---|
| `c1526cdc` | 2026-04-21 | "security: remove hardcoded Stripe key + close user_id query param backdoor" | First real closure pass |
| `84236b0c` | 2026-04-30 | "feat: complete JWT-only auth migration and dead code cleanup — Migrated all 96+ backend endpoints from query-param auth to JWT Bearer tokens ... Removed all legacy user_id/admin_id query parameters" | Second, larger closure pass — 20 route files touched, `security.py` gained the migration-bridge helpers |

Spot-checked the diff of `84236b0c` against `backend/routes/posts.py` (a file that existed then and has since been split into `posts/interactions.py`, `posts/management.py`, `posts/social.py`, `posts/post_collaboration.py`): every function the commit touched (`toggle_like_post`, `unlike_post`, `pin_post_to_profile`, `unpin_post_from_profile`, `create_comment`, `delete_comment`, `edit_comment`, `get_feed`) went from `user_id: str = Query(...)` to `user_id: str = Depends(get_user_id_from_jwt_or_query)`.

**Checked whether that fix survived the later file split — it did.** All of those functions, read directly in today's `posts/interactions.py`, still have the dependency. The migration itself is durable where it was applied.

**So where did the 221 come from?** Cross-referencing `84236b0c`'s file list against a currently-flagged file (`bookings/crud.py`, which the commit *did* touch) shows the commit fixed two *specific* functions that lived in that file at the time (`share_booking_to_feed`, `get_nearby_open_bookings` — both since moved to `booking_lifecycle.py`, both still correctly protected today). The functions flagged in today's `bookings/crud.py` (`get_all_bookings`, `get_user_bookings`, `update_booking_settings`, `get_booking_share_link`, `get_user_live_sessions`, `get_user_session_history`) are **different functions** — either out of scope for the original sweep, or added afterward. Either way: **the pattern isn't regressing, it's drifting** — new code, and code the original sweep didn't reach, keeps landing without the dependency that's already standard practice 361 times over in the same codebase, in the same file in some cases.

This matches OWASP's own framing exactly: *"IDOR vulnerabilities persist because access control logic must be implemented consistently across every endpoint ... without automated security testing."* [source](https://hadrian.io/blog/insecure-direct-object-reference-idor-a-deep-dive) A convention that isn't structurally enforced erodes over time, no matter how thorough any one cleanup pass is.

---

## 3. What real user data is exposed today (categorized, with direct source evidence)

Every entry below was confirmed by reading the actual function body, not inferred from the route name.

### 3.1 Financial / payment data — highest real-world severity
- `GET /credits/balance/{user_id}` — `get_user_balance()`, `subscriptions_billing/credits.py` — real credit balance, zero auth.
- `GET /credits/history/{user_id}` — full credit transaction history.
- `GET /payments/history/{user_id}` — `get_payment_history()`, `subscriptions_billing/payments.py` — full payment history.
- `POST /payments/identity/create-session` — `create_identity_verification_session()`, same file — creates a real **Stripe Identity** verification session (used for Guardian/Pro badges) attributed to an arbitrary `user_id`, zero auth, confirmed no manual in-body check either.
- `POST /request/{request_id}/boost` — `boost_dispatch_request()`, `dispatch/boost.py` — a genuine financial **write**, not just a read: spends 5/10/20 real credits (by duration) to elevate a dispatch request's priority, attributed to whatever `user_id` the caller supplies. An attacker could drain another user's credit balance through this path alone.
- Plus subscription-tier mutation endpoints (`toggle-status`, `upgrade-tier`, `apply-pro`) — these are **write** paths: an attacker could change *another user's* subscription state.

*(Added during the final-pass re-verification: spot-checked two more routes specifically for a manual in-body auth check that wouldn't show up in the AST scan — `create_identity_verification_session` and `boost_dispatch_request` — confirmed both have none; the scanner isn't missing a manual-check pattern.)*

### 3.2 Private communications
- `GET /messages/conversations/{user_id}` — `get_conversations()`, `messages/conversations.py` — a user's full DM inbox list. (Confirmed this file *does* correctly gate the grom-safety-zone messaging permission check — the messaging-permission logic is sound; it's the caller-identity check that's missing.)
- `GET /messages/unread-counts/{user_id}`, conversation deletion/mute/pin toggles — same pattern.

### 3.3 Location / physical safety adjacent
- `GET /map/{user_id}` — `get_friends_on_map()`, `social/friends.py` — returns a user's friends' real-time GPS locations for map display. Zero auth on who's asking.
- `POST /location/{user_id}` — `update_gps_location()` — a **write**: could an attacker push a fake location update for another user's account, corrupting their friends' map view? Not confirmed further in this pass, flagged for the remediation-planning conversation.

### 3.4 Identity / account-as-another-user writes
- `POST /upload/avatar` — `upload_avatar()`, `uploads/core.py` — `user_id: str = Form(...)`, changes whose avatar is set with zero check the caller owns that account.
- `POST /support/tickets` (`create_ticket`), `POST /career/admin/pending-verifications`-adjacent submit endpoints — create records attributed to an arbitrary `user_id`.

### 3.5 Confirmed NOT affected — the pattern is not universal
- **`grom_hq/*` (parental controls, spending limits, age verification)** — spot-checked `monitoring.py` directly: every function uses `Depends(get_user_id_from_jwt_or_query)`. The single most safety-sensitive area of this app (child accounts) is properly gated.
- Admin routes generally (229 correctly gated, plus the 6 fixed in the prior round of this same audit arc).

This asymmetry (child-safety code is clean, general social/financial code has gaps) is worth noting as evidence the team *has* applied appropriate rigor when a feature area's sensitivity was obvious — the gap is more about routine, lower-drama endpoints not getting the same treatment by default.

---

## 4. Why this matters — grounded in current best practice, not just this session's opinion

- **OWASP API1:2023 (BOLA)** is the exact classification: *"BOLA occurs when an API does not properly enforce authorization checks for each object accessed by the client, allowing attackers to manipulate object identifiers ... to access or modify resources they are not authorized to."* [owasp.org](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) — has held the #1 spot in OWASP's API-specific list since 2019.
- Recommended remediation, matched against this codebase's actual state:
  - *"Ensure object-level authorization checks are performed for every API request"* — this app has the tooling to do this (`get_user_id_from_jwt_or_query`), just inconsistently applied.
  - *"Keep entitlement logic centralized and consistent"* — currently there are 5 valid patterns plus the broken one; consolidating toward fewer, or enforcing structurally, would help.
  - *"Prefer non-predictable, non-sequential object identifiers"* — **already true here** (UUIDs throughout, not sequential integers) — this doesn't fix BOLA but it does remove the "attacker enumerates 1, 2, 3, ..." version of the attack; an attacker still needs to *obtain* a real UUID first (e.g., from a public profile page, a shared link, or another leaky endpoint), which is a real but non-trivial bar.
  - *"Add automated tests that prove access is denied when the caller doesn't own the object"* [source](https://hadrian.io/blog/insecure-direct-object-reference-idor-a-deep-dive) — this is the single highest-leverage recommendation for THIS codebase specifically, because the same category of bug has already resurfaced twice without one.
- **FastAPI-specific best practice**: *"FastAPI's dependency injection system creates a 'security perimeter' — by the time business logic runs, the token is valid and the user is known"* [source](https://medium.com/@ancilartech/bulletproof-jwt-authentication-in-fastapi-a-complete-guide-2c5602a38b4f) — this app already leans on that pattern correctly in 361 places; the fix for the other 221 is mechanically the same shape, not a new architecture.

Sources: [OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) · [StackHawk BOLA guide](https://www.stackhawk.com/blog/understanding-and-protecting-against-api1-broken-object-level-authorization/) · [Hadrian IDOR deep dive](https://hadrian.io/blog/insecure-direct-object-reference-idor-a-deep-dive) · [OWASP IDOR Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) · [FastAPI JWT best practices](https://davidmuraya.com/blog/fastapi-jwt-authentication/) · [Bulletproof JWT in FastAPI](https://medium.com/@ancilartech/bulletproof-jwt-authentication-in-fastapi-a-complete-guide-2c5602a38b4f)

---

## 5. Why this was NOT fixed in this session (deliberate, not an oversight)

221 routes is enormous scope for a single reflexive pass. Specific reasons to slow down and plan rather than bulk-edit:

1. **Scale.** This touches roughly a quarter of the entire backend, across nearly every feature domain. A mistake here has much broader blast radius than the admin-panel fixes in this same audit arc (which were individually small, isolated, and had zero UI dependents).
2. **Unverified assumption.** This report is confident the frontend sends a real token on *every* apiClient call (confirmed by reading the interceptor). It has **not** verified, route by route, that every one of the 221 callers passes a `user_id` that always matches the logged-in user's own ID rather than a legitimate "look up someone else" case. Some of the 221 (e.g., `GET /profile/{user_id}/posts` — viewing another user's public profile) may be **intentionally** looking up another user's data, where the right fix is closer to "check the target profile's privacy settings," not "require the caller to own the ID." Bulk-converting everything to "must match caller" without this per-route judgment call would break legitimate public-profile-browsing behavior.
3. **No regression net yet.** Per §4's best-practice citation, the recommended prerequisite for this kind of change is a cross-account isolation test suite (two seeded test users, assert each cannot see/mutate the other's data) — this doesn't exist yet for these routes and should probably be built *alongside* the fix, not after.
4. **This exact class of change has silently failed to hold twice already** in this codebase. Repeating the same "big sweep, declare victory" pattern a third time without addressing *why* it drifted (§2.4) would likely produce the same outcome in another 2-3 months.

---

## 6. Recommended path forward (planning only — no decision made yet)

### Phase 0 — Decide the enforcement mechanism (do this first, before touching any route)
Options, roughly cheapest-to-most-robust:
- **A. Convention + code review discipline** — cheapest, already tried twice, already failed twice. Not recommended as the *only* control.
- **B. A lint/CI check** — grep or AST-based (reuse this session's scanner) run in CI, failing the build if a new route accepts a bare `user_id` param without one of the 5 auth markers. Cheap to build (this session already has working AST code), directly addresses the "drift" root cause from §2.4, doesn't require touching the 221 existing routes to start protecting *new* ones immediately.
- **C. Global auth middleware** — bigger lift, changes the app's auth model shape, would need careful design given many routes are intentionally public. Worth considering long-term but not a quick win.

**Recommendation: B, immediately, cheaply, as a first step** — stops the bleeding on new code while the 221 existing routes get triaged properly. Then proceed to Phase 1.

### Phase 1 — Triage the 221 by "self data" vs "target data" (needs a human decision per ambiguous case, not a bulk script)
- **Clear "self" cases** (route name/logic implies "my own data": `get_conversations`, `get_user_balance`, `get_payment_history`, `create_ticket`, `upload_avatar`, anything with `/my-*` in the path): swap `user_id: str` → `user_id: str = Depends(get_user_id_from_jwt_or_query)`. Mechanical, low-risk, matches the exact pattern already used 97 times. Zero frontend changes needed (§2.3).
- **Ambiguous "target" cases** (`GET /profile/{user_id}/posts`, `GET /users/{user_id}/following` — looking up *another* user intentionally): needs a real decision — is this meant to be public (then it's not a bug, just correctly using `user_id` as a target, and the finding here is a false positive for THIS specific route), or does it need to respect blocking/privacy settings (a feature gap, not an auth gap)? Recommend a short pass through this bucket with the user before writing any code.

### Phase 2 — Build the regression test
Two seeded test accounts, one assertion per touched route: "account A cannot read/write account B's data by passing B's ID with A's token." This is the concrete, cheap insurance against a third silent regression.

### Phase 3 — Roll out by domain, financial/private-data first
Suggested order by §3's severity groupings: (1) financial/payments, (2) private messages, (3) location, (4) identity-writes (avatar, tickets), (5) everything else. Each phase: fix, add the phase-2-style test, ship, verify live (same discipline as the rest of this audit arc — curl-prove 401-without-auth and 200-with-auth on a sample from each domain before moving on).

### Explicitly NOT recommended
Do not attempt this as one large PR. Given the exact same "big bang, declared complete" approach already happened twice (§2.4) and didn't hold, a domain-by-domain rollout with a regression test per phase is more likely to actually stick.

---

## 7. What's already correct and doesn't need touching
- The JWT infrastructure itself (`core/security.py`) — sound design, matches current best practice on the points checked (UUID subject, proper HS256 signing, sensible token lifetime for the app's use case).
- `get_current_admin` and the 229 admin routes using it (this whole audit arc, already verified extensively).
- `grom_hq/*` — child-safety-sensitive code, already fully migrated.
- The frontend's token-attachment mechanism (`apiClient.js`) — already correct, unconditional, no gaps found.
- Non-sequential (UUID) identifiers throughout — removes the "just enumerate 1,2,3" trivial version of this attack class app-wide.

---

## 8. Session notes / how to resume this work

- The AST-based scanner used for both the corrected 221 count and the earlier 6-endpoint admin fix is reproducible: walk `backend/routes/`, `ast.parse` each file, find `@router.<method>("path")`-decorated functions, check parameter names for `user_id` and each parameter's default expression for any of the 5 auth-marker function names. Rebuild from this description if the exact script wasn't saved to disk.
- Full per-route list (all 221, file:line, function name) is in this session's raw tool output; re-run the scanner rather than trying to reconstruct the list by hand — it's a 30-second script.
- Related memory: [[app-wide-userid-auth-gap-2026-07-12]] (topic file, being updated alongside this report with the corrected count and this report's pointer), [[admin-panel-jacobian-audit-2026-07-12]] (where this was first surfaced, round 4, §21.4).
- No code was changed this session. Next session should start at **Phase 0** above — get a decision on the enforcement mechanism before writing any route-level fix.
