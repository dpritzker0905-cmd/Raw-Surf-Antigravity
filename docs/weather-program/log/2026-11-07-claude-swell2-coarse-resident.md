# 2026-11-07 claude: GFS swell_2 "COARSE 2 deg GRID" at Now (root cause pass)

Live, dev, one cold press (reload, Swell 2 after 6 s), polled every 100 ms, no load loop:
- +1.4 s: GPU upload 2 = regional 3 deg box (arbiter: empty_resident, fresh_same_target). Engine resident = 9x11 (0.25 deg).
- +2.2 s: the 181x80 world global_mid grid (2 deg) arrives; arbiter tier_downgrade; `WebGLMarineEngine.js:~215-232` REJECTS it (resident kept) and stashes it (`_pendingDowngrade`, self-heal).
- But `WebGLMarineLayer.js:~288-295` runs `noteCommitted` and `updateMarineTruthTrace('upload', ...)` unconditionally after `engine.setWaveData`, only `publishMarineDrawn` is guarded by `engineHoldsGrid` (W-1). The fetch state and `__MARINE_PROJECTION_DIAG__` carry the world grid too, so the HUD (`TruthOverlay.js` Class row, marineData.grid / projDiag) said COARSE 2 deg while `__MARINE_DRAWN__.resolutionDeg` was 0.25 and the engine held the regional grid.
- Why only swell_2: marineController sibling warm order (`waves, swell_1, swell_2, wind_waves`, ~119-121) leaves swell_2 cold longest, so a quick press hits this world-grid race.
- Not shown: particles on the 2 deg field. The engine kept the regional resident for the wave grid; `_coarseBaseData` (181x83) is the wash behind it, so the coast band outside the 9x11 resident box (lat 27.5-30 only, West Palm 26.7 is south of it) is the wash's land-masked 2 deg cells. That is by design (resident_uncovering), not a commit bug.

Fix shipped (client, ON, kill `__RAW_DISABLE_HUD_RESIDENT_TRUTH__`): `hudResidentTruth.js` makes the HUD resolution come from the engine's resident when it differs from the offered grid. Test reproduces the cold sequence. Not fixed: the stash/self-heal still carries the world grid in fetch state, and the regional resident's 9x11 extent is narrower than the opening viewport band.
