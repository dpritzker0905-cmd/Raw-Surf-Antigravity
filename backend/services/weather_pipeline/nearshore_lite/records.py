"""The MOP-lite forward-archive RECORD in the shared point-archive schema (`point-archive/1`, purpose `nearshore_eval`;
gate served-wave-verify-v1 section 0.2). PURE.

One record per (member, run, target, lead). A record holds the INPUTS every arm reads, not an arm's output: the arms (CHAIN_SERVED,
CHAIN_PART, LITE, OFFSHORE) are computed at SCORE time because LITE needs the frozen coefficients, so every record carries
`arm: "INPUT"` (an addition to the section 0.2 `arm` field, amendment 2026-11-23). Partitions use the shared `kind` names
(`swell_1 | swell_2 | wind_waves | total`); the chain's own two-valued shape (`swell` / `windsea`, which `spectrum.shape_params`
reads) is derived from them on READ (`rows_from_records`), so the physics code is unchanged.
"""
from datetime import timedelta

from services.point_archive import core

ARM = "INPUT"
PURPOSE = "nearshore_eval"
SWELL_KINDS = ("swell_1", "swell_2")
WIND_KIND = "wind_waves"
TOTAL_KIND = "total"


def shape_of(shared_kind):
    """The chain's partition shape for a shared kind: wind_waves is wind sea, everything else swell (a total train is one swell
    train, as the served chain rates it)."""
    return "windsea" if shared_kind == WIND_KIND else "swell"


def shared_partitions(parts, basis):
    """Partitions with the shared `kind` names. `parts` are the served chain's `{h, tp, dir, kind: swell|windsea}` in the order
    it returns them (swell_1, swell_2, wind_waves); a `total` basis is one `total` train. A partition the source does not carry
    is ABSENT, never zero."""
    if basis == "total":
        return [{"kind": TOTAL_KIND, "h": p["h"], "tp": p["tp"], "dir": p.get("dir")} for p in (parts or [])][:1]
    out, swells = [], 0
    for p in parts or []:
        if p.get("kind") == "windsea":
            kind = WIND_KIND
        else:
            swells += 1
            kind = SWELL_KINDS[swells - 1] if swells <= len(SWELL_KINDS) else f"swell_{swells}"
        out.append({"kind": kind, "h": p["h"], "tp": p["tp"], "dir": p.get("dir")})
    return out


def build_record(run_time, member, target, row, list_version, list_hash, run_hash, eta_slice_sha256=None,
                 tide_table_generated_at=None, coefficient_freeze_hash=None, owner_word_ref=None):
    """One `point-archive/1` record from a partition-source row `{target, lead_h, partitions, basis, total}` plus the run's
    provenance. `station_id` is the target's linked buoy when it has one."""
    lead = int(row["lead_h"])
    valid = core.parse_time(run_time) + timedelta(hours=lead)
    basis = row.get("basis")
    rec = {"row_type": "record", "schema": core.SCHEMA, "purpose": PURPOSE, "model": str(member).lower(), "arm": ARM,
           "run_time": core.iso_z(run_time), "valid_time": core.iso_z(valid), "lead_h": lead,
           "target_id": target["id"], "station_id": target.get("station_id"),
           "buoy_list_version": list_version, "buoy_list_hash": list_hash, "run_hash": run_hash,
           "writer_version": core.WRITER_VERSION, "basis": basis,
           "status": "ok" if basis in ("partitions", "total") else "sampler_fail",
           "partitions": shared_partitions(row.get("partitions"), basis) if basis in ("partitions", "total") else []}
    if basis not in ("partitions", "total"):
        rec["cause"] = "unavailable"
    t = row.get("total")
    if isinstance(t, dict):                                             # the bulk block: the TOTAL field production rates
        rec.update({"hs_m": t.get("h"), "tp_s": t.get("tp"), "dir_deg": t.get("dir")})
    if row.get("eta_m") is not None:
        rec["eta_m"] = row["eta_m"]
    for k, v in (("eta_slice_sha256", eta_slice_sha256), ("tide_table_generated_at", tide_table_generated_at),
                 ("coefficient_freeze_hash", coefficient_freeze_hash), ("owner_word_ref", owner_word_ref)):
        if v is not None:
            rec[k] = v
    return rec


def rows_from_records(records):
    """Back to the arms' input rows `{target, lead_h, partitions (chain shape), basis, total, eta_m}`; unavailable rows keep
    `partitions: None`. The inverse of build_record for everything the arms read."""
    out = []
    for r in records:
        if r.get("row_type") != "record":
            continue
        parts = None
        if r.get("status") == "ok":
            parts = [{"h": p["h"], "tp": p["tp"], "dir": p.get("dir"), "kind": shape_of(p["kind"])} for p in r["partitions"]]
        total = None
        if r.get("hs_m"):
            total = {"h": r["hs_m"], "tp": r.get("tp_s"), "dir": r.get("dir_deg")}
        row = {"target": r["target_id"], "lead_h": r["lead_h"], "partitions": parts, "basis": r.get("basis"), "total": total}
        if "eta_m" in r:
            row["eta_m"] = r["eta_m"]
        out.append(row)
    return out
