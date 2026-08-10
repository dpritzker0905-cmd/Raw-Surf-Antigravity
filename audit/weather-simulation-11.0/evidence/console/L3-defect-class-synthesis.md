# L3 — DEFECT-CLASS SYNTHESIS, CHECKED AGAINST THE REPO'S OWN HISTORY

**Lane 3 of the "lessons learned" research pass.** Read-only. 2026-08-09/10, working tree `dev`
at `19889a25` (audit HEAD; some code citations re-verified live at the working tree).

**Question asked:** for each of ten candidate failure SHAPES from the 11.0 audit — is it already in
`INDEX-defect-classes.md`, genuinely new, or a special case? What is the sharpest one-sentence form
and the cheapest detector? And **does the repo's own history contain a second, independent
instance** — because *a class with two independent instances is a LAW; a class with one is an
anecdote.*

**Evidence standard.** Every claim is a `file:line`, a commit SHA, or a quoted transcript/pack
line. Anything I did not execute says **NOT VERIFIED**.

---

## 0. ⛔ READ FIRST — three of these classes are ALREADY BANKED, this session

Before proposing anything, I checked the memory estate. **Three files dated 2026-08-09 already
exist and are already linked from both `MEMORY.md` and `INDEX-defect-classes.md`** (grep: 2 hits
each). Do not re-create them:

| file | covers, of my ten | gap it leaves |
|---|---|---|
| `a-refusal-you-cannot-read-is-a-pass-2026-08-09.md` | **(a)** in full — 5 mechanisms, the M1–M5 table, the two required-check instances, the `-rs` twin. **(h)** appears as ONE bullet (`precompute_ci.py:75-76` / `:53-55`) | (h) has no detector and no prior instance recorded; it is filed as an example, not as a shape |
| `the-census-is-the-defect-not-the-assertion-2026-08-09.md` | **(b)** in full (S-A / S-B sub-shapes, the AST-census fix), **(c)** as sub-shape S-B, **(i)+(j)** as "THE COUSIN SHAPE" | (c) has no instance list; (i)/(j) are a 9-line appendix on a file about registries — (j) in particular is a *working-practice* rule, not a registry rule |
| `verify-the-changed-lines-not-the-suite-2026-08-09.md` | the coverage lesson; item 6 mentions **(g)** in passing as "a producer/consumer field-name mismatch" | (g) is named and never defined; no instance list, no detector |

⇒ **The genuinely unhoused classes are (d), (e), (f), (g).** And one shape that unifies (c), (d)
and (h) exists **only in a commit body** and is in no memory file at all — see §3.

---

## 1. VERDICT TABLE

| # | Class | Verdict | Instances found in this repo | Status |
|---|---|---|---|---|
| a | A refusal you cannot READ is a pass | **ALREADY IN INDEX** (own file, 08-09) | 6+ (see §2a) | **LAW** |
| b | A registry is a CLAIM of completeness | **ALREADY IN INDEX** (own file, 08-09) | 5 | **LAW** |
| c | `assert len(REGISTRY) >= N` | **SPECIAL CASE of (b)**, banked as S-B | 8 sites + 1 historical | **LAW**, and see §3 |
| d | A counter outside the guard it describes | **GENUINELY NEW** — no home | 3 independent | **LAW** |
| e | A published diagnostic that is a snapshot, not a getter | **GENUINELY NEW** — no home | 1 exact + 2 same-family | **LAW at the family level, ANECDOTE at the JS-property level** |
| f | Producer and consumer disagree about SCOPE | **SPECIAL CASE / needs promotion** — sibling files exist, the shape is unnamed | 5 independent | **LAW** |
| g | Producer/consumer FIELD-NAME mismatch ⇒ permanently unreachable branch | **GENUINELY NEW** — named once, never defined | 5 independent | **LAW** |
| h | Input floored, product not | **SPECIAL CASE of §3's zero-derivative law** | 3 | **LAW** |
| i | A test named for what it does not do | **PARTIALLY IN INDEX** (cousin of "a test that re-implements its subject") | 4 | **LAW** |
| j | Fixing a count while preserving the falsehood underneath | **PARTIALLY IN INDEX** (9-line appendix) | 3 | **LAW** |

**Every one of the ten is a LAW by the two-instance test.** Not one is an anecdote — with a single
honest exception: (e)'s narrow JS form (a `window.__X__` data property vs. an accessor) has exactly
one instance; its *family* (a derived copy of a moving quantity, read as if live) has three.

---

## 2. THE CLASSES

### (a) A refusal you cannot READ is indistinguishable from a pass — **LAW, banked**

**Sharpest form:** *If the refusal path and the pass path produce the same observable, a green means
nothing — and a guard that refuses silently is strictly worse than no guard, because no guard is
honestly silent.*

**Cheapest detector — two questions, in order** (already in the memory file, keep them):
1. What did it **assert**? — not what did it *run*.
2. **Could it have refused, and would I be able to tell?**

**Cheapest mechanical detector (add this — it is not in the file):**
```bash
grep -rn "continue-on-error\|| true\|2>/dev/null\|set +e" .github/workflows/    # M4
grep -rEn "\"warn\"|::warning::" .github/workflows/ lighthouserc.json          # M1
grep -rn "addopts\|-rs\|-ra\|reporter" backend/pyproject.toml .github/workflows/ frontend/playwright.config.js
```

**Instances (6, independent):**
| when | instance | evidence |
|---|---|---|
| 2026-08-09 | Playwright `--reporter=html`: `weather-simulation` appears **0 times in 2,393 log lines**; fixed to `list,html` ⇒ **0 → 49** | `edf91af9`; `S2 §A3` |
| 2026-08-09 | **448 pytest refusal sites, 448/448 carry a reason, 0 reach any CI log.** 2,931 unreported skips/run | `S2-refusal-and-vacuity-audit.md §B1`, `ci.yml:426,656,795` |
| 2026-08-09 | `backend-lint` required on `main`, `continue-on-error: true` as the job's last step | `ci.yml:267-270` |
| 2026-08-08 | **`8dc9ef20` "the gate fired correctly and its explanation reached nobody"** — `bash -e` + `pipefail` aborted the step on the `python | tee | tail` line, so the `::error::` block below was unreachable dead code | commit body |
| 2026-08-08 | **`6b34fef7` "the retained artifact is unreadable exactly when it has something to say"** — `drift.json` invalid JSON on **13 of 25** runs, and invalid **only** on runs that flagged something (concordance 24/24) | commit body |
| 2026-08-09 | **`f9066b8d`** — "the truncation that hid the red"; and `tail -40` cutting the failing row out of a census log (already in the index) | commit subject; index §08-09 |

⭐ **The sharpest single line in the whole class, and it is the repo's own:** `lighthouse.yml:8-9`
cites 20/20 green as evidence the job is safe to require, while `lighthouserc.json:12-19` sets every
assertion to `warn`. **It reasoned from an outcome it had made impossible.** (`S1 §F2`, 100/100 runs
green, measured.)

---

### (b) A registry is a CLAIM of completeness, not completeness — **LAW, banked**

**Sharpest form:** *A guard that iterates a hand-kept list reports "every LISTED member complies"
and a reader hears "every member complies"; the two sentences differ by exactly the members nobody
listed, and nothing in a green run distinguishes them.*

**Cheapest detector:** *Can you write down the query that produces the TRUE population?* If yes, the
guard must run that query and assert `true_population − registry − documented_exemptions == ∅`. If
no, the registry is a claim and must say so **in its own failure message**.

**Instances (5, independent) — this is the best-evidenced class in the set:**

| when | instance | evidence |
|---|---|---|
| 2026-08-09 | `SURFACES` = 3 while the **same file's** `POST_STEP_SURFACES` = 4; true population 5 | `test_rating_composition_parity.py:93,478`; `S4 §0` |
| 2026-08-09 | `DISCLOSING_SURFACES` = 4, omits the on-map band, which emits both a height and a score | `test_directional_conflict_disclosure.py:188-193`; `surf_rating.py:786,788`; `S4-02` |
| 2026-08-09 | `CHAIN_MODULES` scans 6 modules; **89 chain constants live in 33 modules outside the scan**, incl. `rating_confirmation.GOOD_T` — the number that decides whether the product says "good" | `test_science_registry_coverage.py:71-78`; `S4-04` |
| 2026-08-07 | **`dd5833a5` — "the staleness check was one-directional, it could not see a NEW fetcher."** Same S-A shape, found by sweeping after `1399f880`. **Fixed the right way:** every `*_fetcher.py` on disk must be in `POOLED_FETCHERS` **or provably free of `requests.*` by AST** — *"so there is no second list to keep in sync"* | commit body; `test_fetcher_http_pooling.py:70-95` |
| 2026-08-09 | `PRIVATE_ENDPOINTS` guards **5 of 10** `@router.websocket` routes; `/ws/admin/events` has no token parameter at all | `test_websocket_endpoints_auth.py:12-18`; `routes/live/websocket.py:134`; `S4-06` |

⭐ **The prior instance that matters most is the SECOND-ORDER one.** `S4-01`: the registry created
*in response to* the 08-03 inert-gate incident, `GATE_ARG_CALLERS`, itself registers **1 of 4+ live
call sites** — and its helper `_call_kwargs_in_function` (`test_rating_composition_parity.py:509-522`)
`return`s on the **first** matching call, so even a registered function is checked once. *The
correct pattern (`_rating_call`, collect every call and assert they agree) exists 200 lines above in
the same file.* ⇒ **The fix for a census defect is itself a census, and it inherited the defect.**

⭐⭐ **Reference implementations to copy** (`S4 §2`): `test_fetcher_http_pooling.py:70-95` (best in
repo — a VERIFIED, not declared, exemption), `test_sim_every_surface_reads_the_served_curve.py:118-144`,
`test_flag_lane_parity.py:525-551`, `test_observation_gate_single_model_surfaces.py:178-231` (a
two-entry registry **with a paired control asserting the other three lanes DO read the flag**, so
"nobody reads it" cannot pass).

⚠️ **`S4`'s own second rule, worth keeping verbatim:** *two registries in one file is the
highest-risk configuration in this repo.* It produced the founding defect (3 vs 4), `S4-03`
(`SURFACES` censused / `HEIGHT_RENDERERS` not, in one file) and `S4-03`'s exemption split
(`sim_health_probe.py` exempt in `EXEMPT`, absent from `DISCLOSURE_EXEMPT`).

---

### (c) `assert len(REGISTRY) >= N` — **SPECIAL CASE of (b); LAW; and see §3**

**Sharpest form:** *`assert len(REGISTRY) >= N` is satisfied by any list of length ≥ N, so it
measures the number somebody typed the day they counted — never the population.*

**Cheapest detector:** `grep -rn "assert len(.*) >= " backend/tests/` and, for each hit, ask **"what
number would this be if the defect it exists to catch occurred?"** If the answer is "the same
number", it is a decoy.

**Instances — 8 live sites, enumerated in `S4-07`.** Two matter:
- `test_rating_composition_parity.py:588` — `len(POST_STEP_SURFACES) >= 4`, actual 4. **This is the
  exact assertion the 3-vs-4 defect walked past.**
- `test_directional_conflict_disclosure.py:217` — `>= 4`, actual 4. A fifth surface has never been
  able to make it red.

⭐⭐⭐ **THE PRIOR INSTANCE IS THE MOST DAMNING FINDING IN THIS LANE — the repo caught this exact
assertion EIGHT DAYS EARLIER AND CLOSED IT BY EDITING THE MESSAGE.**
`docs/research/AUDIT-2026-08-01-v3-forensic-simulation-audit.md:170-178` records, under the heading
*"The parity registry claims five surfaces, enforces four, and lists four"*:
```python
assert len(POST_STEP_SURFACES) >= 4, "all five rating surfaces must be listed"
```
Traced with `git log -S`: that string entered at `79e1001a` (2026-07-31) and was **replaced** at
`2680afe7` (2026-08-03) with `"the four APPLYING rating surfaces must be listed"`. The count and the
message now agree. **The completeness claim did not become true** — `2680afe7` moved the fifth into a
*second* registry (`GATE_ARG_CALLERS`), which `S4-01` measures at **1 of 4+ call sites**.
⇒ This is simultaneously an instance of (c), of (b), and of **(j)**.

---

### (d) A counter outside the guard it describes is a decoy — **GENUINELY NEW, LAW (3 instances)**

**Sharpest form:** *A counter that advances when the work is skipped is not a diagnostic, it is a
decoy — place the increment INSIDE the branch it claims to count, or it measures the loop, not the
work.*

**Cheapest detector:** for every counter, **mutate the guarded work to a no-op and re-read the
counter.** If it still moves, it is not counting the work. (Cheaper still, statically: is the `++`
inside or outside the `if` whose name it borrows?)

**Instances (3, independent, across unrelated subsystems):**

| when | instance | evidence |
|---|---|---|
| 2026-08-09 | `_evolutionTicks++` sat **outside** the `shouldEvolve` block ⇒ reported **304 field evolutions that never occurred** on `/map`; post-fix it reads **0** beside `marineParticles: 3000` | `SimulationLoop.js:219,223,232` (fixed `0bf6278e`); `ROOT_CAUSE_GRAPH.md` CHAIN B |
| 2026-08-03 | **`18ffbb2e`** — `__RAW_GPU__.encodeDupCount`, *the counter that exists to catch duplicate texture encodes*, **reads 2 against 500 identical encodes** (0.4%). The commit itself names it: *"the 'instrument reports success having tested nothing' class in counter form"* | commit body, live capture |
| 2026-07-31 | **`7da00ca8`** — the pilot-rotation test *"fed a counter production never sends"*; the real `cycle_index` quantised wall-clock into 3-h buckets consumed by an 8-h cron ⇒ **2 of 8 regions score ZERO hits**, measured over 30 simulated days, and one live pair sat at **447.9 h (18.7 days)** stale | commit body |

⚠️ **A fourth, adjacent instance worth citing but not counting:** `974bf284` (2026-07-31) — the
marine render `errorCount` was a **lifetime** total that never decayed, so three unrelated throws
hours apart permanently disabled the layer. *The counter must measure a BURST, not a lifetime.*
Same family (a counter whose window is not the window of the thing it names), different mechanism.

⭐ **This class has a companion asymmetry worth recording with it:** in the same commit, the
**snapshot lied LOW** (a healthy engine read as frozen) while the **misplaced counter lied HIGH**
(304 evolutions that never ran). *Two instruments on one screen, disagreeing with reality in
opposite directions, and the audit believed both.*

---

### (e) A published diagnostic that is a snapshot, not a getter, lies in BOTH directions — **GENUINELY NEW**

**Sharpest form:** *A diagnostic that can be stale must be LIVE or carry its own timestamp — a
snapshot read as if live is not merely late, it fabricates both a stall and a speed-up, and the
reader cannot tell which.*

**Cheapest detector — the repo's own, from `0bf6278e`:** read the global **twice, N seconds apart**,
and compare its delta to the module's own accessor over the same interval. A live accessor cannot
disagree; a snapshot's delta is 0 while the truth advances. (`__DATA_DIAG__` is the counter-example
done right: still a snapshot, but it **stamps** one, so a stale read is *detectable*.)

**Instance (exact form, 1):**
- `window.__SIM_DIAGNOSTICS__` was a React prop assigned inside a `useEffect` **deliberately
  decoupled from per-frame updates for performance** — the perf win silently froze the instrument.
  Measured: over 3 s the global's `frameIndex` delta was **0** while `getSimDiagnostics()` advanced
  **180**; absolute drift **1,414 frames ≈ 23.6 s**. It reported a healthy 60 Hz engine as **frozen**.
  **Cost: four probes and two fabricated hypotheses** ("the engine stalls", "the engine runs 7.5×
  fast"), *both wrong.* (`0bf6278e`; `ROOT_CAUSE_GRAPH.md` CHAIN B; `F-02`.)

**Same-family instances (2, independent) — this is why the FAMILY is a law:**
- 2026-07-27 **`913b4af7`** — *"the sim's catalogue was a drifted snapshot."* `dev.db` vs production:
  Bethune Beach **~7 km** apart, `is_active` disagreeing, 1547 vs 1515 rows. ★ The commit's own rule:
  ***"a stale catalogue is worse than a missing one once the forecast is real"*** — the sim sampled a
  REAL forecast at a wrong point and reported it with full confidence.
- 2026-08-08 **`32bd579c`** (banked as `sim-parity-monitor-fails-intermittently-2026-08-08`) — the
  rotating parity reds were **reference-generation skew**: a glyph frame rated against an older
  climatology snapshot, paged against a fresh lookup. Control: replay with the glyph's own reference
  ⇒ **d = 0.0 exactly**.

⚠️ **HONEST LIMIT — and the reason this one is scoped carefully.** The narrow JS form (a `window.__X__`
**data property** where an **accessor** was needed) has **one** instance. Its family — *a derived
copy of a moving quantity, read as if it were the quantity* — has three. **Write the memory at the
family level; cite the JS mechanic as the instance.**

⚠️ **The session over-claimed its own fix and the re-verify caught it:** *"a stale snapshot is
structurally impossible"* is **false for `__FCE_FIELD__` / `__FCE_DIAGNOSTICS__`**, which are still
per-*render* snapshots, and the `__SIM_DIAGNOSTICS__` getter's `catch` **silently restores the stale
snapshot** (`V3-observability-reverify.md §1, V3-02`). Also, `__RAW_GPU__` "changed type mid-session"
was **the auditor's own probe bug** — leave it alone.

---

### (f) The producer and the consumer disagree about SCOPE — **LAW (5 instances); shape is unnamed**

**Sharpest form:** *Producer coverage ⊃ consumer coverage is the classic silent-disclosure shape:
the producer emits for every model, layer and coordinate; the consumer renders for a subset; and the
gap is exactly the population nobody is warned about.*

**Cheapest detector — a CROSS-CONSUMER PARITY TEST, not a per-field pin.** The repo already built
the right instrument and wrote down why: `pointFieldWhitelistParity.test.js` compares the **mappers
against each other**, *"so the NEXT omission fails on the day it is written rather than on the day
someone notices the infobox disagreeing with the glyph"* (`e8b38e42`). Per-field pins
(`shoreNormalPassthrough.test.js`) *"cannot catch the class."*
Second detector, for scope specifically: **enumerate the producer's own key set and the consumer's
own key set and diff them** — the `waves` case is one `includes()` on each side.

**Instances (5, independent):**

| when | instance | evidence |
|---|---|---|
| 2026-08-09 | **`WebGLMarineLayer.js:185` explicitly records `'waves'` as a layer it reports staleness for; `forecastDiagnostics.js:13` excluded `'waves'` from displaying it** — and `waves` is the DEFAULT layer, and the layer the +78 h stale-hour defect was measured on | `S3-01`/`S3-03`; fixed `d1b40987` |
| 2026-08-09 | The map **rating band** composes a rating outside the mandated chain: band vs point at the SAME coordinate, height up to **3.04×**, rating up to **56.9 pts**, signed both ways; band-vs-glyph pinned at **+32.50 pts** | `E1-01`, `578e9a1c` |
| 2026-08-06 | **`f1bd00bd`** — *"the disclosure reached 1 of 4 renderers, and now a guard enumerates them"*; and **`1b1c2900`** the day before — *"I fixed ONE consumer of the disclosure and left the sibling ranking silent"* | commit subjects |
| 2026-08-07 | **`7a002e8b`** — `forecast_confidence` present on two endpoints, and *"the word 'confidence' appears ZERO times"* on the rendered hub. ★ *"A capability reaches a screen only where something RENDERS it; a field arriving in a payload is not reach"* | commit body, measured live at ANCÃO |
| 2026-08-09 | `geometry_readiness` / `directional_conflict` / `model_agreement` survive **all four** client mappers (there is even a parity test) and are read by **nothing**. `spotRatingsClient.js:62` says so itself | `S3-01` |

⭐⭐⭐ **The consequence is measured, not argued, and it is the biggest number in the S3 pack:**
a `geometry_readiness == 'blind'` spot is scored with the **most favourable** assumption
(`surfRating.js:83` returns full exposure when `shoreNormalDeg == null`). Executed at HEAD with one
variable moved: **+68.4 points and a four-level jump (`very_poor` → `good`)**, monotonically
optimistic. The field that says "this is the blind arm" is in the same JSON object as the score.

---

### (g) A producer/consumer FIELD-NAME mismatch makes a branch permanently unreachable — **GENUINELY NEW, LAW (5 instances)**

**Sharpest form:** *When the consumer reads a key the producer never writes, the branch is not
flaky and not rare — it is unreachable for every user forever, and it fails as SILENCE, which is
indistinguishable from "the condition never occurred."*

**Cheapest detector:** for every field in a conjunction that gates a UI state, **grep the whole tree
for a WRITER**. One command, and it is decisive:
```bash
grep -rn "renderedVectorCount" frontend/src --include=*.js   # 4 hits, ALL reads, zero writers
```
Structural version: *a boolean built from ≥3 conjuncts across a module boundary needs a truth-table
test with a known-TRUE fixture* — an absence test alone passes when nothing renders at all.

**RE-VERIFIED LIVE AT THE WORKING TREE (this is not inherited from the pack):**
`forecastDiagnostics.js:69-74` requires `webglDiag.renderedVectorCount > 0 && webglDiag.renderedNonzeroCount > 0`
for `isWebGLRendered`. The producer, `WebGLMarineLayerDiag.js:115-126`, writes
**`webglSourceVectorCount`**. A whole-tree grep returns **4 hits for `renderedVectorCount`, every one
a read** (`forecastDiagnostics.js:73,74,241,242`) and **no writer anywhere**. ⇒ `undefined > 0` is
`false` ⇒ **`return 'ready'` is dead code.** (Sibling field `renderedProvider` IS written at
`WebGLMarineLayerDiag.js:123`, which is what makes the mismatch look plausible on review.)

**Instances (5, independent):**

| when | instance | evidence |
|---|---|---|
| 2026-08-09 | `isWebGLRendered` permanently false (above); this is `OPEN_QUESTIONS Q-06`'s `infoboxHeatmapParity === false` | verified at working tree |
| 2026-08-09 | `rate_limited_cached` — **written at `WebGLMarineLayer.js:178`, ZERO consumers repo-wide.** Result: `reason==='cooldownActive'` discloses in **0 of 12** model×layer cells | `V6 §(1)`, `probe_V6_disclosure_matrix.js` |
| **2026-07-17** | **`infobox-provisional-marker-dead-predicate-2026-07-17`** — a two-phase "provisional" marker built on **2026-07-05** never rendered for **12 days**: `!isExactPointAuthority && isExactPointLoading` where `isExactPointAuthority` is a *selection-type* flag that is TRUE from the first render ⇒ the compound is unreachable. **Found only because a user reported the symptom.** ★ *"When a UX marker was built but users don't see it, re-derive the predicate's truth table against what the flags ACTUALLY mean"* | memory file, `2da69161` |
| 2026-08-09 | **`e8f04cc1`** — the admin map editor sent `{lat,lng}` to a model requiring `latitude/longitude` ⇒ FastAPI **422 before the handler ran**. ★ *"THE FAILURE WAS PERMANENT, NOT INTERMITTENT"* — no amount of retrying could move a land-flagged spot. Two call sites built the body independently | commit body, proven against the deployed `/openapi.json` |
| 2026-08-09 | **`bd75343b`** — the producer returned `reference_size_m` and **Pydantic silently dropped it** at the `/spot-ratings` boundary. The commit names the class and its ancestors: *"the `6da4c16e` / `e8b38e42` / `forecast_confidence` class"* | commit body |

⭐ **The 2026-08-02 ancestor is the richest**: `e8b38e42` measured the point-mapper matrix and found
**the backend had carried the whole geometry envelope since 2026-07-30 and no client mapped any of
it** — `shore_normal_source`, `break_depth_m`, `geometry_readiness` were ❌❌❌ across all three
mappers, and `coverage_status`, *whose own comment read "FOURTH FIELD IN A ROW to be missing from
this whitelist"*, was then added to **one mapper of three.**

⇒ **(f) and (g) should be ONE memory.** `V6-handoff-factpack.md:259` reaches the same conclusion
independently: *"Treat as one **producer/consumer field-name census**, not three bugs."*

---

### (h) Input floored, product not — **LAW (3), and a SPECIAL CASE of §3**

**Sharpest form:** *A guard that floors its INPUT and only logs its PRODUCT cannot see the failure
that consumes a healthy input and emits nothing.*

**Cheapest detector:** for each floor, **name the failure it exists to catch, then ask what the
asserted quantity reads under that failure.** Same number ⇒ decoy. (This is §3.)

**Instances (3, independent):**
- 2026-08-09 — `precompute_ci.py:53-55` correctly aborts when `not restored` (**input floored**);
  `:75-76` does `n_spots, n_frames = run_spot_ratings_precompute()` then `logger.info(...)` and
  **never asserts** (**product unfloored**) ⇒ a cycle rating **zero spots** returns 0 and
  `precompute.yml` is green. *Verified at the working tree; the log/assert asymmetry is exactly as
  the pack describes.*
- 2026-08-07 — **`5032a31f`**, "the coverage floor could not fire on the failure it was written
  for." **Two defects, and fixing either alone leaves the floor useless**: (1) GATED — `truncated_at`
  is set only by the soft-deadline break, never by 429/503/malformed GRIB; (2) BLIND —
  `covered_h = (len(times)-1)*3` counts `times`, and the per-step `except` **appends to `times` too**.
  Measured: **1 ok step / 112 failed still measured 336 h and shipped.**
- 2026-08-09 — `ci.yml:528` builds the `MIN_FILES` module set from **every** `<testcase>`, so a
  module that is collected and **entirely declines** still counts as "produced results" — measured
  against a real junit XML: `tests=30 skipped=30 passed=0`, modules counted toward `MIN_FILES`: **2**
  (`S2 §C3`). *Partial* blind spot: the `MIN_PASSED` floor does catch a mass-skip.

⭐ **The counter-example to copy is in the same estate:** `ci.yml:88-97` floors
**`numPassedTests`**, so converting a test to a skip *lowers* the count and reds the gate. `S2 §A4`
calls this *"the best gate in the repo… immune to the class."* Residual: the floors are set ~2
suites / ~40 tests **below** the measurement, so **up to ~40 tests could be skipped silently**, and
`numPendingTests` is never read.

---

### (i) A test named for what it does not do — **LAW (4); PARTIALLY in the index**

**Sharpest form:** *A test's NAME is an assertion about coverage that nothing checks — prove what it
executes with `sys.settrace` (or by deleting the subject and re-running), never by reading its
title.*

**Cheapest detectors, in ascending cost:**
1. `git ls-files <src> | grep test | xargs grep -ln <Subject>` returning **nothing** (already in the
   index, from `d42c635c`).
2. **Delete the subject and re-run.** If it stays green, it could not observe its subject.
3. **`sys.settrace` over the test's parametrisations, printing per-module `EXECUTED` booleans.**

**Instances (4, independent):**

| when | instance | evidence |
|---|---|---|
| **2026-08-05** | `test_all_three_surfaces_agree_exactly_with_flags_off` — settrace over all four parametrisations: `surf_rating.py` **7,686 calls**, `spot_ratings.py` / `spot_conditions.py` / `sim_rating.py` **EXECUTED = False**. *"Its three 'surfaces' are ONE function called three ways."* | `backend/tests/test_three_surfaces_agree_BEHAVIOURALLY.py:1-19` — **written in-tree, four days before the 08-09 rename** |
| 2026-08-07 | **`d42c635c`** — `SpotConditions.confidence.test.js` imported nothing from the component; ran green against the component with the whole confidence block **deleted** (14 passed, rc=0) | index entry |
| 2026-08-07 | **`9445103f` / `e45efd53`** — the guard hard-coded `half=2` while the run derives `half=60`; it entered its branch on **18 of 31,128 points (0.06%)** | index entry |
| 2026-08-09 | **`79d0c322`** — *"RETRACT the tide result: the harness could not exercise the flag it declared quiet"*; and **`03bf6bc7`** — *"the marine zoom-burst probe could not fail"* | commit subjects |

⭐ **The 08-09 instance is not the discovery — it is the RE-OFFENCE.** `test_the_three_POINT_surfaces_agree_exactly_with_flags_off`
(`test_rating_composition_parity.py:350-371`, read at the working tree) calls `compute_surf_rating`
positionally, `compute_surf_rating` by keyword, and `rating_score` by keyword. It imports none of
the three named surfaces. **The rename made the count honest and left the noun wrong.**

---

### (j) Fixing a count while preserving the falsehood underneath it — **LAW (3); a 9-line appendix today**

**Sharpest form:** *Correcting a label is not correcting the claim — after you edit a number, a name
or a message, re-derive the sentence UNDERNEATH it, because a tidier wrong sentence is still wrong
and now looks maintained.*

**Cheapest detector:** *After changing any count, name or gate — what MEASUREMENT would now be
different?* If none, you changed the label. Specifically: **when a red goes green, diff the DATA, not
the colour.**

**Instances (3, independent):**

| when | instance | evidence |
|---|---|---|
| 2026-08-09 | The rename fixed 3→"three POINT" **and left standing** *"This is the assertion that would have gone red for `9b808d05`"* — which `test_three_surfaces_agree_BEHAVIOURALLY.py:1-19` explicitly refutes, **by measurement, in-tree, since 08-05** | `test_rating_composition_parity.py:352` |
| 2026-08-03 | `2680afe7` changed `"all five rating surfaces must be listed"` → `"the four APPLYING rating surfaces must be listed"` after the 08-01 audit flagged the contradiction. **The message became consistent; the census did not become complete** (`S4-01`: 1 of 4+ call sites) | `git log -S`, `AUDIT-2026-08-01…:170-178` |
| 2026-08-09 | **The Forecast Calibration Census went 6-red → 3-green by changing the GATE, not the data.** Run `31335894359` is `conclusion=success` while its own log prints `VERDICT: BOUNDS STALE`. Six consecutive failures before `822a0785`, three consecutive successes after | `S1 §F3`, measured live |

⚠️ **Be fair to `822a0785`:** it was a *defensible* change (page on the claim that survives the
percentile; memory explicitly forbids widening the bound). The class is not "that fix was wrong" —
it is that **the red disappeared while the condition it named persisted**, and the only artifact of
the transition is a `::warning::` nobody re-reads. ⇒ **The rule is about the TRANSITION, not the
verdict: when a gate stops paging, record what still holds.**

⭐ **A fourth, meta-level instance already in memory:** the LOC ratchet. Both regressions were ~90%
rationale, so the cheapest way to fix the *number* is to delete the *reason* — which is why the
standing rule is ⛔ **move rationale to `docs/`, never delete it.** Same shape, one level up.

---

## 3. ⭐⭐⭐ THE LAW THAT UNIFIES (c), (d) AND (h) — AND IT IS IN NO MEMORY FILE

The repo coined this on 2026-08-07 and it lives **only in a commit body** (`5032a31f`). Grepping the
entire memory estate for "derivative" returns **one hit, about database licensing**. It is
unrecorded.

> ★★★ **AN INSTRUMENT WHOSE DERIVATIVE WITH RESPECT TO ITS OWN SUBJECT IS ZERO CANNOT DETECT IT.**
> *(`5032a31f`, measured: `d(covered_h)/d(steps_failed) = +0.000` at every failure rate, while
> `d(null%)/d(steps_failed) = +0.885`.)*

Apply it to the three classes and they collapse into one question:

| class | the instrument | the subject it names | derivative |
|---|---|---|---|
| (c) | `assert len(REGISTRY) >= N` | an unlisted member | **0** — the list is unchanged by what is not in it |
| (d) | `_evolutionTicks++` outside `shouldEvolve` | whether evolution ran | **0** — it counts ticks, not evolutions |
| (h) | `if not restored: return 1` | a cycle that rates zero spots | **0** — the input is fine in exactly that failure |
| (a/M3) | "an empty population is a pass" | the population going empty | **0** |

**The detector is one sentence and it costs nothing:** *name the failure this guard exists to catch,
then say what number the guard prints when that failure occurs.* If it prints the same number, the
guard is a decoy no matter how green it is.

⭐ **And `5032a31f` supplies the proof technique too** — a **mutation matrix that discriminates**:
*"Mutation 1 (restore both) → 5 of 12 guards die. Mutation 2 (fix ONLY the gate, keep the blind
metric) → **THE IDENTICAL 5 die**, because the floor then computes 336 ≥ 120 and waves everything
through."* Two mutations, identical kill set ⇒ **the second defect is invisible to the suite**, and
that is how you prove a two-defect claim instead of asserting it.

---

## 4. SECOND-ORDER OBSERVATIONS THE LEAD SHOULD KNOW

1. ⭐⭐⭐ **THE STRONGEST FINDING IN THIS LANE IS NOT A NEW CLASS — IT IS THE RECURRENCE INTERVAL.**
   Three of the ten had been **measured and written down in this repo before**, and the record did
   not stop the re-offence:
   - `AUDIT-2026-08-01…:174` recorded the `>= 4` / "five surfaces" contradiction — **8 days** before
     3-vs-4 was found.
   - `test_three_surfaces_agree_BEHAVIOURALLY.py:1-19` refuted the `9b808d05` sentence **by settrace
     on 08-05** — the 08-09 rename edited that exact docstring and re-affirmed it.
   - `dd5833a5` (08-07) named the one-directional staleness shape and fixed it *the right way* in
     one file — two days later five more registries had it.
   ⇒ **This is the index's own "THE REGISTRY KNEW AND THE GATE STILL PAGED FOR 24 HOURS", generalised:
   documenting a defect is not a defence against it. The provenance must move INTO the check.**
   The actionable form: **when you fix an instance, `git log -S` and `grep` the shape, and record the
   sibling count in the commit even when it is 1** (already a rule — `a-fix-at-the-incident-site…`;
   this lane is its fourth and fifth confirmations).

2. ⭐⭐ **THE PACKS' OWN HONESTY IS PART OF THE EVIDENCE.** `S4` executed **no test** and says so;
   `S2` says its vacuity verdict rests on a **13-file** traced subset because the full 227-file
   `settrace` had not finished; `S4-08` is labelled **HYPOTHESIS (latent)** and measured clean.
   `S2 §C4` clears 64 flagged sites as **correctly guarded** and calls it *"a genuinely good result
   [that] should be recorded as such."* **Any memory written from these packs must carry the same
   NOT-MEASURED labels**, or it will read as stronger than the evidence.

3. ⚠️ **ONE CLASS I EXPECTED AND DID NOT FIND.** I looked for a prior instance of (e)'s *exact* JS
   mechanic (data property where an accessor belonged). There is none — `git log --grep=snapshot`
   returns catalogue snapshots and E2E failure snapshots, not published-global snapshots. **Say
   "one instance" for that mechanic, or the memory over-claims.**

4. ⚠️ **A NAMESPACE TRAP THE MEMORY MUST CARRY.** `MASTER §13b` records an **ID namespace collision**:
   subagent `F-01…F-11` are NOT the lead's `F-01…F-12`. Subagent `F-03` is `netlify.toml:7`; lead
   `F-03` is the inert physics kernel. **Cite lead findings by their `L-` prefix.** Any memory that
   quotes an `F-` number without a namespace is a future wrong citation.

---

## 5. RANKED PROPOSALS (detail returned in the structured output)

| rank | action | target | why now |
|---|---|---|---|
| 1 | **NEW** | `an-instrument-whose-derivative-is-zero-2026-08-09` | Unifies (c)(d)(h)+M3; coined in-repo 08-07; **zero memory hits**; one-sentence detector |
| 2 | **NEW** | `producer-and-consumer-must-be-censused-together-2026-08-09` | (f)+(g) as ONE law, 5+5 instances incl. a **12-day dead predicate found only by a user report** |
| 3 | **NEW** | `a-published-diagnostic-that-is-a-snapshot-lies-both-ways-2026-08-09` | (d)+(e); cost this audit 4 probes and 2 false hypotheses; the two-instruments-disagree-in-opposite-directions pairing |
| 4 | **EDIT** | `the-census-is-the-defect-not-the-assertion-2026-08-09` | Add the **08-01 prior** (`>= 4` / "five surfaces", closed by editing the message) and the `dd5833a5` reference fix — it turns the file's central claim from anecdote to law |
| 5 | **EDIT** | `a-refusal-you-cannot-read-is-a-pass-2026-08-09` | Give (h) its detector + its two priors; add the `8dc9ef20` / `6b34fef7` ancestors so the class does not read as born on 08-09 |
| 6 | **EDIT** | `verify-the-changed-lines-not-the-suite-2026-08-09` | Promote (j) out of the census file into this working-practice file, with the census-gate transition instance |
| 7 | **INDEX LINE ONLY** | `INDEX-defect-classes.md` | (i) gains a 4th instance and the settrace detector; add it to the existing "test that re-implements its subject" bullet rather than a new file |

---

## 6. WHAT I DID NOT VERIFY

- **I executed no test and dispatched no workflow.** Every "the guard is green" statement is
  inherited from the S1–S4 packs or inferred from reading the assertion against a derived population.
- **The 24 undefined-name flake8 claim is still unverified** (flake8 not installed here) — as the
  handoff already says.
- I re-verified at the working tree only: `forecastDiagnostics.js:8-20,62-75`,
  `WebGLMarineLayerDiag.js:15,115-126`, `WebGLMarineLayer.js:155-190`, `SimulationLoop.js:219-232`,
  `precompute_ci.py:47-76`, `test_rating_composition_parity.py:93,350-371,478-490,588`,
  `test_three_surfaces_agree_BEHAVIOURALLY.py:1-24`, `bathymetry.py:24-30`,
  `local_size_preview.py:236-244`, `AUDIT-2026-08-01…:170-178`, and the `git log -S` history of the
  `>= 4` assertion message.
- **I did not re-measure any consequence** (no +68.4 pt replication, no band-vs-point run, no
  browser). All deltas are quoted from the packs that measured them.
- `S4-01`'s served divergence and `S4-06`'s access outcomes were **NOT MEASURED** by their own
  authors; I did not close either.

## 7. COMMANDS USED

```bash
git log --oneline -n 400 --format="%h %ad %s" --date=short
git log --grep="counter\|snapshot\|floor\|no consumer\|never read" -i --oneline -n 600
git log -S "all five rating surfaces must be listed"      -- backend/tests/test_rating_composition_parity.py
git log -S "the four APPLYING rating surfaces must be listed" -- backend/tests/test_rating_composition_parity.py
git show -s --format="%b" dd5833a5 e8f04cc1 5032a31f 8dc9ef20 6b34fef7 7a002e8b bd75343b e8b38e42 \
                          18ffbb2e 7da00ca8 913b4af7 974bf284 0bf6278e 578e9a1c
grep -rn "renderedVectorCount\|renderedNonzeroCount\|webglSourceVectorCount" frontend/src --include=*.js
grep -rln "the-census-is-the-defect\|a-refusal-you-cannot-read" \
     ~/.claude/projects/C--Users-dprit-Raw-Surf/memory/
```
