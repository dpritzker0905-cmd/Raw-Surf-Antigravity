"""The baked coastal-node mask (frontend/public/data/coastal-nodes-025.bin) equals `bathymetry.is_coastal` on the 0.25-deg lattice.

The map's rated mosaic pads a node with "no band" only where this mask says 0, so a stale mask would hide a real band. Every node
around every pilot box edge is checked, plus a seeded random sample of the world, plus header shape. Positive control: a flipped
bit is caught by the same comparison.
"""
import os
import random
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import build_coastal_node_mask as M  # noqa: E402
from services.weather_pipeline import bathymetry  # noqa: E402

pytestmark = pytest.mark.skipif(not bathymetry.is_available(), reason="bundled bathymetry unavailable")

# staticRegional.PILOT_BOXES (frontend): the boxes whose edges the mosaic pads beyond.
PILOT_BOXES = [
    (-85, 24, -79, 31), (-125, 30, -115, 38), (-161, 18, -154, 23), (-11, 36, -6, 44), (-11, 49, 1, 59), (150, -38, 156, -25),
    (98, -11, 120, 2), (-49, -27, -34, -3), (17, -35, 28, -31), (-106, 8, -84, 21), (-82, 31, -74.4, 37.5), (-29.8, 36, -24, 40.1),
    (-76.1, 37.5, -69, 44.6), (-6, 42.5, 1, 48.8), (-19, 26, -9, 34), (-71, 12, -61, 20), (72, 2, 82, 10), (-84, 3, -75, 11),
    (-128, 38, -122, 49),
]


@pytest.fixture(scope="module")
def blob():
    with open(M.DEFAULT_OUT, "rb") as fh:
        return fh.read()


def _ring_nodes(margin=3.0):
    for w, s, e, n in PILOT_BOXES:
        lat = round((s - margin) / M.STEP) * M.STEP
        while lat <= n + margin:
            lng = round((w - margin) / M.STEP) * M.STEP
            while lng <= e + margin:
                inside = w <= lng <= e and s <= lat <= n
                if not inside and -90 <= lat <= 90:
                    yield lat, lng
                lng += M.STEP
            lat += M.STEP


def test_header(blob):
    assert blob[:4] == M.MAGIC
    assert len(blob) == 16 + (M.COLS * M.ROWS + 7) // 8


def test_matches_is_coastal_around_every_pilot_box(blob):
    bad = [(la, ln) for la, ln in _ring_nodes() if M.read_bit(blob, la, ln) != bathymetry.is_coastal(la, ln)]
    assert not bad, f"{len(bad)} stale nodes, e.g. {bad[:5]}: re-run scripts/build_coastal_node_mask.py"


def test_matches_is_coastal_on_a_world_sample(blob):
    rng = random.Random(20261115)
    bad = 0
    for _ in range(4000):
        r, c = rng.randrange(M.ROWS), rng.randrange(M.COLS)
        la, ln = M.node(r, c)
        bad += M.read_bit(blob, la, ln) != bathymetry.is_coastal(la, ln)
    assert bad == 0


def test_positive_control_a_flipped_bit_is_caught(blob):
    la, ln = 28.0, -78.75                      # off Florida, beyond the box's east edge
    r, c = int(round((la + 90) / M.STEP)), int(round((ln + 180) / M.STEP))
    i = r * M.COLS + c
    flipped = bytearray(blob)
    flipped[16 + (i >> 3)] ^= 1 << (i & 7)
    assert M.read_bit(bytes(flipped), la, ln) != bathymetry.is_coastal(la, ln)
