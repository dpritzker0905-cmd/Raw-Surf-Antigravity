#!/usr/bin/env python3
"""Offline bathymetry tile fetch for the MOP-lite gate (docs/weather-program/gates/nearshore-moplite-v1.md section 1).

CI / local only; NEVER the Render box. Reads a tile manifest (JSON list of {id, source, url, bytes, license,
attribution, native_datum}) and downloads each tile, freezing its sha256 BEFORE any coefficient is computed.

  * DRY RUN is the default: it prints the plan and the total size and downloads nothing. `--go` downloads.
  * The total declared size is checked against `--max-total-mb` before a single byte moves; a manifest that exceeds it
    is refused. The size is stated in the run's summary either way.
  * Only https URLs on the allow-listed public hosts are fetched (no credentials are used or needed).
  * Output: <out>/<id>.<ext> files plus TILES.sha256 ("<sha256>  <file>" per tile, sorted).

The tile LIST per target is an OPEN item of the gate (section 9); the manifest is supplied by the dispatching owner.
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request

ALLOWED_HOSTS = (
    "www.ngdc.noaa.gov", "noaa-nos-coastal-lidar-pds.s3.amazonaws.com", "chs.coast.noaa.gov",
    "erddap.emodnet.eu", "www.emodnet-bathymetry.eu", "ftp.emodnet-bathymetry.eu",
    "www.bodc.ac.uk", "dap.ceda.ac.uk", "www.gebco.net", "download.gebco.net", "www.ncei.noaa.gov",
)
SUMS = "TILES.sha256"


def load_manifest(path):
    with open(path, encoding="utf-8") as f:
        tiles = json.load(f)
    for t in tiles:
        for k in ("id", "source", "url", "bytes", "native_datum", "license"):
            if k not in t:
                raise ValueError(f"tile {t.get('id')!r}: missing {k!r}")
        u = urllib.parse.urlparse(t["url"])
        if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
            raise ValueError(f"tile {t['id']}: {t['url']} is not https on an allow-listed public host")
    return tiles


def plan(tiles):
    total = sum(int(t["bytes"]) for t in tiles)
    return total, [f"{t['id']:<28} {t['source']:<8} {int(t['bytes']) / 1e6:10.1f} MB  {t['native_datum']:<8} {t['license']}"
                   for t in tiles]


def fetch(tiles, out):
    os.makedirs(out, exist_ok=True)
    sums = {}
    for t in tiles:
        ext = os.path.splitext(urllib.parse.urlparse(t["url"]).path)[1] or ".bin"
        name = f"{t['id']}{ext}"
        h = hashlib.sha256()
        with urllib.request.urlopen(t["url"], timeout=120) as r, open(os.path.join(out, name), "wb") as f:   # noqa: S310
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                h.update(chunk)
                f.write(chunk)
        sums[name] = h.hexdigest()
    with open(os.path.join(out, SUMS), "w", encoding="utf-8", newline="\n") as f:
        for name in sorted(sums):
            f.write(f"{sums[name]}  {name}\n")
    return sums


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", default="nearshore_lite_tiles")
    ap.add_argument("--max-total-mb", type=float, default=2000.0)
    ap.add_argument("--go", action="store_true", help="download (default: dry run)")
    a = ap.parse_args(argv)
    tiles = load_manifest(a.manifest)
    total, lines = plan(tiles)
    print("\n".join(lines))
    print(f"TOTAL {total / 1e6:.1f} MB over {len(tiles)} tiles (cap {a.max_total_mb:.0f} MB)")
    if total / 1e6 > a.max_total_mb:
        print("REFUSED: the declared size exceeds the cap", file=sys.stderr)
        return 1
    if not a.go:
        print("DRY RUN: nothing downloaded (pass --go)")
        return 0
    sums = fetch(tiles, a.out)
    print(f"downloaded {len(sums)} tiles; sha256 table written to {os.path.join(a.out, SUMS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
