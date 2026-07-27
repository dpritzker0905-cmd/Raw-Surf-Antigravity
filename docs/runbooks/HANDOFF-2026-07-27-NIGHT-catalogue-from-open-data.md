# HANDOFF 2026-07-27 NIGHT — the catalogue can be BUILT from open data, and the admin can finally see it

**Continues `HANDOFF-2026-07-27-EVE-weather-sim-and-the-water-blind-detector.md`.**
~20 commits on `dev`, all pushed, tree clean. Backend **1083 passed / 0 failed** (the one
pre-existing grom-media contract failure excluded — unrelated, reproduced clean before any change).
Frontend `craco build` succeeds.

Read [[standing-work-rules-user-mandate]] first. Everything below was measured, and **six of my own
claims were overturned by measurement this session** — they are marked ⚠️ where they appear.

---

## 0. ⛔ READ THIS BEFORE TOUCHING SPOT DATA

**Nothing has been imported.** `import_reviewed_spots.py` is **dry-run by default** and needs
`--commit`. The full ranked Portugal+Ireland candidate list is being produced by
[run 30293941194](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/30293941194)
— collect the `spot-candidates-reviewed` artifact, review the `NEW` rows, then import.

Production writes made this session are in §1. All are reversible; snapshots exist.

---

## 1. PRODUCTION WRITES (all applied, all reversible)

| | before | after |
|---|---|---|
| `is_verified_peak` | 1300 | **44 → 55** (55 now have a real `verified_by`; the owner verified 11 by hand) |
| `flagged_for_review` | 0 | **165** |
| `accuracy_flag='low_accuracy'` | 0 | **165** |
| `accuracy_flag='offset_adjusted'` | 0 | **2** (Bethune Beach, NSB Flagler Ave — relocated) |
| `is_active=false` | 0 | **1** (the inland `New Smyrna Beach Inlet` duplicate) |

Snapshots: `surf_spots_verified_peak_backup_20260727`, `surf_spots_placement_backup_20260727`.
Rollback SQL in the EVE handoff §1.

**Volusia, from the owner's own eyes:** Bethune Beach was **7 km** off in BOTH axes (28.998,-80.926
→ **28.950892,-80.83899**, Volusia County parks) and Flagler Ave **2.6 km** (29.028,-80.921 →
**29.038081,-80.895559**, Natural Atlas + Sandee agreeing independently). Shore normals went
**70.1→57.9** and **84.8→64.9**, into the neighbour band (53.8–71.6) from outside it.
★ **An authoritative civic source beat both my map recall AND a geometric snap** — my ETOPO-only
proposal would have kept Bethune's wrong latitude.

---

## 2. ★★★ THE ADMIN WAS BLIND, IN THREE SEPARATE WAYS

Owner: *"I still don't see the admin surf spots area looking like its working right."*
★ **I had been reading the source instead of rendering the page. Running it took two minutes and
showed every defect immediately. Do that first.**

1. **`ad6cd082` — the stats endpoint measured nothing.** `/admin/spots/stats` returned
   total/country/tier only; **no number was a function of the accuracy columns**, so 1414 changed
   rows rendered identically.
2. **`46280a1b` — the list was fed PUBLIC data.** `AdminSpotsPanel` was already *written* for admin
   data (the row renders `{spot.is_verified_peak && …}`) but `fetchSpots` called `/surf-spots`,
   whose `SurfSpotResponse` **omits `is_verified_peak` / `flagged_for_review` / `accuracy_flag`**.
   Every badge was `undefined && …` and rendered nothing, forever. Now on `/admin/spots/list`, with
   a per-row accuracy badge, an accuracy filter, and an honest "showing N of M".
3. **`7883e4b0` — the tiles went stale.** `handleUpdateSpot` refreshed the list but not the stats.
   Everything now routes through one `refreshAll()`; header shows **"Live · updated HH:MM:SS"**
   with a 60 s auto-refresh.

**`dcd7c9f6` — and the Import button reported success while importing nothing.** Owner: *"We added
some, and I don't see them."* **Nothing was hidden — nothing was ever written.** No `surf_spots`
row created since **2026-04-23**; no `spot_edit_logs` row since 2026-07-13; the dev Supabase has
**no `surf_spots` table at all**; `dev.db` is a divergent June-9 snapshot *missing 77 US spots*.
`import_curated_spots` reads **358 hardcoded `CURATED_SPOTS`** and skips anything already present —
and the catalogue holds all 358, so a *correct* run adds **zero** while `toast.success` fired
anyway. ★ **The button was structurally incapable of adding a spot.** Also the OSM leg was gated on
`tier > 0` while the UI defaults to tier **0**, so the checkbox did nothing.

---

## 3. ★★★ THE CATALOGUE CAN BE BUILT FROM OPEN GOVERNMENT DATA

The owner ruled out licensing Wannasurf and asked for government data instead. **That is the better
path**, and the reason is structural: surf spots ARE beaches, and governments publish beaches
exhaustively, with coordinates, under open licences, because they are legally required to.

**EU Bathing Water Directive → 15,091 coastal sites, CC-BY 4.0**, one command
(`spot_sources.py --source eea --all-europe`). 14,893 are not within 2 km of anything we have.
Atlantic surf coast alone: Portugal 445, France 2012, Spain 1875, England 340, Ireland 128.

★★ **AND THE NAMES MATCH**, which was the open question. Officialdom says "Ehukai Beach" where a
surfer says "Pipeline" — but not in Europe:

```
Pors Carn -> PORS CARN 1.97 · Carcans -> CARCANS OCEAN 1.07 · Lafitenia -> LAFITENIA 1.12
Rossnowlagh -> ROSSNOWLAGH 1.28 · Ribeira d'Ilhas -> RIBEIRA DE ILHAS 1.06 · Thurso -> Thurso 1.21
```
EEA recall against our 133 European spots: **45.9% @1 km, 64.7% @2 km, 77.4% @3 km.**

### The measured market (counted, not quoted)
| source | real named spots | licence |
|---|---|---|
| Wannasurf | **9,511** (6,262 GPS) | closed — *"may be subject to a fee"* |
| Stormrider | 5,000+ | closed |
| **★ Raw Surf** | **1,516** | **ours** |
| OSM | **539** (Overpass, two mirrors agreeing to 0.6%) | ODbL |
| Wikipedia `Category:Surfing_locations` | **29** | CC-BY-SA |
| Wikidata | 40 | CC0 |
| GNIS / NGA GNS | *unlimited coverage, official names* | public domain |

★ **Our 1,516 is already the largest freely-obtainable surf catalogue that exists.** Everything
bigger is closed; everything open is smaller.

⚠️⚠️ **OpenWaterAtlas (Zenodo, CC-BY 4.0) is a TRAP.** Its own README says spot locations come from
**OpenStreetMap** and requires crediting OSM downstream ⇒ ODbL rides along, badge notwithstanding.
**Read the upstream sources named in a README, not the licence on the landing page.**

---

## 4. THE PIPELINE (built, deployed, proven end-to-end)

```
spot_sources.py          open sources -> one shape, licence+attribution PER ROW
filter_spot_candidates.py  stage1 offline fetch (free) -> stage2 ETOPO -> rank
import_reviewed_spots.py   dry-run by default; --commit required
.github/workflows/discover-spot-candidates.yml   runs it where the key already is
```

**Portugal+Ireland result:** 622 in → 30 sheltered, 27 not-a-beach, 10 no-geometry rejected →
555 to stage 2 → **43 of our 55 existing spots rediscovered (~78% recall)**, **373 NEW**.
Top names are unmistakably real: **Areia Branca, Porto Dinheiro, Valmitão, S. Lourenço, Praia das
Maçãs, Santa Cruz**.

### ⚠️ Six of my own claims, overturned by measurement
1. **"Gazetteer recall is 3.9%"** — WRONG three times over: an alphabetical `--limit` (GNIS files
   are name-sorted, so I sampled A–B), a bbox mismatch, and **`Populated Place` excluded from
   `COASTAL_CLASSES`**. Surf spots are named after coastal TOWNS: for **40 of 102** Florida spots
   the nearest feature is a `Populated Place`. Real recall **92.2%**.
2. **"The 1.5 km ocean cutoff separates cleanly"** — WRONG. Calibrated on 17 spots, at catalogue
   scale it flagged 250 (17%) including **J-Bay Kitchen Windows, Puerto Escondido Carrizalillo,
   Thurso, Maroubra, Ribeira d'Ilhas**. The tell was the SHAPE — mild catches piled at exactly
   1.50–1.53 km. Real gap: max-good 2.68 / min-bad 3.17 ⇒ **3.0 km**.
3. **"Land between pin and sea is the discriminator"** — REFUTED by data: good spots score
   0,0,0,0,0,0,1,1,2,2,2,3,3,3,4,5 land cells vs bad 3,4,6,7,8,12. Overlapping. Removed.
4. **"The bigger ETOPO window slowed the build"** — WRONG. **ERDDAP charges per REQUEST, not
   payload**: 484 cells → 22.06 s, 1600 cells → 21.83 s, same instant. My "optimisation" would have
   DOUBLED it.
5. **"Fetch separates the Mediterranean"** — NO. Naples 344 km > Bundoran 264 km. Storm climate,
   not distance, is the deficit.
6. **"I can't read the private bucket"** — the ACCESS claim was right (storage bytes aren't in
   Postgres; no sign/download function; `http`/`pg_net` available but not installed) but **"blocked"
   was wrong**: the server holds the key, so the fix is an endpoint / running the job in CI.

★ **And a recurring one: my map recall was wrong FIVE times** (Kitchen Windows, Bird Island,
"central Spain" which is open Mediterranean in 1,489 m of water, Bethune's latitude, Flagler's
latitude). **Take coordinates from the catalogue or an authoritative source. Never from memory.**

---

## 5. RANKING — and why geometry alone is not enough

Open-water **fetch SATURATES** on an exposed coast: 258 of 373 scored ≥500 km of a 600 km cap. Good
GATE, useless RANKER. The fix is `grid_size_climatology` — **observed p80 breaking heights per
coastal 2° cell, accumulated 6×/day, live in L2** (1,879 cells, refreshed 2026-07-27T14:19). It now
dominates `confidence` (0–50, saturating at 2.5 m) with geometry at half weight; absent, the score
is geometry-only **and the run says so**.

⚠️ **It needs `pydantic`** — `grid_size_climatology → store → schemas` imports it, and production's
L2 loader swallows ImportError by design (correct when serving). The first CI run silently degraded
to geometry-only because the job installed numpy+requests. Fixed, and the loader now reports the
actual reason.

⚠️ **OSM is NOT in the score, deliberately.** Its 536 named `sport=surfing` features include German
river waves (Eisbachwelle, Almwelle, blackforestwave) and clubs. Reported as `osm_surf_km` only.

---

## 6. NEXT (ranked)

1. **Collect [run 30293941194](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/30293941194)**,
   review the `NEW` rows top-down, import the good ones with `--commit`. Then re-run
   **Build Shore Normal Asset** so they get geometry.
2. **Work the Precision Queue** — 165 flagged spots are now visible and filterable in the admin.
3. **Extend to France/Spain/UK** (`-f countries=FR,ES,UK`) once the PT/IE batch proves out.
4. **Turn on the crowdsourced refinement flow** — `refinements.py` is a complete
   propose→review→approve pipeline holding **one row**. It is the other half of the machine.
5. **US coverage via GNIS**, worldwide via **NGA GNS** (`spot_sources.py --source gnis`).
6. Buoy calibration: fit a **quantile** correction, not a single number.
7. **Do NOT flip `RATING_LOCAL_SIZE`** — still no oversize penalty, so a beginner beach outranks
   the point break.

### ⚠️ OPEN / LATENT
* **`--offline-only` does not classify NEW/KNOWN** (stage 2 owns that), so an offline run's CSV has
  only stage-1 decisions. Fine, but do not read it as a candidate list.
* **`AdminSpotsPanel` still caps the rendered list at 50 rows** — the count line is honest about it,
  but there is no paging.
* Size-climatology coupling (unchanged): `grid_size_climatology.py:95` / `surf_rating.py:453`
  compute climatology **without** a break depth while served heights have one. Harmless at
  `RATING_LOCAL_SIZE=0`; fix before flipping.
* `test_media_privacy_contracts.py` still fails on `dev`, unrelated to all of this.
* ⚠️ **The WeatherSimulation MCP server holds the OLD module in memory** — restart it to pick up
  `dc8ee965`.
