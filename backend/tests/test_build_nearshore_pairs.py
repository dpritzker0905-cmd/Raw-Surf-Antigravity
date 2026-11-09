"""build_nearshore_pairs.fetch_spots: --spots-file reads locally and never touches the network."""
import json
import os
import sys
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import build_nearshore_pairs as bnp  # noqa: E402


def test_spots_file_is_offline_and_normalised(tmp_path):
    f = tmp_path / "spots.json"
    f.write_text(json.dumps({"spots": [
        {"id": 1, "name": "A", "latitude": 36.9, "longitude": -122.0},
        {"id": 2, "name": "B", "lat": 33.0, "lng": -117.3},
        {"id": 3, "name": "no-coords"},
    ]}), encoding="utf-8")
    with mock.patch.object(bnp.urllib.request, "urlopen", side_effect=AssertionError("network")):
        out = bnp.fetch_spots(str(f))
    assert [s["id"] for s in out] == ["1", "2"]
    assert out[0]["lat"] == 36.9 and out[1]["lng"] == -117.3


def test_spots_file_accepts_bare_list(tmp_path):
    f = tmp_path / "spots.json"
    f.write_text(json.dumps([{"id": "x", "name": "X", "latitude": 1.0, "longitude": 2.0}]), encoding="utf-8")
    assert bnp.fetch_spots(str(f))[0]["id"] == "x"
