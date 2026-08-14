# SECURITY, DATA INTEGRITY AND SUPPLY CHAIN — Audit 12.2

**Scope: the weather-simulation feature.** Non-destructive review only — nothing was upgraded,
changed, or exploited. **No credential value appears in this document or in any 12.2 artifact;**
where a secret exists, only its file, line and variable *name* are recorded.

Classification per §21 of the brief: **Immediate security blocker · Data-integrity risk ·
Operational hardening · General app concern · Not applicable.**

---

## Summary

**No immediate security blocker was found in the weather feature.** The two items worth the owner's
attention are an **information-disclosure** issue that is present-tense at HEAD, and a **data-integrity
surface list that is incomplete** in an already-tracked task.

| Finding | Class | Coverage |
|---|---|---|
| Complete first-party source published via source maps on **both** deploys, including HEAD | Operational hardening | **uncovered** |
| Git-tracked `forecast_cache/*.json` acts as a live fallback | **Data-integrity risk** | **WS-CAN-0017's surface list is incomplete → expand** |
| Committed credential in `BRAIN_RULES.md` | Security governance | **WS-CAN-0021**, owner-gated |
| PostHog third-party script in `index.html` | Supply chain / privacy | **uncovered — in no dependency register** |
| 261 `window.__RAW_*` runtime overrides, 2 of which change a displayed forecast value | Operational hardening | **uncovered as a class** |
| No CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy | Operational hardening | uncovered (general app) |
| Service-worker cache poisoning | ✅ **refuted** | n/a |
| Client marine-cache validation | ✅ adequate | n/a |
| `_fetch_message_bytes` accepts a bare 200 | Data-integrity risk | ✅ **fully covered** by WS-CAN-0017 |
| Decode-worker truncation guards | ✅ present | ✅ WS-CAN-0008 |

---

## 1. Source maps publish the complete frontend, at HEAD

Measured, not inferred.

```
grep -rIl 'GENERATE_SOURCEMAP'  (tracked files)
  → exactly ONE hit, a docs runbook — it appears in NO build config
  → positive control (CI=false) found 3 files, so the search works

netlify.toml:3
  command = "node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build"
  publish = "build"
```

CRA 5 defaults `GENERATE_SOURCEMAP` to `true`, and `publish = "build"` ships the whole directory.
Locally, `find frontend/build -name '*.map'` → **105 map files**. Live probe of both deploys:

| deploy | `main.js` | `main.js.map` |
|---|---|---|
| `rawsurf.netlify.app` (production, frozen at `3bd38a83`) | 200 / 1,124,342 B | **200 / 4,802,016 B** |
| `dev--rawsurf.netlify.app` (**= HEAD `791fdf78`**) | 200 | **200 / 4,807,261 B** |

The complete, un-minified first-party source — every weather, marine and WebGL module, with
`sourcesContent` — is anonymously downloadable from both origins.

**Severity: LOW, and deliberately downgraded** from how it first reads:

- No credential value is newly exposed. Any `REACT_APP_*` value is inlined into the minified bundle
  regardless; the map adds nothing there.
- The flag-name disclosure is not new either — the overwhelming majority of the 261 override names
  are already present as string literals in the shipped minified JS.
- It touches no served number, no render path, and not the ONE FORECAST COMPOSITION chain.

The residual is **source-text disclosure of a private repository**, plus deploy weight. It is fixable
in one config line (`GENERATE_SOURCEMAP=false` in `netlify.toml`'s build command) and is an **owner
decision**, because source maps are also what makes a production stack trace legible — and this
program has no other production error-reporting path.

## 2. Data integrity

### The one real gap: the git-tracked cache is a live fallback

`backend/uploads/forecast_cache/marine_global.json` and `wind_global.json` are **tracked in git**,
are **the only two files dirty in the working tree at this audit's baseline**, and are read as a
serving fallback. That makes a repository file part of the serving path for forecast values.

`WS-CAN-0017` (pipeline integrity chain — end-to-end checksum, byte-count/Range validation) is the
right owner, and its surface list does not include this file pair. **Expand WS-CAN-0017; do not open
a new ID.**

### What is already adequate — recorded so it is not re-audited

- `_fetch_message_bytes` accepting a bare `200` is exactly the case WS-CAN-0017 exists for. ✅ covered.
- The decode worker has truncation guards. ✅ WS-CAN-0008.
- Client-side marine cache validation is adequate.
- **Service-worker cache poisoning is refuted**, not merely unproven. The SW's substring host
  matching is the same *class* as the WS-CAN-0059 `url.includes('.js')` bug, but it is not
  exploitable here and no finding follows.
- The service worker caches `/api/surf-spots` and static assets. It caches **no** weather or
  conditions response —
  `grep -c "api/weather\|api/conditions" frontend/public/service-worker.js` → **0**, positive control
  `api/surf-spots` → **3**. **There is no stale-weather-via-service-worker hazard.**

## 3. Supply chain

### PostHog — a third-party script six audits did not see

Injected in **`frontend/public/index.html:149, 172-173`**, and observed live in this audit's own
network capture (`us-assets.i.posthog.com`). It appears in **no** dependency register in the program.

The reason it was missed is worth recording as a method note, not a blame: **every dependency search
in this program has run over `frontend/src` and `package.json`. A `<script>` in `index.html` is in
neither.** Any future dependency census must include `frontend/public/`.

It should be added to `EXTERNAL_DEPENDENCY_RISK_REGISTER.csv` with its data-collection surface stated,
since it observes an authenticated map session.

### Dependencies

`frontend/package-lock.json` is present and pinned. Backend reports `deps_count: 137`, `python 3.12`,
`deps_digest: 320d9d9cc7c5` on the live service — a genuinely good supply-chain fingerprint that few
programs carry. **No dependency was upgraded or audited destructively**, per the brief.

⚠️ `python-upgrade-readiness.yml` exists, carries **six** `continue-on-error: true` steps, and has
**never executed**. A readiness gate that has never run is not a control.

## 4. Debug surface

**261** `window.__RAW_*` / `__OM_*` overrides ship to production in 143 files, with essentially no
`NODE_ENV` gating (one guard exists in the whole map directory and it gates an error-boundary detail
panel). Two of them change a **displayed forecast quantity**:

```js
marineEngineDecisions.js:113   __RAW_RATING_SPAN_FADE_HI__   (default 9.5)
WebGLMarineEngine.js:1656      __RAW_BLEND_HEIGHT_HI__       (default 1.4)
```

Plus two **persistent** `localStorage` renderer overrides — `force_marine_fallback`,
`force_wind_fallback` — read in a `useState` initialiser (`MapWebGL.js:95-96`) with no reset path.

**This is not an immediate security blocker** — setting them requires page access, and an attacker
with page access has better options. It is an **operational hardening and reproducibility** finding,
and it is filed as such in `LV12-2-03`. The security-relevant residual is narrow and real: the
system has **no record of which overrides were set** in any session, so a report of a wrong number
cannot be distinguished from a tampered client.

## 5. Credentials

`BRAIN_RULES.md` is still tracked at HEAD and still matches a credential pattern.
**The value was deliberately not reproduced or read.** This is `WS-CAN-0021` / `WS-OBJ-703`, owner
action, unchanged: rotate provider-side and move to env. Editing the file does not help — git history
retains it regardless, which is why the task is *rotate*, not *delete*.

## 7. ⛔ This audit leaked a token into its own evidence, and the claim that it had not was false

**Recorded prominently because it is the only finding here that the audit itself caused.**

The sentence that stood in this section read: *"Confirmed absent from any 12.2 artifact: API keys,
tokens, signed URLs, cookies, and provider commercial terms."* **It was false when written.**

A pre-commit scan of the 12.2 tree found the **live `access_token=pk.eyJ…` Mapbox public token
embedded 21 times** — 20 in `evidence/browser-device-tests/coverage-chromium-desktop.json` and 1 in
the Firefox equivalent — inside captured tile URLs under `netFail[].url`. `covercap.js` stored
`r.url()` verbatim, and a Mapbox tile URL carries the token as a query parameter.

| | |
|---|---|
| Severity | **Low as a credential** — `pk.` is Mapbox's *public/client* token class, designed to ship in client code, and it is already present in the deployed bundle and in every browser's network tab |
| Severity **as an audit defect** | **High.** The document asserted an absence it had not checked, in the section whose entire job is credential hygiene |
| Fixed | all 21 occurrences replaced with `<REDACTED-MAPBOX-PUBLIC-TOKEN>`; host, path and failure reason preserved so the evidence still reads |
| Prevented | `covercap.js` now redacts **on the way in**, not after — a post-hoc sweep only works if someone remembers to run it |
| Re-scanned | `sk-*`, `eyJ*` JWTs, `AKIA*`, `ghp_*`, `pk.eyJ*` → **0 files** (the one remaining `pk.eyJ` string is an agent's count notation, `pk.eyJ=1`, with no payload after it) |

★ **This is §4's own question, answered the hard way.** That row asked *"Are secrets redacted in what
is retained?"* and answered *"Not verified by this audit for the video artifacts."* It is now
verified — by finding one. The general rule, which applies to the CI artifacts this audit tells you
to go and read: **a retained artifact is a disclosure surface, and "we did not put a secret in it" is
a hope unless something strips them on the way in.** `zoomlab-nightly` (59.5 MB of frames and video
of an authenticated session) and `playwright-report` have never been checked for this at all.

After redaction, and now actually verified rather than asserted: no API key, token, signed URL,
cookie or provider commercial term appears in any 12.2 artifact.

## 6. What this review did NOT do

- No `npm audit`, no dependency upgrade, no lockfile change.
- No penetration testing, no auth bypass attempts, no CORS exploitation.
- **No production configuration was read** — the live Render service's env vars exist only in the
  dashboard (`render.yaml` is documented as not applied), so this review cannot state what is set
  there. That is `WS-CAN-0040`, owner-gated, and it bounds several statements above.
