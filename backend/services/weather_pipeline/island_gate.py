"""The island lane's SERVING gate — ONE definition for every manifest selection site.

`copernicus_island_ingestion` documented itself as "inert by construction -- until a serving tier
reads region_id `island_*`". No tier ever read region_id, and none had to: every manifest selection
site ranks candidates on geometry, and island tiles are 0.083° — the finest resolution in the
estate. They did not leak into selection, they WON it.

⇒ INERTNESS IS A PROPERTY OF THE SELECTOR, NEVER OF THE WRITER. A lane is inert only when something
on the READ path excludes it; "I only write products" is not a safety property while the reader
ranks on an attribute the new products dominate.

THIS PREDICATE LIVES ALONE BECAUSE THERE ARE FIVE SELECTION SITES AND NO CHOKE POINT. It started
inline in point_resolution on 2026-09-19 covering three; auditing the rest that day found two more
on the higher-traffic `/api/weather/grid` path. Five copies of a predicate is how the 4096/340
literals happened — one definition, imported.

GATED SITES (all five, pinned by tests/test_island_serving_gate.py):
  1. point_resolution._resolve_point_internal
  2. point_resolution.find_cached_grid_product
  3. viewport_helper.find_any_cached_product_helper
  4. grid_resolver_selection.find_candidates          ← /api/weather/grid, ranks by smallest
                                                        coverage area on an intersection tie, so an
                                                        island tile won DETERMINISTICALLY when
                                                        zoomed in at an island
  5. grid_resolver Step 6 regional_partial overlap    ← ties on intersection then falls to LIST
                                                        ORDER, the same trap mid_res_tier already
                                                        documents for global_mid

AUDITED AND EXONERATED, do not re-audit without cause (2026-09-19):
  lattice_fill._lane_items        — exact-match allowlist ("global_coarse", "global_mid")
  icon_marine_extension           — region_id allowlist AND model ICON/GFS (island tiles are EURO)
  far_edge_hold                   — requires coverage_mode == "global_tile"; island is regional_tile

Arm: COPERNICUS_ISLAND_SERVE=1. Ingest is separate and defaults OFF (COPERNICUS_ISLAND_INGEST).
Rationale: docs/runbooks/RATIONALE-2026-09-19-island-serving-gate.md
"""
import os

ISLAND_REGION_PREFIX = "island_"


def island_serving_armed() -> bool:
    """True only when the owner has explicitly armed island serving."""
    return os.environ.get("COPERNICUS_ISLAND_SERVE", "0") == "1"


def is_island_gated(p) -> bool:
    """True when `p` is an island-lane product AND island serving is not armed.

    Keys on region_id, NEVER on resolution: a gate that excluded every fine product would pass
    most tests while silently dropping legitimate high-resolution tiers.
    """
    if island_serving_armed():
        return False
    return str(getattr(p, "region_id", None) or "").startswith(ISLAND_REGION_PREFIX)
