# Audit 12.2 — Source Inventory: SECURITY + DATA INTEGRITY + SUPPLY CHAIN (§21)

**Auditor scope:** non-destructive, weather-feature-scoped security / data-integrity / supply-chain
inventory. **Read-only on all production source.** No file outside this evidence directory was
created, edited or deleted. No commits, pushes, dispatches, installs or dependency changes.
`npm audit` was run in its default read-only mode; `--fix` was NOT run.

- **Repo:** `C:\Users\dprit\Raw-Surf`
- **Branch / HEAD:** `dev` @ `791fdf78`
- **Dev deploy measured:** `dev--rawsurf.netlify.app`, `service-worker.js` `BUILD_VERSION = '791fdf78'` — **= HEAD exactly**
- **Prod deploy measured:** `rawsurf.netlify.app`, frozen (WS-CAN-0039 / WS-OBJ-104)
- **Date:** 2026-08-13

> ⛔ **NO CREDENTIAL VALUE IS REPRODUCED IN THIS FILE.** Where a secret exists it is named by
> `FILE:LINE` and by variable name only. Where a shape needed classifying, only a 3-character
> prefix and a length were recorded (e.g. `pk.` / 89 chars), never the body.

---

## 0. Method, and the controls that make the negatives trustworthy

**ABSENCE IS A CLAIM.** Every "there is no X" below was paired with a positive control run through
the *identical command shape* against the *same file set*. Where a control came back empty, the
negative was thrown away and re-run — this happened once and is recorded (§0.2).

### 0.1 Search techniques used, and their controls

| # | Technique | Command shape | Positive control | Control result |
|---|---|---|---|---|
| C1 | tracked-file enumeration | `git ls-files \| grep …` | `grep -c 'package.json'` | 1 ✅ |
| C2 | tracked-file content scan | `git ls-files -z \| xargs -0 grep -nIE …` | needle `MIN_SWELL_ENERGY_SHARE` | 5+ files ✅ |
| C3 | frontend src scan | `git ls-files -z 'frontend/src/*' \| xargs -0 grep …` | needle `REACT_APP_MAPBOX_TOKEN` | `mapUtils.js` ✅ |
| C4 | NODE_ENV gate search | `grep -rnI "NODE_ENV" frontend/src \| grep …` | `NODE_ENV === 'production'` | `useOpenMeteoForecast.js:107`, `index.js:49` ✅ |
| C5 | route-decorator scan | `grep -rnIl 'rate_limit' backend/routes` | 3 modules found | auth / admin×2 ✅ |
| C6 | backend hazard scan | `grep -rnI … backend --include='*.py'` | `requests.get` / `shell` / `yaml` | 3 files each ✅ |
| C7 | prior-audit coverage scan | `grep -rilE … audit/12.0 audit/12.1` | needle `measure-or-refuse` | 3 files ✅ |
| C8 | live HTTP probe | `curl -s -o /dev/null -w '%{http_code}'` | `/asset-manifest.json` → 200 | ✅ |

### 0.2 A technique that failed its own control — recorded, not hidden

My first localStorage-key extractor was
`grep -rhoE "localStorage\.getItem\(\s*['\"][^'\"]+['\"]" … | sed -E "s/.*['\"]//"`.
It reported **1 distinct key**. The `sed` strips through the *last* quote, so it deleted the key it
was extracting. Re-run with a Python extractor over the same tree: **44 distinct keys**. A count of
1 was a defect in the instrument, not a property of the code. Every count in this file below was
produced by a technique that passed a control.

### 0.3 What I did NOT establish

- Whether the Mapbox `pk.` token has URL/domain restrictions applied account-side (requires the
  Mapbox dashboard — owner-only). **Undetermined.**
- Whether Supabase RLS is enabled on every table the anon key can reach (out of weather scope,
  requires the Supabase dashboard). **Undetermined.**
- Whether Render's live env vars match `render.yaml` — the file itself states it is **not applied**
  to the live service (WS-CAN-0040, owner-gated). **Blocked.**
- Runtime exploitation of anything below. **Nothing was exploited.** All live probing was limited to
  unauthenticated GETs of public URLs and status-code reads.

---

## 1. Client-side secrets and the shipped bundle

### 1.1 Env files — tracked status

| File | Tracked? | Ignored by | Result |
|---|---|---|---|
| `frontend/.env.local` | **NO** | `frontend/.gitignore:16` | ✅ correct |
| `backend/.env` | **NO** | `.gitignore:292` (`*.env`) | ✅ correct |
| any other `.env*` | **none tracked** | — | ✅ (C1 control passed) |

`git ls-files | grep -iE '(^|/)\.env'` → **zero rows**. Control C1 passed on the same command.

### 1.2 Variable NAMES present (values never read out)

`frontend/.env.local`: `GRIBSTREAM_API_TOKEN`, `REACT_APP_MAPBOX_TOKEN`, `REACT_APP_BACKEND_URL`,
`PORT`, `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`.

`backend/.env`: `COPERNICUSMARINE_SERVICE_USERNAME`, `COPERNICUSMARINE_SERVICE_PASSWORD`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `USE_WEATHER_PROXY`, `WEATHER_PROXY_URL`,
`LOCAL_TEST_FIXTURE`, `RENDER_API_KEY`.

Shape classification (prefix + length only):
`REACT_APP_MAPBOX_TOKEN` → `pk.` / 89 → **public Mapbox token, correct type** (a `sk.` here would
have been a blocker; it is not).
`REACT_APP_SUPABASE_ANON_KEY` → `eyJ` / 208 → **anon JWT, public-by-design** (RLS-dependent).
`GRIBSTREAM_API_TOKEN` → 40 chars, **not** `REACT_APP_`-prefixed.

### 1.3 Does CRA inline the non-prefixed token? — NO

`frontend/craco.config.js` was read in full. It contains **no `DefinePlugin` and no
`EnvironmentPlugin`**; the only `webpack.configure` mutations are `watchOptions.ignored` and an
optional health-check plugin behind `ENABLE_HEALTH_CHECK`. CRA 5 inlines only `REACT_APP_*`,
`NODE_ENV` and `PUBLIC_URL`. `require("dotenv").config()` at the top of craco.config.js loads the
file into the *build process* env, not into the bundle.
⇒ `GRIBSTREAM_API_TOKEN` is **not** inlined. It is nevertheless **misfiled** — a server-side
provider token living in a frontend env file is one `REACT_APP_` rename away from shipping.

### 1.4 THE DECISIVE MEASUREMENT — what is actually in the served bundle

I streamed the **live dev bundle** (`https://dev--rawsurf.netlify.app/static/js/main.e474455a.js`,
1,124,342 B, from `BUILD_VERSION 791fdf78` = HEAD) into `grep -c` and counted shapes. Nothing was
saved to disk; no value was printed.

| Shape | Count in the live bundle |
|---|---|
| `pk\.eyJ…` (Mapbox public token) | **1** |
| `eyJ….….…` (any bare JWT, e.g. a Supabase key) | **0** |
| `AIza…` (Google API key) | **0** |
| `sk-…` | **0** |
| `sk_live_` | **0** |
| `service_role` | **0** |

⇒ **The "secrets in the weather bundle" hypothesis is REFUTED at HEAD.** The only credential the
weather app ships is a Mapbox `pk.` token, which is public by design. This is a first-class negative
result and it kills what would otherwise have been the headline finding of this area.

### 1.5 Hardcoded tokens in tracked source — none

`git ls-files -z 'frontend/src/*' 'frontend/public/*' 'backend/*' | xargs -0 grep -nIE
'\b(pk|sk)\.eyJ[A-Za-z0-9_-]{10,}'` → **zero rows**. Control C3 passed on the identical command.

`grep -rnIlE 'AIza[0-9A-Za-z_-]{30,}' frontend/src backend` → **zero rows**.
`frontend/src/components/messages/GifPicker.js:23` reads `process.env.REACT_APP_GIPHY_API_KEY` with
**no hardcoded fallback** — the fallback was removed. ✅

---

## 2. Committed credentials in git-reachable content (WS-CAN-0021 / WS-OBJ-703)

### 2.1 WS-CAN-0021 — STILL PRESENT AT HEAD. Confirmed.

`BRAIN_RULES.md` is tracked. At **`BRAIN_RULES.md:200`** a Qdrant Cloud cluster endpoint URL and its
API key (JWT-shaped) are written in plaintext. Count of JWT-shaped literals in that file: **1**.
No `sk-` / `ghp_` / `AKIA` / `xox*` shapes are present (line-number scan returned empty).
`BRAIN_RULES.md:201` references a LangSmith key but states it lives in episodic memory — **no value
in the file**. ✅ that half is clean.

⇒ **WS-CAN-0021 verification state "Verification Failed / Repair" is CORRECT and unchanged.**
Register says "the two committed credentials"; at HEAD **one** value survives in that file.

### 2.2 THE SAME CREDENTIAL IS IN A SECOND TRACKED FILE THE REGISTER DOES NOT NAME

`.antigravityrules:201` (tracked) carries a JWT-shaped literal. I compared them **by hash, without
printing either**:

```
sha256(match in BRAIN_RULES.md)   -> 6bd74b381b9d…
sha256(match in .antigravityrules)-> 6bd74b381b9d…   ← IDENTICAL
```

The WS-CAN-0021 row's `Current Files / Symbols` column says **`BRAIN_RULES.md`** only. Its
*Remaining Work* column does say "secret-scan all refs", so the intent is present — but the surface
list is not, and a rotation executed against the named file alone leaves this one. **Expand the
task's file list; do not open a new task.**

### 2.3 A THIRD committed credential, different shape, different file, no task at all

`frontend/eslint_errors.json:1` (tracked, 5,417,389 B, last touched by commit `04342a9a`
*"Refactor: remove all emergent agent settings, configs, and third-party urls from the
application"*) embeds a **Google/Tenor API key** (`AIza…`). Parsing the JSON shows the origin:

```
filePath: C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\frontend\src\components\messages\GifPicker.js
source line 16 -> const TENOR_API_KEY = process.env.REACT_APP_TENOR_API_KEY || 'AIza<REDACTED>';
```

Notes: (a) the key came from a **scratch copy of the repo outside this tree** — the lint artifact
captured source that no longer exists here; (b) the current `GifPicker.js` has **no** hardcoded
fallback (§1.5), so the *code* was fixed and the *artifact* was not; (c) the file also embeds
absolute local paths of another machine's working tree. **Not on the weather path.** Same class as
WS-CAN-0021 and belongs on its rotation list.

### 2.4 Repo-wide secret-shape sweep — everything else was a false positive

`git ls-files -z | xargs -0 grep -nIE '(sk-…|sk_live_|pk_live_|ghp_…|github_pat_|AKIA…|xox[baprs]-…|AIza…|SG\.…|rnd_…|glpat-|npm_…)'` returned 4 locations. Three inspected and cleared:

| Location | Verdict |
|---|---|
| `backend/server.py:40` | `if STRIPE_API_KEY and STRIPE_API_KEY.startswith('sk_live_')` — a **guard**, not a secret ✅ |
| `backend/routes/dispatch/crew.py:409` | `if stripe_key.startswith("sk_live_")` — a **guard** ✅ |
| `.agents/DEEP_AUDIT.md:424` | prose describing that guard ✅ |
| `frontend/eslint_errors.json:1` | **real key** — §2.3 |

### 2.5 GitHub Actions supply-chain surface — clean

- `pull_request_target` in `.github/workflows/`: **zero files** (control C1/C7 shape passed).
- Secrets echoed / interpolated into `run:` echo statements: **zero rows**.
- 27 workflow files.

---

## 3. Source maps in production — MEASURED, and it is current, not historical

`grep -rIl 'GENERATE_SOURCEMAP'` over tracked files → the string appears in **exactly one** file, a
docs runbook (`docs/runbooks/HANDOFF-2026-07-22-…md:22`, discussing a dev-server crash). It appears
in **no build config**. Control C2-shape passed (`CI=false` needle found 3 files).

`netlify.toml:3`:
```
command = "node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build"
```
No `GENERATE_SOURCEMAP=false`. CRA 5 defaults it to `true`; `publish = "build"` ships the whole
directory. Locally `find frontend/build -name '*.map'` → **105 map files**.

**Live probe (both deploys):**

| Deploy | build id | `main.js` | `main.js.map` |
|---|---|---|---|
| `rawsurf.netlify.app` (prod, frozen) | — | 200 / 1,124,342 B | **200 / 4,802,016 B** |
| `dev--rawsurf.netlify.app` | `791fdf78` = **HEAD** | 200 | **200 / 4,807,261 B** |

⇒ The complete un-minified frontend source, including every weather/marine/WebGL module, is
publicly downloadable from **both** deploys. Because the **dev** deploy is at HEAD, this is a
present-tense property of the current program, not an artifact of the 85-day production freeze —
so the usual "prod serves an artifact this program does not own" discount (WS-CAN-0039) does **not**
apply.

**Honest severity:** by itself this is disclosure, not compromise — §1.4 proved no private secret is
in the bundle to be read out. It is *Operational hardening*. Its real cost is that it removes the
last friction from reading the guard logic, kill-switch names and om:// URL construction.

### 3.1 Security response headers

`frontend/public/_headers` sets `X-Content-Type-Options: nosniff` and cache directives only.
Measured on both live deploys, the complete set of security headers returned is:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload   (Netlify default)
X-Content-Type-Options: nosniff
```

**Absent:** `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`, `Referrer-Policy`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`. No CSP means the `dangerouslySetInnerHTML` and
`window.__RAW_*` surfaces below have no second line of defence. *Operational hardening.*

---

## 4. CORS

### 4.1 Backend (`backend/server.py:486-492`)

```python
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.netlify\.app|https://.*\.render\.com|http://localhost:.*|http://127\.0\.0\.1:.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Starlette matches `allow_origin_regex` with `fullmatch`, so no suffix-escape is possible
(`https://evil.netlify.app.attacker.com` does **not** match). But `https://.*\.netlify\.app`
admits **any** Netlify subdomain — and anyone can provision one in minutes — with
`allow_credentials=True`.

**I tried to make this a blocker and failed.** The kill:

- `grep -rnI 'set_cookie|request.cookies|SessionMiddleware' backend --include='*.py'` → **zero
  non-test rows**. There is no cookie session.
- `grep -rnI 'credentials:\s*.include|withCredentials' frontend/src` → **zero rows**; control C3
  passed (`Authorization` needle found 3 files).
- `frontend/src/lib/apiClient.js:52-61` injects `Authorization: Bearer …` read from
  `localStorage['raw-surf-user']`.

⇒ Auth is a **bearer header**, not a cookie. A hostile `*.netlify.app` origin therefore cannot ride
the victim's session: `allow_credentials=True` transmits nothing it can use, and the responses it
can read are the public weather payloads. **Operational hardening / latent**, not a blocker. It
becomes a blocker the day any cookie is introduced.

Second-order note: the same regex is **duplicated verbatim** at `backend/server.py:510-512`
(`_CORS_ERR_ORIGIN_RE`, for the exception handler). Two copies of one security constant — a drift
seam, not a defect today.

### 4.2 Netlify weather proxy — `Access-Control-Allow-Origin: *`, unauthenticated, and LIVE

`frontend/netlify/functions/weather-proxy.js:41` and every error return set
`'Access-Control-Allow-Origin': '*'`. Reachability measured on the dev deploy:

| Path | Status |
|---|---|
| `/.netlify/functions/weather-proxy` | **400** — body `{"error":"Missing type parameter"}`, header `Access-Control-Allow-Origin: *` |
| `/.netlify/functions/weather` | 404 (not deployed) |
| `/api/weather-proxy` | 404 |

A 400 with the handler's own error string proves the function **executes, unauthenticated, from any
origin**. Meanwhile `frontend/src/index.js:38-53` **quarantines** it: any fetch matching
`/api/weather-proxy` (or `api.open-meteo.com` / `marine-api.open-meteo.com`) is blocked when
`NODE_ENV === 'production'`. So the app no longer calls it, but Netlify still serves it.
⇒ **Legacy-but-reachable.** It is an open, unauthenticated third-party API proxy attached to the
project's own quota, with a per-container in-memory cache. Mitigations present in-code: a fixed
3-entry `API_URLS` allowlist (`weather-proxy-helpers.js:13-17`, no user-supplied URL ever reaches
`fetch`), `estimateRequestCost`, `RESPONSE_SIZE_LIMIT` 6.5 MB, and circuit breakers. **No SSRF.**

---

## 5. Cache integrity

### 5.1 The Netlify proxy cache is keyed by a 32-bit hash

`frontend/netlify/functions/weather-proxy-helpers.js:130-147` — `getCacheKey()` builds
`type + JSON.stringify(body)` (or the sorted query string) and reduces it with
`hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0` — a **32-bit** djb2-variant — then returns
`` `${type}_${hash}` ``. Entries live in a module-scope `Map` (`:6`) with `CACHE_TTL` 30 min
(`:11`). `validateCacheShape()` (`:107-128`) checks only that *some* recognised container is
non-empty; it never checks that the cached payload's coordinates match the request's.

Two different coordinate sets that collide in 32 bits therefore share a cache entry: a request for
location A can be served location B's field. Collisions in a 32-bit space are findable by brute
force in seconds, and §4.2 shows the endpoint is open and unauthenticated, so an attacker can prime
the entry. **Data-integrity risk.** Discounted by reachability: the app quarantines this path in
production (§4.2), so no *user* is currently served from it.

### 5.2 Service worker — cache-poisoning hypotheses tested and REFUTED

`frontend/public/service-worker.js`, read in full.

- The `message` handler (`:338-357`) was the strongest hypothesis: any page script can `postMessage`
  to the SW. **Refuted** — on `CACHE_SPOTS` the URL is reconstructed hardcoded:
  `new URL('/api/surf-spots', self.location.origin)` (`:344`). The message payload is never used as
  a URL. ✅
- The `fetch` handler does not check `url.origin`, but every `cache.put` / `cache.match` is keyed on
  the full `event.request`, so a cross-origin entry can never satisfy a same-origin lookup. ✅
- `:116` `if (response && response.ok)` — a cold-start 502/4xx is **never** cached, with an in-file
  comment saying exactly why. ✅ Good practice.
- **Weather is excluded from the SW entirely**: `:91-103` returns early for
  `open-meteo.com`, `rainviewer`, `tiles.`, `tile.`, `maplibre`, `.om`, `om` protocol,
  `/marine`, `/weather`. ⇒ **the SW is not a weather-data cache surface at all.**

Residual, class-level only: those exclusions and `url.hostname.includes('supabase')` (`:164`) are
**substring** host tests — the identical defect *shape* as WS-CAN-0059 (`url.includes('.js')`
matching `.json`). `tile.` matches `tile.attacker.example`; `supabase` matches
`evil-supabase.example`. Because cache keys carry the origin, neither is exploitable today. Worth a
line in a hardening pass, **not** a finding.

### 5.3 Client-side marine cache — validated

`frontend/src/engine/RenderPlanDispatcher.js:38-70` (`hydrateGridFromLocalStorage`) parses
`rawsurf_marine_cache_v9` inside `try`, then rejects on: missing `results`/`points`, model mismatch,
layer mismatch, `provider === 'fallback_safe_zero' || 'estimated'`, and empty `hourly.time`. It does
not range-check the numeric values, but the store is same-origin localStorage — reachable only with
script execution the attacker already has. **Not a finding.**

### 5.4 ⚠️ A GIT-TRACKED, PROCESS-MUTATED JSON FILE IS A LIVE FORECAST FALLBACK

```
$ git ls-files backend/uploads/forecast_cache/
backend/uploads/forecast_cache/marine_global.json     (204,796 B)
backend/uploads/forecast_cache/wind_global.json        (72,833 B)

$ git status --short backend/uploads/forecast_cache/
 M backend/uploads/forecast_cache/marine_global.json
 M backend/uploads/forecast_cache/wind_global.json
```

Both are **tracked**, and both were **already dirty at session start** — the running process writes
them. `backend/services/weather_pipeline/wind_ingestion.py:189-227` reads `wind_global.json` when
the live NOAA/ECMWF fetch returns nothing, and the only validation is:

```python
if len(cached_data) < 100:      # :196  — a point-count floor, nothing else
```

There is no schema check, no age check, no checksum, and no provenance check on the file contents.
The loader then **modulo-cycles** whatever hours exist across a 14-day horizon
(`orig_speed[hour_idx % len(orig_speed)]`, `:214-217`) and serves that as the global wind field.
The same pattern repeats at `:303` and `:560`.

⇒ Whatever any developer happens to commit becomes production's wind fallback on the next Render
deploy. **Data-integrity risk.**

**Mitigating fact, found by following it through:** the path is *honest on the wire*. `:240` /
`:358` / `:560` stamp
`estimate_basis = {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache", …}`
and `:249` sets `estimated_after_index=0`. A consumer **can** tell. This is the program's
refusal-over-fabrication habit working, and it drops the severity from Critical to High.

**Coverage check:** WS-CAN-0017's `Current Files / Symbols` are `_fetch_message_bytes x3; store.py;
store_helpers.py`. This fallback bypasses `store.py` entirely and is not among them. WS-OBJ-304 /
SOTA **B14** state the outcome ("a truncated product cannot register as authoritative") but no row
names this surface. ⇒ **Expand WS-CAN-0017, do not open a new task.**

---

## 6. Provider-response validation (WS-CAN-0017 scope confirmation)

`_fetch_message_bytes` exists in three copies:
`backend/services/noaa_gfs_pressure_fetcher.py:95`, `noaa_gfs_wave_fetcher.py:248`,
`noaa_gfs_wind_fetcher.py:97`. All three are the same six lines:

```python
rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
r = requests.get(url, headers={"Range": rng}, timeout=HTTP_TIMEOUT)
if r.status_code not in (200, 206):
    raise RuntimeError(f"range GET {rng} -> HTTP {r.status_code}")
return r.content
```

**A bare `200` is accepted.** A `200` means the upstream *ignored* the `Range` header and returned
the whole object; the code writes those bytes into the GRIB temp file as if they were the requested
message. `len(r.content)` is never compared to `end - start + 1`, and `Content-Range` is never read.

⇒ This is **exactly** WS-CAN-0017's stated remaining work — *"start with byte-count/Range validation
(one site, three copies)"* — including the count. **Fully covered. Not a new gap.** Recording it
here only as independent confirmation that the register's description is accurate at HEAD.

`MARINE_PHYSICS_VALIDITY` (`backend/services/weather_pipeline/wave_physics.py:52`, default ON)
is a *physical-plausibility* guard on decoded values, a different and complementary layer. Present
and on. ✅

---

## 7. Malformed-binary handling in the decode workers

| Worker | Reachability | Malformed-input handling |
|---|---|---|
| `frontend/src/components/map/GridParserWorker.js` (748 LOC) | **Active-reachable** — imported by `useGridWorker.js`, `usePressureEngine.js` (control C3 passed) | Explicit truncation guards `:70` and `:142` (`offset + rows*cols > data.length → return null`); top-level `try/catch` `:729-747` posting `{id, result, error}` |
| `frontend/src/engine/workers/forecast-decode-worker.js` | **Dead** — `grep -rnI "forecast-decode" frontend/src frontend/e2e frontend/package.json` → zero rows; control C3 passed on `GridParserWorker` | n/a |
| `frontend/src/workers/gpsWorker.js` | Active (`useSessionTracker.js:22`) | out of weather scope |
| om:// `.om` raster decode | **Active-reachable** | delegated to **`@openmeteo/weather-map-layer` 0.0.19** WASM — see §9.2 |

`frontend/src/components/map/openMeteoProtocol.js:696` builds every om:// URL against a
**hardcoded** host, `https://map-tiles.open-meteo.com/data_spatial/…`; `:741` parses it with
`new URL(params.url.replace('om://',''))` inside a `try`. **No user-controlled host reaches the
decoder.** ✅

Note (design, not defect): `:691` publishes `window.__OM_PROTOCOL_SETTINGS__` and `:722` reads it
back as the live settings for every decoded tile, including `colorScales` and `postReadCallback`.
It is the app's own shared-settings channel (`colorScales.js:227-430` writes it) and is only
reachable with script execution.

WS-CAN-0008 ("worker crash handling … stop zero-filling truncated arrays") already owns this area
and is *Implemented and Active / Partially Verified*. **Covered.**

---

## 8. Unsafe dynamic code, debug interfaces, and runtime overrides

### 8.1 Dynamic code execution — clean

| Pattern | Count in `frontend/src` |
|---|---|
| `eval(` | **0** |
| `new Function(` | **0** |
| `dangerouslySetInnerHTML` | **8** |

Of the 8, exactly **one is on a weather surface**: `TruthOverlay.js:701`, a `<style>` block. I read
lines 701-710 and counted interpolations: **`${` occurrences = 0**. It is a static `@keyframes`
literal. ✅ Not a finding.

The other 7 are `<script type="application/ld+json">` SEO blocks (`Explore.js:441`,
`SpotHub.js:246`, `Profile.js:383`, `SinglePost.js:471`, `GalleryStorefront.js:224,260`,
`ScheduledBookingHelpers.js:588`) fed by `JSON.stringify(...)`. `JSON.stringify` does not escape
`<`, so a value containing `</script>` would break out. Inputs are catalogue/spot metadata, not
free-text. Plus one imperative `innerHTML =` with a static SVG string
(`ExploreSearchResults.js:107`) and a static template
(`LocationPicker.js:129`). **General app concern**, not weather, not covered by any WS-CAN.

### 8.2 Backend hazard sweep — clean, with controls

| Pattern | Result | Control (C6) |
|---|---|---|
| `verify=False` / `rejectUnauthorized:false` / `NODE_TLS_REJECT` | **0** | `requests.get` → 3 files ✅ |
| `shell=True` / `os.system(` in `backend/services`, `backend/routes` | **0** | `shell` token → 3 files ✅ |
| `pickle.load` / `yaml.load(` (non-test) | **0** | `yaml` → 3 files ✅ |

### 8.3 The diagnostics HUD IS gated — hypothesis killed

`frontend/src/components/map/TruthOverlay.js:19-29`, `isDiagHudEnabled(win)`:

```js
if (win.localStorage.getItem('__RAW_DIAG__') === '0') return false;
if (new URLSearchParams(win.location.search).get('diag') === '1') return true;
if (win.localStorage.getItem('__RAW_DIAG__') === '1') return true;
const h = win.location.hostname;
return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
} catch (e) { return false; }
```

Production is **OFF by default**, `?diag=1` is a **deliberate documented opt-in**, `'0'` suppresses
everywhere, and any storage exception **fails closed**. The 2026-07-19 header comment records that
it was previously mounted unconditionally and that this gate was the fix. `MarineAnimTuner.js`
carries 7 gate tokens by the same contract. `TruthOverlayVisualTab` / `TruthOverlayGpuTab` have no
gate of their own because they render only inside the gated parent.
⇒ **Not applicable / by design.** The "debug panel reachable in production" hypothesis is refuted.

### 8.4 The global surface, measured

`grep -rhoE '__(RAW|OM|WEATHER|MARINE)_[A-Z0-9_]+__' frontend/src | sort -u | wc -l` → **433**
distinct globals. `grep -rnI "NODE_ENV" frontend/src | grep -iE '__RAW_|__BACKEND_URL__|__MARINE_'`
→ **zero rows**, while control C4 confirms `NODE_ENV === 'production'` gates *do* exist elsewhere in
the tree. ⇒ **none of the 433 is production-gated.**

This is not, by itself, a defect. The SOTA contract lists *"Kill-switch-and-control-arm discipline"*
as one of the things the platform is already state of the art at (B12 ✅ MET), and window flags are
the mechanism. Read-only diagnostic globals and kill switches that only *degrade* are a deliberate,
documented design. Recorded for completeness, **not raised**.

### 8.5 ⚠️ THE ONE OVERRIDE THAT IS DIFFERENT: `__BACKEND_URL__`

44 distinct localStorage keys are read/written by `frontend/src` (extractor in §0.2). Most are
preferences. Four change the data path; one changes the *server*.

`frontend/src/lib/apiClient.js:23` — **module-scope, evaluated at import, no gate of any kind:**

```js
export const BACKEND_URL = (typeof window !== 'undefined' &&
  (window.__BACKEND_URL__ || window.localStorage.getItem('__BACKEND_URL__')))
  || process.env.REACT_APP_BACKEND_URL || DEFAULT_BACKEND_URL;
```

localStorage is consulted **before** the build-time env var. Twenty-nine lines later, `:52-61`, the
request interceptor attaches `Authorization: Bearer <access_token>` to **every** request on that
client. The same override is re-implemented at `LayerAccessResolver.js:32-33` and
`useOpenMeteoForecast.js:153-154`.

⇒ One persisted localStorage string silently redirects **every API call, with the bearer token
attached**, to an arbitrary origin, and survives reloads, tab closes and browser restarts.

**Honest severity.** This is **not** a remote-exploitable vulnerability. Setting it requires script
execution on the origin — and an attacker with script execution can already read the token straight
out of `localStorage['raw-surf-user']`. What the override adds is (a) **persistence** far beyond the
payload's lifetime, (b) **silence** — no UI states that the backend has been swapped, and (c) a
**non-XSS vector**: a shared/kiosk machine, a malicious browser extension, or the "paste this in
the console to fix your map" social-engineering pattern that this codebase's own comments show
developers being told to use (`frontend/.env.local:4-6` instructs exactly that command). It is a
**post-compromise persistence primitive** and a **weather data-integrity** hole, not a blocker.

**Coverage check:** WS-CAN-0022 names *"persisted `force_*_fallback` keys"* as one of its four
residuals — so `force_marine_fallback` / `force_wind_fallback` are **covered**. `__BACKEND_URL__`
appears in no WS-CAN, no WS-OBJ and no SOTA row (checked WS-CAN-0022, 0020, 0063, WS-OBJ-301/504/506,
A11, B5, B6). **It survives.**

Also present and **not** weather: `isGodMode`, `impersonation_session`, `activePersona`,
`admin_commission_rates` are client-side localStorage keys with privilege-sounding names. Out of
scope; flagged for a general-app pass only.

---

## 9. Supply chain

### 9.1 Pinning census

| Manifest | Result |
|---|---|
| `backend/requirements.txt` | **41 / 41** pinned with `==` ✅ |
| `backend/requirements-dev.txt` | **5 / 5** pinned with `==` ✅ |
| `frontend/package-lock.json` | tracked, `lockfileVersion: 3` ✅ |
| `frontend/package.json` `dependencies` | 71 total — **68 caret ranges**, 3 exact |
| `frontend/package.json` `devDependencies` | 25 |

### 9.2 ⚠️ THE LOCKFILE IS COMMITTED AND THE PRODUCTION BUILD DOES NOT USE IT

| Lane | Install command | Honours lockfile? |
|---|---|---|
| **Netlify (both prod and dev deploys)** | `netlify.toml:3` → `npm install --legacy-peer-deps` | ❌ **no** — may resolve and rewrite |
| `.github/workflows/ci.yml:40,146,186` | `npm ci` | ✅ |
| `.github/workflows/e2e-tests.yml:105` | `npm ci` | ✅ |
| `.github/workflows/lighthouse.yml:30` | `npm ci` | ✅ |
| `.github/workflows/marine-nightly.yml:41` | `npm ci --no-audit --no-fund` | ✅ |

With 68 caret ranges, every Netlify build is free to resolve a different transitive tree from the
one all five CI lanes tested. **The artifact CI grades and the artifact users receive are not
built from the same dependency resolution.**

**Coverage check.** SOTA **A18** ("Users receive the tested artifact") and WS-CAN-0039 / WS-OBJ-104
are about **build identity** — *"Production build identity within one release of HEAD"*, remaining
work *"OWNER DECISION ONLY: unfreeze"*. Closing A18 makes the *commit* match; it does **nothing**
about the dependency tree. The two are independent, and A18 would read ✅ MET with this open.
**It survives.**

(Also on that line: `CI=false` suppresses CRA's treat-warnings-as-errors for the deploy build only.
Minor, noted.)

### 9.3 `npm audit` — 46 advisory-bearing packages, and the program has never looked

Run read-only, `npm audit --json`, no `--fix`:

```
{'critical': 2, 'high': 22, 'moderate': 8, 'low': 14, 'info': 0, 'total': 46}
```

Criticals: `shell-quote`, `websocket-driver`.
Highs include: `axios`, `react-router`, `nth-check`, `postcss`, `serialize-javascript`, `svgo`,
`ws`, `js-yaml`, `form-data`, `fast-uri`, `nanoid`, `brace-expansion`, `underscore`,
`workbox-build`, `workbox-webpack-plugin`, `react-scripts`, `rollup-plugin-terser`, `bfj`,
`css-select`, `jsonpath`, `@svgr/*`.
Moderates include `webpack-dev-server` ("source code may be stolen when they access a malicious web
site") and `launch-editor` ("NTLMv2 hash disclosure via UNC path handling **on Windows**").

**Triage — and this is where the honest reading matters.** The overwhelming majority of the 22 highs
and both criticals are **build-time / dev-server transitives of `react-scripts` 5.0.1**, which is
the exactly-pinned CRA build toolchain. They are **not** in the shipped runtime bundle. The two
runtime-dependency highs both fail to apply:

- `axios ^1.8.4` — the advisory is *"Node HTTP adapter can use an inherited proxy…"*; the browser
  adapter is used here.
- `react-router` — *"Arbitrary Constructor Injection via `deserializeErrors()` in React Router
  **SSR**"*; this is a CRA single-page app with no SSR.

⇒ Classify **Operational hardening / supply chain**, **not** an immediate security blocker. The two
that do bite are **developer-machine** risks and the team is on Windows: `webpack-dev-server`
source-theft and `launch-editor` NTLM disclosure both fire while `npm start` is running, which is
most of the working day.

The structural finding underneath the numbers: **`react-scripts` 5.0.1 (April 2022) is the last CRA
release; Create React App is retired.** The entire build toolchain that produces the weather bundle
is unmaintained, and it is the source of most of the 46. That is the "unmaintained dependency on the
weather path" item, and it has no exit condition anywhere in the program (SOTA **B2**: *"Every
migration has an exit condition"* — ❌ 0 of 3 — lists three dual paths; the build toolchain is not
one of them).

**Coverage check.** `grep -rilE 'npm audit|dependabot|CVE-|vulnerab'` across
`audit/weather-simulation-12.0`, `audit/weather-simulation-12.1` and
`MASTER_WEATHER_SIMULATION_REPORT_11.0.md` → **zero files**; control C7 passed on the same command
shape (`measure-or-refuse` → 3 files). **Six audits, no dependency-security dimension.**
The **only** security row in the entire program is WS-OBJ-703 → WS-CAN-0021, scoped to one
credential in one markdown file. **It survives.**

### 9.4 `@openmeteo/weather-map-layer ^0.0.19` owns the raster decode path

The om:// protocol, WASM `.om` decode and colour ramp for **every raster weather layer** run inside a
third-party package at version **0.0.19**. `^0.0.19` resolves to exactly `0.0.19` under npm's
0.0.x rule, so it is effectively pinned — but it is a pre-1.0, single-digit-patch dependency on the
critical rendering path, and §7 shows all malformed-`.om` handling is delegated to it. Recorded as a
**concentration-of-risk** observation, not a defect. WS-CAN-0060's fix (colour-scale key coverage,
closed `f3fe2c85`) already lives at exactly this seam.

---

## 10. Backend weather-route exposure

### 10.1 Authentication and rate limiting

`backend/routes/weather.py` route inventory: `/products` `:56`, `/grid_series` `:75`, `/grid` `:106`,
`/point` `:170`, `/spot-ratings` `:462`, `/buoy-calibration` `:626`, `/report-calibration` `:638`,
`/status` `:650`, `/capabilities` `:706`, **POST** `/client-diagnostics` `:715`, `/diagnostics-log`
`:758`.

Only `/diagnostics-log` is protected (`admin=Depends(get_current_admin)`, `:759`). Everything else,
**including the POST**, is unauthenticated — appropriate for a public weather API.

A rate limiter exists — `backend/core/rate_limiter.py` — and is applied in `auth_pkg/auth.py:14`,
`admin/content_mgmt.py`, `admin/system.py`. `grep -rnIl 'rate_limit' backend/routes/weather.py
backend/routes/surf_data/` → **zero rows**; control C5 passed (3 modules found).
⇒ **No weather route is rate limited**, including the unauthenticated write endpoint below and
`/api/conditions/batch` (WS-CAN-0064, p50 ≈ 52–59 s — an unauthenticated minute-long route is also
an amplification primitive, which that task frames purely as latency).

### 10.2 ⚠️ `POST /api/weather/client-diagnostics` — unauthenticated, unbounded, disk-writing, log-injectable

`backend/routes/weather.py:715-756`. Schema
`backend/services/weather_pipeline/schemas.py:328-337`:

```python
class ClientDiagnosticReport(BaseModel):
    timestamp: datetime
    event_type: str                              # no max_length
    model: Optional[str] = None                  # no max_length
    layer: Optional[str] = None                  # no max_length
    timeOffset / fps / memory: Optional[float]
    correlationId: Optional[str] = None          # no max_length
    details: Optional[Dict[str, Any]] = None     # arbitrary nesting, no size bound
```

Four properties compound:

1. **Unauthenticated + unrate-limited** (§10.1) and reachable from any allowed origin (§4.1).
2. **It writes to disk on every call**, appending to
   `Path(__file__).parent.parent / "diagnostics.log"` (`:741`, via `asyncio.to_thread`). No size
   cap, no rotation, no retention. The file already exists in-tree (`backend/diagnostics.log`).
3. **Log injection.** `event_type` is a raw `str` interpolated straight into the line —
   `f"[CLIENT-DIAGNOSTIC] Type: {report.event_type} | …"` (`:723`) — and Python does **not** escape
   newlines in a raw `str`. A newline in `event_type` forges arbitrary additional log lines, into
   both `diagnostics.log` **and** the `logger.error` / `logger.warning` stream (`:736-739`).
   (`details` is a `Dict`; its `repr` escapes newlines, so that field is not a vector.)
4. **The forged content is served to an admin.** `GET /diagnostics-log` (`:758-759`) reads that same
   file back for `get_current_admin`.

Also at `:755`: `raise HTTPException(status_code=500, detail=f"Failed to save diagnostic:
{str(e)}")` — a raw exception string on the wire. This is the WS-CAN-0009 class ("stop leaking
`str(e)`") but at a **different file**: that task's `Current Files / Symbols` is
`backend/routes/surf_data/conditions.py` with nine sites (I counted **8** `str(e)` occurrences there
at HEAD). `weather.py` has **1**, and no task names it.

**Why this matters now, not later.** This endpoint is **the only client-to-server transport in the
system** — WS-CAN-0020 says so verbatim, and **WS-OBJ-504 is the objective to scale it into a full
telemetry uplink**. WS-CAN-0020's stated shape is *"fixed cardinality, modelled on
request_telemetry"* — cardinality is about metric explosion; it says nothing about auth, field
bounds, log injection or unbounded disk writes. WS-CAN-0063 (closed, `69ac3ddb`) fixed the *honesty*
of one field on this endpoint, not its *exposure*. ⇒ Hardening belongs **before** the uplink is
built, not after.

---

## 11. Full classification table

| Item | Classification | Register coverage |
|---|---|---|
| Qdrant credential at `BRAIN_RULES.md:200` | Immediate security blocker (governance) | **WS-CAN-0021 / WS-OBJ-703** ✅ covered |
| Same credential at `.antigravityrules:201` | Immediate security blocker (governance) | WS-CAN-0021 **file list incomplete** → expand |
| Google API key at `frontend/eslint_errors.json:1` | General app concern | **uncovered** → add to WS-CAN-0021 |
| No secrets in the shipped weather bundle | ✅ verified clean | n/a |
| Source maps served on prod **and** dev (HEAD) | Operational hardening | **uncovered** |
| No CSP / XFO / Referrer-Policy / Permissions-Policy | Operational hardening | uncovered (general app) |
| `allow_origin_regex` `*.netlify.app` + `allow_credentials` | Operational hardening (latent) | uncovered — de-fanged by bearer auth |
| Duplicated CORS regex `server.py:488` vs `:510` | Operational hardening | uncovered (trivial) |
| weather-proxy open + `ACAO:*`, app-quarantined | Operational hardening | uncovered |
| 32-bit proxy cache key | Data-integrity risk | uncovered — low reach (quarantined path) |
| Service-worker poisoning | ✅ **refuted** | n/a |
| SW substring host matching | Operational hardening (class of WS-CAN-0059) | not exploitable — no finding |
| Client marine-cache validation | ✅ adequate | n/a |
| Git-tracked `forecast_cache/*.json` as live fallback | Data-integrity risk | **WS-CAN-0017 surface list incomplete** → expand |
| `_fetch_message_bytes` accepts bare 200 | Data-integrity risk | **WS-CAN-0017** ✅ fully covered |
| Decode-worker truncation guards | ✅ present | WS-CAN-0008 ✅ covered |
| `forecast-decode-worker.js` dead | Hygiene | uncovered (trivial) |
| `eval` / `new Function` | ✅ zero | n/a |
| `dangerouslySetInnerHTML` on weather surface | ✅ static, no interpolation | n/a |
| `JSON.stringify` into `ld+json` ×7 | General app concern | uncovered, not weather |
| `verify=False` / `shell=True` / `pickle` | ✅ zero (controls passed) | n/a |
| TruthOverlay prod gate | ✅ **Not applicable — by design** | n/a |
| 433 ungated `window.__RAW_*` globals | Not applicable (documented kill-switch design, SOTA B12 ✅) | n/a |
| `localStorage.__BACKEND_URL__` redirects bearer-authed calls | Data-integrity risk / post-compromise persistence | **uncovered** |
| `force_*_fallback` persisted keys | Data-integrity risk | **WS-CAN-0022** ✅ covered |
| No rate limiting on any weather route | Operational hardening | uncovered |
| `client-diagnostics`: unbounded, log-injectable, disk-writing | Data-integrity risk / Operational hardening | **uncovered** — and WS-OBJ-504 plans to scale it |
| `str(e)` on `weather.py:755` | Operational hardening | WS-CAN-0009 class, **different file** |
| Netlify `npm install` vs CI `npm ci` | Operational hardening / supply chain | **uncovered** — A18 does not reach it |
| 46 advisory-bearing deps (2 crit / 22 high) | Operational hardening / supply chain | **uncovered — zero prior coverage in 6 audits** |
| `react-scripts` 5.0.1 / CRA retired | Operational hardening / supply chain | uncovered; SOTA B2 lists 3 dual paths, not this |
| `@openmeteo/weather-map-layer` 0.0.19 on the decode path | Operational hardening (concentration) | uncovered — observation only |

---

## 12. What I tried to raise and killed

Recorded because a suppressed candidate is a first-class result of an anti-inflation audit.

1. **"Secrets are shipped in the weather bundle."** Killed by direct measurement of the live HEAD
   bundle (§1.4): one Mapbox `pk.`, zero of everything else.
2. **"The `*.netlify.app` CORS wildcard is a session-hijack blocker."** Killed: no cookie auth
   anywhere, no `credentials: 'include'`, bearer-header only (§4.1).
3. **"The service worker can be poisoned via `postMessage`."** Killed: the URL is reconstructed
   same-origin and hardcoded (§5.2). Also, weather never enters the SW at all.
4. **"The diagnostics HUD is exposed in production."** Killed: a documented, fail-closed prod gate
   has been in place since 2026-07-19 (§8.3).
5. **"433 ungated debug globals is a finding."** Killed: this is the program's documented
   kill-switch discipline, which SOTA **B12** marks ✅ MET and names a strength (§8.4).
6. **"Byte-range GRIB fetch has no length validation."** Real, but killed as *new* — it is verbatim
   WS-CAN-0017's remaining work, down to "one site, three copies" (§6).
7. **"`str(e)` leaks on weather routes."** Reduced from a finding to a footnote — WS-CAN-0009 owns
   the class; only 1 site exists outside its named file (§10.2).
8. **"The frontend localStorage marine cache is unvalidated."** Killed: shape, model, layer,
   provider and time-array checks all present (§5.3).
9. **"npm audit's 2 criticals / 22 highs are a security blocker."** Reduced honestly: nearly all are
   build-time `react-scripts` transitives; the two runtime highs are Node-adapter- and SSR-specific
   and do not apply here (§9.3).

---

## 13. Commands of record

```bash
git ls-files | grep -iE '(^|/)\.env'
git ls-files -z | xargs -0 grep -nIE 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'
git ls-files -z | xargs -0 grep -nIE '(sk-…|ghp_…|AKIA…|AIza…|xox[baprs]-…|sk_live_|…)'
grep -rnoE "process\.env\.[A-Z_0-9]+" frontend/src | awk -F: '{print $NF}' | sort | uniq -c
grep -rhoE '__(RAW|OM|WEATHER|MARINE)_[A-Z0-9_]+__' frontend/src | sort -u | wc -l      # 433
find frontend/build -name '*.map' | wc -l                                               # 105
curl -s -o /dev/null -w '%{http_code} %{size_download}' <deploy>/static/js/main.*.js.map
curl -s -D - -o /dev/null https://dev--rawsurf.netlify.app/
curl -s -o /dev/null -w '%{http_code}' https://dev--rawsurf.netlify.app/.netlify/functions/weather-proxy
grep -rnI 'set_cookie\|request.cookies\|SessionMiddleware' backend --include='*.py'
grep -rnIl 'rate_limit' backend/routes/weather.py backend/routes/surf_data/
git ls-files backend/uploads/forecast_cache/ ; git status --short backend/uploads/forecast_cache/
for f in requirements.txt requirements-dev.txt; do … grep -cE '==' … ; done             # 41/41, 5/5
grep -rnI 'npm ci\|npm install' netlify.toml .github/workflows/*.yml
cd frontend && npm audit --json        # READ-ONLY. --fix was NOT run.
```
