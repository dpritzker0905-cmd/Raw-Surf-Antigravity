import sys, warnings, json
sys.path.insert(0, sys.argv[1])
import numpy as np
from gribberish import parse_grib_message
warnings.simplefilter("ignore")
d = sys.argv[2]
def load(v, f):
    raw = open(f"{d}/{v}_{f}.grib2", "rb").read()
    m = parse_grib_message(raw, 0)
    a = np.asarray(m.data(), dtype=float)
    shape = getattr(m, "grid_shape", None)
    if a.ndim == 1:
        a = a.reshape(-1, 1440)
    a[(a > 1e10) | (a < -1e10)] = np.nan
    return a
def rms(a, k, zero_where=None):
    a = a.copy()
    if zero_where is not None:
        a[np.isnan(a) & zero_where] = 0.0
    r, c = (a.shape[0]//k)*k, (a.shape[1]//k)*k
    b = a[:r, :c].reshape(r//k, k, c//k, k)
    return np.sqrt(np.nanmean(b*b, axis=(1,3)))
def rules(H, parts):
    P = np.stack(parts); pv = np.isfinite(P); cells = np.isfinite(H) & (H > 0.25) & pv.any(axis=0)
    Pz = np.where(pv, P, 0.0); n = cells.sum()
    return round(float((cells & (Pz.max(0) > H + 0.05)).sum()/n), 4), round(float((cells & ((Pz**2).sum(0) > 1.1*H**2)).sum()/n), 4)
for f in ("024", "072", "168"):
    H, s, w = load("swh", f), load("shts", f), load("shww", f)
    hv = np.isfinite(H)
    out = {"lead": f, "shape": H.shape, "res_deg": None}
    for name, p in (("swell(shts)", s), ("wind_waves(shww)", w)):
        out[name] = {"H valid & p NaN": round(float((hv & np.isnan(p)).sum()/hv.sum()), 4),
                     "H valid & p==0": round(float((hv & (p == 0)).sum()/hv.sum()), 4),
                     "p valid & H NaN": int((~hv & np.isfinite(p)).sum())}
    out["native R1,R2"] = rules(H, [s, w])
    # ICON world tier ~1.75 deg: GWAM 0.25 deg -> k=7 approx; try 7 and 8
    for k in (7, 8):
        out[f"k{k} skip R1,R2"] = rules(rms(H, k), [rms(s, k), rms(w, k)])
        out[f"k{k} zero R1,R2"] = rules(rms(H, k), [rms(s, k, hv), rms(w, k, hv)])
    print(json.dumps(out))
