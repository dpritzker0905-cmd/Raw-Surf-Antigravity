"""Forward archive of the served offshore partitions per 00Z init, with a SHA256SUMS freeze record (gate section 5).

Written by a GitHub Actions job, never the Render box. One canonical-JSON file per init; SHA256SUMS lists them. A
file that changes after it was archived is a verification failure, and `missing_run` names inits that lack any step to
the 72 h horizon (the missing-run rule drops those inits for ALL arms).
"""
import hashlib
import json
import os

SUMS = "SHA256SUMS"
LEAD_MAX_H = 72
FORMAT = "nearshore-lite-archive/1"


def _canon(obj):
    return (json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def archive_init(dirpath, init_iso, member, rows):
    """rows: list of dict(target, lead_h, partitions=[{h,tp,dir,kind}]). Returns (path, sha256).
    The file name is the init time; re-archiving an existing init is REFUSED (immutable)."""
    os.makedirs(dirpath, exist_ok=True)
    name = f"{init_iso.replace(':', '').replace('-', '')}.json"
    path = os.path.join(dirpath, name)
    if os.path.exists(path):
        raise FileExistsError(f"{name} is already archived: archives are immutable")
    b = _canon({"format": FORMAT, "init": init_iso, "member": member,
                "rows": sorted(rows, key=lambda r: (r["target"], r["lead_h"]))})
    with open(path, "wb") as f:
        f.write(b)
    h = hashlib.sha256(b).hexdigest()
    with open(os.path.join(dirpath, SUMS), "a", encoding="utf-8", newline="\n") as f:
        f.write(f"{h}  {name}\n")
    return path, h


def read_sums(dirpath):
    out = {}
    p = os.path.join(dirpath, SUMS)
    if not os.path.exists(p):
        return out
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                h, name = line.split(None, 1)
                out[name.strip()] = h
    return out


def verify_archive(dirpath):
    """[] when every archived file matches SHA256SUMS and every file is listed; else a list of problems."""
    sums = read_sums(dirpath)
    problems = []
    for name in sorted(os.listdir(dirpath)):
        if name == SUMS or not name.endswith(".json"):
            continue
        if name not in sums:
            problems.append(f"{name}: not in {SUMS}")
            continue
        with open(os.path.join(dirpath, name), "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != sums[name]:
                problems.append(f"{name}: sha256 mismatch")
    for name in sums:
        if not os.path.exists(os.path.join(dirpath, name)):
            problems.append(f"{name}: listed but missing")
    return problems


def missing_run(dirpath, targets, step_h=1):
    """Inits that lack any (target, lead 0..72 step) row: dropped for all arms. Returns the sorted init names."""
    want = {(t, h) for t in targets for h in range(0, LEAD_MAX_H + 1, step_h)}
    bad = []
    for name in sorted(read_sums(dirpath)):
        with open(os.path.join(dirpath, name), "rb") as f:
            d = json.loads(f.read())
        have = {(r["target"], r["lead_h"]) for r in d["rows"]}
        if not want <= have:
            bad.append(name)
    return bad
