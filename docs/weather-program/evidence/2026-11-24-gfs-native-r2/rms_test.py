import sys, json, warnings
sys.path.insert(0, sys.argv[1])
exec(open(sys.argv[2]).read().split('if __name__')[0])
warnings.simplefilter("ignore")
def rms(a, k, nan_as_zero_where=None):
    a = a.copy()
    if nan_as_zero_where is not None:
        a[np.isnan(a) & nan_as_zero_where] = 0.0
    r, c = (a.shape[0]//k)*k, (a.shape[1]//k)*k
    b = a[:r, :c].reshape(r//k, k, c//k, k)
    return np.sqrt(np.nanmean(b*b, axis=(1,3)))
for f in (24, 168):
    F = fields(sys.argv[3], sys.argv[4], f)
    H = F["H"]; hv = np.isfinite(H)
    for k in ("s1","s2","ww","s3"):
        p = F[k]
        print(f, k, "H valid & p NaN:", round(float((hv & np.isnan(p)).sum()/hv.sum()),4), " H valid & p==0:", round(float((hv & (p==0)).sum()/hv.sum()),4))
    served = ["s1","s2","ww"]
    print(json.dumps(rules(rms(H,8), [rms(F[k],8) for k in served], "2-deg RMS, NaN skipped (as fetcher)")))
    print(json.dumps(rules(rms(H,8), [rms(F[k],8,hv) for k in served], "2-deg RMS, NaN->0 where H valid")))
