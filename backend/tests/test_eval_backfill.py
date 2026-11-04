"""eval_backfill: the parallel prefetch fills EXACTLY the cache keys eval_gfswave.fetch_fields reads (so a harness run
is all cache hits), byte identity is checked against a reference cache, and an input-version change is flagged."""
import struct
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import eval_backfill as bf
from services.weather_pipeline import eval_gfswave as gw
from services.weather_pipeline import eval_grib2 as g2
from services.weather_pipeline import eval_provenance as pv

WAVE_ORDER = ["WIND", "WDIR", "UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW", "WVHGT"]


def _msg(tag: int, gen: int = 11) -> bytes:
    """A minimal GRIB2 message: sections 1, 3, 4 carrying the fingerprinted octets, then 7777."""
    s1 = bytearray(21)
    s1[0:4], s1[4] = struct.pack(">I", 21), 1
    s1[5:7], s1[9], s1[10] = struct.pack(">H", 7), 2, 1
    s3 = bytearray(72)
    s3[0:4], s3[4] = struct.pack(">I", 72), 3
    s3[30:34], s3[34:38] = struct.pack(">I", 1440), struct.pack(">I", 721)
    s4 = bytearray(34)
    s4[0:4], s4[4], s4[13] = struct.pack(">I", 34), 4, gen
    body = bytes(s1) + bytes(s3) + bytes(s4) + bytes([tag]) * 8 + b"7777"
    return b"GRIB" + b"\x00\x00\x00\x02" + struct.pack(">Q", 16 + len(body)) + body


def _file(keys, gen=11):
    msgs = [_msg(i, gen) for i in range(len(keys))]
    off, lines = 0, []
    for n, (k, m) in enumerate(zip(keys, msgs), 1):
        lev = "10 m above ground" if k.endswith(":10m") else "surface"
        lines.append(f"{n}:{off}:d=2025100100:{k.split(':')[0]}:{lev}:24 hour fcst:")
        off += len(m)
    return b"".join(msgs), "\n".join(lines) + "\n"


class FakeS3:
    def __init__(self, gen=11):
        self.wave = _file(WAVE_ORDER, gen)
        self.atm = _file(["PRMSL", "UGRD:10m", "VGRD:10m", "TMP"])
        self.calls = []

    def __call__(self, url, rng=None, max_bytes=None):
        self.calls.append((url, rng))
        body, idx = self.wave if "/wave/" in url else self.atm
        if url.endswith(".idx"):
            return idx.encode(), 200
        lo, hi = rng
        return body[lo:(hi + 1) if hi is not None else None], 206


C = datetime(2025, 10, 1, 0, tzinfo=timezone.utc)


def test_prefetch_fills_exactly_the_keys_fetch_fields_reads(tmp_path, monkeypatch):
    res = bf.prefetch(str(tmp_path), [(C, 24), (C, 48)], workers=4, get=FakeS3())
    assert res["ok"] == 2 and not res["failed"]
    # The harness, OFFLINE on the filled cache: every fetch must be a hit (offline raises on a miss).
    monkeypatch.setattr(g2, "decode_span", lambda raw, keys, want, b: {k: (None, {"decoder": "stub"}) for k in want})
    monkeypatch.setattr(g2, "select_backend", lambda prefer="auto": "eccodes")
    cache = pv.Cache(str(tmp_path), offline=True, pause_s=0.0)
    gw.fetch_fields(cache, C, 24, wind_source="pgrb2", decoder="eccodes")
    assert cache.records and all(r["cache_hit"] for r in cache.records)


def test_cache_base_matches_fetch_fields_prefix():
    assert bf.cache_base(C, 72) == "gfs/2025100100/f072"


def test_parity_check_byte_identity_and_difference(tmp_path):
    a, b = str(tmp_path / "a"), str(tmp_path / "b")
    bf.prefetch(a, [(C, 24)], get=FakeS3())
    bf.prefetch(b, [(C, 24)], get=FakeS3())
    assert bf.parity_check(b, a, [(C, 24)])["byte_identical"] is True
    c = str(tmp_path / "c")
    bf.prefetch(c, [(C, 24)], get=FakeS3(gen=12))           # different bytes, same ranges
    rep = bf.parity_check(c, a, [(C, 24)])
    assert rep["byte_identical"] is False and rep["different"]


def test_version_change_is_a_parity_break(tmp_path):
    old = bf.prefetch(str(tmp_path / "o"), [(C, 24)], get=FakeS3(gen=11))["rows"]
    new = bf.prefetch(str(tmp_path / "n"), [(C, 24)], get=FakeS3(gen=12))["rows"]
    ref = new[0]["fingerprint"]["id"]
    assert old[0]["fingerprint"]["generating_process"] == 11
    assert bf.parity_breaks(new, ref) == []
    assert len(bf.parity_breaks(old, ref)) == 1


def test_workers_are_capped_and_failures_counted(tmp_path):
    def broken(url, rng=None, max_bytes=None):
        raise OSError("down")
    res = bf.prefetch(str(tmp_path), [(C, 24)], workers=999, get=broken)
    assert res["ok"] == 0 and len(res["failed"]) == 1
    assert bf.MAX_WORKERS == 16


def test_only_the_open_data_bucket_is_parallel():
    assert bf.PARALLEL_HOSTS == ("noaa-gfs-bdp-pds.s3.amazonaws.com",)
    assert all(h in pv.ALLOWED_HOSTS for h in bf.PARALLEL_HOSTS)


def test_needed_uses_the_harness_plan():
    t = [datetime(2025, 10, 4, 0, tzinfo=timezone.utc)]
    assert bf.needed(t, [24, 48]) == sorted({(c, fh) for c, fh, _, _ in gw.plan(t, [24, 48])})


@pytest.mark.parametrize("key", ["UGRD", "HTSGW", "DIRPW"])
def test_span_keys_follow_fetch_fields(key):
    assert key in bf.WAVE_SPAN_KEYS and bf.ATM_SPAN_KEYS == ("UGRD:10m", "VGRD:10m")
