"""A tiny synthetic location_time grid for unit tests (1-degree cells), written in the real file format with a valid
manifest checksum, so tests exercise the real load / verify / lookup path without the 1 MB production grid.

Cell (i, j) centre = (-90 + i + .5, -180 + j + .5). Default class: nautical Etc/GMT by longitude band. Painted cells:
"""
import hashlib
import json
import os

import numpy as np

PAINT = {
    # (lat_cell, lng_cell): (iana, source, near_border, alt_iana, band)
    (21, -158): ("Pacific/Honolulu", "civil", False, "", -1),
    (20, -158): ("Pacific/Honolulu", "coast_snap", False, "", 20),
    (-32, 159): ("Australia/Lord_Howe", "civil", False, "", -1),
    (-44, -177): ("Pacific/Chatham", "civil", False, "", -1),
    (27, 85): ("Asia/Kathmandu", "civil", False, "", -1),
    (40, -74): ("America/New_York", "civil", False, "", -1),
    (38, -10): ("Europe/Lisbon", "civil", False, "", -1),
    (-14, -172): ("Pacific/Apia", "civil", False, "", -1),
    (-15, -171): ("Pacific/Pago_Pago", "civil", False, "", -1),
    (-29, 153): ("Australia/Brisbane", "coast_snap", True, "Australia/Sydney", 30),
    (10, 10): ("Not/AZone", "civil", False, "", -1),
    (-17, 179): ("Pacific/Fiji", "civil", False, "", -1),
    (-17, -180): ("Pacific/Fiji", "civil", False, "", -1),
}


def _cell(lat_cell, lng_cell):
    return lat_cell + 90, lng_cell + 180


def write_grid(path):
    os.makedirs(path, exist_ok=True)
    nlat, nlon = 180, 360
    classes, cid = [], {}

    def cls_of(key):
        if key not in cid:
            cid[key] = len(classes)
            classes.append(key)
        return cid[key]

    grid = np.zeros((nlat, nlon), np.uint32)
    for j in range(nlon):
        lng = -180 + j + .5
        n = int(round(-lng / 15.0))
        n = max(-12, min(12, n))
        name = "Etc/GMT" if n == 0 else f"Etc/GMT{'+' if n > 0 else ''}{n}"
        grid[:, j] = cls_of((name, "nautical", False, "", -1))
    for (a, b), key in PAINT.items():
        i, j = _cell(a, b)
        grid[i, j] = cls_of(key)
    row_ptr, starts, ids = [0], [], []
    for row in grid:
        s = np.concatenate([[0], np.flatnonzero(np.diff(row)) + 1])
        starts.extend(s.tolist())
        ids.extend(row[s].tolist())
        row_ptr.append(len(starts))
    gp = os.path.join(path, "grid.npz")
    np.savez_compressed(gp, row_ptr=np.array(row_ptr, np.uint32), starts=np.array(starts, np.uint16),
                        ids=np.array(ids, np.uint32), cls_iana=np.array([c[0] for c in classes]),
                        cls_source=np.array([c[1] for c in classes]),
                        cls_near_border=np.array([c[2] for c in classes]), cls_alt=np.array([c[3] for c in classes]),
                        cls_band=np.array([c[4] for c in classes], np.int16), res=np.array(1.0))
    with open(gp, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"schema": "raw-surf/location-time-grid/1", "res_deg": 1.0, "grid_sha256": sha}, fh)
    return path
