# AUDIT 12.2 — AREA §19: DEPLOYMENT + OPERATIONAL READINESS

**Raw source inventory.** Repo `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`.
Read-only pass. Nothing outside this evidence directory was written.

⚠️ **Method note up front.** This inventory was built from the deployment artifacts themselves
(`.github/workflows/*.yml`, `netlify.toml`, `render.yaml`, `frontend/public/_headers`,
`frontend/public/_redirects`, `frontend/craco.config.js`, `frontend/playwright.config.js`,
`frontend/update-sw-version.js`, `frontend/public/service-worker.js`, `backend/routes/health.py`,
`backend/server.py` lifespan, `backend/scripts/uptime_probe.py`) **before** the 12.1 registers were
opened, then diffed against them. Every "there is no X" below is paired with a positive control
executed in the same command — the controls are recorded inline so the search technique can be
audited, not just its result.

---

## 0. THE ONE-PARAGRAPH SHAPE OF THE SYSTEM

There is **no deployment pipeline in this repository.** Deployment is performed by two external
providers wired to git refs, and nothing in `.github/workflows/` can start, stop, gate, delay or
reverse either of them.

* **Backend** — Render web service `Raw-Surf-Antigravity` (`srv-d7fhiu7lk1mc73debje0`), auto-deploys
  every push to `dev`. Its configuration lives **only in the Render dashboard**; `render.yaml`
  is documentation (its own header records three independent proofs that the Blueprint is not
  applied).
* **Frontend** — Netlify site `rawsurf`, git-connected. `main` → production alias (frozen at
  `3bd38a83`, 2026-05-20), `dev` → `dev--rawsurf.netlify.app`.
* **Data plane** — a third delivery path that touches neither provider: GitHub Actions cron lanes
  write weather products and precomputed spot ratings into Supabase Storage, and the browser reads
  `spot_ratings/latest.json` **directly off the Supabase CDN**.

Consequence: three release surfaces with three different cadences, three different rollback
stories, and one shared production backend.

---

## 1. WORKFLOW CENSUS — all 27 files in `.github/workflows/`

Counted with `ls -1 .github/workflows/*.yml | wc -l` → 27. Triggers extracted per file with
`sed -n '/^on:/,/^[a-z]/p' | grep -E '^\s{2,}(push|pull_request|schedule|workflow_dispatch|workflow_run|repository_dispatch):|cron:|branches:'`.

| # | file | trigger | class |
|---|---|---|---|
| 1 | `artifact-interpreter-parity.yml` | dispatch only | evidence probe |
| 2 | `build-bathymetry.yml` | dispatch only | asset build (git-pushes an asset) |
| 3 | `build-shore-normals.yml` | dispatch only | asset build (git-pushes an asset) |
| 4 | `ci.yml` | push `[dev, main]`, PR `[dev, main]` | test/guard lane, 12 jobs |
| 5 | `data-health-monitor.yml` | cron `*/30 * * * *` | monitor |
| 6 | `discover-spot-candidates.yml` | dispatch only | data tooling |
| 7 | `e2e-tests.yml` | push `[dev]` (paths-ignore md/docs/audit), dispatch | **post-deploy** browser lane |
| 8 | `ecmwf-band-closure-probe.yml` | dispatch | probe |
| 9 | `ecmwf-ensemble-decode-verify.yml` | dispatch | probe |
| 10 | `ecmwf-ensemble-full-horizon-cost.yml` | dispatch | probe |
| 11 | `ecmwf-ensemble-key-probe.yml` | dispatch | probe |
| 12 | `ecmwf-ensemble-mean-vs-deterministic.yml` | dispatch | probe |
| 13 | `encoding-check.yml` | push `[dev, main]`, PR, dispatch | guard |
| 14 | `forecast-accuracy-monitor.yml` | cron `5 1,7,13,19 * * *` | monitor (the paired accuracy gate) |
| 15 | `forecast-calibration-census.yml` | cron `35 2,8,14,20 * * *` | monitor |
| 16 | `forecast-ingest-pilots.yml` | cron `45 3,11,19 * * *`, dispatch | **writes L2** |
| 17 | `forecast-ingest.yml` | cron `15 */4 * * *`, dispatch | **writes L2** |
| 18 | `keep-warm.yml` | cron `*/5 * * * *`, dispatch | liveness pinger |
| 19 | `l2-orphan-sweep.yml` | dispatch | L2 maintenance |
| 20 | `lighthouse.yml` | push `[dev, main]`, PR | perf report (all assertions `warn`) |
| 21 | `loc-check.yml` | push `[dev, main]`, PR | governance (has a `paths:` filter ⇒ NOT a required check) |
| 22 | `marine-nightly.yml` | cron `30 6 * * *`, dispatch | contract + zoomlab |
| 23 | `precompute.yml` | cron `45 3-23/4 * * *`, dispatch | **writes `spot_ratings/latest.json`** |
| 24 | `python-upgrade-readiness.yml` | dispatch | probe |
| 25 | `science-shadow-ab.yml` | dispatch | shadow A/B |
| 26 | `sim-parity-monitor.yml` | cron `20 5,11,17,23 * * *`, dispatch | monitor |
| 27 | `vector-blockmean-parity.yml` | dispatch | probe |

**Absence claims, each with its control:**

* `grep -rn "^\s*environment:" .github/workflows/*.yml` → **0 hits.**
  Control: `grep -rc "permissions:"` on the same glob returns non-zero for 5+ files.
  ⇒ **No GitHub Environment protection rule exists anywhere**, so no required reviewer, no wait
  timer, and no deployment-branch policy can be attached to anything.
* `grep -rn "workflow_run" .github/workflows/*.yml` → **0 hits.**
  Control: `workflow_dispatch` appears in 25 of 27 files.
  ⇒ **No workflow is chained to the success of another.** Every lane fires independently on the
  push event, in parallel with the two provider deploys.
* `ls .github/CODEOWNERS .github/settings.yml` → absent.
  Control: `ls -a .github/` returns `loc-baseline.json` and `workflows/`.
  ⇒ No repo-side declaration of branch protection or review requirement.
* `ls docs/runbooks | grep -iE "deploy|incident|rollback|release|ops|oncall|runbook"` → returns only
  `HANDOFF-2026-08-04-what-actually-stops-the-word-good.md` and
  `OPS-2026-07-29-trevec-index-consumed-437gb.md`, neither of which is a deploy procedure.
  Control: `ls docs/runbooks | grep -c HANDOFF` → **149**.
  ⇒ **No deploy, rollback, or incident runbook exists** in a directory that contains 172 documents.

**Deploy cadence.** `git log --oneline --since="14 days ago" dev | wc -l` → **654 commits over 15
distinct commit-days** (`git log --format=%ad --date=short --since="14 days ago" dev | sort -u | wc -l`
→ 15). Commits are not pushes, so this is an upper bound on deploys and a lower bound on nothing;
the previously measured figure of 9 deploys in 2h41m on 2026-08-10 is the direct observation. Either
way the backend production service is redeployed on the order of tens of times per day with no gate.

---

## 2. THE PRE-DEPLOY CONTROL SURFACE — what actually can and cannot stop a release

### 2a. `ci.yml` — 11 jobs, none of them a gate on deployment

`grep -nE "^  [a-zA-Z0-9_-]+:$" .github/workflows/ci.yml` returns **13** lines; two of them
(`push:` at 15 and `pull_request:` at 17) are the trigger block, not jobs, so the job count is
**11**. Naming them rather than quoting the raw count, because the raw count is wrong:

`lint-and-build` (21) · `frontend-lint` (131) · `frontend-marine-composition-guards` (170) ·
`backend-lint` (239) · `backend-file-size-check` (274) · `backend-import-check` (290) ·
`backend-bola-guard` (310) · `backend-sim-composition-guards` (337) ·
`backend-forecast-chain-guards` (633) · `backend-estate-coverage` (791) ·
`backend-floor-staleness` (1025).

The file's own header says these are deliberately kept free of `paths:` filters *"which is what
makes them safe to list as REQUIRED status checks"*. That is a statement about branch protection,
which lives on GitHub and not in this repo — and a required status check only gates a **pull
request merge**. The release trigger here is a **push to `dev`**, which Render consumes directly.
A required check cannot delay a push-triggered auto-deploy; it can only mark the commit red after
the fact.

### 2b. `e2e-tests.yml` runs strictly **after** the deploy, by design

Lines 63–95 wait up to 20 min for `dev--rawsurf.netlify.app/service-worker.js` to serve a
`BUILD_VERSION` prefixing the commit under test. Lines 138–155 then wait up to 15 min for
`raw-surf-antigravity.onrender.com/api/health` to report the same 40-hex SHA. Both waits **fail the
job** if the deploy never lands. That is excellent evidence hygiene — and it is definitionally a
**post-deploy smoke test**: by the time the first assertion executes, the change is already serving
every production user of the backend.

### 2c. The pre-push hook is local, fail-open and overridable

`.git/hooks/pre-push` (untracked; `.git/hooks` is not version-controlled — the hook file says so):

```
# Fails OPEN on any internal error. Override: git push --no-verify
"$PY" backend/scripts/check_floor_before_push.py || exit 1
```

`git config core.hooksPath` → unset. WS-CAN-0065's own register row states the hook *"is local and
unshareable by design"*. It checks a **test-count floor**, not the deployability of the change.

### 2d. `lighthouse.yml` cannot fail

`lighthouserc.json` — all four assertions are `["warn", …]`. `treosh/lighthouse-ci-action@v12` with
warn-only assertions exits 0. The workflow's own comment records *"20 of the last 20 runs
succeeded"*.

**Net: the only thing between an engineer's `git push origin dev` and every production user of the
weather backend is a local, fail-open, overridable hook that measures test counts.**

---

## 3. BACKEND DEPLOY SURFACE (Render)

### 3a. `render.yaml` is documentation, not configuration

Its header records three independent proofs (declared `RATING_TIDE` absent from the live env at the
time; service name mismatch `raw-surf-backend` vs `Raw-Surf-Antigravity`; `rootDir: backend` vs an
empty live rootDir). It declares 7 env vars. The live service was measured at **27**.

`git grep -n "healthCheckPath" -- .` → **0 hits.** Control: `git grep -n "startCommand" -- render.yaml`
→ `render.yaml:28`. ⇒ **No health-gated deploy promotion is declared anywhere in git.** Whether the
live service has one configured is unknowable from this repository — which is itself the WS-CAN-0040
problem.

The only production configuration change ever recorded in git is a comment:

```
buildFilter = {"ignoredPaths": ["docs/**", "audit/**", "**/*.md"], "paths": null}
```

set via the Render API on 2026-08-10 because `autoDeploy=yes` with no filter meant a single-markdown
commit restarted the box under an in-flight E2E run (two deploys measured live at 17:28:30 and
17:32:10). Note what this establishes: **the deploy filter is the only deploy control that exists,
and it is a path filter, not a quality gate.**

### 3b. Startup failure behaviour — every weather failure is swallowed

`backend/server.py:419-470` (`lifespan`):

* `store.quarantine_invalid_copernicus_products()` → `except Exception: logger.error(...)`
* `store.restore_from_supabase()` → `except Exception: logger.error(...)`
* `prefetch_supabase_products()` → `except Exception: logger.error(...)`
* `run_background_cache_population()` → `except Exception: logger.error(...)`

and the last two run inside `asyncio.create_task(run_startup_tasks())`, i.e. **after** the app has
already yielded and bound the port. The comment at `server.py:19` states this is deliberate: *"shifted
to the lifespan function to avoid blocking port binding and causing Render health check failures."*

⇒ A deploy whose L2 restore fails completely still binds its port, still passes any port-based or
`/api/health`-based promotion check, and replaces the previously healthy instance.

### 3c. `/api/health` cannot express weather-unreadiness

`backend/routes/health.py:186-283`. The response includes `weather_readiness` (`product_count`,
`restore_status`, `restored_count`, `restore_errors`, `disk_product_count`, `supabase_product_count`)
— and `health_data["checks"]` is appended to in exactly two places: the **database** block
(`:243`) and the **scheduler** block (`:262`/`:270`). `health_data["status"]` is only ever demoted by
those two. `weather_readiness` is reported and never graded.

The endpoint returns a plain dict ⇒ **HTTP 200 always**, including when `status == "unhealthy"`.
`/api/health/simple` returns a literal `{"status": "ok"}` with no probe at all.

The compensating instrument exists and is good: `backend/scripts/uptime_probe.py:120-131` explicitly
REDs on `product_count <= 0` — *"ZERO PRODUCTS — the service is up and serving nothing … HTTP 200
would hide this completely."* But WS-CAN-0025's own row says it is **not scheduled anywhere**, and
`keep-warm.yml` (the only thing that actually polls `/api/health` on a schedule) grades only
`%{http_code} = 200`.

---

## 4. FRONTEND DEPLOY SURFACE (Netlify)

### 4a. `netlify.toml`

```
[build]  base = "frontend"
         command = "node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build"
         publish = "build"
[build.environment] NODE_VERSION = "18.20.2"   # Node 18 has been EOL since 2025-03-27
                    NODE_OPTIONS = "--openssl-legacy-provider"
                    REACT_APP_BACKEND_URL = "https://raw-surf-antigravity.onrender.com"
[context.production] ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- frontend/src frontend/public netlify.toml"
[context.dev]        ignore = "false" ; REACT_APP_BACKEND_URL = <same Render host>
[context.branch-deploy]                REACT_APP_BACKEND_URL = <same Render host>
```

**All three contexts point at the same backend.** `git grep -ohE "https://[a-z0-9-]+\.onrender\.com"`
returns exactly one distinct host, 236 times. There is **no staging backend**.

**The production `ignore` filter watches `frontend/src`, `frontend/public` and `netlify.toml` only.**
It does not watch `frontend/package.json`, `frontend/package-lock.json`, `frontend/craco.config.js`
or `frontend/update-sw-version.js`. A `maplibre-gl` or `@openmeteo/weather-map-layer` bump — which
changes what the weather map renders — is invisible to it.

⛔ **Do not re-run the dead theory.** The 2026-08-05 memory record shows this `ignore` rule was
already proposed as the cause of the production freeze and **refuted** by a decisive control: `main`
and `dev` sat on the identical commit `01df62d7`, dev built and production did not. The finding
recorded above is a *different* claim — a latent filter gap that will bite the moment WS-CAN-0039
closes — and it must not be restated as the freeze's cause.

### 4b. Two overlapping redirect declarations

`netlify.toml` `[[redirects]]`:
`/api/weather-proxy → /.netlify/functions/weather-proxy 200`, then `/api/* → <render>/api/:splat 200`.
`frontend/public/_redirects`: `/api/* → <render>/api/:splat 200`, then `/* → /index.html 200`.

Netlify processes `netlify.toml` rules before `_redirects`, so `/api/weather-proxy` reaches the
function today by ordering alone. The `/api/*` rule is declared **twice, in two files**; the SPA
fallback exists only in `_redirects`; the function hop exists only in `netlify.toml`. This is a
latent single-authority violation on the routing surface, not a live defect.

### 4c. Build-time weather switches, and where their production values live

`grep -rhoE "process\.env\.REACT_APP_[A-Z0-9_]+" frontend/src/ | sort | uniq -c`:

| var | uses | set in `netlify.toml`? |
|---|---|---|
| `REACT_APP_BACKEND_URL` | 14 | yes (all 3 contexts) |
| `REACT_APP_SUPABASE_URL` | 6 | no (Netlify UI) |
| `REACT_APP_SUPABASE_ANON_KEY` | 5 | no (Netlify UI) |
| `REACT_APP_USE_BACKEND_WIND` | 2 | **no** |
| `REACT_APP_USE_BACKEND_WEATHER` | 2 | **no** |
| `REACT_APP_USE_BACKEND_MARINE_SYSTEM` | 2 | **no** |
| `REACT_APP_USE_BACKEND_ICON_MARINE` | 2 | **no** |
| `REACT_APP_USE_BACKEND_COPERNICUS` | 2 | **no** |
| `REACT_APP_RATINGS_CDN` | 1 | **no** |
| `REACT_APP_MAPBOX_TOKEN`, `REACT_APP_GIPHY_API_KEY` | 1 each | no |

Five of these change **which weather data source the map reads**. None is set in `netlify.toml`, so
each falls to its code default, baked into the artifact at build time
(`frontend/src/components/map/backendWeatherServiceClient.js:66-180`). The runtime overrides that
exist alongside them (`window.__USE_BACKEND_*__`, `localStorage`) are **per-browser** — a developer
lever, not an operator lever.

### 4d. Service-worker versioning and cache invalidation

`frontend/update-sw-version.js` stamps `git rev-parse --short HEAD` into **both**
`public/service-worker.js` (`BUILD_VERSION`) and `src/buildVersion.js`. It runs twice per Netlify
build (once as the shell command, once as npm `prebuild`) — harmless, idempotent.

`frontend/public/service-worker.js`:
* every cache name is suffixed with `BUILD_VERSION` **except** `GALLERY_CACHE_NAME`
  (`rawsurf-gallery-offline-v1`, deliberately persistent, gallery media only — no weather content).
* `install` → `self.skipWaiting()` unconditionally; `activate` → `self.clients.claim()`; old cache
  keys deleted in `activate`.
* `STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/offline.html']` — **no JS/CSS chunk is
  precached**, so the SW cannot pin a stale bundle.
* the `fetch` handler **excludes** `open-meteo.com`, `rainviewer`, `tiles.`, `tile.`, `maplibre`,
  `.om`, the `om` protocol, and any path containing `/marine` or `/weather`. ⇒ the weather data
  plane never passes through the SW at all.
* navigation is network-first with `/offline.html` → `/index.html` fallback.

`frontend/public/_headers`:
```
/static/js/*  Cache-Control: public, max-age=31536000, immutable
/static/css/* Cache-Control: public, max-age=31536000, immutable
/index.html   Cache-Control: no-cache, no-store, must-revalidate
/*            Cache-Control: no-cache ; X-Content-Type-Options: nosniff
```
Correct hashed-asset policy. Note it also grants **`/static/js/*.map` a one-year immutable cache**.

`frontend/src/index.js:314-345` unregisters the SW and purges `rawsurf-*` caches on localhost; on
deployed hosts it registers and calls `registration.update()` hourly.

### 4e. SOURCE MAPS ARE PUBLISHED

* `git grep -n "GENERATE_SOURCEMAP" -- .` → **1 hit, in a 2026-07-22 handoff prose line only**;
  no build config sets it. Control: `git grep -n "NODE_VERSION" -- netlify.toml` → `netlify.toml:7`.
* CRA 5 defaults `GENERATE_SOURCEMAP=true`; `craco.config.js` does not override it, and there is no
  tracked `.env`/`.env.production` (`git ls-files | grep -i "\.env"` → **0 tracked env files**; only
  an untracked `frontend/.env.local` exists locally).
* Local artifact of the same command: `ls frontend/build/static/js/*.map | wc -l` → **99 files**,
  `du -ch frontend/build/static/js/*.map | tail -1` → **32 MB**.
* `tail -c 120 frontend/build/static/js/main.*.js` → `//# sourceMappingURL=main.afa2b42b.js.map`.
* No `_headers` or redirect rule excludes `*.map`.

⇒ The Netlify origin serves complete, unminified frontend source for the weather map — every flag
name, every internal endpoint shape, every `window.__RAW_*__` override key — at a 1-year immutable
cache. No credential values were observed in the maps and none were extracted; the exposure is
source and internal-surface disclosure, plus 32 MB per deploy.

### 4f. Worker and lazy-chunk asset paths under the production build

* `frontend/src/components/map/useGridWorker.js:25` — `new Worker(new URL('./GridParserWorker.js',
  import.meta.url))`. Webpack 5 emits this as its own chunk. Failure is **handled**: an `onerror` /
  `onmessageerror` handler (added at R11-07) rejects all pending parses, terminates, nulls the
  instance so the next call re-creates it, and its comment explicitly names *"a deploy race serving
  a dead chunk"* as one of the causes.
* `frontend/src/hooks/useSessionTracker.js:22` — `new Worker(new URL('../workers/gpsWorker.js',
  import.meta.url))`. Not weather.
* `frontend/src/components/map/openMeteoProtocol.js:513` —
  `import('@openmeteo/weather-map-layer').then(({ omProtocol, defaultOmProtocolSettings, GridFactory }) => { … })`
  closing at **line 915** with `});`. **There is no `.catch()` on this chain.** Verified by
  `awk 'NR>513 && /^  \}\)/ {print NR": "$0; exit}'` → `915:   });`.
  The last statement inside is `setProtocolReady(true)` (`:914`).
* That import is a real, separately-emitted chunk: `grep -l "omProtocol" build/static/js/*.chunk.js`
  → `2486.14607771.chunk.js` (194 KB) and `6770.db8f084f.chunk.js` (**1.38 MB**).
* `setProtocolReady` is `useState` in `useOpenMeteoTileUrls.js:44`, registered once in a
  `useEffect(..., [])` at `:331` — **no retry** — and consumed at `MapWebGL.js:852`:
  `return protocolReady && Object.keys(LAYER_REGISTRY).filter(…)`.
* `frontend/src/components/routing/ErrorBoundary.js:37-58` auto-reloads once on `ChunkLoadError` /
  `"Loading chunk"` / `"Failed to fetch dynamically imported module"` — but a React error boundary
  cannot observe a rejected promise outside the render path, so it cannot see this one.
* The only global handler, `frontend/src/index.js:200-207`, filters for `AbortError`/`DOMException`
  and lets everything else through to the console.

⇒ **If that 1.38 MB chunk 404s** — the exact stale-hash-after-deploy scenario the ErrorBoundary was
written for — the promise rejects unhandled, `protocolReady` stays `false` for the session, and
`MapWebGL.js:852` creates **zero `om://` raster sources.** No error UI, no telemetry, no refusal.
This is a silent-blank mechanism distinct from WS-CAN-0060 (colour-scale key miss) and WS-CAN-0061
(layer order): in those the layer exists and paints transparent; here the layer is never created.

---

## 5. THE DATA PLANE AS A RELEASE SURFACE

`backend/services/weather_pipeline/store.py:21-35` (`manifest_cache_control`) classifies L2 keys by
mutation class:

| key class | CDN max-age | mutability |
|---|---|---|
| `manifest.json` | `0` | hot-mutating registry |
| `manifests/…` | `3600` | **run-keyed, immutable per filename** |
| `spot_ratings/…`, `calibration/…` | `60` | **mutating state blobs, re-uploaded in place** |
| top-level product files | `3600` | immutable (`valid_time` in the name) |

`store.py:41-63` — the DESIGNATED-WRITER gate (`L2_WRITER=1`) exists precisely because these are *"a
single shared mutable dataset with NO concurrency control … last-writer-wins"*, after a live incident
on 2026-07-11. **Its scope is explicitly "top-level keys only"**; the namespaced state blobs
`calibration/…` and `spot_ratings/…` are *"serve-box-writable and stay ungated."*

Single-key blobs, overwritten in place, with **no run-keyed twin**:
* `spot_ratings/latest.json` — `services/weather_pipeline/spot_ratings.py:33`
* `calibration/buoy_latest.json` — `services/weather_pipeline/buoy_calibration.py:25`, whose own
  comment at `:517` states it is *"a SINGLE KEY, overwritten on every CI run, so exactly one snapshot
  exists at [any time]"*
* `calibration/report_latest.json` — `services/weather_pipeline/report_calibration.py:27`
* `spot_ratings/size_climatology.json`, `spot_ratings/grid_size_climatology.json`

Positive control for the absence claim: `manifests/…` **does** carry run-keyed immutable copies, and
the same `manifest_cache_control` function is where both facts are stated. So the search technique
does find versioned twins where they exist; it finds none for the ratings blob.

`frontend/src/components/map/spotRatingsCdn.js` reads `spot_ratings/latest.json` **directly from the
Supabase CDN** with the anon key under a scoped RLS policy, and runs a **1:1 JS port** of the
backend's `select_precomputed_laddered` ladder (`:24-32`, `:67+`). So the browser's copy of a
selection algorithm is a fourth thing that can drift from the backend's, released on the Netlify
cadence while the object it reads is released on the precompute cron cadence.

### What "rollback" would actually mean here

| you roll back | what returns | what does not |
|---|---|---|
| Render to a prior deploy | serve code | env vars (dashboard-only, unversioned); `spot_ratings/latest.json`; `calibration/*_latest.json`; every product already registered in `manifest.json` |
| Netlify to a prior deploy | the whole frontend artifact | the backend it talks to (shared, single) |
| a git revert on `dev` | serve code **and**, on the next cron tick (up to 4 h), the ingest/precompute lanes | the durable blobs already overwritten between the bad deploy and the revert |

No document in `docs/runbooks/` describes any of the three. No commit or document names a
"known-good" SHA to roll back **to** for the backend.

---

## 6. CANARY / PHASED ROLLOUT

`grep -rn -i "canary" audit/weather-simulation-12.1/` returns six references, all pointing at
**WS-CAN-0044** — `p2.py:556-561` target-before-exclude precedence inversion, register state *"Zero
callers today. … Fix before any canary is wired."*

⇒ There is a rollout **evaluator** in the codebase with a known inverted precedence and no callers,
and there is no rollout **mechanism** at all. Render auto-deploy is all-or-nothing: one instance,
one revision, 100% of traffic instantaneously. Netlify's production alias is likewise all-or-nothing.
This is correctly captured by WS-CAN-0044's disposition; what is *not* captured anywhere is that the
absence of any percentage-rollout capability is itself an accepted operating position.

---

## 7. ENVIRONMENT VARIABLES THAT CHANGE WEATHER **BEHAVIOUR**

`grep -rn -oE "os\.(environ\.get|getenv)\(\s*[\"'][A-Z0-9_]+[\"']" --include=*.py backend/` yields
**358 distinct names** (`sort -u | wc -l`). Filtering to prefixes that gate forecast science,
ingestion, rating or rendering (`SURF_`, `RATING_`, `MARINE_`, `WIND_`, `GFS_`, `EURO_`, `ICON_`,
`WAVES_`, `FORECAST_`, `SIM_`, `POINT_`, `SPOT_`, `WORLDWIDE_`, `BUOY_`, `FETCH_`, `OPEN_METEO`,
`USE_WEATHER`, `VIEWPORT_`, `SHORE_`) gives **201 names**
(`grep -cE "^(SURF_|RATING_|MARINE_|WIND_|GFS_|EURO_|ICON_|WAVES_|FORECAST_|SIM_|POINT_|SPOT_|WORLDWIDE_|BUOY_|FETCH_|OPEN_METEO|USE_WEATHER|VIEWPORT_|SHORE_)"`
against the deduplicated list). That 201 is a **prefix filter, not a semantic judgement** — a few
entries in it are timeouts or concurrency caps rather than science switches, and a few science
switches outside those prefixes (`L2_WRITER`, `DISABLE_FORECAST_SCHEDULER`, `RENDER`) are excluded
by it. Treat it as the order of magnitude, not a certified count. The list includes
`SURF_HEIGHT_H110`, `SURF_REFRACTION_KR`,
`SURF_GAMMA_FIELD_CEILING`, `SURF_TIDE_DEPTH`, `SURF_PARTITIONS`, `RATING_TIDE`, `RATING_LOCAL_SIZE`,
`RATING_OBS_GATE`, `BUOY_CALIBRATION_MODEL`, `WORLDWIDE_REGIONS_PER_CYCLE`,
`MARINE_PHYSICS_VALIDITY`, `DISABLE_FORECAST_SCHEDULER`, `L2_WRITER`.

Whatever the exact count, it is two orders of magnitude above the **27** env vars measured on the
live Render service on 2026-08-10 — i.e. the overwhelming majority of weather behaviour in
production is running at a **code default**, which is at least knowable from git. The dangerous set
is the small number that are set on the box and therefore knowable nowhere.

These are declared in **four places that are not each other**:
1. `.github/workflows/forecast-ingest.yml` `env:` block,
2. `.github/workflows/precompute.yml` `env:` block,
3. `backend/routes/admin/surf_forecast.py` `_RATING_FLAGS` registry (the documentation table),
4. **the Render dashboard, which is not in git.**

`backend/tests/test_flag_lane_parity.py` guards 1–3 against each other and says so in its own
docstring: *"⚠️ Render's environment is not in git and CANNOT be checked here."*
`backend/scripts/check_env_parity.py:41-43` compares `ci.yml`'s Python against **`render.yaml`**,
and correctly annotates at `:92` *"⚠️ DECLARED is not MEASURED. render.yaml is a Blueprint and this
service may not be [synced]."* `/api/health.runtime.python` is the honest instrument for that one
question. There is no equivalent self-report for the ~190 behaviour flags.

This is the WS-CAN-0040 hole, already owned. Recorded here for completeness, not as a new gap.

---

## 8. WHAT HAPPENS TO THE FRONTEND WHEN THE BACKEND 5xxs

* Netlify's `/api/*` rule is a **CDN proxy**, status pass-through, with a ~26 s window
  (`netlify.toml` comment; the old `/.netlify/functions/weather` hop with a ~10 s sync limit was
  removed 2026-07-13 and must not be re-added).
* `frontend/netlify/functions/weather-proxy.js` is a *separate* lane for Open-Meteo grid POSTs with
  its own circuit breakers (`openMeteoCircuitUntil`, `copernicusCircuitUntil`) and a 30 min cache —
  it does not front the Render backend.
* `frontend/netlify/edge-functions/rvproxy.js` fronts RainViewer only, and explicitly never caches
  4xx/5xx so a frame self-heals.
* Detection / disclosure / recovery on a total weather-request failure is **WS-CAN-0036** with
  objective **WS-OBJ-103** and SOTA row **A14** (`⚠️ PARTIAL — disclosure only`). Already owned; not
  re-reported.

---

## 9. DIFF AGAINST THE 12.1 REGISTERS

### Already covered — do not re-open

| operational concern | covered by |
|---|---|
| Production frontend 85 days stale | WS-CAN-0039 / WS-OBJ-104 / SOTA **A18** |
| Live Render env unknowable | WS-CAN-0040 |
| Vercel app still installed, 8-of-8 failing | WS-CAN-0041 |
| Canary evaluator precedence inverted | WS-CAN-0044 (*"before any canary is wired"*) |
| Monitor delivery unmeasured; GitHub cron 5–32% of nominal | WS-CAN-0025 / WS-OBJ-505 |
| Backend-failure detection/disclosure/recovery in the UI | WS-CAN-0036 / WS-OBJ-103 / A14 |
| Build identity end to end (SW stamp, `/api/health` SHA, telemetry `build`) | WS-CAN-0003 + SOTA "Release identity end to end" |
| `/api/conditions/batch` ~1 min p50 | WS-CAN-0064 / WS-OBJ-302 / A16 |
| E2E lane runs and can fail; floor governance | WS-CAN-0059 + WS-CAN-0065 / WS-OBJ-705 |
| Playwright video retention | WS-CAN-0027 (closed `181b7ba7`) |
| `ChunkLoadError` after a deploy | **not a register row — already mitigated in code** at `ErrorBoundary.js:37-58`. Not a gap. |
| No remote kill switch for frontend weather layers | SOTA **B12**, whose criterion is "a kill switch and a control arm", satisfied by the `window`/`localStorage`/build-time triple. Remote operability is not in the criterion, and the operator lever that does exist — a rebuild — is gated by WS-CAN-0039. |

### Gaps that survived the attempt to kill them

Numbered `OPS-G1…G7`; full statements, proofs and dispositions are in the structured return. In
short:

* **G1** — the backend deploy has no gate of any kind (no `environment:`, no `workflow_run`, no
  CODEOWNERS, no deploy job; the only pre-push control is local, fail-open and count-based).
* **G2** — no rollback runbook, no named known-good point, and a code rollback does not restore the
  in-place-mutated durable weather artifacts.
* **G3** — source maps published to the production origin with a 1-year immutable cache.
* **G4** — `openMeteoProtocol.js:513` lazy import has no `.catch`; a chunk 404 silently suppresses
  every `om://` raster layer for the session.
* **G5** — no pre-production backend environment: all three Netlify contexts and the E2E lane share
  the single Render service.
* **G6** — `/api/health` `status` never reflects weather readiness, and every weather startup failure
  is swallowed, so no promotion check can see a boot that restored zero products.
* **G7** — `[context.production] ignore` does not watch `package.json` / `package-lock.json` /
  `craco.config.js`; a dependency bump that changes weather rendering will not trigger a production
  rebuild once WS-CAN-0039 closes.

---

## 10. EXHAUSTIVE FILE LIST TOUCHED (read-only)

```
.github/workflows/*.yml                        (all 27)
.github/loc-baseline.json                      (existence only)
.git/hooks/pre-push                            (untracked, read)
netlify.toml
render.yaml
lighthouserc.json
frontend/package.json
frontend/craco.config.js
frontend/playwright.config.js
frontend/update-sw-version.js
frontend/vercel.json
frontend/public/service-worker.js
frontend/public/_headers
frontend/public/_redirects
frontend/netlify/functions/weather-proxy.js
frontend/netlify/functions/weather-proxy-helpers.js   (imports only)
frontend/netlify/edge-functions/rvproxy.js
frontend/src/index.js
frontend/src/components/routing/ErrorBoundary.js
frontend/src/components/map/useGridWorker.js
frontend/src/components/map/openMeteoProtocol.js
frontend/src/components/map/useOpenMeteoTileUrls.js
frontend/src/components/map/MapWebGL.js               (line 852 only)
frontend/src/components/map/backendWeatherServiceClient.js
frontend/src/components/map/spotRatingsCdn.js
frontend/src/hooks/useSessionTracker.js
frontend/build/static/js/                             (artifact census only)
backend/server.py
backend/routes/health.py
backend/scripts/uptime_probe.py
backend/scripts/check_env_parity.py
backend/tests/test_flag_lane_parity.py
backend/tests/test_env_parity_instrument.py
backend/services/weather_pipeline/store.py
backend/services/weather_pipeline/spot_ratings.py     (constant only)
backend/services/weather_pipeline/buoy_calibration.py (constant + :517 comment)
audit/weather-simulation-12.1/*                       (registers)
docs/runbooks/                                        (listing + rollback grep)
```
