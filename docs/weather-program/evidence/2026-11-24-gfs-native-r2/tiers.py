import sys, json, warnings
sys.path.insert(0, sys.argv[1])
exec(open(sys.argv[2]).read().split('if __name__')[0])
warnings.simplefilter("ignore")
def rms(a, k, zero_where=None):
    a = a.copy()
    if zero_where is not None:
        a[np.isnan(a) & zero_where] = 0.0
    r, c = (a.shape[0]//k)*k, (a.shape[1]//k)*k
    b = a[:r, :c].reshape(r//k, k, c//k, k)
    return np.sqrt(np.nanmean(b*b, axis=(1,3)))
F = fields(sys.argv[3], sys.argv[4], 72)
H = F["H"]; hv = np.isfinite(H); served = ["s1","s2","ww"]
for k, name in ((2, "0.5 deg"), (8, "2 deg"), (40, "10 deg")):
    Hb = rms(H, k)
    a = {s: rms(F[s], k) for s in served}; b = {s: rms(F[s], k, hv) for s in served}
    ra = rules(Hb, list(a.values()), name + " skip"); rb = rules(Hb, list(b.values()), name + " zero")
    # how much does each served partition height move (where both finite, total > 0.25)
    m = np.isfinite(Hb) & (Hb > 0.25)
    mv = {s: (round(float(np.nanmedian((a[s]/np.maximum(b[s],1e-9))[m & np.isfinite(b[s]) & (b[s] > 0.05)])),3),
              round(float(np.nanpercentile((a[s]/np.maximum(b[s],1e-9))[m & np.isfinite(b[s]) & (b[s] > 0.05)], 90)),3)) for s in served}
    print(name, "skip R1/R2", ra["r1_rate"], ra["r2_rate"], "| zero R1/R2", rb["r1_rate"], rb["r2_rate"], "| skip/zero height ratio p50,p90", mv)
