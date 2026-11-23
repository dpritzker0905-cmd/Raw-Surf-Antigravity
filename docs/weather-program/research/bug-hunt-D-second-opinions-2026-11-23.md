# Bug hunt item D: second opinions on the total-sea band design (2026-11-23)

**Context.** Bug hunt 2026-11-22 item D (`bug-hunt-weather-sim-2026-11-22.md`, #1175): over Swell 1 / Swell 2 / Wind Waves the
map rating band graded the shown partition as if it were the whole sea. The owner decided "Rate the whole sea". The fix is PR
#1198 (`backend/services/weather_pipeline/band_total_sea.py`, flag `BAND_RATES_TOTAL_SEA`).

**Method.**
- The director relayed the owner's request for SubQ and Reflection reviews.
- Both reviewers got the same public description of the design: the system, the defect, the fix steps, the CI-frame keying and the tests. They got no code, no secrets and no private data.
- The figures below are model output, not statistics.

## Reflection (Beam-1.0, high effort)

Its verdict: "Mostly correct and likely the smallest fix", provided three things hold:
- the swap and restore are exception-safe;
- the swap never mutates a shared cached grid;
- the nearest-node sampling caveat is understood.

| Point raised | Verdict | Action |
|---|---|---|
| A rating that throws after the swap leaves total-sea values on the partition grid | **Real.** Reproduced: the served vectors read 2.0 m / 10 s / 80° under a swell_1 label. | Fixed: the restore now runs in `try/finally`. Test `test_a_failing_rating_restores_the_partition`. |
| A 0 m total-sea node and "no product" are conflated | **Real**, in a different way than stated. The sampler skipped nodes with speed 0, so a calm cell borrowed the nearest neighbour's swell and was rated. | Fixed: a 0 m node is now kept as a real calm, and the cell stays a valid, unrated partition. Test `test_a_calm_total_sea_cell_is_unrated_partition_not_a_neighbours_swell`. |
| In-place mutation of shared cached grids | Already safe: the overlay copies the vectors before the transform branch (pinned in `test_grid_surf_overlay_copies.py`). | Added `test_the_shared_cached_product_is_never_mutated` for the partition path. |
| `/grid_series` must sample per frame | Already true: the series resolves and overlays each frame at its own valid time (`grid_series_helper` passes `valid_time=vt_str` per hour). | None. |
| Unrated cells must get their partition speed and phys_speed back | Already covered by `restore`, and pinned by `test_the_partition_keeps_its_own_height_period_direction_and_motion`. | None. |
| The nearest total-sea node or product may differ from what the `waves` band's own grid uses | Accepted, by design. The per-cell pick is the **point resolver's** (the glyph's), which is the composition the owner asked to match. Where the viewport's `waves` grid comes from the same product, the scores are equal cell for cell (the parity test). | Documented here. |
| CI reuse must invalidate when the total-sea candidates change | Already done: a partition frame's ask signature includes the waves candidate filenames, and other layers' signatures are unchanged. | None. |

## SubQ (snap-1.2, Decisions API)

| Question | Answer |
|---|---|
| Is the design correct and sound? | true 0.955 |
| Biggest remaining risk | `user_confusion_legend` 0.850 (then `product_mismatch` 0.093) |
| Should the legend say it rates the whole sea over a partition? | true 0.968 |

**Action.** The legend title over a partition layer now reads "Surf Rating · whole sea (coastal band)".
- It is the same helper (`ratingBandLegend.js`) in all three layouts: the desktop panel, the mobile collapsed float and the mobile expanded sheet.
- It is styled with the existing theme-aware text classes.
- Kill switch: `window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__`.
- Test `ratingBandLegend.test.js` renders it in light, dark and beach, on desktop and mobile.
- ⚠️ The label cannot see the server flag. If `BAND_RATES_TOTAL_SEA` is killed, kill the label too.
