"""Freeze order (gate section 1a): datum conversion recorded, seam table committed, THEN coefficients.

`freeze_targets` refuses to write a coefficient unless it is handed (a) a datum conversion record for every source
used, (b) the committed seam table's sha256 for that target set, and (c) the seam table file itself, whose bytes
hash to that sha. The seam table's sha256 is written into every coefficient's meta, so the order is auditable from the
frozen files alone. No buoy value is read anywhere on this path.
"""
import hashlib
import os

from . import coefficients as coef
from . import seam as seam_mod
from .ray_trace import TRUNCATED_FLAG_SHARE, convergence, trace_target, truncated_share


class FreezeOrderError(RuntimeError):
    """A coefficient was requested before the datum record and the committed seam table exist."""


def commit_seam_table(dirpath, rows, filename="seam_table.csv"):
    """Write the seam table, return (path, sha256). Must be called (and committed) BEFORE `freeze_targets`."""
    os.makedirs(dirpath, exist_ok=True)
    text, sha = seam_mod.to_csv(rows)
    path = os.path.join(dirpath, filename)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path, sha


def freeze_targets(dirpath, targets, seam_table_path, seam_table_sha256):
    """targets: list of dict(id, grid (ray_trace.DepthGrid), xy, datum_records (list of DatumConversion.as_dict),
    stratum, tags (list), sources (list), tile_sha256 ({name: sha})). Returns {file: sha256} (also SHA256SUMS)."""
    if not seam_table_path or not os.path.exists(seam_table_path):
        raise FreezeOrderError("the seam table is not committed: no coefficient may be frozen before it")
    with open(seam_table_path, "rb") as f:
        actual = hashlib.sha256(f.read()).hexdigest()
    if actual != seam_table_sha256:
        raise FreezeOrderError(f"seam table sha256 {actual} != the committed {seam_table_sha256}")
    for t in targets:
        if not t.get("datum_records"):
            raise FreezeOrderError(f"{t['id']}: no datum conversion record (gate 1a): refusing to freeze")
        if any(r.get("method") == "none" and "DATUM_1M" not in (r.get("tags") or []) for r in t["datum_records"]):
            raise FreezeOrderError(f"{t['id']}: an unresolved datum is not tagged DATUM_1M")
    for t in targets:
        table = trace_target(t["grid"], *t["xy"])
        tshare = truncated_share(table)
        conv = convergence(table, trace_target(t["grid"], *t["xy"], step_factor=0.5)) if t.get("check_convergence", True) else None
        tags = sorted(set(t.get("tags", [])) | {r_tag for r in t["datum_records"] for r_tag in (r.get("tags") or [])})
        meta = {
            "stratum": t["stratum"], "tags": tags, "sources": t.get("sources", []),
            "datum_records": t["datum_records"], "tile_sha256": t.get("tile_sha256", {}),
            "seam_table_sha256": seam_table_sha256, "truncated_share": round(tshare, 4),
            "truncated_flag": bool(tshare > TRUNCATED_FLAG_SHARE), "convergence_half_step": conv, "method": "backward-ray-linear/Liouville",
            "datum": "MSL (tide eta NOT added; gate 1a)",
        }
        coef.write_target(dirpath, t["id"], table, meta)
    return coef.write_sums(dirpath)
