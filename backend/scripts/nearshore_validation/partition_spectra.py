"""Rebuild every buoy record's directional spectrum the SAME way (maximum entropy method from a1/b1/a2/b2) and split it
into wind sea + swell with wavespectra's STEEPNESS watershed method (no wind needed; the nearshore buoys have none).

Run with the SPECTRA venv:  ..\\..\\..\\.venv-spectra\\Scripts\\python.exe partition_spectra.py
Reads cache/<station>.npz (fetch_spectra.py), writes out/<station>_parts.npz:
  time, hs, tp, dm (total) and per partition p in (windsea, swell): h_p, tp_p, dir_p (nan when empty).

Same method for every station: identical reconstruction, identical partition settings. That is the point: earlier
ratios mixed NDBC's and CDIP's own swell/sea splits.
"""
import numpy as np
import xarray as xr
from wavespectra.core.attributes import set_spec_attributes

from config import CACHE, NDIR, OUT, STATIONS

CHUNK = 1500


def mem_spectrum(energy, a1, b1, a2, b2, ndir=NDIR):
    """Lygre & Krogstad (1986) maximum entropy directional distribution, per (time, freq).
    Angles are compass FROM (moments defined with the same angle), returns efth (time, freq, dir) in m2/Hz/deg."""
    theta = np.radians(np.arange(ndir) * (360.0 / ndir))
    c1 = np.nan_to_num(a1) + 1j * np.nan_to_num(b1)
    c2 = np.nan_to_num(a2) + 1j * np.nan_to_num(b2)
    c1 = np.where(np.abs(c1) >= 0.999, c1 * 0.999 / np.maximum(np.abs(c1), 1e-12), c1)   # keep |c1| < 1
    phi1 = (c1 - c2 * np.conj(c1)) / (1 - np.abs(c1) ** 2)
    phi2 = c2 - c1 * phi1
    num = 1 - phi1 * np.conj(c1) - phi2 * np.conj(c2)
    e1 = np.exp(-1j * theta)[None, None, :]
    den = np.abs(1 - phi1[..., None] * e1 - phi2[..., None] * e1 ** 2) ** 2
    d = np.real(num[..., None] / den)
    d = np.clip(d, 0, None)
    s = d.sum(axis=2, keepdims=True)
    d = np.where(s > 0, d / np.where(s > 0, s, 1), 1.0 / ndir)          # each frequency's spread sums to 1
    dir_step = 360.0 / ndir
    return np.nan_to_num(energy)[..., None] * d / dir_step


def partition_station(sid: str):
    src = np.load(CACHE / f'{sid}.npz')
    t, freq = src['time'], src['freq']
    ok = np.isfinite(src['energy']).sum(1) > 0.8 * len(freq)
    idx = np.where(ok)[0]
    dirs = np.arange(NDIR) * (360.0 / NDIR)
    out = {k: [] for k in ('time', 'hs', 'tp', 'dm', 'h_ws', 'tp_ws', 'dir_ws', 'h_sw', 'tp_sw', 'dir_sw')}
    for c0 in range(0, len(idx), CHUNK):
        sel = idx[c0:c0 + CHUNK]
        efth = mem_spectrum(src['energy'][sel], src['a1'][sel], src['b1'][sel], src['a2'][sel], src['b2'][sel])
        ds = xr.DataArray(efth, dims=('time', 'freq', 'dir'),
                          coords={'time': t[sel], 'freq': freq, 'dir': dirs}, name='efth').to_dataset()
        set_spec_attributes(ds)
        tot = ds.spec.stats(['hs', 'tp', 'dm'])
        parts = ds.spec.partition.steepness(swells=1)      # part 0 = wind sea, part 1 = all swell
        ps = parts.spec.stats(['hs', 'tp', 'dm'])
        out['time'].append(t[sel])
        for k in ('hs', 'tp', 'dm'):
            out[k].append(tot[k].values)
        for p, tag in ((0, 'ws'), (1, 'sw')):
            out[f'h_{tag}'].append(ps['hs'].isel(part=p).values)
            out[f'tp_{tag}'].append(ps['tp'].isel(part=p).values)
            out[f'dir_{tag}'].append(ps['dm'].isel(part=p).values)
        print(f'  {sid}: {min(c0 + CHUNK, len(idx))}/{len(idx)}', end='\r')
    res = {k: np.concatenate(v) for k, v in out.items()}
    for tag in ('ws', 'sw'):                                 # an empty partition has no direction or period
        empty = ~(res[f'h_{tag}'] > 0.02)
        res[f'tp_{tag}'][empty] = np.nan
        res[f'dir_{tag}'][empty] = np.nan
    OUT.mkdir(exist_ok=True)
    np.savez_compressed(OUT / f'{sid}_parts.npz', **res)
    return res, src


def self_check(sid, res, src):
    """Controls on the reconstruction itself: (1) total Hs from the MEM 2-D spectrum == 4*sqrt(m0) of the 1-D input
    (energy conserved); (2) swell + wind sea energy == total (partition conserves variance)."""
    e = np.nan_to_num(src['energy'])
    f = src['freq']
    m0 = np.trapezoid(e, f, axis=1)
    hs1d = 4 * np.sqrt(np.clip(m0, 0, None))
    ok = np.isin(src['time'], res['time'])
    d_hs = np.nanmedian(np.abs(res['hs'] - hs1d[ok]) / np.maximum(hs1d[ok], 1e-6))
    recon = np.sqrt(np.nan_to_num(res['h_ws']) ** 2 + np.nan_to_num(res['h_sw']) ** 2)
    d_part = np.nanmedian(np.abs(recon - res['hs']) / np.maximum(res['hs'], 1e-6))
    # (3) the rebuilt spectrum's mean direction == the energy-weighted direction straight from the moments.
    #     Added 2026-10-23 after NDBC history r1/r2 (stored x100) silently turned 73 deg into 192 deg.
    a = (e * np.nan_to_num(src['a1'])).sum(1)[ok]
    b = (e * np.nan_to_num(src['b1'])).sum(1)[ok]
    dmom = np.degrees(np.arctan2(b, a)) % 360
    d_dir = np.nanmedian(np.abs((res['dm'] - dmom + 180) % 360 - 180))
    print(f'  {sid}: {len(res["time"])} records; CHECK energy |Hs_2D - Hs_1D|/Hs median {d_hs:.4f}; '
          f'CHECK partitions |sqrt(ws^2+sw^2) - Hs|/Hs median {d_part:.4f}; CHECK direction |dm_2D - dm_moments| median {d_dir:.1f} deg')
    if not (d_hs < 0.05 and d_part < 0.01 and d_dir < 15):
        raise SystemExit(f'REFUSED: {sid} reconstruction control failed')
    return d_hs, d_part


def main():
    for sid in STATIONS:
        if not (CACHE / f'{sid}.npz').exists():
            print(f'{sid}: no cache, run fetch_spectra.py first')
            continue
        print(f'{sid}:')
        res, src = partition_station(sid)
        self_check(sid, res, src)


if __name__ == '__main__':
    main()
