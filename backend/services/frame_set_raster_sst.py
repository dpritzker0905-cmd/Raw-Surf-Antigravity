"""Copernicus ocean-model sea temperature as WATER TEMP raster frames (G4, 2026-11-17; the director's assignment and arm R2,
pre-registered in docs/weather-program/log/2026-11-15-opus-gusts-currents.md sections 11 / 11b).

SOURCE. Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024, dataset cmems_mod_glo_phy_anfc_0.083deg_PT1H-m (Mercator
Ocean's 1/12-degree global ocean model): HOURLY MEAN `thetao` (sea water potential temperature, degC) on the store's ONE
level, elevation -0.494 m (the top model layer; checked against the store on every publish), stamped on the whole hour, to
about 9-10 days ahead, one bulletin a day. Read as the service's own ARCO Zarr (timeChunked: [1, 1, 512, 2048] float32
blosc-lz4, land = the 9.97e36 fill), the same reader as the currents set (frame_set_raster_currents). Candidate A of
section 11; why not the 6-hourly instantaneous product: this one is hourly and surface-only (one level to read).

WHY. DWD ICON has no sea temperature, so ICON's water temp is blank on own frames; GFS and EURO draw a SKIN temperature. The
ocean model gives ICON a water temperature, and (only if the section 11 observation check passes) a bulk temperature for all.

THIS SET (the WORLD half of arm R2): 1/6 degree, 3-hourly. Every second source row and column, the source cells' own values
(no interpolation, no mean): lat -80 + j/6, lon -180 + k/6, 2160 x 1021 nodes; nothing south of 80S (no source rows). The 1/12
degree regional tiles (hourly, the pilot boxes) are the second half, built separately.
"""
from __future__ import annotations

from datetime import timedelta

try:
    from services import frame_binary as fb
    from services.frame_set_raster_currents import CmemsCurrentsSource, SRC_COLS, SRC_ROWS
except ImportError:  # pragma: no cover - run by path (fetcher subprocess)
    import frame_binary as fb
    from frame_set_raster_currents import CmemsCurrentsSource, SRC_COLS, SRC_ROWS

ARCO = ("https://s3.waw3-1.cloudferro.com/mdl-arco-time-014/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
        "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m_202406/timeChunked.zarr")
SURFACE, SURFACE_M = 0, -0.494                 # the store's only level (checked against the store, 2026-11-17: -0.494025 m)
GRID_KEY = "1p6"
GRID = {"cols": SRC_COLS // 2, "rows": (SRC_ROWS + 1) // 2, "bounds": (-180.0, -80.0, 180.0 - 1.0 / 6.0, 90.0), "stride": 1}
CREDIT = "Generated using E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00016"

SPEC = {
    "target": {"model": "CMEMS", "domain": "marine", "layer": "water_temp", "region_id": "global_1p6"},
    "field": fb.TEMP_C, "grid": GRID_KEY, "frame_plane": True, "idx": ("thetao",), "convert": lambda a: a,
    "valid": (-3.0, 40.0), "clip": None, "env": "FRAME_RASTER_WATER_TEMP_CMEMS", "default_on": False,
    "value_kind": "sea_water_temperature_top_layer", "value_unit": "degC",
    "source_dataset": "Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024 cmems_mod_glo_phy_anfc_0.083deg_PT1H-m thetao "
                      "(hourly mean) at -0.494 m; every second 1/12-degree cell (1/6 degree), the cells' own values",
    "hours": tuple(range(0, 238, 3)), "source": "cmems_sst", "upstream_provider": "copernicus_marine",
    "credit": CREDIT,
    "license": "Copernicus Marine Service licence: free, any purpose incl. commercial, attribution required "
               "(https://marine.copernicus.eu/user-corner/service-commitments-and-licence)",
    "source_url": "https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_PHY_001_024",
}


def register(specs, grids):
    """Add the set and its lattice to frame_set_raster's tables (kept here: that module is at its line limit)."""
    grids.setdefault(GRID_KEY, GRID)
    specs.setdefault("water_temp_cmems", SPEC)


def sixth(a):
    """(1021, 2160) frame-order plane (row 0 = 80S, column 0 = 180W) from the (2041, 4320) source field: every second cell."""
    import numpy as np
    a = np.asarray(a, dtype=float)
    if a.shape != (SRC_ROWS, SRC_COLS):
        raise ValueError(f"expected the 1/12-deg source grid {(SRC_ROWS, SRC_COLS)}, got {a.shape}")
    return a[::2, ::2]


class CmemsSstSource(CmemsCurrentsSource):
    """One hourly-mean thetao step per frame from the CMEMS ARCO store (module docstring)."""

    ARCO, SURFACE, SURFACE_M = ARCO, SURFACE, SURFACE_M

    def url(self, cycle, f):
        t = self.times().get(cycle + timedelta(hours=f))
        return f"{self.ARCO}/thetao/{t}.{self.SURFACE}.*.*"

    def fetch(self, cycle, f):
        """(1021, 2160) plane of degC on the 1/6-degree lattice; land and south of 80S are NaN."""
        t = self.times().get(cycle + timedelta(hours=f))
        if t is None:
            raise RuntimeError(f"no store step at {cycle + timedelta(hours=f)}")
        return sixth(self._field("thetao", t))
