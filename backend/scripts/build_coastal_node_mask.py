"""Bake `bathymetry.is_coastal` on every 0.25-deg node of the world into a bitset the map client reads (2026-11-15, rating band lane).

WHY. The Surf Rating band masks every NON-coastal cell (`surf_rating.rating_transform_grid`, coastal_fn = `bathymetry.is_coastal`): open
ocean never carries a band. The client's rated mosaic (frontend `staticRatedMosaic.js`) answers a viewport that overhangs a pilot box
from the CDN, and it may pad a node no box holds only where the server would mask it anyway. `is_coastal` is GEOGRAPHY ONLY (the bundled
bathymetry grid: land and ocean within +-0.75 deg; no flag, no forecast input), so its answer on the 0.25-deg lattice is a static fact:
baked once here, checked against the live function by `tests/test_coastal_node_mask.py` (a stale asset fails CI).

FORMAT (`frontend/public/data/coastal-nodes-025.bin`): 16-byte header b"RSCN" + u16 version 1 + u16 cols 1440 + u16 rows 721 + 6 zero
bytes, then cols*rows bits, row-major, rows SOUTH first (lat -90 + r*0.25), cols WEST first (lng -180 + c*0.25), LSB first in each
byte. Bit = 1: coastal (the band may paint there: the client must ask the server). Bit = 0: the server masks it.

    python scripts/build_coastal_node_mask.py [--out ../frontend/public/data/coastal-nodes-025.bin]
"""
import argparse
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

STEP = 0.25
COLS = 1440
ROWS = 721
MAGIC = b"RSCN"
VERSION = 1
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           "frontend", "public", "data", "coastal-nodes-025.bin")


def node(r, c):
    return -90.0 + r * STEP, -180.0 + c * STEP


def build_bits(is_coastal):
    bits = bytearray((COLS * ROWS + 7) // 8)
    n = 0
    for r in range(ROWS):
        for c in range(COLS):
            lat, lng = node(r, c)
            if is_coastal(lat, lng):
                i = r * COLS + c
                bits[i >> 3] |= 1 << (i & 7)
                n += 1
    return bytes(bits), n


def header():
    return MAGIC + struct.pack("<HHH", VERSION, COLS, ROWS) + b"\0" * 6


def read_bit(blob, lat, lng):
    """The baked answer at a lattice node (used by the parity test)."""
    r = int(round((lat + 90.0) / STEP))
    c = int(round((((lng + 180.0) % 360.0)) / STEP)) % COLS
    i = r * COLS + c
    return bool(blob[16 + (i >> 3)] >> (i & 7) & 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    from services.weather_pipeline import bathymetry
    if not bathymetry.is_available():
        sys.exit("bathymetry grid unavailable: is_coastal would fail open (True everywhere); refusing to bake that")
    bits, n = build_bits(lambda la, ln: bathymetry.is_coastal(la, ln))
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "wb") as fh:
        fh.write(header() + bits)
    print(f"coastal nodes: {n} of {COLS * ROWS} -> {args.out} ({16 + len(bits)} bytes)")


if __name__ == "__main__":
    main()
