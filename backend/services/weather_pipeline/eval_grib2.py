"""eval_grib2.py - the GRIB2 half of the evaluation harness's forecast-of-record replay. Serves nothing.

Two things, both small and both PURE apart from the optional pygrib import:
  * `.idx` parsing and byte-range selection for NOAA's GFS / GFS-Wave files on the AWS Open Data archive
    (s3://noaa-gfs-bdp-pds): one sidecar line per message, `n:offset:d=YYYYMMDDHH:VAR:LEVEL:FCST:`.
  * DECODING. Production decodes with pygrib (requirements.txt pins it; the Linux wheel bundles ecCodes). The
    harness prefers it whenever it imports. Where it does not (Windows has no pygrib wheel), a minimal built-in
    decoder reads exactly what GFS-Wave publishes: grid template 3.0 (regular lat/lon), data template 5.40
    (JPEG 2000 through Pillow/OpenJPEG) or 5.0 (simple packing), bitmap indicator 0 or 255. Anything else raises
    `Unsupported` rather than guessing. The scorecard records which decoder produced every field, because two
    decoders are two instruments (GFS pgrb2 atmosphere files use template 5.3, which only pygrib reads).

Field values: float64 array [nj, ni] with NaN where the bitmap masks a point (land, ice), rows SOUTH to NORTH
(the decoder flips GFS's north-to-south scan), longitudes 0 .. 360 - dx eastward.
"""
import io
import struct
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np


class Unsupported(ValueError):
    """A GRIB2 feature the built-in decoder does not read. Never decoded approximately."""


# ---- .idx ------------------------------------------------------------------------------------------------------
def parse_idx(text: str) -> List[Tuple[int, str]]:
    """[(byte offset, key)] in file order. The key is VAR, or VAR:n for the swell partitions
    (`SWELL:1 in sequence`), matching the production fetcher's selection labels."""
    out = []
    for line in (text or "").splitlines():
        p = line.split(":")
        if len(p) < 5:
            continue
        try:
            off = int(p[1])
        except ValueError:
            continue
        var, lev = p[3], p[4]
        key = f"{var}:{lev.split()[0]}" if var in ("SWELL", "SWPER", "SWDIR") else var
        if lev.startswith("10 m above ground"):
            key = f"{var}:10m"
        out.append((off, key))
    return out


def select_range(idx: Sequence[Tuple[int, str]], wanted: Sequence[str]) -> Optional[Tuple[int, Optional[int], List[str]]]:
    """(first byte, last byte or None = to EOF, keys in the span) of the ONE contiguous span covering every wanted
    key. One range GET per file is the polite form; the span may include unwanted messages, which are skipped."""
    pos = [i for i, (_, k) in enumerate(idx) if k in wanted]
    if not pos or len({idx[i][1] for i in pos}) < len(set(wanted)):
        return None
    lo, hi = pos[0], pos[-1]
    last = idx[hi + 1][0] - 1 if hi + 1 < len(idx) else None
    return idx[lo][0], last, [k for _, k in idx[lo:hi + 1]]


# ---- decoding ----------------------------------------------------------------------------------------------------
def iter_messages(buf: bytes) -> Iterator[bytes]:
    p = 0
    while True:
        p = buf.find(b"GRIB", p)
        if p < 0:
            return
        if len(buf) < p + 16:
            raise Unsupported("truncated GRIB header")
        total = struct.unpack(">Q", buf[p + 8:p + 16])[0]
        if buf[p + 7] != 2:
            raise Unsupported(f"GRIB edition {buf[p + 7]}")
        yield buf[p:p + total]
        p += total


def _sm32(b):  # signed-magnitude int32 (GRIB2 convention)
    v = struct.unpack(">I", b)[0]
    return -(v & 0x7FFFFFFF) if v & 0x80000000 else v


def _sm16(b):
    v = struct.unpack(">H", b)[0]
    return -(v & 0x7FFF) if v & 0x8000 else v


def _sections(msg: bytes) -> Dict[int, bytes]:
    p, sec = 16, {}
    while p < len(msg) - 4:
        if msg[p:p + 4] == b"7777":
            break
        length = struct.unpack(">I", msg[p:p + 4])[0]
        if length < 5:
            raise Unsupported("malformed section length")
        sec[msg[p + 4]] = msg[p:p + length]
        p += length
    return sec


def decode_builtin(msg: bytes) -> Tuple[np.ndarray, dict]:
    """(values [nj, ni] south-to-north, meta) for one message; raises Unsupported outside 3.0 / 5.0 / 5.40."""
    sec = _sections(msg)
    s3, s5, s6, s7 = sec.get(3), sec.get(5), sec.get(6), sec.get(7)
    if s3 is None or s5 is None or s7 is None:
        raise Unsupported("missing section 3, 5 or 7")
    if struct.unpack(">H", s3[12:14])[0] != 0:
        raise Unsupported("grid template other than 3.0")
    ni = struct.unpack(">I", s3[30:34])[0]
    nj = struct.unpack(">I", s3[34:38])[0]
    lat1, lon1 = _sm32(s3[46:50]) / 1e6, _sm32(s3[50:54]) / 1e6
    lat2, lon2 = _sm32(s3[55:59]) / 1e6, _sm32(s3[59:63]) / 1e6
    npack = struct.unpack(">I", s5[5:9])[0]
    tmpl5 = struct.unpack(">H", s5[9:11])[0]
    ref = struct.unpack(">f", s5[11:15])[0]
    e_scale, d_scale, nbits = _sm16(s5[15:17]), _sm16(s5[17:19]), s5[19]
    data = s7[5:]
    if nbits == 0:
        x = np.zeros(npack)
    elif tmpl5 == 40:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im.load()
        x = np.asarray(im, dtype=np.float64).ravel()[:npack]
        # Pillow widens an n-bit (n < 16) J2K component to 16 bits by a left shift; undo it.
        if im.mode.startswith("I;16") and nbits < 16:
            x = np.floor(x / (1 << (16 - nbits)))
    elif tmpl5 == 0:
        bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))[:npack * nbits].reshape(npack, nbits)
        x = bits.dot(1 << np.arange(nbits - 1, -1, -1)).astype(np.float64)
    else:
        raise Unsupported(f"data template 5.{tmpl5}")
    vals = (ref + x * (2.0 ** e_scale)) / (10.0 ** d_scale)
    out = np.full(ni * nj, np.nan)
    if s6 is not None and s6[5] == 0:
        bm = np.unpackbits(np.frombuffer(s6[6:], dtype=np.uint8))[:ni * nj].astype(bool)
        if int(bm.sum()) != npack:
            raise Unsupported(f"bitmap holds {int(bm.sum())} points for {npack} packed values")
        out[bm] = vals
    elif s6 is not None and s6[5] != 255:
        raise Unsupported(f"bitmap indicator {s6[5]}")
    else:
        out[:] = vals
    arr = out.reshape(nj, ni)
    if lat1 > lat2:
        arr = arr[::-1]
    return arr, {"ni": ni, "nj": nj, "lat_south": min(lat1, lat2), "lat_north": max(lat1, lat2),
                 "lon_west": lon1 % 360.0, "dlat": (abs(lat2 - lat1) / (nj - 1)) if nj > 1 else 0.0,
                 "dlon": ((lon2 - lon1) % 360.0) / (ni - 1) if ni > 1 else 0.0, "template": f"5.{tmpl5}",
                 "decoder": "builtin"}


def _decode_pygrib(buf: bytes, keys: Sequence[str]) -> Dict[str, Tuple[np.ndarray, dict]]:
    import os
    import tempfile

    import pygrib  # noqa: F401 - the production decoder
    fd, path = tempfile.mkstemp(suffix=".grib2")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(buf)
        out = {}
        with pygrib.open(path) as grbs:
            for key, g in zip(keys, grbs):
                vals = np.ma.filled(g.values.astype(np.float64), np.nan)
                lats, lons = g.latlons()
                if lats[0, 0] > lats[-1, 0]:
                    vals = vals[::-1]
                out[key] = (vals, {"ni": vals.shape[1], "nj": vals.shape[0], "lat_south": float(lats.min()),
                                   "lat_north": float(lats.max()), "lon_west": float(lons.min()) % 360.0,
                                   "dlat": float(abs(lats[1, 0] - lats[0, 0])), "dlon": float(lons[0, 1] - lons[0, 0]),
                                   "template": "pygrib", "decoder": "pygrib"})
        return out
    finally:
        os.unlink(path)


def decode_span(buf: bytes, span_keys: Sequence[str], wanted: Sequence[str],
                prefer: str = "auto") -> Dict[str, Tuple[np.ndarray, dict]]:
    """{key: (values, meta)} for the wanted keys of a contiguous byte span whose messages are `span_keys` in order.
    prefer: "auto" (pygrib when importable), "pygrib" or "builtin"."""
    if prefer in ("auto", "pygrib"):
        try:
            got = _decode_pygrib(buf, span_keys)
            return {k: v for k, v in got.items() if k in wanted}
        except ImportError:
            if prefer == "pygrib":
                raise
    out = {}
    for key, msg in zip(span_keys, iter_messages(buf)):
        if key in wanted:
            out[key] = decode_builtin(msg)
    missing = [k for k in wanted if k not in out]
    if missing:
        raise Unsupported(f"span decoded without {missing}")
    return out


def value_at(arr: np.ndarray, meta: dict, i: int, j: int) -> Optional[float]:
    v = float(arr[i, j % meta["ni"]])
    return None if v != v else v


def index_of(meta: dict, lat: float, lng: float) -> Tuple[int, int]:
    """(row, col) of the grid node at or south-west of (lat, lng)."""
    i = int(np.floor((lat - meta["lat_south"]) / meta["dlat"]))
    j = int(np.floor(((lng - meta["lon_west"]) % 360.0) / meta["dlon"]))
    return i, j
