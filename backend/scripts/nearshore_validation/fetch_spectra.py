"""Fetch raw directional buoy spectra into cache/<station>.npz (energy + Fourier moments, compass FROM convention).

Run with the SPECTRA venv (needs netCDF4 for CDIP OPeNDAP):
  ..\\..\\..\\.venv-spectra\\Scripts\\python.exe fetch_spectra.py
Public sources only (NDBC realtime2 + historical; CDIP THREDDS archive + realtime). Downloads are cached; re-runs reuse them.

Moments are stored as a1, b1, a2, b2 with directions measured clockwise from true north, waves coming FROM.
  NDBC gives alpha1/alpha2 (deg, FROM) and r1/r2: a1 = r1 cos(alpha1), b1 = r1 sin(alpha1), a2 = r2 cos(2 alpha2), ...
  CDIP stores waveA1Value..waveB2Value in the same nautical FROM convention (checked at run time: the mean direction
  rebuilt from a1/b1 must match CDIP's own waveMeanDirection; the script refuses the file if it does not).
"""
import gzip
import io
import sys
import urllib.request
from datetime import datetime, timezone

import numpy as np

from config import CACHE, NDBC_YEARS, STATIONS

NDBC_RT = 'https://www.ndbc.noaa.gov/data/realtime2/{id}.{ext}'
NDBC_HIST = 'https://www.ndbc.noaa.gov/data/historical/{kind}/{id}{code}{year}.txt.gz'
HIST_KINDS = {'spec': ('swden', 'w'), 'alpha1': ('swdir', 'd'), 'alpha2': ('swdir2', 'i'), 'r1': ('swr1', 'j'),
              'r2': ('swr2', 'k')}
RT_EXT = {'spec': 'data_spec', 'alpha1': 'swdir', 'alpha2': 'swdir2', 'r1': 'swr1', 'r2': 'swr2'}
CDIP_ARCHIVE = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{id}p1/{id}p1_historic.nc'
CDIP_RT = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{id}p1_rt.nc'


def _get(url: str, cache_name: str) -> bytes:
    path = CACHE / cache_name
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    path.write_bytes(data)
    return data


def _parse_ndbc_table(text: str):
    """Two NDBC layouts. REALTIME: 'YY MM DD hh mm [sep] v1 (f1) v2 (f2) ...'. HISTORY: a header row
    '#YY MM DD hh mm .0200 .0325 ...' holding the frequencies, then rows of values only.
    Returns times (list of datetime), freqs (np), values (n_time, n_freq)."""
    lines = text.splitlines()
    hdr = next((l for l in lines[:3] if l.lstrip('#').lower().startswith('yy')), None)
    if hdr and '(' not in text[:4000]:
        return _parse_ndbc_history(lines, hdr)
    times, rows, freqs = [], [], None
    for line in lines:
        if not line.strip() or line.startswith('#') or line.lower().startswith('yy'):
            continue
        parts = line.replace('(', ' ').replace(')', ' ').split()
        try:
            y, mo, d, h, mi = (int(float(p)) for p in parts[:5])
        except ValueError:
            continue
        rest = parts[5:]
        if len(rest) % 2 == 1:                      # realtime data_spec carries a separation-frequency column first
            rest = rest[1:]
        vals, fs = rest[0::2], rest[1::2]
        try:
            f = np.array([float(x) for x in fs])
            v = np.array([np.nan if x == 'MM' or float(x) >= 999 else float(x) for x in vals])
        except ValueError:
            continue
        if freqs is None:
            freqs = f
        if len(f) != len(freqs) or not np.allclose(f, freqs):
            continue
        y = y + 2000 if y < 100 else y
        times.append(datetime(y, mo, d, h, mi, tzinfo=timezone.utc))
        rows.append(v)
    return times, freqs, np.array(rows)


def _parse_ndbc_history(lines, hdr):
    cols = hdr.lstrip('#').split()
    n_time = 5 if cols[4].lower() == 'mm' else 4
    freqs = np.array([float(c) for c in cols[n_time:]])
    times, rows = [], []
    for line in lines:
        if not line.strip() or line.startswith('#') or line.lower().startswith('yy'):
            continue
        p = line.split()
        if len(p) != n_time + len(freqs):
            continue
        try:
            y, mo, d, h = (int(float(x)) for x in p[:4])
            mi = int(float(p[4])) if n_time == 5 else 0
            v = np.array([np.nan if x == 'MM' or float(x) >= 999 else float(x) for x in p[n_time:]])
        except ValueError:
            continue
        y = y + 2000 if y < 100 else y
        times.append(datetime(y, mo, d, h, mi, tzinfo=timezone.utc))
        rows.append(v)
    return times, freqs, np.array(rows)


def _ndbc_component(sid: str, comp: str, year=None):
    if year is None:
        url = NDBC_RT.format(id=sid, ext=RT_EXT[comp])
        text = _get(url, f'rt_{sid}.{RT_EXT[comp]}').decode('ascii', 'replace')
    else:
        kind, code = HIST_KINDS[comp]
        raw = _get(NDBC_HIST.format(kind=kind, id=sid, code=code, year=year), f'h{year}_{sid}_{kind}.txt.gz')
        text = gzip.decompress(raw).decode('ascii', 'replace')
    return _parse_ndbc_table(text)


def fetch_ndbc(sid: str) -> dict:
    blocks = []
    for year in list(NDBC_YEARS) + [None]:
        comps = {c: _ndbc_component(sid, c, year) for c in RT_EXT}
        t_spec, f, e = comps['spec']
        index = {t: i for i, t in enumerate(t_spec)}
        keep_t, out = [], {k: [] for k in RT_EXT}
        maps = {c: {t: i for i, t in enumerate(comps[c][0])} for c in RT_EXT}
        for t in t_spec:
            if all(t in maps[c] for c in RT_EXT):
                keep_t.append(t)
                for c in RT_EXT:
                    out[c].append(comps[c][2][maps[c][t]])
        if not keep_t:
            continue
        a1r, a2r = np.radians(np.array(out['alpha1'])), np.radians(np.array(out['alpha2']))
        r1, r2 = np.array(out['r1']), np.array(out['r2'])
        # NDBC HISTORY files store r1/r2 x100 (0-100); realtime stores 0-1. Found 2026-10-23: unscaled, the MEM
        # rebuild of the history years pointed the spectrum 192 deg while its own moments said 73 deg.
        for name, r in (('r1', r1), ('r2', r2)):
            if np.nanmedian(r) > 1.5:
                r /= 100.0
            if np.nanmax(r) > 1.01:
                sys.exit(f'REFUSED: NDBC {sid} {year or "realtime"} {name} out of range after scaling (max {np.nanmax(r)})')
        blocks.append(dict(time=np.array([t.timestamp() for t in keep_t]), freq=f, energy=np.array(out['spec']),
                           a1=r1 * np.cos(a1r), b1=r1 * np.sin(a1r), a2=r2 * np.cos(2 * a2r), b2=r2 * np.sin(2 * a2r)))
        print(f'  ndbc {sid} {year or "realtime"}: {len(keep_t)} records, {len(f)} freqs')
        _ = index
    return _merge(blocks)


def _dap_certs():
    """netCDF-C's libcurl has no CA store on Windows. Build a PEM bundle from certifi PLUS the Windows ROOT/CA stores
    (this machine's TLS chain needs a root that only Windows holds) and point libcurl at it. Verification stays ON."""
    import os
    import ssl
    import certifi
    pem = [open(certifi.where(), encoding='ascii').read()]
    if hasattr(ssl, 'enum_certificates'):
        for store in ('ROOT', 'CA'):
            for der, enc, _trust in ssl.enum_certificates(store):
                if enc == 'x509_asn':
                    pem.append(ssl.DER_cert_to_PEM_cert(der))
    bundle = CACHE / 'ca_bundle.pem'
    bundle.write_text('\n'.join(pem), encoding='ascii')
    (CACHE / '.dodsrc').write_text(f'HTTP.SSL.CAINFO={bundle}\nHTTP.SSL.VERIFYPEER=1\n', encoding='ascii')
    os.chdir(CACHE)      # netCDF-C reads .dodsrc from the working directory


CDIP_DAP_ASCII = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{id}p1/{id}p1_historic.nc.ascii?{q}'
CDIP_RT_FILE = 'https://thredds.cdip.ucsd.edu/thredds/fileServer/cdip/realtime/{id}p1_rt.nc'
CDIP_VARS = ('waveEnergyDensity', 'waveA1Value', 'waveB1Value', 'waveA2Value', 'waveB2Value')
CDIP_KEYS = ('energy', 'a1', 'b1', 'a2', 'b2')
START = datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp()


def _dap_ascii(sid: str, query: str, cache_name: str) -> dict:
    """OPeNDAP ASCII subset through Python's HTTPS stack (netCDF-C's libcurl rejects this machine's TLS chain).
    Returns {var: np.array}; 2-D variables come back as (rows, cols)."""
    text = _get(CDIP_DAP_ASCII.format(id=sid, q=query), cache_name).decode('ascii', 'replace')
    # Layout: a header line "name[n]" (1-D) or "name.name[n][m]" (2-D), then either ONE line of comma-separated
    # values (1-D) or rows "[i], v, v, ..." (2-D).
    body = text.split('-' * 20, 1)[-1]
    out, cur, rows, flat = {}, None, [], []

    def close():
        if cur is not None:
            if rows:
                out[cur] = np.array(rows)
            elif flat:
                out[cur] = np.array(flat)

    for line in body.splitlines():
        line = line.strip().rstrip(',')
        if not line or set(line) == {'-'}:             # blank, or the rest of the header separator
            continue
        if line.startswith('['):                       # 2-D row
            rows.append([float(x) for x in line.split(',', 1)[1].split(',')])
        elif line[0].isdigit() or line[0] in '-.':     # 1-D values
            flat.extend(float(x) for x in line.split(','))
        else:                                          # a new variable header
            close()
            cur, rows, flat = line.split('[')[0].split('.')[-1], [], []
    close()
    return out


def _cdip_archive(sid: str):
    t = _dap_ascii(sid, 'waveTime', f'cdip{sid}_time.ascii')['waveTime']
    sel = np.where(t >= START)[0]
    if sel.size == 0:
        return None
    s0, s1 = int(sel[0]), int(sel[-1])
    freq = _dap_ascii(sid, 'waveFrequency', f'cdip{sid}_freq.ascii')['waveFrequency']
    nf = len(freq) - 1
    blk = dict(time=t[s0:s1 + 1], freq=freq)
    step = 4000                                        # rows per request keeps each response a few tens of MB
    for var, key in zip(CDIP_VARS, CDIP_KEYS):
        parts = []
        for a in range(s0, s1 + 1, step):
            b = min(a + step - 1, s1)
            got = _dap_ascii(sid, f'{var}[{a}:1:{b}][0:1:{nf}]', f'cdip{sid}_{var}_{a}_{b}.ascii')
            parts.append(got[var])
        blk[key] = np.vstack(parts)
    dp = []
    for a in range(s0, s1 + 1, 20000):
        b = min(a + 19999, s1)
        dp.append(_dap_ascii(sid, f'waveDp[{a}:1:{b}]', f'cdip{sid}_dp_{a}_{b}.ascii')['waveDp'])
    blk['dp_reported'] = np.concatenate(dp)
    return blk


def _cdip_realtime(sid: str):
    import netCDF4  # spectra venv only; the file is local, so no libcurl
    path = CACHE / f'cdip{sid}_rt.nc'
    if not path.exists():
        _get(CDIP_RT_FILE.format(id=sid), path.name)
    nc = netCDF4.Dataset(str(path))
    v = nc.variables
    t = np.asarray(v['waveTime'][:], dtype='float64')
    blk = dict(time=t, freq=np.asarray(v['waveFrequency'][:], dtype='float64'),
               dp_reported=np.asarray(v['waveDp'][:], dtype='float64'))
    for var, key in zip(CDIP_VARS, CDIP_KEYS):
        blk[key] = np.asarray(v[var][:], dtype='float64')
    nc.close()
    return blk


def fetch_cdip(sid: str) -> dict:
    blocks = []
    for tag, fn in (('archive', _cdip_archive), ('realtime', _cdip_realtime)):
        try:
            blk = fn(sid)
        except Exception as exc:  # report and keep going: one source down must not hide the other
            print(f'  cdip {sid} {tag}: unavailable ({str(exc)[:160]})')
            continue
        if blk is None:
            continue
        for k in CDIP_KEYS:                            # CDIP fill values -> NaN
            blk[k] = np.where(np.abs(blk[k]) > 1e6, np.nan, blk[k])
        _check_cdip_convention(sid, tag, blk)
        blocks.append(blk)
        print(f'  cdip {sid} {tag}: {len(blk["time"])} records, {len(blk["freq"])} freqs')
    return _merge(blocks)


def _check_cdip_convention(sid, tag, blk):
    """The direction from a1/b1 (FROM, clockwise from N) AT THE PEAK FREQUENCY must match CDIP's own waveDp."""
    e = np.nan_to_num(blk['energy'], nan=-1)
    ip = np.argmax(e, axis=1)
    rr = np.arange(len(ip))
    dp = np.degrees(np.arctan2(blk['b1'][rr, ip], blk['a1'][rr, ip])) % 360
    rep = blk['dp_reported']
    ok = np.isfinite(rep) & (rep >= 0) & (rep <= 360) & np.isfinite(dp)
    diff = np.abs((dp[ok] - rep[ok] + 180) % 360 - 180)
    med = float(np.median(diff)) if diff.size else float('nan')
    print(f'  cdip {sid} {tag}: direction convention check, median |rebuilt - reported Dp| = {med:.1f} deg (n {diff.size})')
    if not med < 10:
        sys.exit(f'REFUSED: CDIP {sid} moment convention does not reproduce waveDp (median {med:.1f} deg)')


def _merge(blocks):
    if not blocks:
        return {}
    freq = blocks[0]['freq']
    keys = ('energy', 'a1', 'b1', 'a2', 'b2')
    out = {'freq': freq, 'time': [], **{k: [] for k in keys}}
    for b in blocks:
        if len(b['freq']) != len(freq) or not np.allclose(b['freq'], freq):
            # NDBC realtime and history grids differ by a bin: interpolate onto the first block's grid
            # (energy density and moments are smooth in frequency; values outside the source range become NaN).
            print(f'  regridding a block from {len(b["freq"])} to {len(freq)} freqs')
            b = dict(b, **{k: np.array([np.interp(freq, b['freq'], row, left=np.nan, right=np.nan) for row in b[k]])
                           for k in keys})
        out['time'].append(b['time'])
        for k in keys:
            out[k].append(b[k])
    t = np.concatenate(out['time'])
    order = np.argsort(t)
    t = t[order]
    uniq = np.concatenate([[True], np.diff(t) > 0])
    res = {'freq': freq, 'time': t[uniq]}
    for k in keys:
        res[k] = np.concatenate(out[k])[order][uniq]
    return res


def main():
    CACHE.mkdir(exist_ok=True)
    for sid, st in STATIONS.items():
        print(f'{sid} ({st["name"]})')
        data = fetch_ndbc(sid) if st['source'] == 'ndbc' else fetch_cdip(sid)
        if not data:
            print('  NO DATA')
            continue
        np.savez_compressed(CACHE / f'{sid}.npz', **data)
        span = [datetime.fromtimestamp(x, timezone.utc).strftime('%Y-%m-%d') for x in (data['time'][0], data['time'][-1])]
        print(f'  saved {len(data["time"])} records {span[0]} .. {span[1]}')


if __name__ == '__main__':
    main()
