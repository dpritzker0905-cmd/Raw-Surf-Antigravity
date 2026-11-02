# 2026-11-01 (UTC 2026-11-02) · claude · science second pass, latest-science MCP (docs only)

Branch `claude/science-second-pass-2026-11-01`, stacked on the first-pass commit `290c15b01`
(`claude/science-sota-2026-11-01`). One writer: this session.

- ~04:30Z: appended §7 "Second pass (latest-science MCP)" to `docs/research/science-sota-2026-11-01.md`. No code, flag or
  served-number change.
- M7: replicated M4 on the independent 10-20 hold-out set (3 regions, 2°, 3 h and 6 h gaps). Linear Hs² blending in
  time loses to linear Hs in 6/6 cells, and every block-bootstrap CI excludes zero; Catmull-Rom on Hs is best. Read
  offline from saved Open-Meteo data, so there was no load on our backend.
- New from the WW3 v5.16 manual: GFS partitions are untracked per-node watershed slots ("no coherence … over
  geographical space and in time"), and wind sea is identified by wave age (multiplier 1.7).
- Literature added with OpenAlex citation counts:
  - Zhang 2021 γ(s₀, kh);
  - Campos 2020 and Lenartz 2010 (post-processing gain = bias);
  - HyWaves 2023 (per-partition downscaling);
  - Aurora's peak smoothing;
  - OceanCastNet;
  - the Iberian surfing-day validation against app session logs;
  - Wave Peel Tracking.
- Four contradictions with memory, listed in §7.3.
- Reflection (Beam, high effort) reviewed the top 5: agree ×2, agree-with-caveat ×3. All caveats are folded into §7.
- Live load: none. SCOREBOARD: no row, because no served number changed.

## Third pass (owner 22:45 EST: "keep the researcher digging deeper")

- 04:55Z: §8.1-8.2 (verification metrics and buoy QC; swell decay and arrival), commit fd47f59e2.
- 05:05Z: §8.3-8.4 (wind-sea growth and fetch; tide and bathymetry), commit 98f0e347f.
- 05:20Z: §8.5-8.7. Peak-capture check (Hs² gives no peak benefit; Catmull-Rom best). CDIP publishes MOP
  transformation coefficients. Ranked top 10 after three passes. Twelve contradictions with memory.
- Source status:
  - OpenAlex works, but `fetch_top_cited` needs concept IDs.
  - Europe PMC and CORE return "API server error".
  - arXiv returns 429.
  - Some publisher PDFs gave 403 or failed extraction.
- Live load: none. SCOREBOARD: no row.

## Fourth pass (lead 23:04 EST: SciWeave, #680, open K tools, owner's MCP paper)

- 05:40Z: §9.1-9.7.
  - The operational GFS-Wave writer is settled: global-workflow `ww3_grib_gfs.x` with
    `OUTPARS_WAV="... PHS PTP PDIR"`, so SWPER/WVPER = PTP (peak).
  - Direction-binned MOS: assessed as a sound interim at Canaveral (buoy→buoy ratio × period band), with a
    validation plan.
  - Open K tools table, with a serve-time lookup design and a Canaveral pipeline.
  - O'Reilly & Guza 1991: rays are not accurate for narrow swell over complex bathymetry, so a SWAN check is required.
  - AIFS wave: summer-only evaluations; gate on a winter.
  - Ordinal rating calibration (McCullagh 1980; RPS).
- Not reached:
  - SciWeave is not loaded in this session;
  - the Ayuso-Virgili 2024 full text (the publisher page was refused by the session's bot-check policy; the abstract
    only is used);
  - retargeting #681's base onto #680's branch was denied, so #681 stays on dev, stacked on 290c15b01.
- Live load: none. SCOREBOARD: no row.
- 05:55Z: §9.8 records the lead's SciWeave answers, with edits elsewhere:
  - contradiction #13 is softened: rays by default, with a ≤ ~90 m SWAN check only for narrow swell over shoals
    (Crosby et al. 2019, JTECH 36:217);
  - top-10 #3 must beat persistence and AR(p) (Jiang et al. 2024);
  - #5 is gated on a winter sample;
  - Fanti 2023 supports calibration.
