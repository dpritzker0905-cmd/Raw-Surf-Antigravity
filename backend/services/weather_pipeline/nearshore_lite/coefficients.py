"""Frozen per-target coefficient tables: write, hash, verify, apply (gate section 2, "Frozen artifacts").

A coefficient file is canonical JSON (sorted keys, fixed-precision floats), so its bytes, and its sha256, are
reproducible. SHA256SUMS beside the files is the freeze record. A scorer or server that finds a mismatch REFUSES to
run: it raises CoefficientHashMismatch. No buoy value is ever read by this module (leak rule, gate section 7).
"""
import hashlib
import json
import math
import os

import numpy as np

from . import spectrum as sp
from .dispersion import G

FORMAT = "nearshore-lite-coef/1"
SUMS_NAME = "SHA256SUMS"


class CoefficientHashMismatch(RuntimeError):
    """A coefficient file's bytes do not match the frozen hash. Refuse to score or serve."""


def _round(a, nd=6):
    return np.round(np.asarray(a, dtype=float), nd).tolist()


def build_payload(target_id, table, meta):
    """Canonical payload dict from a `ray_trace.trace_target` result. `meta` carries the recorded provenance
    (sources, datum conversions with the VDatum version, strata tags, seam table sha256)."""
    return {
        "format": FORMAT,
        "target_id": str(target_id),
        "depth_t_m": round(float(table["depth_t_m"]), 4),
        "freqs_hz": _round(table["freqs_hz"], 4),
        "theta_t_from_deg": _round(table["theta_t_from_deg"], 3),
        "theta_b_from_deg": _round(table["theta_b_from_deg"], 3),
        "R": _round(table["R"], 6),
        "meta": meta,
    }


def canonical_bytes(payload):
    return (json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def write_target(dirpath, target_id, table, meta):
    """Write `<dirpath>/<target_id>.coef.json` and return (path, sha256). Does NOT update SHA256SUMS."""
    os.makedirs(dirpath, exist_ok=True)
    b = canonical_bytes(build_payload(target_id, table, meta))
    path = os.path.join(dirpath, f"{target_id}.coef.json")
    with open(path, "wb") as f:
        f.write(b)
    return path, sha256_hex(b)


def write_sums(dirpath):
    """(Re)write SHA256SUMS over every *.coef.json in the directory, in sorted order. Returns the dict."""
    sums = {}
    for name in sorted(os.listdir(dirpath)):
        if name.endswith(".coef.json"):
            with open(os.path.join(dirpath, name), "rb") as f:
                sums[name] = sha256_hex(f.read())
    with open(os.path.join(dirpath, SUMS_NAME), "w", encoding="utf-8", newline="\n") as f:
        for name, h in sums.items():
            f.write(f"{h}  {name}\n")
    return sums


def read_sums(dirpath):
    out = {}
    with open(os.path.join(dirpath, SUMS_NAME), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                h, name = line.split(None, 1)
                out[name.strip()] = h
    return out


def load_verified(dirpath, target_id):
    """Load a target's table after checking its bytes against SHA256SUMS. Raises CoefficientHashMismatch."""
    name = f"{target_id}.coef.json"
    sums = read_sums(dirpath)
    if name not in sums:
        raise CoefficientHashMismatch(f"{name} is not in {SUMS_NAME}: not frozen")
    with open(os.path.join(dirpath, name), "rb") as f:
        b = f.read()
    got = sha256_hex(b)
    if got != sums[name]:
        raise CoefficientHashMismatch(f"{name}: sha256 {got} != frozen {sums[name]}")
    d = json.loads(b)
    if d.get("format") != FORMAT:
        raise CoefficientHashMismatch(f"{name}: unknown format {d.get('format')!r}")
    return Table(d)


class Table:
    """A verified transfer table, ready to apply to partitions."""

    def __init__(self, d):
        self.target_id = d["target_id"]
        self.depth_t_m = float(d["depth_t_m"])
        self.meta = d.get("meta", {})
        self.f = np.asarray(d["freqs_hz"], dtype=float)
        self.theta_t = np.asarray(d["theta_t_from_deg"], dtype=float)
        self.theta_b = np.asarray(d["theta_b_from_deg"], dtype=float)
        self.R = np.asarray(d["R"], dtype=float)
        self.dtheta_rad = math.radians(float(self.theta_t[1] - self.theta_t[0]))
        self.df = float(self.f[1] - self.f[0])

    def apply_partition(self, hs_m, tp_s, dir_from_deg, kind="swell", variant="base", rotate_deg=0.0):
        """One partition through the table. Returns dict(hs_t_m, ratio, dir_t_from_deg, tp_t_s, in_band) or None.

        ratio = Hs_target / Hs_boundary on the in-band energy (the Kr x Ks x exposure the chain would otherwise
        approximate with constants). Rotation (`rotate_deg`) is the gate's direction plant."""
        if hs_m is None or tp_s is None or hs_m <= 0 or tp_s <= 0 or dir_from_deg is None:
            return None
        gamma, s = sp.shape_params(tp_s, kind, variant)
        S = sp.jonswap_shape(self.f, tp_s, gamma)
        if S is None:
            return None
        mean_dir = (float(dir_from_deg) + float(rotate_deg)) % 360.0
        D = sp.spreading(self.theta_b, mean_dir, s)                         # (nf, nth) density at the boundary dir
        e_t = S[:, None] * D * self.R * self.dtheta_rad * self.df           # energy at the target per cell
        e_b = float(np.sum(S) * self.df)                                    # boundary energy (D integrates to 1)
        tot = float(np.sum(e_t))
        if e_b <= 0 or not math.isfinite(tot):
            return None
        ratio = math.sqrt(max(tot, 0.0) / e_b)
        # target mean direction and peak period from the cell energies
        ang = np.radians(self.theta_t)[None, :]
        vx, vy = float(np.sum(e_t * np.sin(ang))), float(np.sum(e_t * np.cos(ang)))
        dir_t = (math.degrees(math.atan2(vx, vy)) % 360.0) if tot > 0 else None
        ef = np.sum(e_t, axis=1)
        tp_t = (1.0 / float(self.f[int(np.argmax(ef))])) if tot > 0 else None
        return {"hs_t_m": float(hs_m) * ratio, "ratio": ratio, "dir_t_from_deg": dir_t, "tp_t_s": tp_t}

    def apply(self, partitions, variant="base", rotate_deg=0.0, scale=1.0):
        """Sum partitions in quadrature. Returns dict(hs_t_m, hs_b_m, dir_t_from_deg, tp_t_s) or None."""
        e_t = e_b = 0.0
        vx = vy = 0.0
        best = (0.0, None)
        used = 0
        for p in partitions or []:
            if not isinstance(p, dict):
                continue
            r = self.apply_partition(p.get("h"), p.get("tp"), p.get("dir"), p.get("kind") or "swell",
                                     variant, rotate_deg)
            if r is None:
                continue
            used += 1
            e = r["hs_t_m"] ** 2
            e_t += e
            e_b += float(p["h"]) ** 2
            if r["dir_t_from_deg"] is not None:
                a = math.radians(r["dir_t_from_deg"])
                vx += e * math.sin(a)
                vy += e * math.cos(a)
            if e > best[0]:
                best = (e, r["tp_t_s"])
        if used == 0:
            return None
        return {"hs_t_m": scale * math.sqrt(e_t), "hs_b_m": math.sqrt(e_b),
                "dir_t_from_deg": (math.degrees(math.atan2(vx, vy)) % 360.0) if e_t > 0 else None,
                "tp_t_s": best[1]}


def partition_kr(table, hs_m, tp_s, dir_from_deg, kind, shoaling_to_target):
    """The REFRACTION-only factor that replaces REFRACTION_KR x exposure in the chain (gate section 2, serving form).

    The table's ratio already contains shoaling to the target depth; the chain applies its own shoaling, so the
    factor handed to it is ratio / Ks(Tp, target depth) with Ks supplied by the caller (the chain's own
    shoaling_coefficient). Returns None when the partition cannot be transferred (the caller keeps the constants)."""
    r = table.apply_partition(hs_m, tp_s, dir_from_deg, kind or "swell")
    if r is None or not shoaling_to_target or shoaling_to_target <= 0:
        return None
    k = r["ratio"] / float(shoaling_to_target)
    return k if math.isfinite(k) else None
