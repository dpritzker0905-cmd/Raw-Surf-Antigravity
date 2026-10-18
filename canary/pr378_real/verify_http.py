"""Independent HTTP qualification of the sealed regional real-grid replay.

This does not qualify the full application, L2 persistence or forecast accuracy.
Only the explicitly named isolated canary or a local test server is allowed.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import re
from pathlib import Path
import ssl
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
BASE = "6fbf439ac2bb2da5337f9a45864ffd3af8be8423"
MODE = "real-grid-regional-replay"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None and parsed.utcoffset() is not None, "Unqualified forecast timestamp")
    return parsed.astimezone(timezone.utc)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AssertionError("HTTP redirect refused")


def validate_url(value):
    parsed = urlsplit(value)
    require(not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            "URL credentials, query and fragment are forbidden")
    require(parsed.path in ("", "/"), "Provide the canary origin without a path")
    local = parsed.hostname in ("localhost", "127.0.0.1")
    remote = bool(parsed.hostname and parsed.hostname.startswith("rawsurf-pr378-real-grid-")
                  and parsed.hostname.endswith(".onrender.com"))
    require(local or remote, "Hostname is outside the explicit replay-canary allowlist")
    require(parsed.scheme in (("http", "https") if local else ("https",)), "Secure HTTPS is required remotely")
    require(local or parsed.port in (None, 443), "Unexpected remote port")
    return value.rstrip("/")


def trusted_bundle():
    pin = json.loads((HERE / "bundle-pin.json").read_text())
    compressed = (HERE / "bundle.json.gz").read_bytes()
    require(pin["base_commit"] == BASE and sha(compressed) == pin["sha256"], "Local bundle pin mismatch")
    payload = json.loads(gzip.decompress(compressed))
    require(set(payload["files"]) == set(payload["sha256"]), "Local bundle inventory mismatch")
    for name, content in payload["files"].items():
        require(sha(content.encode()) == payload["sha256"][name], "Local sealed-file hash mismatch")
    receipt = json.loads(payload["files"]["receipt.json"])
    require(receipt["base_commit"] == BASE and receipt["guard"] == "0" and receipt["mode"] == MODE,
            "Local capture identity mismatch")
    require(len(receipt["cases"]) == 16, "Expected all sixteen regional provenance cases")
    require(pin["products"] == len(receipt["products"]) and pin["cases"] == len(receipt["cases"]),
            "Local bundle inventory counts disagree")
    source = json.loads((HERE / "source-pins.json").read_text())
    return pin, payload, receipt, source


def check_adapter(actual, expected):
    require(re.fullmatch(r'[0-9a-f]{40}', expected) is not None, 'Expected adapter must be a full commit SHA')
    require(actual == expected, 'Runtime adapter differs from the reviewed commit')


def verify(origin, counts, expected_adapter):
    pin, payload, expected, source = trusted_bundle()
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    tls.load_default_certs(ssl.Purpose.SERVER_AUTH)

    def request(path, *, method="GET", status=200):
        opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=tls))
        req = Request(origin + path, method=method, headers={"Accept": "application/json"})
        try:
            response = opener.open(req, timeout=45)
        except HTTPError as exc:
            response = exc
        with response:
            body = response.read(8 * 1024 * 1024 + 1)
            require(len(body) <= 8 * 1024 * 1024, "HTTP response exceeds verification budget")
            require(response.code == status, f"Unexpected HTTP status for {method} {path.split('?')[0]}")
            return body, response.headers

    def get_json(path, **kwargs):
        return json.loads(request(path, **kwargs)[0])

    def check_identity(identity):
        expected_fields = {"base_commit": BASE, "bundle_sha256": pin["sha256"], "guard": "0", "mode": MODE,
                           "source_archive_sha256": source["archive_sha256"],
                           "replay_as_of": expected["as_of"], "bbox": expected["bbox"],
                           "resolution": expected["resolution"], "products": len(expected["products"]),
                           "cases": len(expected["cases"]), "network_attempts": 0,
                           "tripwire_positive_control": "blocked", "database_imported": False,
                           "server_imported": False, "bundle_unchanged": True,
                           "verified_python_files": len(source["files"]),
                           "storage": "actual ProductStore; sealed local real-grid files; no L2"}
        for key, value in expected_fields.items():
            require(identity.get(key) == value, "Runtime identity mismatch: " + key)
        instant(identity["served_at"])
        check_adapter(identity.get("adapter_commit"), expected_adapter)
        return {key: value for key, value in identity.items() if key != "served_at"}

    initial_identity = check_identity(get_json("/identity"))
    require(get_json("/evidence") == expected, "HTTP source evidence differs from trusted local receipt")
    ready = get_json("/healthz")
    require(ready == {"status": "ready", "guard": "0", "bundle_sha256": pin["sha256"],
                      "real_products": len(expected["products"])}, "Readiness identity mismatch")
    counts["identity"] += 1
    loaded = {}
    for filename, record in expected["products"].items():
        require(Path(filename).name == filename and "/" not in filename and "\\" not in filename,
                "Unsafe expected product filename")
        body, headers = request("/products/" + quote(filename, safe=""))
        digest = sha(body)
        require(digest == record["sha256"] == payload["sha256"]["products/" + filename],
                "HTTP product body SHA-256 differs from capture/store bytes")
        require(headers.get("X-Content-SHA256") == digest and headers.get("X-Canary-Guard") == "0"
                and headers.get("X-Actual-ProductStore-Loaded") == "1", "Missing actual-store HTTP proof headers")
        product = json.loads(body)
        require(product == json.loads(payload["files"]["products/" + filename]), "Loaded JSON differs from sealed grid")
        require(product["product_id"] == filename and product["model"] == record["model"]
                and product["domain"] == "marine" and product["is_estimated"] == record["is_estimated"]
                and product["is_test_fixture"] is False and product["provider"] != "test-fixture",
                "Product identity or fixture invariant failed")
        require(instant(product["valid_time"]) == instant(record["valid_time"]), "Stored valid time mismatch")
        require(product["model_run_time_status"] == record["model_run_time_status"], "Stored cycle status mismatch")
        if record["model_run_time"] is not None:
            require(instant(product["model_run_time"]) == instant(record["model_run_time"]), "Stored cycle mismatch")
        else:
            require(product["model_run_time"] is None, "Unexpected invented shared cycle")
        vectors = product["grid"]["vectors"]
        require(len(vectors) == record["cells"] == 6 and sum(v["is_valid"] for v in vectors) == record["valid_cells"] > 0,
                "Regional grid shape or validity mismatch")
        require(product["grid"]["bounds"] == expected["bbox"], "Regional grid bounds mismatch")
        loaded[filename] = product
        counts["products"] += 1

    for filename, record in expected["products"].items():
        if record["kind"] != "estimate":
            require(loaded[filename]["model_run_time_status"] == "known", "Native cycle is not known")
            continue
        product = loaded[filename]
        basis = product["estimate_basis"]
        require(basis["cycle_semantics"] == "shared_contributor_cycle", "Unrecognized contributor-cycle semantics")
        sources = {entry["role"]: entry for entry in basis["cycle_sources"]}
        require(len(sources) == len(basis["cycle_sources"]) and set(sources) == set(record["contributors"])
                == {"native_anchor", "gfs_anchor", "gfs_target"}, "Contributor role inventory mismatch")
        for role, contributor_id in record["contributors"].items():
            require(contributor_id in loaded, "Contributor was not independently loaded over HTTP")
            contributor = loaded[contributor_id]
            contributor_record = expected["products"][contributor_id]
            require(record["contributor_sha256"][role] == contributor_record["sha256"], "Contributor hash mismatch")
            require(not contributor["is_estimated"] and contributor["model_run_time_status"] == "known",
                    "Contributor is not a real native product")
            require(contributor["model"] == (product["model"] if role == "native_anchor" else "GFS"),
                    "Contributor model does not match its recipe role")
            entry = sources[role]
            for key in ("model", "provider", "source_dataset", "product_id", "model_run_time_status"):
                require(entry[key] == contributor[key], "Loaded contributor identity differs from cycle_sources: " + key)
            require(entry["reported_model_run_time_status"] == "known"
                    and instant(entry["model_run_time"]) == instant(contributor["model_run_time"]),
                    "Loaded contributor cycle differs from cycle_sources")
            prefix = ("persistence_anchor" if product["model"] == "ICON" else "euro_anchor") if role == "native_anchor" else role
            require(basis[prefix + "_product_id"] == contributor_id, "Recipe contributor ID mismatch")
            require(instant(basis[prefix + "_valid_time"]) == instant(contributor["valid_time"]),
                    "Recipe contributor valid time mismatch")
            require(contributor["layer"] == product["layer"] and contributor["region_id"] == product["region_id"],
                    "Contributor layer or region mismatch")
            counts["contributor_links"] += 1
        require(instant(loaded[record["contributors"]["gfs_target"]]["valid_time"]) == instant(product["valid_time"]),
                "Target contributor serves a different forecast hour")
        require(instant(loaded[record["contributors"]["gfs_anchor"]]["valid_time"])
                == instant(loaded[record["contributors"]["native_anchor"]]["valid_time"]),
                "Donor anchor does not match the persistence-anchor hour")
        counts["estimates"] += 1

    for case, definition in expected["cases"].items():
        require(len(definition["products"]) == 3, "Case does not contain all three selected extended hours")
        result = get_json("/evidence/cycles?" + urlencode({"case": case}))
        require(result == {"case": case, "as_of": expected["as_of"], "report": definition["report"],
                           "verdict": definition["expected_verdict"], "reasons": definition["reasons"],
                           "guard": "0", "clock": "explicit capture clock"}, "HTTP cycle report differs from capture")
        for filename in definition["products"]:
            record = expected["products"][filename]
            require(loaded[filename]["model"] == definition["model"], "Case contains a different model")
            contributors = record["contributors"]
            coherent = (instant(loaded[contributors["gfs_anchor"]]["model_run_time"])
                        == instant(loaded[contributors["gfs_target"]]["model_run_time"]))
            require(coherent == case.endswith("/coherent"), "Real donor cycles do not match the case control")
            target = record["valid_time"]
            result = get_json("/replay/grid?" + urlencode({"case": case, "valid_time": target}))
            require(instant(result["requested_valid_time"]) == instant(target)
                    == instant(result["served_valid_time"]) and result["frame_offset_hours"] == 0
                    and result["frame_substituted"] is False and result["guard"] == "0",
                    "Requested/served hour honesty assertion failed")
            require(result["product_id"] == filename and result["sha256"] == record["sha256"]
                    and result["contributor_sha256"] == record["contributor_sha256"]
                    and result["grid"] == loaded[filename], "HTTP replay grid or contributor hashes mismatch")
            absent = (instant(target) + timedelta(hours=1)).isoformat()
            request("/replay/grid?" + urlencode({"case": case, "valid_time": absent}), status=404)
            counts["held_hour_refusals"] += 1
            counts["frames"] += 1
        counts["cases"] += 1

    health = get_json("/api/health/data", status=503)
    require(health.get("status") == "critical" and "error" not in health, "Full data-health returned an integrity/handler error")
    require("no global products in manifest at all" in health.get("alerts", []) and health.get("lanes") == {},
            "Full data-health did not identify absent global coverage")
    counts["health"] += 1
    first_case = next(iter(expected["cases"]))
    negatives = [
        ("GET", "/products/unknown.json", 404),
        ("GET", "/products/%2e%2e%2freceipt.json", 404),
        ("GET", "/replay/grid?" + urlencode({"case": first_case, "valid_time": "2026-10-18T00:00:00"}), 422),
        ("GET", "/replay/grid?" + urlencode({"case": "unknown", "valid_time": "2026-10-18T00:00:00Z"}), 404),
        ("GET", "/evidence/cycles?case=unknown", 404),
        ("POST", "/identity", 405), ("POST", "/products/unknown.json", 405),
        ("GET", "/docs", 404), ("GET", "/openapi.json", 404), ("GET", "/redoc", 404),
    ]
    for method, path, status in negatives:
        request(path, method=method, status=status)
        counts["negative_routes"] += 1
    with ThreadPoolExecutor(max_workers=4) as executor:
        snapshots = list(executor.map(lambda _: check_identity(get_json("/identity")), range(4)))
    require(all(value == initial_identity for value in snapshots), "Runtime identity changed under concurrent HTTP reads")
    require(check_identity(get_json("/identity")) == initial_identity, "Final runtime identity changed")
    counts["concurrent_reads"] = 4
    return {"base_commit": BASE, "bundle_sha256": pin["sha256"], "guard": "0", "mode": MODE,
            "adapter_commit": initial_identity["adapter_commit"], "bbox": expected["bbox"],
            "resolution": expected["resolution"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--expected-adapter-commit", required=True)
    args = parser.parse_args()
    counts = {name: 0 for name in ("identity", "products", "estimates", "contributor_links", "cases", "frames",
                                  "held_hour_refusals", "health", "negative_routes", "concurrent_reads")}
    receipt = {"started_at": datetime.now(timezone.utc).isoformat(), "counts": counts, "failures": [],
               "limits": "Regional sealed replay only; no full-application, L2 persistence, forecast-accuracy or availability acceptance."}
    try:
        origin = validate_url(args.url)
        receipt["origin"] = origin
        receipt["identity"] = verify(origin, counts, args.expected_adapter_commit)
    except Exception as exc:
        receipt["failures"].append({"type": type(exc).__name__, "message": str(exc)[:400]})
    receipt["status"] = "pass" if not receipt["failures"] else "fail"
    receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))
    return 0 if receipt["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
