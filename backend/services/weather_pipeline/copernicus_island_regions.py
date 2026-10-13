"""
The 0.083° island region list — where a 0.25° marine grid cannot resolve the coast.

WHY THESE REGIONS AND NOT OTHERS. Measured, 2026-08-18: at 0.25° (~22.5 km) a small island occupies
ONE grid cell, so its cell is filled with the MEAN of its ocean neighbours — mixing the sheltered lee
with the exposed windward side — and bilinear filtering then spreads that single averaged value onto
both shores. That is the island halo the owner reported. It is provably unfixable by any infill: at
unit island thickness a Laplace/Dirichlet solve returns the neighbour mean to within 0.03 m.

The Madeira pilot proved finer data fixes it, on the SAME live API:

    windward shore   0.25° renders 1.24-1.38 m   |   0.083° reads 1.62-1.77 m
    lee behind it    averaged away               |   0.59-0.98 m, sharp
    island cells     0.0, then extrapolated      |   null (the mask consumes them directly)

⭐ The owner's "turquoise ring" is a SMEARED version of a real wave shadow — 1.65 m windward against
0.59 m in the lee, eight kilometres apart. At 0.25° that structure collapses into one ~1.1 m cell, and
that collapse IS the ring. Finer data does not paper over the defect; it removes its cause.

HOW THE LIST WAS DERIVED (program/weather-simulation/COPERNICUS_ISLAND_REGIONS.json carries all 69):
  1,773 spots from PRODUCTION /api/surf-spots crossed with Natural Earth 50m land, split into 1,421
  individual landmasses. Each spot attributes to the SMALLEST landmass whose bbox (+0.35°, since a
  spot sits in the water off its shore) contains it. Landmasses under 150 km diagonal are kept — below
  that a 22.5 km grid cannot separate windward from lee. Landmasses within 0.6° merge into one region;
  each region is padded 0.45° (~5 cells of open water per side, enough to carry the windward/lee
  structure the pilot found).

  island spots (<150 km landmass) ... 549 across 119 landmasses -> 69 regions
  mainland / large landmass ......... 1,218 spots — OUT OF SCOPE: their averaged cells sit inland, so
                                      the coastline covers the ramp (Lisbon has 0.0 cells and no band)
  no NE land within 0.35° ...........     6 spots — KEPT as candidates in the full list, because
                                      NE 50m OMITS small islands, i.e. exactly the worst cases. Absence
                                      of land data must fail SAFE toward inclusion.

TOP 20 chosen by spot count: 398 spots = 72% of all island spots for 19,963 cells. The tail is poor
value — all 69 regions add only 28% more spots for another 13,000 cells, mostly single-spot regions.

COST, measured rather than assumed:
  ⚠️ Latency is FIXED PER SUBSET CALL, not per cell. Same bbox at three densities:
        40 pts -> 12.4 s      150 pts -> 12.0 s      308 pts -> 13.4 s
     So 20 regions ≈ 20 calls ≈ ~4.3 min per frame. An earlier estimate of "0.8 h per frame" divided
     one call's latency by its cell count and assumed linearity — it was wrong by two orders of
     magnitude. Never derive a per-unit rate from a single measurement without testing the slope.
  Payload: 232 B/cell/frame (measured) -> 4.6 MB/frame, ~37 MB/day at the 3-hourly cadence.
  ⚠️ The cell counts below are the ACTUAL region_axes lattice, not span/resolution rounded.
     The first pass understated them by 3.1% because the lattice includes BOTH edges; a
     published cost figure has to come from the code that does the work.

Every region's span is within the 28°x55° single-request limit that copernicus_marine_service._fetch_sync
enforces before it falls back to tiling, so each region is ONE subset. The widest is 5.64°x4.35°.
"""
from typing import List, Dict

# (slug, west, south, east, north, spots, cells) — ordered by spot count, which is the ingest priority.
ISLAND_REGIONS: List[Dict] = [
    {"id": "azores",           "west": -29.292, "south":  36.492, "east": -24.577, "north":  39.545, "spots": 57, "cells": 2109},
    {"id": "florida_bahamas",  "west": -80.887, "south":  24.199, "east": -75.665, "north":  28.301, "spots": 46, "cells": 3150},
    {"id": "hawaii",           "west": -160.693, "south": 20.149, "east": -155.540, "north": 22.673, "spots": 40, "cells": 1922},
    {"id": "outer_banks",      "west": -77.124, "south":  34.203, "east": -75.186, "north":  36.396, "spots": 30, "cells": 648},
    {"id": "madeira",          "west": -17.691, "south":  32.198, "east": -16.243, "north":  33.319, "spots": 23, "cells": 252},
    {"id": "bali_lombok",      "west": 115.030, "south":  -9.379, "east": 117.184, "north":  -7.754, "spots": 22, "cells": 520},
    {"id": "canaries",         "west": -18.611, "south":  27.196, "east": -12.973, "north":  29.687, "spots": 21, "cells": 2040},
    {"id": "santa_catarina",   "west": -49.005, "south": -28.262, "east": -47.928, "north": -26.950, "spots": 18, "cells": 208},
    {"id": "mid_atlantic",     "west": -75.829, "south":  37.422, "east": -73.617, "north":  41.108, "spots": 18, "cells": 1215},
    {"id": "lesser_antilles",  "west": -61.990, "south":  12.612, "east": -58.978, "north":  16.957, "spots": 16, "cells": 1961},
    {"id": "maldives",         "west":  73.023, "south":   3.705, "east":  73.978, "north":   4.698, "spots": 13, "cells": 144},
    {"id": "andaman_thailand", "west":  97.668, "south":   7.467, "east": 100.524, "north":  10.501, "spots": 13, "cells": 1295},
    {"id": "samoa",            "west": -172.496, "south": -14.497, "east": -171.000, "north": -13.357, "spots": 12, "cells": 252},
    {"id": "society_islands",  "west": -151.962, "south": -18.312, "east": -148.701, "north": -16.124, "spots": 12, "cells": 1080},
    {"id": "siargao_visayas",  "west": 123.367, "south":   9.118, "east": 126.443, "north":  10.610, "spots": 11, "cells": 666},
    {"id": "tonga",            "west": -175.812, "south": -21.901, "east": -173.472, "north": -18.115, "spots": 10, "cells": 1334},
    {"id": "west_ireland",     "west": -10.716, "south":  53.435, "east":  -9.498, "north":  54.467, "spots":  9, "cells": 195},
    {"id": "sw_florida",       "west": -82.651, "south":  25.978, "east": -81.587, "north":  27.151, "spots":  9, "cells": 195},
    {"id": "mentawai",         "west":  99.087, "south":  -3.271, "east": 100.654, "north":  -1.567, "spots":  9, "cells": 399},
    {"id": "virgin_islands",   "west": -65.339, "south":  17.252, "east": -63.875, "north":  18.967, "spots":  9, "cells": 378},
]

ISLAND_RESOLUTION = 0.0833          # the CMEMS cmems_mod_glo_wav_anfc_0.083deg native step
SINGLE_REQUEST_MAX_LAT_SPAN = 28.0  # _fetch_sync tiles beyond these; every region above is inside them
SINGLE_REQUEST_MAX_LON_SPAN = 55.0


def region_by_id(region_id: str):
    """The region whose id matches, or None. Ids are stable and used as the product's region_id."""
    for r in ISLAND_REGIONS:
        if r["id"] == region_id:
            return r
    return None


def regions_covering(lat: float, lng: float):
    """
    Every island region containing the point, SMALLEST FIRST.

    Smallest-first matters: regions may overlap after merging, and the finest useful answer for a
    viewport is the tightest region that contains it. Returns [] outside all of them — the caller must
    then fall through to the coarser tier rather than inventing coverage.
    """
    if lat is None or lng is None:
        return []
    hits = [r for r in ISLAND_REGIONS
            if r["west"] <= lng <= r["east"] and r["south"] <= lat <= r["north"]]
    return sorted(hits, key=lambda r: (r["east"] - r["west"]) * (r["north"] - r["south"]))


def region_containing_bbox(west: float, south: float, east: float, north: float):
    """
    The smallest island region that FULLY contains the bbox, or None.

    ⚠️ Fully, not partially. A region that covers only part of the viewport would serve a fine grid
    over a fraction of the screen and leave the rest to a coarser product — a visible seam, and the
    box-edge artifact that got an earlier 120° viewport-clip attempt reverted. Partial overlap must
    fall through.
    """
    if None in (west, south, east, north):
        return None
    hits = [r for r in ISLAND_REGIONS
            if r["west"] <= west and r["east"] >= east and r["south"] <= south and r["north"] >= north]
    return sorted(hits, key=lambda r: (r["east"] - r["west"]) * (r["north"] - r["south"]))[0] if hits else None


def region_axes(region: Dict, resolution: float = ISLAND_RESOLUTION):
    """
    The (lats, lngs) lattice for one region — the coordinate arrays _fetch_sync derives its bbox from.

    Inclusive of the far edge so the region's own padding is fully sampled; a half-open range would
    leave the outermost column unfetched, i.e. exactly the open water the pad exists to provide.
    """
    lats, lngs = [], []
    v = region["south"]
    while v <= region["north"] + 1e-9:
        lats.append(round(v, 4))
        v += resolution
    v = region["west"]
    while v <= region["east"] + 1e-9:
        lngs.append(round(v, 4))
        v += resolution
    return lats, lngs
