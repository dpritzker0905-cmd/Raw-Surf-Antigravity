"""Bounded anonymous CMEMS native-resolution replay capture; never imports the app.

Requires numpy and numcodecs. Returns real point samples, not production coarse
block means. Raw public source bytes and their SHA-256 evidence are retained.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener
import ssl
import xml.etree.ElementTree as ET

import numpy as np
import numcodecs

DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
PRODUCT_ID = "GLOBAL_ANALYSISFORECAST_WAV_001_027"
MAX_BYTES = 25 * 1024 * 1024
VARIABLE_MAP = (
    ("VHM0", "wave_height", "m"), ("VMDR", "wave_direction", "°"),
    ("VTM10", "wave_period", "s"),
    ("VHM0_SW1", "swell_wave_height", "m"),
    ("VMDR_SW1", "swell_wave_direction", "°"),
    ("VTM01_SW1", "swell_wave_period", "s"),
    ("VHM0_SW2", "secondary_swell_wave_height", "m"),
    ("VMDR_SW2", "secondary_swell_wave_direction", "°"),
    ("VTM01_SW2", "secondary_swell_wave_period", "s"),
    ("VHM0_WW", "wind_wave_height", "m"),
    ("VMDR_WW", "wind_wave_direction", "°"),
    ("VTM01_WW", "wind_wave_period", "s"),
)
_ALLOWED_HOSTS = {"stac.marine.copernicus.eu", "s3.waw3-1.cloudferro.com"}
_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Provider redirects are not accepted")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def capture(output_dir: Path) -> dict:
    """Capture six coastal cells, all twelve fields, now-6h through real horizon.

    Raises on ambiguous producer identity, metadata changes, no ocean values,
    unfamiliar encoding, a time-chunk boundary, or the cumulative byte cap.
    No credentials, environment files, shared store, or application routes are used.
    """
    raw_dir = Path(output_dir) / "raw_cmems"
    raw_dir.mkdir(parents=True, exist_ok=True)
    # Build a verified system-trust context without SSLKEYLOGFILE side effects.
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    tls.load_default_certs(ssl.Purpose.SERVER_AUTH)
    opener = build_opener(ProxyHandler({}), _NoRedirect(), HTTPSHandler(context=tls))
    records: list[dict] = []
    total_bytes = 0

    def fetch(url: str, *, head: bool = False) -> tuple[bytes, dict]:
        nonlocal total_bytes
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_HOSTS or parsed.username:
            raise ValueError("Public provider URL outside the explicit HTTPS allowlist")
        with opener.open(Request(url, method="HEAD" if head else "GET"), timeout=45) as response:
            if response.geturl() != url:
                raise ValueError("Provider redirect is not accepted")
            size = response.headers.get("Content-Length")
            remaining = MAX_BYTES - total_bytes
            if not head and size is not None and int(size) > remaining:
                raise ValueError("CMEMS cumulative download budget exceeded")
            data = b"" if head else response.read(remaining)
            if not head and (size is None and len(data) == remaining):
                raise ValueError("Unbounded response exhausted the CMEMS download budget")
            if not head and size is not None and len(data) != int(size):
                raise ValueError("CMEMS response did not match its declared byte length")
            total_bytes += len(data)
            info = {"url": url, "retrieved_at": _iso(datetime.now(timezone.utc)),
                    "etag": response.headers.get("ETag"), "bytes": len(data),
                    "content_length": int(size) if size is not None else None}
            if not head:
                digest = _sha(data)
                name = f"{len(records):03d}-{digest}.bin"
                (raw_dir / name).write_bytes(data)
                info.update(sha256=digest, file=f"raw_cmems/{name}")
                records.append(info)
            return data, info

    config_bytes, _ = fetch("https://stac.marine.copernicus.eu/clients-config-v1")
    catalogue = json.loads(config_bytes)["catalogues"][0]
    product_url = urljoin(catalogue["stacRoot"], f"{PRODUCT_ID}/product.stac.json")
    product_bytes, _ = fetch(product_url)
    product = json.loads(product_bytes)
    candidates = sorted((link["href"] for link in product["links"]
                         if link["rel"] == "item" and
                         Path(link["href"]).parts[0].startswith(DATASET_ID + "_")), reverse=True)
    dataset = None
    for href in candidates:
        dataset_url = urljoin(product_url, href)
        dataset_bytes, _ = fetch(dataset_url)
        candidate = json.loads(dataset_bytes)
        props = candidate["properties"]
        if props.get("admp_retired_date") is None and not props.get("admp_in_preparation", False):
            dataset = candidate
            break
    if dataset is None:
        raise ValueError("No active version of the actual CMEMS wave dataset")
    version = dataset["id"]
    native_uri = dataset["assets"]["native"]["href"].rstrip("/")
    zarr_uri = dataset["assets"]["geoChunked"]["href"].rstrip("/")
    zmeta_bytes, _ = fetch(zarr_uri + "/.zmetadata")
    metadata = json.loads(zmeta_bytes)["metadata"]

    def decode(name: str, data: bytes) -> np.ndarray:
        spec = metadata[name + "/.zarray"]
        if spec["zarr_format"] != 2 or spec.get("filters") or spec["order"] != "C":
            raise ValueError("Unsupported provider encoding")
        decoded = numcodecs.get_codec(spec["compressor"]).decode(data)
        return np.frombuffer(decoded, dtype=spec["dtype"])

    def coordinate(name: str) -> np.ndarray:
        spec = metadata[name + "/.zarray"]
        arrays = []
        for index in range(math.ceil(spec["shape"][0] / spec["chunks"][0])):
            data, _ = fetch(f"{zarr_uri}/{name}/{index}")
            arrays.append(decode(name, data))
        return np.concatenate(arrays)[:spec["shape"][0]]

    time_values = coordinate("time")
    time_attrs = metadata["time/.zattrs"]
    if time_attrs["units"] != "hours since 1950-01-01" or time_attrs.get("calendar") != "gregorian":
        raise ValueError("Unexpected CMEMS time-axis semantics")
    epoch = datetime(1950, 1, 1, tzinfo=timezone.utc)
    axis = [epoch + timedelta(hours=int(value)) for value in time_values]
    now = datetime.now(timezone.utc)
    indices = np.array([i for i, time in enumerate(axis) if time >= now - timedelta(hours=6)])
    if len(indices) < 2 or axis[-1] <= now:
        raise ValueError("Real forecast horizon is unavailable")
    times = [_iso(axis[int(i)]) for i in indices]
    latitudes, longitudes = coordinate("latitude"), coordinate("longitude")
    cells = [(int(np.abs(latitudes - lat).argmin()), int(np.abs(longitudes - lon).argmin()))
             for lat in (36.0, 37.0) for lon in (-124.0, -123.0, -122.0)]
    values_by_var = {}
    chunk_records = []
    for variable, om_name, _ in VARIABLE_MAP:
        spec = metadata[variable + "/.zarray"]
        chunks = spec["chunks"]
        time_chunks = {int(i) // chunks[0] for i in indices}
        spatial_chunks = {(y // chunks[1], x // chunks[2]) for y, x in cells}
        if len(time_chunks) != 1 or len(spatial_chunks) != 1:
            raise ValueError("Bounded capture would require multiple chunks per variable")
        tchunk = time_chunks.pop()
        ychunk, xchunk = spatial_chunks.pop()
        key = f"{tchunk}.{ychunk}.{xchunk}"
        data, record = fetch(f"{zarr_uri}/{variable}/{key}")
        record.update(variable=variable, key=key)
        chunk_records.append(record)
        array = decode(variable, data).reshape(chunks)
        attrs = metadata[variable + "/.zattrs"]
        values_by_var[om_name] = []
        for y, x in cells:
            raw = array[indices % chunks[0], y % chunks[1], x % chunks[2]]
            valid = raw != spec["fill_value"] if spec.get("fill_value") is not None else np.ones(raw.shape, dtype=bool)
            decoded = raw.astype(float) * attrs.get("scale_factor", 1) + attrs.get("add_offset", 0)
            if not np.isfinite(decoded[valid]).all():
                raise ValueError(f"Nonfinite ocean sample in {variable}")
            values_by_var[om_name].append([round(float(value), 4) if ok else None
                                           for value, ok in zip(decoded, valid)])
        if not any(all(value is not None for value in cell) for cell in values_by_var[om_name]):
            raise ValueError(f"No complete actual ocean series in {variable}")

    native = urlsplit(native_uri)
    bucket, prefix = native.path.lstrip("/").split("/", 1)
    first_month = (axis[int(indices[0])] - timedelta(days=1)).replace(day=1)
    month = first_month
    keys = []
    listing_urls = []
    while (month.year, month.month) <= (axis[-1].year, axis[-1].month):
        query = urlencode({"list-type": "2", "prefix": f"{prefix}/{month:%Y/%m}/", "max-keys": "1000"})
        url = f"{native.scheme}://{native.netloc}/{bucket}?{query}"
        listing, _ = fetch(url)
        listing_urls.append((url, _sha(listing)))
        root = ET.fromstring(listing)
        if root.findtext(_NS + "IsTruncated") == "true":
            raise ValueError("Producer listing truncated; refusing incomplete identity evidence")
        keys.extend(node.text for node in root.iter(_NS + "Key"))
        month = month.replace(year=month.year + (month.month == 12), month=month.month % 12 + 1)
    pins = json.loads((Path(__file__).resolve().parent / "source-pins.json").read_text())
    resolver_rel = "backend/services/cmems_run_identity.py"
    resolver_path = Path(__file__).resolve().parent / "_pinned" / resolver_rel
    if _sha(resolver_path.read_bytes()) != pins["files"][resolver_rel]["sha256"]:
        raise ValueError("CMEMS identity resolver is not the prepared pinned source")
    module_spec = importlib.util.spec_from_file_location("_canary_cmems_identity", resolver_path)
    resolver = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(resolver)
    run, reason = resolver.run_from_native_keys(keys, axis[int(indices[0])], axis[-1])
    if run is None or reason != "ok":
        raise ValueError(f"CMEMS bulletin not proven: {reason}")
    run_iso = _iso(run)
    # Mutable provider addresses must still identify the same capture at completion.
    for record in chunk_records:
        _, current = fetch(record["url"], head=True)
        if not record["etag"] or current["etag"] != record["etag"]:
            raise ValueError("CMEMS chunk changed during capture")
    if _sha(fetch(zarr_uri + "/.zmetadata")[0]) != _sha(zmeta_bytes):
        raise ValueError("CMEMS Zarr metadata changed during capture")
    for url, digest in listing_urls:
        if _sha(fetch(url)[0]) != digest:
            raise ValueError("CMEMS producer listing changed during capture")
    points = []
    for cell_index, (y, x) in enumerate(cells):
        points.append({"latitude": float(latitudes[y]), "longitude": float(longitudes[x]),
                       "__provider": "copernicus", "__model_run_time": run_iso,
                       "generationtime_ms": 0, "utc_offset_seconds": 0,
                       "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                       "hourly_units": {"time": "iso8601", **{om: unit for _, om, unit in VARIABLE_MAP}},
                       "hourly": {"time": times, **{om: values[cell_index] for om, values in values_by_var.items()}}})
    evidence = {"provider": "copernicus", "dataset": DATASET_ID, "version": version,
                "identity_source_commit": pins["base_commit"],
                "identity_source_sha256": pins["files"][resolver_rel]["sha256"],
                "native_uri": native_uri, "zarr_uri": zarr_uri, "run_iso": run_iso,
                "identity_reason": reason, "first_valid": times[0], "last_valid": times[-1],
                "source_keys": keys, "download_bytes": total_bytes, "download_cap_bytes": MAX_BYTES,
                "sample_method": "native-resolution point samples; no production block means",
                "bounds": {"west": -124.0, "east": -122.0, "south": 36.0, "north": 37.0},
                "resolution": 1.0, "actual_coordinates": [[float(latitudes[y]), float(longitudes[x])] for y, x in cells],
                "sources": records}
    (raw_dir / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return {"points": points, "times": times, "run_iso": run_iso, "evidence": evidence,
            "bbox": evidence["bounds"], "resolution": evidence["resolution"],
            "actual_coordinates": evidence["actual_coordinates"]}
