"""Offline build of the location_time grid (phase 1). NEVER imported by the server; run by hand, output committed.

WHAT IT BUILDS: a global 0.01-degree grid. Cell (i, j) has its centre at lat = -90 + (i + .5) * R, lng = -180 + (j + .5) * R.
Each cell holds a CLASS = (iana, source, near_border, alt_iana, coast_band_km), run-length encoded per latitude row.

POLICY C' (owner, 2026-11-10, DAVID-DECISIONS-2):
  * civil      - the reference zone where the reference is a civil zone: land AND territorial waters (timezone-boundary-
                 builder 'timezones-with-oceans' polygons extend to the 12 nm line - the maritime convention).
  * coast_snap - a nautical (Etc/GMT*) cell whose nearest OpenStreetMap land is <= 50 km away takes the civil zone at that
                 nearest land point. coast_band_km records the 10-km band the distance fell in (0,10,20,30,40).
  * nautical   - every other sea cell keeps its Etc/GMT+-N zone.
  * near_border - a coast_snap cell with a DIFFERENT civil zone among its 8 neighbours (snapped or civil, ~1.1 km);
                 alt_iana is that other zone (smallest IANA name if several). The note is shown by the client.
                 ALSO (O2/LT-8): a sea cell on either side of a coast/nautical line whose offsets differ by >= 3 h
                 (see NAUTICAL EDGE below), so the 50-km snap cliff is never silent.

DISTANCE: per 0.25-degree latitude band, OSM polygons and cell centres are mapped to x = lng * cos(band centre), y = lat;
STRtree.query_nearest picks the nearest polygon and shortest_line its nearest point; the distance reported is the
HAVERSINE distance (R = 6371.0088 km) from the cell centre to that point. The band scaling can pick a slightly wrong
nearest point (it never under-states distance), so cells within REFIT_KM of the 50-km cut are re-solved as the minimum
haversine distance to the candidate polygons' boundaries densified to ~110 m. A seeded random sample of snapped cells is
re-solved the same way and the band method's error (p50/p99/max) is written to the manifest.

INPUTS (pinned by sha256 in the manifest; versions printed at start):
  timezonefinder 9.2.0 + timezonefinder-data 4.2026.6 (timezone-boundary-builder 2026f, timezones-with-oceans)
  OpenStreetMap land-polygons-split-4326 (osmdata.openstreetmap.de), snapshot date in its README.
LICENCE: both inputs are ODbL 1.0, so the grid is a Derivative Database under ODbL 1.0 (see the LICENSE file written
next to it). Build-only dependencies (NOT in requirements.txt): timezonefinder, shapely>=2, pyshp, scipy, numpy.

Usage:  python scripts/build_location_tz_grid.py --osm-dir <dir with land_polygons.shp> --osm-zip <the .zip> --out data/location_time
"""
import argparse
import hashlib
import importlib.metadata as md
import sys
import math
import os
import time
from datetime import datetime, timezone

import numpy as np

R_DEG = 0.01
SNAP_KM = 50.0
EARTH_KM = 6371.0088
BAND_DEG = 0.25
REFIT_KM = 0.05         # trial 2026-11-10 (20-22N): band method vs densified re-solve max 0.8 m (n=45); 50 m keeps ~60x margin
DENSIFY_DEG = 0.001     # ~110 m vertex spacing for the re-solve
SOURCES = ("civil", "coast_snap", "nautical")


def sha256_file(path, chunk=1 << 22):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def tf_data_identity():
    import timezonefinder_data
    d = os.path.join(os.path.dirname(timezonefinder_data.__file__), "data")
    files = sorted(os.path.relpath(os.path.join(r, f), d).replace("\\", "/") for r, _, fs in os.walk(d) for f in fs)
    per = {f: sha256_file(os.path.join(d, f)) for f in files}
    cat = hashlib.sha256("".join(per[f] for f in files).encode()).hexdigest()
    with open(os.path.join(d, "data_version.txt"), encoding="utf-8") as fh:
        version = fh.read().strip()
    return {"package": "timezonefinder-data", "package_version": md.version("timezonefinder-data"),
            "data_version": version, "variant": "timezones-with-oceans", "files": len(files),
            "sha256_of_file_sha256s": cat}


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lng2 - lng1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def raw_reference_grid(tf, nlat, nlon, log):
    """Zone index per cell from timezonefinder at every cell centre (the 'raw reference')."""
    names, idx = [], {}
    grid = np.zeros((nlat, nlon), np.uint16)
    lngs = -180 + (np.arange(nlon) + .5) * R_DEG
    t0 = time.time()
    for i in range(nlat):
        la = -90 + (i + .5) * R_DEG
        row = grid[i]
        for j, lo in enumerate(lngs):
            z = tf.timezone_at(lat=la, lng=float(lo)) or ""
            k = idx.get(z)
            if k is None:
                k = idx[z] = len(names)
                names.append(z)
            row[j] = k
        if i % 1000 == 0:
            log(f"raw grid row {i}/{nlat} ({time.time() - t0:.0f}s, {len(names)} zones)")
    return grid, names


def load_osm(osm_dir, log):
    import shapefile
    from shapely.geometry import shape
    t0 = time.time()
    r = shapefile.Reader(os.path.join(osm_dir, "land_polygons.shp"))
    geoms = [shape(s.__geo_interface__) for s in r.iterShapes()]
    log(f"OSM: {len(geoms)} polygons loaded in {time.time() - t0:.0f}s")
    return np.array(geoms, dtype=object)


def coast_snap(grid, names, osm, osm_tree, tf, log, rows=None):
    """For every nautical cell within reach of a civil cell, the haversine distance to the nearest OSM land and the
    civil zone there. Returns (snap_zone int32 [-1 = none], snap_km float32, refits, error_sample)."""
    import shapely
    from scipy.ndimage import distance_transform_edt
    nlat, nlon = grid.shape
    is_civil_name = np.array([bool(n) and not n.startswith("Etc/") for n in names])
    civil = is_civil_name[grid]
    reach_cells = int(math.ceil(SNAP_KM / 111.19 / R_DEG)) + 15      # civil zones reach 12 nm out; slack for bays
    snap_zone = np.full(grid.shape, -1, np.int32)
    snap_km = np.full(grid.shape, np.nan, np.float32)
    zidx = {n: k for k, n in enumerate(names)}
    rng = np.random.default_rng(20261110)
    sample, n_snapped = [], 0
    per_band = int(round(BAND_DEG / R_DEG))
    t0 = time.time()
    exact_refits = 0
    r0, r1 = rows or (0, nlat)
    for b0 in range(r0, r1, per_band):
        b1 = min(nlat, b0 + per_band)
        lat_c = -90 + ((b0 + b1) / 2) * R_DEG
        c = max(0.05, math.cos(math.radians(lat_c)))
        h0, h1 = max(0, b0 - reach_cells), min(nlat, b1 + reach_cells)
        pad = min(nlon // 2, int(math.ceil(reach_cells / c)))
        win = np.concatenate([civil[h0:h1, -pad:], civil[h0:h1], civil[h0:h1, :pad]], axis=1)
        if not win.any():
            continue
        dist = distance_transform_edt(~win, sampling=(1.0, c))[b0 - h0:b1 - h0, pad:pad + nlon]
        cand = (~civil[b0:b1]) & (dist <= reach_cells)
        ii, jj = np.nonzero(cand)
        if len(ii) == 0:
            continue
        lat = -90 + (ii + b0 + .5) * R_DEG
        lng = -180 + (jj + .5) * R_DEG
        # band polygons (with +/-360 copies near the antimeridian), mapped to x = lng * c
        lat_lo, lat_hi = lat.min() - 0.7, lat.max() + 0.7
        boxes = [shapely.box(-180, lat_lo, 180, lat_hi)]
        hits = np.unique(np.concatenate([osm_tree.query(bx) for bx in boxes]))
        if len(hits) == 0:
            continue
        polys = list(osm[hits])
        shifted = [shapely.transform(g, lambda xy, s=s: xy + np.array([s, 0.0])) for s in (-360.0, 360.0) for g in polys
                   if (s < 0 and g.bounds[2] > 179.0) or (s > 0 and g.bounds[0] < -179.0)]
        allp = np.array(polys + shifted, dtype=object)
        scaled = shapely.transform(allp, lambda xy: xy * np.array([c, 1.0]))
        tree = shapely.STRtree(scaled)
        pts = shapely.points(lng * c, lat)
        maxd = (SNAP_KM + 5) / 111.19
        pi, gi = tree.query_nearest(pts, max_distance=maxd, all_matches=False)
        if len(pi) == 0:
            continue
        line = shapely.shortest_line(pts[pi], scaled[gi])
        end = shapely.get_coordinates(shapely.get_point(line, 1))
        n_lat = end[:, 1]
        n_lng = ((end[:, 0] / c) + 180.0) % 360.0 - 180.0
        d_km = haversine_km(lat[pi], lng[pi], n_lat, n_lng)
        for k in range(len(pi)):
            a, o, d = float(lat[pi[k]]), float(lng[pi[k]]), float(d_km[k])
            nl, no = float(n_lat[k]), float(n_lng[k])
            if abs(d - SNAP_KM) <= REFIT_KM:                     # re-solve on densified vertices
                d, nl, no = exact_nearest(a, o, osm, osm_tree)
                exact_refits += 1
            if d is None or d > SNAP_KM:
                continue
            z = civil_zone_at_coast(tf, a, o, nl, no)
            if z is None:
                continue
            if z not in zidx:
                zidx[z] = len(names)
                names.append(z)
            ci, cj = int(ii[pi[k]] + b0), int(jj[pi[k]])
            snap_zone[ci, cj], snap_km[ci, cj] = zidx[z], d
            n_snapped += 1
            if rng.random() < 2e-4 and len(sample) < 4000:          # band-method error, measured on a seeded sample
                e = exact_nearest(a, o, osm, osm_tree)[0]
                if e is not None:
                    sample.append(d - e)
        if (b0 // per_band) % 10 == 0:
            log(f"band {b0 // per_band}/{nlat // per_band}: {len(ii)} candidates, {n_snapped} snapped so far,"
                f" {exact_refits} exact re-solves ({time.time() - t0:.0f}s)")
    return snap_zone, snap_km, exact_refits, sample


def exact_nearest(lat, lng, osm, osm_tree):
    """Minimum haversine distance from the cell centre to the boundaries of every OSM polygon within reach, the boundaries
    densified to DENSIFY_DEG. Returns (km, lat, lng) of the nearest vertex, or (None, None, None)."""
    import shapely
    reach = (SNAP_KM + 5) / 111.19
    c = max(0.05, math.cos(math.radians(lat)))
    best = (None, None, None)
    for s in (0.0, -360.0, 360.0):
        bx = shapely.box(lng - reach / c - s, lat - reach, lng + reach / c - s, lat + reach)
        hits = osm_tree.query(bx)
        if len(hits) == 0:
            continue
        rings = shapely.boundary(shapely.clip_by_rect(osm[hits], *bx.bounds))
        xy = shapely.get_coordinates(shapely.segmentize(rings, DENSIFY_DEG))
        if len(xy) == 0:
            continue
        d = haversine_km(lat, lng, xy[:, 1], xy[:, 0] + s)
        k = int(np.argmin(d))
        if best[0] is None or d[k] < best[0]:
            best = (float(d[k]), float(xy[k, 1]), float(((xy[k, 0] + s) + 180.0) % 360.0 - 180.0))
    return best


def civil_zone_at_coast(tf, lat, lng, nlat, nlng):
    """The civil zone at the nearest land point, stepping a little inland along the approach if the coast point itself
    reads nautical (polygon edges of the two datasets do not coincide exactly)."""
    dy, dx = nlat - lat, ((nlng - lng + 180) % 360) - 180
    n = math.hypot(dy, dx) or 1.0
    for step in (0.0, 0.0005, 0.002, 0.005):
        z = tf.timezone_at(lat=max(-90, min(90, nlat + dy / n * step)), lng=((nlng + dx / n * step + 180) % 360) - 180)
        if z and not z.startswith("Etc/"):
            return z
    return None


def classify(grid, names, snap_zone, snap_km):
    """Class id per cell + class table [(iana, source, near_border, alt_iana, band)]. Vectorised."""
    nlat, nlon = grid.shape
    is_civil_name = np.array([bool(n) and not n.startswith("Etc/") for n in names])
    zone = grid.astype(np.int32)
    source = np.where(is_civil_name[grid], 0, 2).astype(np.uint8)
    snapped = snap_zone >= 0
    zone[snapped] = snap_zone[snapped]
    source[snapped] = 1
    band = np.full(grid.shape, -1, np.int8)
    band[snapped] = (np.minimum(4, (snap_km[snapped] // 10).astype(np.int8)) * 10).astype(np.int8)
    rank = np.argsort(np.argsort(np.array(names)))                  # lexicographic rank of each zone name
    alt = np.full(grid.shape, -1, np.int32)
    civ_or_snap = source < 2
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if not (di or dj):
                continue
            nz = np.roll(zone, (-di, -dj), axis=(0, 1))
            nok = np.roll(civ_or_snap, (-di, -dj), axis=(0, 1))
            if di == -1:
                nok[0, :] = False
            if di == 1:
                nok[-1, :] = False
            take = snapped & nok & (nz != zone) & ((alt < 0) | (rank[nz] < rank[np.maximum(alt, 0)]))
            alt[take] = nz[take]
            del nz, nok, take
    classes, cid = [], {}
    cls = np.zeros(grid.shape, np.uint32)
    for i in range(nlat):
        key = (((zone[i].astype(np.int64) * 3 + source[i]) * 1024 + (alt[i] + 1)) * 64) + (band[i] + 10)
        u, inv = np.unique(key, return_inverse=True)
        m = np.empty(len(u), np.uint32)
        for n, k in enumerate(u.tolist()):
            if k not in cid:
                b = k % 64 - 10
                a = (k // 64) % 1024 - 1
                zs = k // 64 // 1024
                cid[k] = len(classes)
                classes.append((names[zs // 3], SOURCES[zs % 3], a >= 0, names[a] if a >= 0 else "", int(b)))
            m[n] = cid[k]
        cls[i] = m[inv]
    return cls, classes, int((alt >= 0).sum())


# ── NAUTICAL EDGE (O2 / LT-8, 2026-11-10) ───────────────────────────────────────────────────────────────────────────
# Policy C' snaps sea cells to the coast zone out to 50 km and leaves the nautical Etc/GMT zone beyond. Where those two
# disagree by hours, one cell (~1.1 km) moves the clock that far: 49 km north of Apia reads Pacific/Apia (+13, local date
# 11-11) and 50 km reads Etc/GMT+11 (-11, local date 11-10): 24 h in one step, with NO note, because `near_border` was
# set only where two COAST zones meet. The cliff itself is policy (owner, C'); a silent cliff is not.
# RULE: a sea cell on either side of a coast(civil|coast_snap) / nautical boundary whose UTC offsets differ by
# >= EDGE_MIN_H in January OR July gets near_border = True and alt_iana = the zone across the line (smallest name if
# several; an existing coast-border alt is kept). 3 h: below it the gap is the ordinary political/DST distance between
# a civil zone and its longitude band (Spain/Portugal +1-2, Argentina +1-2, Iceland/China edges), which every coast has
# and which needs no note; at >= 3 h it is a different hour of the day or a different date. Both sides are marked so a
# click 50 km out (nautical) is told about the coast clock and a click 49 km out about the open-sea one.
EDGE_MIN_H = 3.0
EDGE_SEASONS = (datetime(2026, 1, 15, 12, tzinfo=timezone.utc), datetime(2026, 7, 15, 12, tzinfo=timezone.utc))


def _edge_offsets_h(classes):
    """(n_cls, 2) UTC offsets in hours at EDGE_SEASONS; NaN for a zone ZoneInfo does not know."""
    from zoneinfo import ZoneInfo
    out = np.full((len(classes), len(EDGE_SEASONS)), np.nan)
    cache = {}
    for c, cl in enumerate(classes):
        name = cl[0]
        if name not in cache:
            try:
                z = ZoneInfo(name)
                cache[name] = [t.astimezone(z).utcoffset().total_seconds() / 3600.0 for t in EDGE_SEASONS]
            except Exception:                                  # noqa: BLE001 - unknown zone: never an edge
                cache[name] = [np.nan] * len(EDGE_SEASONS)
        out[c] = cache[name]
    return out


def mark_nautical_edges(get_row, nlat, classes, log=print):
    """Apply the NAUTICAL EDGE rule row by row (three rows in memory, never the whole grid) and run-length encode.
    `get_row(i)` -> the class ids of grid row i. Returns (row_ptr, starts, ids, classes, n_edge_cells); `classes`
    is extended with the marked variants. Used by `main` and by scripts/patch_location_tz_nautical_edge.py."""
    classes = [tuple(c) for c in classes]
    off = _edge_offsets_h(classes)
    src = np.array([{"civil": 0, "coast_snap": 1, "nautical": 2}.get(c[1], -1) for c in classes])
    coast, naut = (src == 0) | (src == 1), src == 2
    names = sorted({c[0] for c in classes})
    rank = {n: k for k, n in enumerate(names)}
    zone_rank = np.array([rank[c[0]] for c in classes])
    cid = {c: k for k, c in enumerate(classes)}
    row_ptr, starts, ids, n_edge = [0], [], [], 0
    prev, cur = None, np.asarray(get_row(0)).astype(np.int64)
    for i in range(nlat):
        nxt = np.asarray(get_row(i + 1)).astype(np.int64) if i + 1 < nlat else None
        best = np.full(cur.shape, -1, np.int64)                       # class id across the line (smallest zone name)
        for row in (prev, cur, nxt):
            if row is None:
                continue
            for dj in (-1, 0, 1):
                if row is cur and dj == 0:
                    continue
                nb = np.roll(row, -dj)
                cross = (coast[cur] & naut[nb]) | (naut[cur] & coast[nb])
                with np.errstate(invalid="ignore"):
                    gap = np.nanmax(np.abs(off[cur] - off[nb]), axis=1) >= EDGE_MIN_H
                take = cross & gap & ((best < 0) | (zone_rank[nb] < zone_rank[np.maximum(best, 0)]))
                best[take] = nb[take]
        out = cur.copy()
        hit = np.flatnonzero(best >= 0)
        n_edge += len(hit)
        if len(hit):
            pairs = np.unique(np.stack([cur[hit], best[hit]], 1), axis=0)
            remap = {}
            for c, b in pairs.tolist():
                iana, source, nb_flag, alt, band = classes[c]
                key = (iana, source, True, alt or classes[b][0], band)
                if key not in cid:
                    cid[key] = len(classes)
                    classes.append(key)
                remap[(c, b)] = cid[key]
            out[hit] = [remap[(c, b)] for c, b in zip(cur[hit].tolist(), best[hit].tolist())]
        s = np.concatenate([[0], np.flatnonzero(np.diff(out)) + 1])
        starts.extend(s.tolist())
        ids.extend(out[s].tolist())
        row_ptr.append(len(starts))
        prev, cur = cur, nxt
        if i % 3000 == 0:
            log(f"nautical edge: row {i}/{nlat}, {n_edge} cells marked")
    return (np.array(row_ptr, np.uint32), np.array(starts, np.uint16), np.array(ids, np.uint32), classes, n_edge)


def rle(cls):
    row_ptr, starts, ids = [0], [], []
    for row in cls:
        change = np.flatnonzero(np.diff(row)) + 1
        s = np.concatenate([[0], change])
        starts.extend(s.tolist())
        ids.extend(row[s].tolist())
        row_ptr.append(len(starts))
    return np.array(row_ptr, np.uint32), np.array(starts, np.uint16), np.array(ids, np.uint32)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm-dir", required=True)
    ap.add_argument("--osm-zip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--trial-rows", help="i0:i1 - run the coast snap on these grid rows only, report, write nothing")
    ap.add_argument("--raw-cache", help="npz of a previous raw reference grid (same inputs) to skip that step")
    args = ap.parse_args(argv)
    t_start = time.time()
    log = lambda m: print(f"[{time.time() - t_start:7.0f}s] {m}", flush=True)  # noqa: E731
    from timezonefinder import TimezoneFinder
    import shapely
    tf = TimezoneFinder()
    tfid = tf_data_identity()
    log(f"timezonefinder {md.version('timezonefinder')} / {tfid}")
    nlat, nlon = int(round(180 / R_DEG)), int(round(360 / R_DEG))
    if args.raw_cache and os.path.exists(args.raw_cache):
        z = np.load(args.raw_cache, allow_pickle=False)
        names = [str(n) for n in z["names"]]
        if "grid" in z:
            grid = z["grid"]
        else:                                            # run-length form (row_ptr / starts / ids), same cell centres
            grid = np.zeros((nlat, nlon), np.uint16)
            rp, st, ids = z["row_ptr"], z["starts"].astype(np.int64), z["ids"]
            for i in range(nlat):
                s0, s1 = int(rp[i]), int(rp[i + 1])
                grid[i] = np.repeat(ids[s0:s1], np.diff(np.append(st[s0:s1], nlon)))
        log(f"raw grid reused from {args.raw_cache} ({len(names)} zones)")
    else:
        grid, names = raw_reference_grid(tf, nlat, nlon, log)
        if args.raw_cache:
            np.savez(args.raw_cache, grid=grid, names=np.array(names))
    osm = load_osm(args.osm_dir, log)
    osm_tree = shapely.STRtree(osm)
    rows = tuple(int(x) for x in args.trial_rows.split(":")) if args.trial_rows else None
    snap_zone, snap_km, refits, err = coast_snap(grid, names, osm, osm_tree, tf, log, rows)
    n_snap = int((snap_zone >= 0).sum())
    e = np.array(err) if err else np.zeros(1)
    err_stats = {"n": len(err), "p50_km": round(float(np.percentile(e, 50)), 4), "p99_km": round(float(np.percentile(e, 99)), 4),
                 "max_km": round(float(e.max()), 4), "min_km": round(float(e.min()), 4)}
    log(f"coast_snap cells: {n_snap} (re-solves near 50 km: {refits}); band-method error vs re-solve: {err_stats}")
    if rows:
        log("trial only: nothing written")
        return
    cls, classes, n_border = classify(grid, names, snap_zone, snap_km)
    row_ptr, starts, ids, classes, n_edge = mark_nautical_edges(lambda i: cls[i], nlat, classes, log)
    os.makedirs(args.out, exist_ok=True)
    # Runtime format v2 (location_time.write_grid_dir): uncompressed .npy arrays the server memory-maps, so its RSS
    # stays far under the 8 MB cap; uint16 ids while there are < 65,536 classes.
    with open(os.path.join(args.osm_dir, "README.txt"), encoding="utf-8") as fh:
        osm_date = next((ln.split("is", 1)[1].strip() for ln in fh if ln.startswith("Date of the data")), "unknown")
    extra = {
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "res_deg": R_DEG, "cells": nlat * nlon, "runs": int(len(starts)), "classes": len(classes),
        "policy": "C-prime: civil on land and territorial waters; coast_snap <= 50 km to OSM land; else nautical",
        "snap_km": SNAP_KM, "coast_snap_cells": n_snap, "near_border_cells": n_border, "exact_resolves": refits,
        "nautical_edge": {"min_h": EDGE_MIN_H, "cells": n_edge},
        "band_method_error_vs_densified_resolve": err_stats,
        "inputs": {"timezonefinder": md.version("timezonefinder"), "timezone_boundaries": tfid,
                   "osm_land_polygons": {"file": os.path.basename(args.osm_zip), "sha256": sha256_file(args.osm_zip),
                                         "data_date": osm_date, "source": "https://osmdata.openstreetmap.de/",
                                         "licence": "ODbL 1.0, (c) OpenStreetMap contributors"},
                   "shapely": md.version("shapely"), "numpy": md.version("numpy"), "scipy": md.version("scipy")},
        "licence": "ODbL 1.0 (Derivative Database of OpenStreetMap and timezone-boundary-builder data)",
    }
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from services.weather_pipeline.location_time import write_grid_dir
    manifest = write_grid_dir(args.out, row_ptr, starts, ids, classes, R_DEG, extra)
    log(f"done: {manifest['runs']} runs, {manifest['classes']} classes, grid sha256 {manifest['grid_sha256'][:16]}")


if __name__ == "__main__":
    main()
