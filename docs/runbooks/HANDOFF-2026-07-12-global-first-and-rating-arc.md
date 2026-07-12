# HANDOFF — 2026-07-12 · GLOBAL-FIRST MANDATE + rating arc close (fresh-context bootstrap)

**dev = `cdd90c7e`. FE 98 suites / 807 tests green · backend 614 green. Session detail =
memory [[session-2026-07-12-radar-baseline-intersect-prefer]] (rounds 1-4 of the rating arc,
radar baseline+smooth-field, #17 ship-and-revert, S1/S2 ops). Supersedes the 07-11 EVE handoff.**

## 0. ⭐ GLOBAL-FIRST MANDATE (user directive, 2026-07-12 — applies to EVERY layer)
The app must load and render properly for users at ANY GPS location worldwide — not just the
developer's Florida viewport. This is now the standing acceptance rule for ALL weather-sim work:

- **Architecture is already global-shaped** — every marine/wind lane has a global product +
  10 regional pilots (`scheduler_helpers.py` ~L385: florida_east_coast, us_west_coast_socal,
  hawaii, iberia_west, uk_ireland, east_australia, indonesia, brazil_east, south_africa,
  mexico_centralamerica_pac; all 0.25°) + the dynamic viewport lane everywhere else. The gap is
  **cold-path quality and test discipline**, not topology.
- **The pilot/non-pilot asymmetry is THE recurring bug shape**: warm pilots (GFS at FL) hide
  cold-SWR behavior that every non-pilot user gets (this session's EURO/ICON band flicker was
  exactly this — and it reproduced AT a pilot for models without pilot coverage). Fixes that
  only help pilot regions are incomplete by definition.
- **Binding test discipline**: every layer-behavior verification must run at ≥3 rotated
  locations: one warm pilot (any of the 10), one pilot-adjacent straddle, one NON-pilot open
  coast (e.g. Taghazout Morocco, Arugam Bay Sri Lanka, Chicama Peru — all outside every pilot
  box). Cold-cache first load + pan + zoom-out at each. The 1447-spot table is global; the
  glyphs/band/infobox must agree at all of them.
- **Layer coverage truths** (for honest expectations): radar = RainViewer network coverage
  only (NOT global-ocean; by design) + global advection where observed; precip/pressure/temp
  pairs = global model rasters; marine = global coarse + mid tier (2-15°) + pilots + dynamic;
  wind = global + pilots; rating band = global via dynamic+mid (since `e5f693ed`); spot
  glyphs/ratings = global (spot-ratings endpoint, bbox-driven).

## 1. DEEP AUDIT — everything shipped this session (all pushed, dev)
| Commit | What | Verified | Global? |
|---|---|---|---|
| `8199e51a` | #16 radar advect baseline 10→30 min (sub-cell identity root; sub-cell refinement REJECTED on evidence) | offline real-tile harness 81 tiles/3 continents; live URL wiring; FE green | ✓ (RainViewer-wide) |
| `6a5f6992`→`184a5d99` | #17 intersect-prefer SHIPPED then REVERTED same-day — premise falsified (pilots are 13×9=0.25° every hour; ALL marine lanes floor 0.25°). grid_resolver 786→583 split STAYS | 622 green before revert; revert = pre-ship behavior byte-for-byte | n/a (reverted) |
| `3c116b28` | Radar smooth motion FIELD (3×3 half-res vectors, per-pixel bilinear) — kills gridlike tile-block motion | real-tile seam 21.3→2.35 etc.; 4 synthetic tests | ✓ |
| `06f8fc33` | Confidence-weighted interpolation — restores full displacement (verbatim conf-0 zeros damped ~50%) | ≥90% displacement unit-proven; seams improved further (all ≤ observed baseline) | ✓ |
| `975903b2` | Rating round-1: conformedGridBase was EATING `ratingMode` (the explicit-field-list mirror landmine) + EURO client never sent surf=1 | local repro vs prod backend: band OFF→PAINTING in 5s; +1 conform regression test | ✓ |
| `e5f693ed` | Rating round-2: `SURF_REGIONAL_PREFER_MIN_FRAC=0.45` (Tampa/zoom-out sliver serves), `MARINE_MID_RES_RATING=1` (band at overview zooms), wash under band | live blendBoth{engaged,isRating}; suites green | ✓ (floor protects EVERY pilot edge worldwide) |
| `f85f7f69` | Rating round-3: u/v kept through 3 layers; shader presence/vividness re-shape (very-poor floor 0.55 + glow taper + coast-gate soften) | screenshot at the exact reported viewport: corridor continuous, glow, wash, 42FPS | ✓ |
| `cdd90c7e` | Rating round-4: ratingDowngrade guard (unrated never displaces rated — the EURO/ICON cold-cycle flicker, user's own tab logs) + living band → OPT-IN (`__RAW_RATING_LIVING_BAND__`; score-scaled speeds = wrong physics) | +4 guard tests (39 in suite); 807 FE green | ✓ (non-pilot users benefit MOST) |
| Ops | S2 pointer root = 42501 missing service_role GRANT (user applied; runner path verified HTTP 200; grant added to the migration file) · S1 DONE: DEV=`weewaulkwfwlbhqemxma`, legacy schema WIPED (user-directed; 135 tables incl. real PII/payments; paid-tier daily backups ~7d), weather bootstrap applied, **prod service key removed from the local machine**, DEV key installed via authenticated CLI · 04:08Z health fail = transient (12 green since) | probes + REST verifications | — |

**Audit honesty ledger:** intersect-prefer was shipped on an unverified premise and reverted
within ~30 min of live falsification (process worked, but the premise check should have come
FIRST — pilots' actual resolution was one curl away). The living band shipped with score-scaled
motion physics — user caught it; retreated to static default same night. Both lessons are in
memory. Everything else survived its verification.

## 2. QUEUE FOR THE NEXT CONTEXT (Jacobian order)
1. **S2 pointer verify** (2 min): `select * from weather_manifest_pointer` (jnfbxcvcbtndtsvscppt).
   Expect generation ≥1 from the 01:15Z+ ingests (writer = forecast-ingest.yml, NOT precompute).
   Then serve-box log `[Manifest Pointer] manifest served from …`. After 2 healthy generations →
   **P8 CDN flip**. If empty: grep the run's logs for `[Manifest Pointer]`.
2. **GLOBAL ROTATION TEST PASS** (the mandate, §0): rating band + waves + wind + temp pair at 3
   rotated locations × cold load/pan/zoom-out. Instrument: `__RAW_GPU__.ratingBand`,
   `__RAW_GPU__.blendBoth`, `[rating-band]` console breadcrumb. Fix what breaks; the cold-SWR
   first-serve latency at non-pilot coasts is the expected weak spot (design lever: pre-warm the
   spot-dense coasts? a Step-3.7-style instant preview already exists — measure before building).
3. **Colors-vs-data validation** (user question, OPEN): band color vs spot-glyph score vs
   infobox at the same cells (all share compute_surf_rating server-side — disagreement = a
   rendering/calibration bug). One session with screenshots + /spot-ratings + /grid?surf=1 probes.
4. **rating-anim-v2 (banked design)**: decouple color from motion — field schema gains a
   real-height animation channel (backend already sends real u/v on rated cells since
   `f85f7f69`; the builder must store real magnitude separately from the score channel; the
   dispatcher then uses real magnitude + real dir; masked-ocean motion = the two-channel
   color-validity/motion-validity design in memory). Opt-in lever exists for tuning.
5. **#17-redux prerequisite**: the fine-61×41 provenance map — nothing probed serves finer than
   0.25° for marine viewports; find what produced the historical 61×41 resident (or declare it
   extinct and re-frame the cold-arrival goal).
6. Cleanups: grid_resolver Step 3.5 SWR preview = DEAD CODE (own commit) · DEV project rename
   (dashboard) · data-health retry-once idea · backlog (#21, P7/P14, z9 A/B, sheltered-water,
   uptime probe ③).

## 3. KILL-SWITCH / LEVER INVENTORY (this session)
`__RAW_RADAR_ADVECT_BASELINE_MIN__` (≤10 = legacy pair) · `__RAW_RADAR_ADVECT_SMOOTH_DISABLED__`
· `__RAW_RADAR_ADVECT_CAP_MIN__=120` (2h nowcast option) · `SURF_REGIONAL_PREFER_MIN_FRAC`
(0.45) · `MARINE_MID_RES_RATING` (=0 restores honest-swell skip) ·
`__RAW_RATING_BLEND_WASH_DISABLED__` (wash under band) · `__RAW_RATING_LIVING_BAND__` (opt-in
motion; default static) · `__RAW_DISABLE_NO_DOWNGRADE__` (shared, now also covers
ratingDowngrade) · shader constants (presence 0.05-1.2 / vividness floor 0.55 / coast gate
0.05-0.45) are GLSL literals — revert by commit.

## 4. LESSONS / LANDMINES BANKED (memory has full versions)
- Preview TABS retain console logs across server stop — read the user's session logs before
  re-probing.
- "Band missing" ≠ unrated: CHECK CELL SCORES first (alpha ramps crush categorical lows).
- A flag vanishing between mapper and engine → suspect the conform mirror (explicit field list)
  FIRST — third occurrence of this landmine class.
- URL greps: check TAILS (160-char truncation caused a false "series lacks surf" verdict).
- Verify a premise with one probe BEFORE building on it (intersect-prefer).
- maplibre captures rAF at module scope; headless tile-render verification is dead — verify via
  style source templates (`map.style.tileManagers`).
- Supabase: RLS bypass ≠ GRANT (42501 class); MCP can't reveal secret keys — the authenticated
  local CLI (`supabase projects api-keys`) is the local secret path.
- Offline RainViewer tile harness (scratchpad, pngjs + verbatim module copy) = the radar
  forensic method of record.
