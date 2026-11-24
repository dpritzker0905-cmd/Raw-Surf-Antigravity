# 2026-11-24 · claude · tide-A gate pre-registration (tide-a-harcon-v1)

Append-only. Stamps come from `date -u`.

## 16:08Z: gate written and stations frozen, before any data

- **Why:** `tide-datum-parity-v2` FAILED in both strata (run 45421486227). The p90 tail sits at bay and harbour
  stations where FES2022b's A misses. David chose "Fix tide model first"; the director asked for a NEW pre-registered
  gate for A.
- **Gate:** `gates/tide-a-harcon-v1.md`. The candidate is NOAA CO-OPS harmonic constants from the nearest OTHER type-R
  station: w = 1 within 10 km, falling linearly to 0 at 25 km, then FES2022b. Scored leave-one-out at fresh stations
  over a fresh window, 2027-02-01 → 02-15.
- **Stations:** `scripts/tide_datum/a_harcon_select.py`, output `research/tide-a-harcon-v1-stations.json`.
  - Metadata and ETOPO only.
  - 280 previously read ids are excluded; 853 stations are eligible.
  - 20 + 10 per stratum (HARBOR_BAY, OPEN_COAST), seed 20261125.
  - The selection ran with ≤ 25 km. The review changed the rule to < 25 km, and re-walking with the saved classes
    gives the identical set.
- **Advisory review:** SubQ and Reflection, public context only. Their findings are adopted or answered in the gate's
  section 9. LongCat was not used (it needs David's approval).
- **D-090:** no guardrail family reads the served tide, so the flag is BLIND. Coverage is feasible but not built. The
  fix may not ship ON; dark before a tide tester exists is the owner's call.
- **Not done:** the instrument (its own PR, gated before any tag), and any data. #1149 and #1171 stay HELD.

## 16:55Z: provenance fix for the advisor's HOLD on #1273 (51ac1794d)

- **The problem:** the selector depended on files that exist only on #1149 (`us_region`, `_km` and the v2 snapshot),
  and its seen-scan reads artifacts that are only there too. On dev's tree it would find 90 ids, not 280.
- **Vendored** into `a_harcon_frozen.py`, all verbatim from `c29f234df`:
  - `us_region` and `_km` (a diff confirms the copy is exact);
  - the snapshot, byte-identical (sha256 `7e24d1b2…`);
  - the seen list, frozen as `research/tide-a-harcon-v1-seen.json` (280 ids, from scanning `c29f234df`'s tree,
    equal to the committed list).
- **Re-run on this PR's own tree:** the stations JSON is byte-identical, sha256 `ff00cf54…`.
- **Gate §3:** a dated PRE-DATA note now records the base, the sha256 values and the command. It also states the
  instrument's dependency (`parity_coops`, `finder_check` must be vendored or wait for #1171), flags the Ocean City
  near-twin donor (0.752 km), and records the widened exclusion scan for future gates.

## 18:28Z: tide-guard-v1 pre-registered (the TIDE guardrail family), before any data

- **Why:** David, about 17:05Z, via the director: "Build tide tester first (Recommended)". The order is this gate,
  then the tester code, then the A instrument, then the tagged A run.
- **Gate:** `gates/tide-guard-v1.md`.
  - The tester scores the served table's two A arms (`am_h` ON, `am` OFF) against NOAA High/Low predictions at 40
    SUBORDINATE monitors, in two disjoint 7-day windows per build.
  - Its sanity breaches act at once.
  - Acceptance needs the T1–T6 unit and integration tests, plus five planted controls in a sandbox on the first real
    two-arm build.
  - It is REPORT-ONLY until `TIDE_GUARD_RELEASED=1`.
- **Monitors:** `scripts/tide_datum/guard_select.py`, output `research/tide-guard-v1-stations.json`.
  - Snapshot: `research/tide-guard-v1-tp-snapshot.json` (fetched 2026-11-24, with `reference_id`).
  - The donor and w are taken at the key.
  - A monitor's reference is never its key's donor.
  - No monitor, reference or donor is a `tide-a-harcon-v1` station.
  - 1387 eligible; 20 + 10 per stratum.
- **Review:** SubQ and Reflection, public context only; dispositions are in the gate's §10. The first selection run
  was stopped before completion when the review changed the rule, and its output was discarded and never committed.
- **Not done:** the tester code (its own PR). `flag_guardrail.py` is at 756/760 lines, so a block moves out first.

## 18:44Z: tide-guard-v1 amendment 1 (the advisor's pre-code L1), before any tester code

- **The advisor's read of #1278** at `3a7df56b4`: PASS-WITH-LIMITS. Leakage checks clean (0 violations); the type-S
  truth is valid.
- **`gates/tide-guard-v1-amendment-1.md`:**
  - (a) the 36 h staleness test runs every cycle, never from a cached verdict;
  - (b) the blind report counts UNTESTABLE cycles spanning ≥ 24 h, not builds;
  - (c) it opens ONE issue, "TIDE guard blind: …", which matches none of the other three guardrail searches.
- **Disclosed:**
  - the near-lineage monitor 9418686 is reported every run (its reference is 4.865 km from its key's donor, so any
    bias favours ON);
  - an alternating WORSE / NOT_WORSE sequence resets the strike count.
- **Next:** the tester code as its own gated PR, after moving a block out of `flag_guardrail.py`. The A build's
  two-arm table is a separate PR.
