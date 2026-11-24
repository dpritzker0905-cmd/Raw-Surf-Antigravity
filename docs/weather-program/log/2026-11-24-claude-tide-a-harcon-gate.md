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
