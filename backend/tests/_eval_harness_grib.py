"""Test helper: build SYNTHETIC GRIB2 messages (grid template 3.0, simple packing 5.0, optional bitmap) and a
matching `.idx`, so the evaluation harness's decoder and its archive reader run end to end on committed-free data."""
import struct
from typing import List, Optional, Sequence, Tuple

import numpy as np


def _sm32(v: int) -> bytes:
    return struct.pack(">I", (abs(v) | 0x80000000) if v < 0 else v)


def message(values_north_to_south: np.ndarray, lat_north: float, lat_south: float, lon_west: float,
            lon_east: float, mask: Optional[np.ndarray] = None, d_scale: int = 2, nbits: int = 16) -> bytes:
    """One GRIB2 message; `values` rows run NORTH to SOUTH (GFS's scan), NaN or mask=True = masked."""
    v = np.asarray(values_north_to_south, dtype=float)
    nj, ni = v.shape
    m = np.isnan(v) if mask is None else (mask | np.isnan(v))
    flat, mflat = v.ravel(), m.ravel()
    packed = np.round(flat[~mflat] * 10 ** d_scale)
    ref = float(packed.min()) if packed.size else 0.0
    x = (packed - ref).astype(np.int64)
    if x.size and int(x.max()) >= (1 << nbits):
        raise ValueError("values exceed the bit width")
    bits = ((x[:, None] >> np.arange(nbits - 1, -1, -1)) & 1).astype(np.uint8).ravel()
    data = np.packbits(bits).tobytes()
    s1 = struct.pack(">IB", 21, 1) + bytes(16)
    s3 = (struct.pack(">IB", 72, 3) + bytes(1) + struct.pack(">I", ni * nj) + bytes(2) + struct.pack(">H", 0)
          + bytes(16) + struct.pack(">II", ni, nj) + bytes(8)
          + _sm32(int(round(lat_north * 1e6))) + _sm32(int(round(lon_west * 1e6))) + bytes(1)
          + _sm32(int(round(lat_south * 1e6))) + _sm32(int(round(lon_east * 1e6))) + bytes(9))
    assert len(s3) == 72, len(s3)
    s4 = struct.pack(">IB", 34, 4) + bytes(29)
    s5 = (struct.pack(">IBIH", 21, 5, int((~mflat).sum()), 0) + struct.pack(">f", ref)
          + struct.pack(">hh", 0, d_scale) + bytes([nbits, 0]))
    if m.any():
        bm = np.packbits((~mflat).astype(np.uint8)).tobytes()
        s6 = struct.pack(">IBB", 6 + len(bm), 6, 0) + bm
    else:
        s6 = struct.pack(">IBB", 6, 6, 255)
    s7 = struct.pack(">IB", 5 + len(data), 7) + data
    body = s1 + s3 + s4 + s5 + s6 + s7 + b"7777"
    return b"GRIB" + bytes(2) + bytes([10, 2]) + struct.pack(">Q", 16 + len(body)) + body


def file_with_idx(msgs: Sequence[Tuple[str, str, bytes]], cycle: str, fh: int) -> Tuple[bytes, str]:
    """(file bytes, idx text) for [(VAR, LEVEL, message bytes)] in order."""
    buf, lines, off = b"", [], 0
    for n, (var, lev, m) in enumerate(msgs, 1):
        lines.append(f"{n}:{off}:d={cycle}:{var}:{lev}:{fh} hour fcst:")
        buf += m
        off += len(m)
    return buf, "\n".join(lines) + "\n"


def regional_fields(lat_south: float, lat_north: float, lon_west: float, lon_east: float, step: float,
                    fn) -> List[Tuple[str, str, bytes]]:
    """Messages UGRD, VGRD, HTSGW, PERPW, DIRPW on a regional grid; fn(lat, lng) -> dict of the five values."""
    lats = np.arange(lat_north, lat_south - 1e-9, -step)
    lngs = np.arange(lon_west, lon_east + 1e-9, step)
    grids = {k: np.zeros((len(lats), len(lngs))) for k in ("UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW")}
    for a, la in enumerate(lats):
        for b, lo in enumerate(lngs):
            for k, val in fn(la, lo).items():
                grids[k][a, b] = val
    return [(k, "surface", message(grids[k], lats[0], lats[-1], lon_west % 360.0, lon_east % 360.0))
            for k in ("UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW")]
