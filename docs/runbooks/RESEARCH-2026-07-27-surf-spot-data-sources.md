# RESEARCH 2026-07-27 — every free surf-spot source, and why none of them grow the catalogue

Owner asked for sources to build "a complete catalog for our users", supplying surfing-waves.com,
stormrider.surf, wannasurf.com, swellarchive.com, thesurfatlas.com and surfspots.co.

**Every one was checked for LICENCE FIRST, then coverage.** That order matters: this codebase has
already declined Surfline on ToS grounds and has a standing rule that production carries **zero
`osm_id`** because OSM is ODbL share-alike. A source that cannot be used legally has no coverage.

Our catalogue today: **1,516 spots** (1,515 active).

---

## THE TABLE

| source | spots | coordinates | licence — verbatim where quoted | verdict |
|---|---|---|---|---|
| **Wannasurf** | **9,511** | **6,262 GPS waypoints** | *"© Wannasurf.com ltd - All right reserved"*; *"The contents and design of the Site and any material…are copyright of Wannasurf.com and its licensors."* No CC/open licence. Has a **permission-request page**. | ⛔ scraping — ✅ **ASK. Best target by far.** |
| **Stormrider** | **5,000+** | yes (map-based) | *"strictly for personal use and subject to Copyright law, with copying or distributing without consent strictly prohibited"*. Subscription, no API. | ⛔ scraping — licensing conversation |
| **OpenWaterAtlas** (Zenodo, DOI 10.5281/zenodo.20668393) | 2,928 **mixed** dive/kite/surf/freedive | yes, `spots.csv` | **CC-BY 4.0** — but see the trap below | ⚠️ **ODbL-tainted** |
| **surfing-waves.com** | 1,378 | not exposed | *"You agree not to reproduce, duplicate, copy, sell, resell or exploit for any commercial purposes, any portion of the Service"*; *"not to access the Service by any means other than through the interface that is provided"* | ⛔ **and smaller than ours** |
| **SwellArchive** | 1,000+ | not stated | *"Copyright © 2026 - All right reserved"* | ⛔ **and smaller than ours** |
| **OSM / Overpass** | ~1,254 surf objects (~555 real features; ~699 are shops/schools) | yes | **ODbL share-alike** | ⚠️ owner's judgement call |
| **thesurfatlas.com** | destination guides, no spot count or coords | no | *"© 2026 Surf Atlas"*, ToS not open | ⛔ not a dataset |
| **surfspots.co** | not stated | not stated | **no licence found on the site** | ⚠️ would need direct contact |
| **Wikidata** | **40** | yes | **CC0** | ✅ clean, tiny — 8 genuinely absent remain |
| **GeoNames** | — | yes | **CC BY** | ⚠️ measured 07-27: only ~2-3 of 12 hits trustworthy |
| **Windy.app** | "thousands of spots" | not exposed | *"The weather forecast, all info about spots and content of the articles is provided for **personal non-commercial use**."* | ⛔ closed; guide article, not a dataset |
| **Surfline** | — | yes | ToS prohibits scraping | ⛔ previously declined |
| surfd.com "best surf forecasts" | — | — | An article REVIEWING forecast providers, not a spot source | ⛔ not a dataset |

**surfd.com was still worth reading** — it enumerates the whole commercial field (Surfline,
Swellnet, Surf2Surf, Windguru, Windfinder, Surf-Forecast, Swellinfo, Windy.com, UK Met Office) and
**not one of them publishes open spot data**. Several have free *viewing* tiers; none offers a
reusable spot list. That is a useful negative result: the market has been surveyed and the answer
is uniform.

---

## ⚠️ THE TRAP — a CC-BY wrapper does not cure ODbL provenance

**OpenWaterAtlas looks like the answer and is not.** It is genuinely published CC-BY 4.0 on Zenodo,
which is why it survives a licence-label check. Its own README does not:

> spot locations originate from three sources: **OpenStreetMap** — nodes tagged with water sports
> categories (`sport=scuba_diving`, `sport=kitesurfing`, `sport=surfing`) … operator-published site
> lists … community contributions

and it requires you to *"credit … **OpenStreetMap** downstream"*.

⇒ The OSM-derived records inside it **still carry ODbL share-alike**. Importing OpenWaterAtlas is
the same exposure as importing OSM directly, with the provenance one layer harder to see. It is
also **mixed-activity** — dive + kite + surf + freedive across 2,928 rows — so the surf subset is
some unstated fraction, quite possibly smaller than our existing catalogue.

★ **The general lesson: check the upstream sources named in a dataset's README, not the licence
badge on its landing page.**

---

## ★ THE JACOBIAN — this is a PERMISSION problem, not a DISCOVERY problem

Sort every source by whether it would actually grow a 1,516-spot catalogue:

* **Sources big enough to matter — Wannasurf (9,511) and Stormrider (5,000) — are BOTH closed by
  terms of use.**
* **Every openly-licensed source is smaller than what we already have** (surfing-waves 1,378,
  SwellArchive 1,000, OSM ~555 real surf features) **or tiny** (Wikidata 40).

⇒ **There is no free, licence-clean bulk source that grows this catalogue.** That is now the
**third independent confirmation** of the 2026-07-26 expansion refusal, reached from a completely
different direction (the first was OSM's own object count; the second was Wikidata holding only 40
breaks worldwide).

**So the two paths that actually add spots are:**

1. **Ask.** Wannasurf has a permission-request page and 6,262 GPS waypoints — 4× our catalogue. This
   is a commercial/licensing conversation the owner can have; it is not something to route around.
   Stormrider is the same shape (they market a "Passport" subscription, so they already sell
   access).
2. **Our own crowdsourcing flow — which is ALREADY BUILT AND STARVING.** `refinements.py` is a
   complete propose → review → approve pipeline (`crowdsourced_pending` → `verified` →
   `offset_adjusted`), `AdminPrecisionQueue.js` renders it, `AdminSpotEditor.js` edits it — and
   `spot_refinements` holds **1 row**. The mechanism to let 1,516 spots' worth of users add and
   correct spots exists and has never been switched on.

---

## ⚠️ AND COVERAGE IS NOT CURRENTLY THE BINDING CONSTRAINT

Measured this session: **167 of our 1,516 spots are provably misplaced** (flagged), and until today
three of them were shipping shore normals fitted to a *lagoon*. Two of the owner's own local spots
— Bethune Beach and New Smyrna Flagler Avenue — were **7 km and 2.6 km from where they belong**.

Adding 5,000 unverified spots to a catalogue with an 11% placement-error rate makes the product
worse, not better. **Accuracy first, then volume** — and volume, when it comes, comes from a
licence, not a scraper.

---

---

## ADDENDUM — the measured market, and why 9,000 is not obtainable for free

Everything above was licence research. This is the **size** research, measured directly rather
than quoted.

**OSM, counted live via Overpass on two independent mirrors:**

| query | worldwide total |
|---|---|
| `nwr[sport=surfing]` | **1,254** (kumi 1,246 — the two mirrors agree to 0.6%) |
| …with a `name` | 1,052 |
| …named, excluding shop / office / club / school / sports_centre | **539** |
| `nwr[natural=reef][name]` | 4,330 (mostly dive reefs and navigation hazards, not breaks) |

**Wikipedia, counted via the category API:** `Category:Surfing_locations` = **29** pages,
`Category:Surfing_in_the_United_States` = 17, `Category:Surf_breaks` = **0**. Even walking every
subcategory this is low hundreds, not thousands.

### THE TABLE THAT MATTERS

| source | real named surf spots | licence |
|---|---|---|
| **Wannasurf** | **9,511** (6,262 with GPS) | closed — permission "may be subject to a fee" |
| **Stormrider** | **5,000+** | closed, subscription |
| **★ Raw Surf (ours)** | **1,516** | ours outright |
| surfing-waves | 1,378 | closed |
| SwellArchive | 1,000+ | closed |
| **OSM** | **539** | ODbL (separable via `osm_id`) |
| Wikipedia | ~29–100 | CC-BY-SA |
| Wikidata | 40 | CC0 |
| GNIS / NGA GNS | *unlimited coverage, OFFICIAL names* | public domain |

★★ **Our 1,516 is already the largest freely-obtainable surf catalogue in existence, and third
largest overall.** Everything bigger is closed; everything open is smaller. The 9,000 exists in
exactly two places on the internet and both require permission. That is not a research failure —
it is the measured structure of the market.

### ★ THE REFRAME: coverage and naming are SEPARABLE problems

The reason "get 9,000 spots" feels stuck is that it bundles two problems with different answers.

* **Exact GPS coverage — SOLVED, free, unlimited.** GNIS + NGA GNS name every coastal feature on
  Earth in the public domain, and our `ocean_access` + shore-normal chain filters them to
  geometrically valid coastal locations. Measured recall against our own Florida spots: **92.2%**.
* **Proper surf names — genuinely scarce.** A gazetteer says *Ehukai Beach*; a surfer says
  *Pipeline*. Only three sources map official → surf names, and two are tiny: OSM (539, ODbL),
  Wikidata (40, CC0), and our own community.

So the build is a layered one, and only the top layer is hard:

1. **GNIS/GNS + our physics** → thousands of valid coastal locations with exact GPS and official
   names. Public domain, unlimited, ours outright.
2. **Proximity-overlay OSM's 539** real surf names onto those locations. `surf_spots.osm_id`
   already exists to keep those rows separable, which is exactly what the OSMF *Collective
   Database* guideline turns on.
3. **Overlay Wikidata's 40** (CC0) and the 8 confirmed-absent famous breaks.
4. **Community renames and confirms** via `refinements.py` — the propose→review→approve flow that
   is fully built and holds **one row**.

Realistic unilateral ceiling: **~2,000 properly-named spots plus thousands of rated, correctly-
placed coastal locations.** Not 9,000 named. Nobody free has 9,000 named.

### ★ AND THE ASYMMETRY THAT IS ACTUALLY IN OUR FAVOUR

Wannasurf has 9,511 pins and no forecast physics. We have 1,516 spots with ETOPO-derived shore
normals, nearshore break depths, cross-shelf friction and a calibrated rating engine — and the
ability to rate **any coastal coordinate on Earth** without a catalogue entry at all. A user
standing on an unnamed beach can already be told what it is doing.

**A named pin is a lookup key. A rating is the product.** Chasing 9,000 unverified pins into a
catalogue with a measured 11% placement-error rate optimises the wrong number.

### THE ONE PATH TO LITERALLY 9,000

**Ask Wannasurf.** Their terms name the route explicitly: *"Requests for permission for other uses
may be sent to the Webmaster"*, and *"such requests may be subject to a fee."* There is no API and
no named contact — it is the site feedback form, addressed to the Webmaster. 6,262 GPS waypoints
behind one email and a commercial negotiation. That is the whole distance between 1,516 and 9,511.

## NEXT

1. **Owner decision: approach Wannasurf** (permission-request page) and/or Stormrider about
   licensing. That is the only path to a materially larger catalogue.
2. **Turn on the crowdsourced refinement flow** — it is built, wired, and empty.
3. **Import the 8 genuinely-absent Wikidata breaks** (CC0, ETOPO-confirmed): Shipstern Bluff,
   Belharra, Lunada Bay, Scheveningen, El Médano, Brouwersdam, Pointe du Diable, Elbow Ledge.
   ⚠️ Four of the original "14 missing" are already in the catalogue under other names — see
   `22f84245`.
4. **Do NOT import OpenWaterAtlas** without an explicit ODbL decision; its CC-BY badge does not
   describe its OSM-derived rows.
5. If the OSM question is ever revisited, `surf_spots.osm_id` already provides the separability the
   OSMF *Collective Database* guideline turns on — the obligation would travel with those rows, not
   the whole table. That is a judgement call, not a prohibition (see the 07-27 handoff §8a).

**Not legal advice.** The Collective-vs-Derivative line and any Wannasurf/Stormrider agreement are
worth a lawyer's time if the catalogue is a commercial asset.
