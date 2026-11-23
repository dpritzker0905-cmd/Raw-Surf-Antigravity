"""The frame publisher's prune never touches `verify/` (gate served-wave-verify-v1 section 0.3): the point archive and the public
score tables under weather-frames/verify/ are not on the frames' 2-run retention path."""
import re
from pathlib import Path

from services import frame_set as fs
from services import frame_set_bundle as fsb
from services import frame_set_fill as fsf

BACKEND = Path(__file__).resolve().parents[1]
VERIFY = ["verify/served-wave/v1/scores/latest.json", "verify/served-wave/v1/scores/2027-01-15.json",
          "verify/point-archive/v1/served/gfs/20270115T0000Z.jsonl.gz", "verify/point-archive/v1/truth/46025/x.txt.gz"]


def _targets():
    return list(fs.SETS) + list(fs.EURO_SWELL_SETS) + list(fsb.REGIONAL_SETS) + list(fsb.OTHER_MODEL_SETS) + \
        [dict(t) for t in fsf.FILLED_SETS]


def test_every_set_prefix_is_under_v1():
    for t in _targets():
        assert fs.set_prefix(t).startswith("v1/"), t


def test_retention_deletes_only_under_the_sets_own_prefix():
    for t in _targets():
        prefix = fs.set_prefix(t)
        existing = VERIFY + [f"{prefix}/old/x.bin", f"{prefix}/index/old.json", f"{prefix}/keep.bin"]
        gone = fs.retention_deletes(existing, t, {f"{prefix}/keep.bin"})
        assert gone == sorted([f"{prefix}/index/old.json", f"{prefix}/old/x.bin"]), t
        assert not any(p.startswith("verify/") for p in gone)


def test_every_frames_bucket_delete_goes_through_retention_deletes():
    """Each publisher that deletes from weather-frames deletes only `gone` from fs.retention_deletes over a set prefix."""
    for rel in ("scripts/publish_frame_images.py", "services/frame_set_raster.py"):
        src = (BACKEND / rel).read_text(encoding="utf-8")
        calls = re.findall(r"sink\.delete\((\w+)\)", src)
        assert calls and set(calls) == {"gone"}, rel
        assert re.search(r"gone = fs\.retention_deletes\(sink\.list\(", src), rel
        assert "verify/" not in src, rel
