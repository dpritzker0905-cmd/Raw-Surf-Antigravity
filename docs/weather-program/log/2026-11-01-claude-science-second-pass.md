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
