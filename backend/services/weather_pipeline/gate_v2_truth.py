"""gate_v2_truth.py - what the buoy truth IS, for validation gates v2: hull type per station and hour, and period truth
from NDBC spectra. PURE parsers and arithmetic, stdlib only; the fetch lives in scripts/scored_rows_gate.py.

HULLS (science audit 2026-11-01 section 8.1). NDBC's station metadata (https://www.ndbc.noaa.gov/metadata/
stationmetadata.xml) records a `hull` code per deployment (<history start stop hull>). Hulls change with every
service visit (46026: 3D60 -> 3D09 -> 3D24 -> 3D09 -> 3DV40), so the class is looked up AT THE ROW'S HOUR. Codes seen
2026-11-01: 3D/3DV (3 m discus), 2.1D (the new 2.1 m hull, more accurate on Hs and APD: JTECH 2022), 2.3D/2.4D/2.6D/
1.8D (other small discus), 10D/12D (large discus), 6N (6 m NOMAD: reads Hm0 low as height grows, up to ~1 m above
6-7 m, Ocean Dynamics 2021), TAO/ATLAS (equatorial moorings), a bare serial with owner SCRIPPS (a CDIP Waverider).
An empty code in the covering deployment falls back to the nearest EARLIER deployment's code (flagged `inferred`);
no code at all is "unknown", never guessed.

SPECTRA. NDBC `data_spec` rows: `YY MM DD hh mm Sep_Freq S1 (f1) S2 (f2) ...`, density in m^2/Hz at band centres.
  * DPD as NDBC defines it is 1/f of the band with the highest density, no fit: quantised, one band step is ~1-1.5 s
    at swell periods (0.060 vs 0.065 Hz = 16.7 vs 15.4 s).
  * The FIT Tp: the vertex of the parabola through the peak band and its two neighbours (non-uniform spacing), the
    same family model PERPW / pp1d / PTP use, so continuous truth meets continuous forecasts.
  * Tm02 = sqrt(m0/m2) (what NDBC APD is computed from), Tm-1,0 = m-1/m0 (the energy period), Hm0 = 4 sqrt(m0).
  * MULTI-PEAKED: on the 1-2-1 smoothed spectrum, two local maxima each >= `multi_peak_rel` x the global max with a
    trough between them below `multi_peak_trough` x the smaller. There the fit and DPD can jump between swells
    (Ocean Dynamics 2021: fit Tp "temporally unstable" in multi-swell seas), so those hours are reported apart.
"""
import math
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

HULL_CLASSES = ("discus_3m", "discus_2.1m", "discus_small", "discus_large", "nomad_6m", "waverider", "mooring",
                "unknown")

_HISTORY = re.compile(r"<history\b([^>]*)/?>")
_STATION = re.compile(r"<station\b([^>]*)>(.*?)</station>", re.S)
_ATTR = re.compile(r'(\w+)="([^"]*)"')


class UnsafeXML(ValueError):
    pass


def _date(s) -> Optional[datetime]:
    try:
        return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc) if s else None
    except ValueError:
        return None


def parse_station_metadata(text: str) -> Dict[str, dict]:
    """{station_id: {"owner", "history": [(start, stop or None, hull_code)] newest first}}. Regex, not an XML parser:
    the file is flat, and a DOCTYPE or ENTITY (the only way flat XML can attack a parser) is refused outright."""
    head = text[:4096].upper()
    if "<!DOCTYPE" in head or "<!ENTITY" in text.upper():
        raise UnsafeXML("station metadata carries a DOCTYPE/ENTITY; refused")
    out: Dict[str, dict] = {}
    for attrs, body in _STATION.findall(text):
        a = dict(_ATTR.findall(attrs))
        sid = (a.get("id") or "").strip().upper()
        if not sid:
            continue
        hist = []
        for h in _HISTORY.findall(body):
            ha = dict(_ATTR.findall(h))
            start = _date(ha.get("start"))
            if start is not None:
                hist.append((start, _date(ha.get("stop")), (ha.get("hull") or "").strip().upper()))
        hist.sort(key=lambda x: x[0], reverse=True)
        out[sid] = {"owner": a.get("owner") or "", "history": hist}
    return out


def hull_class(code: str, owner: str = "") -> str:
    """The class of one NDBC hull code (see the module docstring)."""
    c = (code or "").strip().upper()
    if c.startswith("6N"):
        return "nomad_6m"
    if c.startswith(("TAO", "ATLAS")):
        return "mooring"
    m = re.match(r"^(\d+(?:\.\d+)?)D", c)
    if m:
        size = float(m.group(1))
        if size >= 18:                      # 24DV / 18DV: tenths of a metre (2.4, 1.8) written without the point
            size = size / 10.0
        if abs(size - 3.0) < 1e-9:
            return "discus_3m"
        if abs(size - 2.1) < 1e-9:
            return "discus_2.1m"
        return "discus_large" if size >= 10 else "discus_small"
    if "SCRIPPS" in (owner or "").upper() or (c.isdigit() and c):
        return "waverider"
    return "unknown"


def hull_at(meta: Dict[str, dict], station, when: Optional[datetime]) -> Tuple[str, bool]:
    """(class, inferred) for `station` at `when`. `inferred` = the covering deployment had no code and an earlier one's
    was used. A station absent from the metadata, or with no code at or before `when`, is ("unknown", False)."""
    st = meta.get(str(station or "").strip().upper())
    if not st or when is None:
        return "unknown", False
    hist = st["history"]
    for i, (start, stop, code) in enumerate(hist):
        if start <= when and (stop is None or when < stop):
            if code:
                return hull_class(code, st["owner"]), False
            for _, _, older in hist[i + 1:]:
                if older:
                    return hull_class(older, st["owner"]), True
            return ("waverider", False) if "SCRIPPS" in st["owner"].upper() else ("unknown", False)
    return "unknown", False


# ---- spectra -----------------------------------------------------------------------------------------------------
_PAIR = re.compile(r"([-+]?\d*\.?\d+)\s*\(\s*([-+]?\d*\.?\d+)\s*\)")


def parse_data_spec(text: str) -> List[Tuple[datetime, List[Tuple[float, float]]]]:
    """[(time UTC, [(f_hz, density)])] for every complete data_spec record; records with missing values are dropped."""
    out = []
    for line in (text or "").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        tok = line.split()
        if len(tok) < 7 or "MM" in tok[:6]:
            continue
        try:
            t = datetime(int(tok[0]), int(tok[1]), int(tok[2]), int(tok[3]), int(tok[4]), tzinfo=timezone.utc)
        except ValueError:
            continue
        pairs = [(float(f), float(s)) for s, f in _PAIR.findall(" ".join(tok[6:]))]
        pairs = [(f, s) for f, s in pairs if f > 0 and s >= 0 and math.isfinite(s)]
        if len(pairs) >= 5:
            out.append((t, sorted(pairs)))
    return out


def _widths(freqs: List[float]) -> List[float]:
    edges = [freqs[0] - (freqs[1] - freqs[0]) / 2]
    edges += [(a + b) / 2 for a, b in zip(freqs, freqs[1:])]
    edges.append(freqs[-1] + (freqs[-1] - freqs[-2]) / 2)
    return [b - a for a, b in zip(edges, edges[1:])]


def _vertex(x0, y0, x1, y1, x2, y2) -> Optional[float]:
    den = (x0 - x1) * (x0 - x2) * (x1 - x2)
    if den == 0:
        return None
    a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den
    b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den
    if a >= 0:                              # not a maximum (flat or convex): no fit
        return None
    return min(max(-b / (2 * a), x0), x2)


def _smooth(s: List[float]) -> List[float]:
    if len(s) < 3:
        return list(s)
    return [s[0]] + [(s[i - 1] + 2 * s[i] + s[i + 1]) / 4 for i in range(1, len(s) - 1)] + [s[-1]]


def peaks(spec: List[Tuple[float, float]], rel: float = 0.30, trough: float = 0.75) -> int:
    """How many SEPARATED peaks the smoothed spectrum holds (>= 1 when there is energy)."""
    s = _smooth([v for _, v in spec])
    top = max(s) if s else 0
    if top <= 0:
        return 0
    idx = [i for i in range(1, len(s) - 1) if s[i] > s[i - 1] and s[i] >= s[i + 1] and s[i] >= rel * top]
    if not idx:
        return 1
    idx.sort(key=lambda i: -s[i])
    kept = [idx[0]]
    for i in idx[1:]:
        if all(min(s[min(i, j):max(i, j) + 1]) < trough * min(s[i], s[j]) for j in kept):
            kept.append(i)
    return len(kept)


def spectral_params(spec: List[Tuple[float, float]], rel: float = 0.30, trough: float = 0.75) -> Optional[dict]:
    """{hm0_m, dpd_s, fit_tp_s, tm02_s, tm_10_s, n_peaks, multi_peaked} or None for an empty spectrum."""
    if len(spec) < 5:
        return None
    f = [x for x, _ in spec]
    s = [y for _, y in spec]
    w = _widths(f)
    m0 = sum(si * wi for si, wi in zip(s, w))
    if m0 <= 0:
        return None
    m2 = sum(si * fi * fi * wi for si, fi, wi in zip(s, f, w))
    mm1 = sum(si / fi * wi for si, fi, wi in zip(s, f, w))
    k = max(range(len(s)), key=lambda i: (s[i], -i))       # the first band holding the maximum
    fp = f[k]
    fit = _vertex(f[k - 1], s[k - 1], f[k], s[k], f[k + 1], s[k + 1]) if 0 < k < len(s) - 1 else None
    n_pk = peaks(spec, rel, trough)
    return {"hm0_m": 4 * math.sqrt(m0), "dpd_s": 1.0 / fp, "fit_tp_s": 1.0 / (fit or fp), "fit_ok": fit is not None,
            "tm02_s": math.sqrt(m0 / m2) if m2 > 0 else None, "tm_10_s": mm1 / m0,
            "n_peaks": n_pk, "multi_peaked": n_pk >= 2}


def nearest_spectrum(records: List[Tuple[datetime, dict]], when: datetime, tol_min: float) -> Optional[dict]:
    """The spectral params whose stamp is closest to `when`, within tol_min minutes; records sorted by time."""
    best, best_dt = None, None
    for t, p in records:
        dt = abs((t - when).total_seconds()) / 60.0
        if dt <= tol_min and (best_dt is None or dt < best_dt):
            best, best_dt = p, dt
    return best
