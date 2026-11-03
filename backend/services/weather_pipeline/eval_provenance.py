"""eval_provenance.py - where every number in an evaluation came from. The harness's cache, network guard and
provenance manifest. Serves nothing; never writes inside the repository.

THE RECORD. Every raw file the harness reads (a buoy record, a GRIB byte range, a tide series) is cached once and
described by one provenance record, kept in a `<file>.prov.json` sidecar and copied into the manifest of every panel
built from it:
    {source, url, range, retrieved_utc, sha256, bytes, cache_file, parser, time_standard, qc_policy,
     station_meta_version, http_status, remote_version, final_url, redirects, notes}
`sha256` is of the RAW bytes as received (before any parsing), so a later reader can prove the panel was built from
exactly that file. `retrieved_utc` is the first retrieval; a cache hit keeps it and says `cache_hit: true`.

THE CACHE lives OUTSIDE the repo (EVAL_HARNESS_CACHE, or --cache-dir, or a CI artifact path). A path inside the git
worktree is refused: this repository is public and downloaded data never belongs in it.

THE NETWORK GUARD. One GET helper, GET only, an explicit HOST ALLOWLIST of public data services applied to the first
URL AND to every redirect hop before it is contacted (a private opener; at most 3 hops), a byte cap, one
request at a time with a pause between them (`polite_pause_s`). The app's own hosts (*.onrender.com, the site) are
refused by name even if someone adds them to the allowlist: the harness must never load the 1-CPU production box.
"""
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

USER_AGENT = "raw-surf-eval-harness/0 (offline verification; github.com/dpritzker0905-cmd/Raw-Surf-Antigravity)"
ALLOWED_HOSTS = (
    "www.ndbc.noaa.gov",                    # NDBC realtime2 stdmet / data_spec / swdir / swr1, station metadata
    "thredds.cdip.ucsd.edu",                # CDIP realtime + archive (OPeNDAP ascii / das)
    "noaa-gfs-bdp-pds.s3.amazonaws.com",    # NOAA GFS / GFS-Wave on AWS Open Data
    "marine-api.open-meteo.com",            # the tide series the served RATING_TIDE lane reads
    "api.tidesandcurrents.noaa.gov",        # CO-OPS water level (optional truth)
)
DENIED_SUFFIXES = (".onrender.com", "rawsurf.com", "raw-surf.com", ".netlify.app", ".supabase.co")
MAX_BYTES_DEFAULT = 64 * 1024 * 1024


class NetworkRefused(PermissionError):
    pass


class CacheRefused(PermissionError):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def check_url(url: str) -> str:
    """The host of an allowed https URL, else NetworkRefused. PURE."""
    u = urllib.parse.urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme != "https":
        raise NetworkRefused(f"not https: {url}")
    if any(host == s.lstrip(".") or host.endswith(s) for s in DENIED_SUFFIXES):
        raise NetworkRefused(f"the app's own host is never read by the harness: {host}")
    if host not in ALLOWED_HOSTS:
        raise NetworkRefused(f"host not on the public-data allowlist: {host}")
    return host


MAX_REDIRECTS = 3


class GuardedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow a redirect ONLY after the resolved absolute target passes check_url (https, not an app host, on the
    allowlist), and at most MAX_REDIRECTS hops. Python's default handler follows Location/URI with no host check, so
    an allowed data URL that redirects could otherwise reach a denied host, an unknown host or plain http. The check
    runs in redirect_request, i.e. BEFORE the next hop is contacted. Used only through a private opener (never
    installed globally). `chain` records every permitted hop: [{code, url}]."""

    def __init__(self, max_hops: int = MAX_REDIRECTS):
        super().__init__()
        self.max_hops, self.chain = max_hops, []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if len(self.chain) >= self.max_hops:
            raise NetworkRefused(f"more than {self.max_hops} redirects (next {newurl})")
        newurl = urllib.parse.urljoin(req.full_url, newurl)
        check_url(newurl)                          # raises NetworkRefused before the next hop is contacted
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            raise NetworkRefused(f"redirect {code} to {newurl} not followable as a GET")
        if new.get_method() != "GET":
            raise NetworkRefused(f"redirect {code} would change the method to {new.get_method()}")
        rng = req.get_header("Range")
        if rng is not None and new.get_header("Range") != rng:
            raise NetworkRefused(f"redirect {code} to {newurl} dropped the Range header")
        self.chain.append({"code": int(code), "url": newurl})
        return new


def private_opener(extra_handlers=()):
    """(opener, redirect guard): a fresh opener per request, never urllib.request.install_opener."""
    guard = GuardedRedirectHandler()
    return urllib.request.build_opener(guard, *extra_handlers), guard


def http_get(url: str, rng: Optional[Tuple[int, Optional[int]]] = None, timeout_s: float = 120.0,
             max_bytes: int = MAX_BYTES_DEFAULT, extra_handlers=()) -> Tuple[bytes, int, dict, dict]:
    """(body, status, version headers, route) of one GET. A Range answered by a 200 (a server ignoring Range) is
    refused. The headers kept (ETag, Last-Modified, x-amz-version-id) identify WHICH version of a mutable remote
    object was read, beside the sha256 of what arrived. `route` = {final_url, redirects: [{code, url}]}: every hop
    was checked against the allowlist before it was contacted. `extra_handlers` is for offline tests only."""
    check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    if rng is not None:
        req.add_header("Range", f"bytes={rng[0]}-{'' if rng[1] is None else rng[1]}")
    opener, guard = private_opener(extra_handlers)
    with opener.open(req, timeout=timeout_s) as resp:                # noqa: S310 - every hop allowlisted https
        status = resp.status
        body = resp.read(max_bytes + 1)
        hdr = {k: resp.headers.get(k) for k in ("ETag", "Last-Modified", "x-amz-version-id") if resp.headers.get(k)}
        final = resp.geturl()
    check_url(final)                                                 # belt and braces; the hops were checked first
    if len(body) > max_bytes:
        raise ValueError(f"response larger than the {max_bytes} byte cap")
    if rng is not None and status != 206:
        raise ValueError(f"range request answered {status}, not 206")
    return body, status, hdr, {"final_url": final, "redirects": list(guard.chain)}


def _inside(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:      # different drives on Windows
        return False


def repo_root(start: Optional[str] = None) -> Optional[str]:
    """The enclosing git worktree (a directory holding `.git`), or None."""
    p = os.path.abspath(start or os.path.dirname(__file__))
    while True:
        if os.path.exists(os.path.join(p, ".git")):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


class Cache:
    """Raw-file cache with provenance sidecars. `get` is injectable (tests); it must return (bytes, status)."""

    def __init__(self, root: str, get: Callable = http_get, pause_s: float = 0.5, offline: bool = False,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        root = os.path.abspath(root)
        rr = repo_root()
        if rr and _inside(root, rr):
            raise CacheRefused(f"cache {root} is inside the repository {rr}; downloaded data stays out of the repo")
        self.root, self.get, self.pause_s, self.offline = root, get, pause_s, offline
        self.clock, self.sleep, self._last = clock, sleep, None
        self.records: List[dict] = []
        os.makedirs(root, exist_ok=True)

    def _paths(self, key: str) -> Tuple[str, str]:
        safe = "".join(c if c.isalnum() or c in "._-/" else "_" for c in key).strip("/")
        path = os.path.join(self.root, *safe.split("/"))
        return path, path + ".prov.json"

    def fetch(self, key: str, url: str, rng=None, *, source: str, parser: str, time_standard: str = "UTC",
              qc_policy: str = "", station_meta_version: Optional[str] = None, notes: str = "",
              max_bytes: int = MAX_BYTES_DEFAULT) -> Tuple[bytes, dict]:
        """(raw bytes, provenance record). A cached file is re-hashed and must match its sidecar, else refetched."""
        path, side = self._paths(key)
        if os.path.exists(path) and os.path.exists(side):
            with open(path, "rb") as f:
                body = f.read()
            with open(side, encoding="utf-8") as f:
                rec = json.load(f)
            if rec.get("sha256") == sha256_bytes(body):
                rec = dict(rec, cache_hit=True)
                if station_meta_version and not rec.get("station_meta_version"):
                    rec["station_meta_version"] = station_meta_version
                self.records.append(rec)
                return body, rec
        if self.offline:
            raise FileNotFoundError(f"offline and not cached: {key}")
        if self._last is not None:
            wait = self.pause_s - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
        try:
            got = self.get(url, rng=rng, max_bytes=max_bytes)
        finally:
            self._last = self.clock()
        got = tuple(got) + ({}, {})[:max(0, 4 - len(got))]
        body, status, hdr, route = got[:4]
        rec = {"source": source, "url": url, "range": list(rng) if rng else None, "retrieved_utc": utc_now_iso(),
               "sha256": sha256_bytes(body), "bytes": len(body), "cache_file": os.path.relpath(path, self.root),
               "parser": parser, "time_standard": time_standard, "qc_policy": qc_policy,
               "station_meta_version": station_meta_version, "http_status": status, "notes": notes,
               "remote_version": hdr or None, "final_url": (route or {}).get("final_url") or url,
               "redirects": (route or {}).get("redirects") or [], "cache_hit": False}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        with open(side, "w", encoding="utf-8", newline="\n") as f:
            json.dump(rec, f, indent=1, sort_keys=True)
        self.records.append(rec)
        return body, rec


def manifest(records: List[dict], panel: str, extra: Optional[Dict] = None) -> dict:
    """The provenance manifest written beside a panel: every distinct raw file (by sha256) it was built from."""
    seen, files = set(), []
    for r in records:
        k = (r.get("sha256"), r.get("url"), json.dumps(r.get("range")))
        if k in seen:
            continue
        seen.add(k)
        files.append({x: r.get(x) for x in ("source", "url", "range", "retrieved_utc", "sha256", "bytes",
                                             "cache_file", "parser", "time_standard", "qc_policy",
                                             "station_meta_version", "remote_version", "final_url", "redirects",
                                             "notes")})
    files.sort(key=lambda r: (r["source"] or "", r["url"] or "", json.dumps(r["range"])))
    digest = sha256_bytes("\n".join(f["sha256"] for f in files).encode())
    out = {"panel": panel, "written_utc": utc_now_iso(), "n_files": len(files), "files_digest": digest,
           "files": files}
    out.update(extra or {})
    return out


def write_json(path: str, obj) -> str:
    rr = repo_root()
    if rr and _inside(path, rr):
        raise CacheRefused(f"{path} is inside the repository; panels and manifests are written outside it")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
    return path
