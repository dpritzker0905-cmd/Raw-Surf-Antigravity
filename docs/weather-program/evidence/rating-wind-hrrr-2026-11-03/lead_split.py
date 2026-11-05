import json, random
from datetime import datetime
rows = json.load(open("eval_rows.json"))
def lead(r):
    h = datetime.fromisoformat(r["t"]).hour
    return (h - 1) % 6 + 1
def clus(sub, cand, reps=2000):
    by = {}
    for r in sub:
        if cand not in r or r[cand]["score"] is None: continue
        o = r["obs"]["score"]
        by.setdefault((r["spot"], r["t"][:10]), []).append(abs(r["gfs"]["score"] - o) - abs(r[cand]["score"] - o))
    ks = list(by); rng = random.Random(1)
    st = lambda kk: (lambda v: sum(v) / len(v))([x for k in kk for x in by[k]])
    b = sorted(st([ks[rng.randrange(len(ks))] for _ in ks]) for _ in range(reps))
    return round(st(ks), 2), (round(b[int(.025 * reps)], 2), round(b[int(.975 * reps)], 2)), sum(len(v) for v in by.values())
out = {}
for L in (1, 2, 3, 4, 5, 6):
    sub = [r for r in rows if lead(r) == L]
    out[L] = {c: clus(sub, c) for c in ("lane", "pt_bil", "omhrrr")}
    print(L, out[L])
json.dump(out, open("lead_split.json", "w"), indent=1)
