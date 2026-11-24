"""Pre-flip measurement for GFS_PARTITION_MASKED_AS_ZERO: the served-height DROP per lead at the 2-deg world tier,
through the PRODUCTION reducer (_fetch_region_reduce.variable, half=4 on the 0.25-deg grid) and the production fill
(_fetch_partition_mask). Offline, read-only: NOAA public AWS GFS-Wave GRIB."""
import sys, json, warnings
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
exec(open(sys.argv[3]).read().split('if __name__')[0])
from services import _fetch_partition_mask as pm
from services import _fetch_region_reduce as rr
warnings.simplefilter("ignore")
half = 4
names = {"s1": "swell_1", "s2": "swell_2", "ww": "wind_waves"}
out = []
for f in [int(x) for x in sys.argv[6].split(",")]:
    F = fields(sys.argv[4], sys.argv[5], f)
    H = F["H"]
    n, m = H.shape
    rs, cs = np.meshgrid(np.arange(half, n - half, 2 * half), np.arange(0, m, 2 * half), indexing="ij")
    rs, cs = rs.ravel(), cs.ravel()
    Hb = rr.variable(H, None, True, None, None, H, rs, cs, half, False)[0]
    row = {"lead_h": f}
    oldp, newp = [], []
    for k, name in names.items():
        old = rr.variable(F[k], None, True, None, None, H, rs, cs, half, False)[0]
        new = rr.variable(pm.fill_masked(F[k], H), None, True, None, None, H, rs, cs, half, False)[0]
        new = pm.keep_absent(new, rs, cs, lambda a, b, _o=F[k]: rr.variable(_o, None, True, None, None, H, a, b, half, False)[0])
        sel = np.isfinite(old) & np.isfinite(new) & np.isfinite(Hb) & (Hb > 0.25)
        d = (old - new)[sel]
        rel = (d / np.maximum(old[sel], 1e-9))
        row[name] = {"blocks": int(sel.sum()), "moved_share": round(float((d > 1e-4).mean()), 4),
                     "drop_m_p50": round(float(np.median(d)), 3), "drop_m_p95": round(float(np.percentile(d, 95)), 3),
                     "drop_rel_p50": round(float(np.median(rel)), 3), "drop_rel_p95": round(float(np.percentile(rel, 95)), 3),
                     "never_rose": bool((d >= -1e-9).all()),
                     "nan_before_value_after": int((np.isnan(old) & np.isfinite(new)).sum())}
        oldp.append(old); newp.append(new)
    for tag, P in (("as_built", oldp), ("fixed", newp)):
        Pz = np.where(np.isfinite(np.stack(P)), np.stack(P), 0.0)
        cells = np.isfinite(Hb) & (Hb > 0.25) & np.isfinite(np.stack(P)).any(0)
        row[f"R2_{tag}"] = round(float((cells & ((Pz ** 2).sum(0) > 1.1 * Hb ** 2)).sum() / cells.sum()), 4)
        row[f"R1_{tag}"] = round(float((cells & (Pz.max(0) > Hb + 0.05)).sum() / cells.sum()), 4)
    out.append(row)
    print(json.dumps(row), flush=True)
json.dump(out, open(sys.argv[7], "w"), indent=1)
