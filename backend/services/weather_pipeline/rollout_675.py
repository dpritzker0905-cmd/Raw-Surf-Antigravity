"""#675 rollout safety (plan v2, owner 2026-11-02 "Build v2 as a draft"): the three default-ON flags of #675 run only
behind a dry run, a backup, a reader proof and a post-publish read-back.

THE FLAGS (each default '1', kill switch '0'):
  (1) INGEST_PRUNE_ESTIMATES_AFTER_REPLACE  copernicus_validator prune: an estimate goes once its own hour is replaced.
  (2) LATTICE_FILL_REFRESH_STALE            lattice_fill: rewrites its own older interpolations IN PLACE (same key).
  (3) EURO_MARINE_NATIVE_TAIL_CADENCE       three-hourly EURO 10-14 d tail; legacy time-keyed names, so later runs
                                            rewrite the same key.

STATES (step summary + ops/rollout_675.json in the bucket; the owner manages nothing):
  BLOCKED   a check failed: the new rules make NO mutation this run (no snapshot-less write, no delete, no publish of
            theirs). The prior manifest and objects are kept and the OLD prune rule is NOT run instead: estimates are
            simply not pruned this run.
  SAFE      (1) only. Its storage deletes are MARKED, never executed in-run.
  PROMOTED  (1) + (2) + (3): the reader proved at the start of this run that it serves the previous run's canary
            revision through its real L2 loader, and the previous run's sampled audit passed.
  RESTORED  written only by scripts/restore_rollout_snapshot.py (on demand, never automatic).
  RESTORE_PARTIAL  the same script stopped partway (a write or its read-back failed): the status names the files restored
            and not restored, the manifest was NOT republished, nothing is rolled back; the operator regenerates.

WHAT "DRY RUN BEFORE ANY MUTATION" MEANS HERE. A run's data does not exist until it is fetched, so the plan cannot be
known at T+0. Two layers: (a) run-level checks at begin_run (both prerequisites '1' in this lane's own env, the
verified-cycles bypass off, the owning lane, last run's read-back and bounds, a readable status and head); (b) for every
operation of the new rules (a prune call, the fill batch, a tail layer), `execute` computes that operation's whole plan
(writes, overwrites, deletes) and checks it BEFORE its first mutation: no filename to delete is named by a retained
registration of ANY lane in the freshly read published head; every expected slot (from the run's own lattice / cadence,
never a fixed range or count) is covered after the plan. Then the order is SNAPSHOT (every touched object + the
pre-publish head, each read back and sha256-verified) -> WRITE -> PUBLISH -> MARK deletes. A failed check or a snapshot
that fails partway turns the run BLOCKED and that operation makes no mutation.

Deletes are executed later by product_object_gc's mark-and-sweep, scoped to this module's marks (product_gc/marks_675.json):
two sweeps >= PRODUCT_GC_GRACE_S apart, and only while the merged published head does not name the object.

OWNING LANE. The EURO coarse estimates and the in-band lattice fills are written by the core lane (forecast-ingest.yml,
INGEST_PILOTS=skip). The pilots lane (INGEST_PILOTS=only) never runs the new rules; while any flag is requested its merges
treat those entries as READ-ONLY (they take the published head's copy, never fold back a ghost, and its duplicate sweep
skips them). There is no compare-and-swap or lease between the lanes: a concurrent publish can still drop an entry; the
post-publish read-back catches it and BLOCKS the next run ("entries lost after publish").

With all three flags '0' every hook is inert (no I/O, byte-identical to the flags-off code). With no run context (unit
tests, local tools; begin_run is called only by scripts/ingest_forecast_ci.py) the flags behave as #675 shipped them.
"""
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

FLAG_PRUNE = "INGEST_PRUNE_ESTIMATES_AFTER_REPLACE"
FLAG_REFRESH = "LATTICE_FILL_REFRESH_STALE"
FLAG_TAIL = "EURO_MARINE_NATIVE_TAIL_CADENCE"
FLAGS = (FLAG_PRUNE, FLAG_REFRESH, FLAG_TAIL)
PREREQUISITES = ("INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS", "MANIFEST_ONE_ENTRY_PER_OBJECT")
BYPASS = "INGEST_PRUNE_VERIFIED_CYCLES"
BLOCKED, SAFE, PROMOTED, RESTORED = "BLOCKED", "SAFE", "PROMOTED", "RESTORED"
RESTORE_PARTIAL = "RESTORE_PARTIAL"              # rollout_675_restore: a restore that stopped partway (no republish)
OFF, READ_ONLY = "OFF", "READ_ONLY"            # internal: no flag requested / the non-owning lane
RUNNING = "RUNNING"                             # status marker between begin_run and finish_run (a crash leaves it)
OWNER_LANE = "core"
READER_PROTOCOL_REQUIRED = 1
BASELINE_CYCLES = 6
BASELINE_KEEP = 12
AUDIT_SAMPLE = 10
GROWTH_LIMIT = 1.10                             # manifest count vs the baseline median, once baselined
DURATION_LIMIT_MIN = 15.0                       # lane minutes over the baseline median, once baselined
HEAD_TTL_S = 120.0
STATUS_KEY = "ops/rollout_675.json"
MARKS_KEY = "product_gc/marks_675.json"
SNAPSHOT_ROOT = "snapshots"
SNAPSHOT_KEEP = 2
CANARY_FILENAME = "ops_rollout675_canary.json"


class SnapshotError(RuntimeError):
    pass


def flag_on(name) -> bool:
    return os.environ.get(name, "1") != "0"


def requested() -> dict:
    return {name: flag_on(name) for name in FLAGS}


def lane_name() -> str:
    return "pilots" if os.environ.get("INGEST_PILOTS", "") == "only" else "core"


def iso(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(data) -> str:
    return hashlib.sha256(data).hexdigest()


def owned_raw(raw) -> bool:
    """The entries only the owning lane may change: lattice fills, and the EURO global-coarse estimates."""
    get = raw.get if isinstance(raw, dict) else (lambda k, d=None: getattr(raw, k, d))
    if get("source_dataset") == "estimated_interpolation":
        return True
    return (str(get("model") or "").upper() == "EURO" and str(get("domain") or "").lower() == "marine"
            and get("region_id") == "global_coarse" and not get("is_forecast_authoritative", False))


@dataclass
class Plan:
    op: str
    writes: dict = field(default_factory=dict)       # filename -> run_time ISO this op writes under that key
    deletes: list = field(default_factory=list)      # filenames whose storage delete is MARKED
    before: dict = field(default_factory=dict)       # filename -> registration (dict) before the op, or None
    expected: dict = field(default_factory=dict)     # lane label -> set of slot ISO times
    covered: dict = field(default_factory=dict)      # lane label -> set of slot ISO times covered after the plan
    retained: set = field(default_factory=set)       # filenames retained registrations (all lanes) name


@dataclass
class Run:
    lane: str
    cycle_id: str
    started_at: datetime
    io: object
    flags: dict
    state: str = SAFE
    reasons: list = field(default_factory=list)
    gate: dict = field(default_factory=dict)
    prev: dict = field(default_factory=dict)
    status_doc: dict = field(default_factory=dict)
    counters: dict = field(default_factory=dict)
    touched: dict = field(default_factory=dict)      # filename -> snapshot/index record
    marks: set = field(default_factory=set)
    events: list = field(default_factory=list)       # ordered ("snapshot"|"write"|"publish"|"mark", key) for tests and logs
    observations: list = field(default_factory=list)
    manifest_snapshot: bool = False
    begin_head_count: int = None
    head_cache: tuple = None

    @property
    def owner(self) -> bool:
        return self.lane == OWNER_LANE

    @property
    def prefix(self) -> str:
        return f"{SNAPSHOT_ROOT}/{self.lane}/{self.cycle_id}"

    def count(self, key, n=1):
        self.counters[key] = self.counters.get(key, 0) + n

    def effective(self, flag) -> bool:
        if not self.flags.get(flag) or not self.owner or self.state not in (SAFE, PROMOTED):
            return False
        return True if flag == FLAG_PRUNE else self.state == PROMOTED

    def block(self, reasons):
        if self.state != BLOCKED:
            logger.error("[Rollout 675] BLOCKED: %s", reasons)
        self.state = BLOCKED
        self.reasons.extend(r for r in reasons if r not in self.reasons)
        self.count("blocked_checks")

    def head_products(self, force=False):
        now = time.monotonic()
        if not force and self.head_cache is not None and now - self.head_cache[0] < HEAD_TTL_S:
            return self.head_cache[1]
        head = self.io.head_products()
        self.head_cache = (now, head) if head is not None else None
        return head


_RUN = None


def current():
    return _RUN


def reset():
    global _RUN
    _RUN = None


# ── run-level preflight ────────────────────────────────────────────────────────────────────────────────────────────


def _prerequisite_reasons():
    reasons = [f"prerequisite {name} is {os.environ.get(name, '0')!r}, not '1', in this lane's env"
               for name in PREREQUISITES if os.environ.get(name, "0") != "1"]
    if os.environ.get(BYPASS, "0") == "1":
        reasons.append(f"{BYPASS}=1 returns the prune early into prune_verified_cycles (bypasses the new rule)")
    return reasons


def _http_get_json(url, timeout):
    import requests
    resp = requests.get(url, timeout=timeout, headers={"Cache-Control": "no-cache"})
    resp.raise_for_status()
    return resp.json()


def reader_gate(prev, http_get=None, base=None, timeout=5.0) -> dict:
    """ONE GET of the reader's /capabilities, fail closed. Open only if the reader runs protocol >= the required one AND its
    revision_probe (the canary loaded through its real L2 loader) equals the canary revision the previous run wrote, AND
    the previous run's sampled audit passed."""
    gate = {"open": False}
    if os.environ.get("PRODUCT_RUN_KEYED_NAMES", "0") == "1":
        gate["reason"] = "PRODUCT_RUN_KEYED_NAMES=1: the same-key rewrite proof does not apply"
        return gate
    expected = (prev or {}).get("canary_revision")
    if not expected:
        gate["reason"] = "no canary revision from a previous SAFE/PROMOTED run"
        return gate
    if not (prev or {}).get("audit_ok"):
        gate["reason"] = "the previous run's sampled audit did not pass"
        return gate
    base = (base if base is not None else os.environ.get("ROLLOUT_675_READER_BASE", "")).rstrip("/")
    if not base:
        gate["reason"] = "ROLLOUT_675_READER_BASE unset"
        return gate
    try:
        rows = (http_get or _http_get_json)(f"{base}/api/weather/capabilities", timeout)
    except Exception as exc:
        gate["reason"] = f"reader GET failed: {type(exc).__name__}"
        return gate
    row = next((r for r in rows if isinstance(r, dict) and r.get("model") == "EURO" and r.get("domain") == "marine"), None) \
        if isinstance(rows, list) else None
    if row is None:
        gate["reason"] = "reader /capabilities has no EURO marine row"
        return gate
    try:
        protocol = int(row.get("reader_protocol") or 0)
    except (TypeError, ValueError):
        protocol = 0
    probe = row.get("revision_probe") if isinstance(row.get("revision_probe"), dict) else {}
    gate.update(reader_protocol=protocol, commit=row.get("commit"), served=probe.get("revision"), expected=expected)
    if protocol < READER_PROTOCOL_REQUIRED:
        gate["reason"] = f"reader_protocol {protocol} < required {READER_PROTOCOL_REQUIRED}"
    elif probe.get("error"):
        gate["reason"] = f"revision_probe error: {probe.get('error')}"
    elif probe.get("revision") != expected:
        gate["reason"] = f"reader serves canary {probe.get('revision')}, expected {expected} (stale reader)"
    else:
        gate["open"], gate["reason"] = True, "reader serves the previous run's canary revision"
    return gate


def begin_run(store, io=None, http_get=None, now=None):
    """Called once by scripts/ingest_forecast_ci.py after the pre-ingest restore. Never raises: an unexpected error leaves a
    BLOCKED run (fail closed), never no run context (which would mean ungated)."""
    global _RUN
    try:
        return _begin_run(store, io, http_get, now)
    except Exception as exc:
        logger.error("[Rollout 675] preflight errored: %s", exc)
        run = Run(lane=lane_name(), cycle_id="error", started_at=now or datetime.now(timezone.utc), io=io, flags=requested())
        run.block([f"preflight errored ({type(exc).__name__}): fail closed"])
        if not any(run.flags.values()):
            run.state = OFF
        _RUN = run
        return run


def _begin_run(store, io, http_get, now):
    global _RUN
    now = now or datetime.now(timezone.utc)
    cycle_id = f"{now:%Y%m%dT%H%M%SZ}-{os.environ.get('GITHUB_RUN_ID', 'local')}"
    flags = requested()
    if io is None and any(flags.values()):
        from services.weather_pipeline.rollout_675_io import SupabaseIO
        io = SupabaseIO(store)
    run = Run(lane=lane_name(), cycle_id=cycle_id, started_at=now, io=io, flags=flags)
    _RUN = run
    if not any(flags.values()):
        run.state = OFF
        return run
    if not run.owner:
        run.state = READ_ONLY
        logger.info("[Rollout 675] lane %s is not the owner (%s): #675 paths off, owned entries read-only", run.lane, OWNER_LANE)
        return run
    reasons = _prerequisite_reasons()
    try:
        from services.weather_pipeline.rollout_675_io import read_status
        run.status_doc = read_status(io)
        run.prev = (run.status_doc.get("lanes") or {}).get(run.lane) or {}
    except Exception as exc:
        reasons.append(f"status object unreadable ({type(exc).__name__}): fail closed")
    if run.prev.get("state") == RUNNING:
        reasons.append(f"the previous run ({run.prev.get('cycle_id')}) never finished its read-back (crashed or cancelled)")
    if run.prev.get("entries_lost"):
        reasons.append(f"entries lost after publish (cycle {run.prev.get('cycle_id')}: {len(run.prev['entries_lost'])})")
    if run.prev.get("bounds_breach"):
        reasons.append(f"bounds breached last cycle: {run.prev['bounds_breach']}")
    try:
        head = run.head_products(force=True)
    except Exception:
        head = None
    if head is None:
        reasons.append("published head unreadable")
    else:
        run.begin_head_count = len(head)
    if reasons:
        run.block(reasons)
        return run
    if flags[FLAG_REFRESH] or flags[FLAG_TAIL]:
        run.gate = reader_gate(run.prev, http_get=http_get)
    else:
        run.gate = {"open": False, "reason": "flags (2) and (3) are off"}
    try:   # RUNNING marker (Reflection 2026-11-02): a run that dies between its writes and its read-back BLOCKS the next one
        from services.weather_pipeline.rollout_675_io import write_status
        marker = dict(run.prev, state=RUNNING, cycle_id=cycle_id, started_at=iso(now), audit_ok=False, entries_lost=[])
        lanes = dict(run.status_doc.get("lanes") or {}, **{run.lane: marker})
        write_status(io, dict(run.status_doc, lanes=lanes, updated_at=iso(now)))
    except Exception as exc:
        run.block([f"RUNNING marker not written ({type(exc).__name__}): fail closed"])
        return run
    run.state = PROMOTED if run.gate.get("open") else SAFE
    logger.info("[Rollout 675] %s (%s); gate: %s", run.state, run.cycle_id, run.gate)
    return run


# ── hooks the three flags call ─────────────────────────────────────────────────────────────────────────────────────


def prune_mode() -> str:
    """'ungated' (no run context, #675 as shipped), 'legacy' (flag (1) off or the non-owning lane: the old preserve rule),
    'blocked' (estimates are not pruned at all this run), 'active' (the new rule, behind execute())."""
    if not flag_on(FLAG_PRUNE):
        return "legacy"
    run = _RUN
    if run is None:
        return "ungated"
    if run.state == BLOCKED:
        return "blocked"
    return "active" if run.effective(FLAG_PRUNE) else "legacy"


def refresh_stale_allowed() -> bool:
    run = _RUN
    if run is None:
        return flag_on(FLAG_REFRESH)
    return run.effective(FLAG_REFRESH)


def tail_cadence_allowed() -> bool:
    run = _RUN
    if run is None:
        return flag_on(FLAG_TAIL)
    return run.effective(FLAG_TAIL)


def non_owner_active() -> bool:
    run = _RUN
    return run is not None and run.state == READ_ONLY


def read_only(product) -> bool:
    return non_owner_active() and owned_raw(product)


def defer_owned_entries(manifest, remote_products) -> int:
    """Non-owning lane: owned entries come ONLY from the published head (no ghost folded back, no stale copy kept)."""
    if not non_owner_active() or remote_products is None:
        return 0
    from services.weather_pipeline.schemas import ManifestProduct
    theirs = []
    for raw in remote_products:
        if isinstance(raw, dict) and owned_raw(raw):
            try:
                theirs.append(ManifestProduct.model_validate(raw))
            except Exception:
                continue
    before = len(manifest.products)
    manifest.products = [p for p in manifest.products if not owned_raw(p)] + theirs
    _RUN.count("read_only_merges")
    return len(manifest.products) - before


# ── the dry run, the backup and the ordered mutation ───────────────────────────────────────────────────────────────


def check_plan(run, plan) -> list:
    reasons = []
    if run.state == BLOCKED:
        reasons.append("run already BLOCKED")
    if not run.owner:
        reasons.append(f"lane {run.lane} does not own the #675 paths")
    reasons.extend(_prerequisite_reasons())
    shared = sorted(set(plan.deletes) & set(plan.retained))
    if shared:
        reasons.append(f"{len(shared)} filename(s) to delete are named by retained registrations: {shared[:3]}")
    for lane, slots in sorted(plan.expected.items()):
        missing = sorted(set(slots) - set(plan.covered.get(lane, ())))
        if missing:
            reasons.append(f"{lane}: {len(missing)} expected slot(s) missing after the plan: {missing[:3]}")
    return reasons


def _put_verified(io, key, data):
    io.upload(key, data)
    got = io.download(key)
    if got is None or sha256(got) != sha256(data):
        raise SnapshotError(f"read-back of {key} does not match")


def _bytes_run_time(data):
    try:
        return iso(json.loads(data.decode("utf-8")).get("run_time"))
    except Exception:
        return None


def write_index(run):
    doc = {"cycle_id": run.cycle_id, "lane": run.lane, "started_at": iso(run.started_at),
           "entries": [run.touched[k] for k in sorted(run.touched)]}
    _put_verified(run.io, f"{run.prefix}/_index.json", json.dumps(doc, sort_keys=True).encode("utf-8"))


def snapshot(run, plan):
    """Copy every object this plan touches (and, once per run, the pre-publish head) and READ BACK each copy before
    anything is written, overwritten, published or deleted. Raises SnapshotError; nothing in run.touched changes then."""
    io = run.io
    if not run.manifest_snapshot:
        head = run.head_products(force=True)
        if head is None:
            raise SnapshotError("published head unreadable")
        _put_verified(io, f"{run.prefix}/_manifest.json", json.dumps({"products": head}, sort_keys=True).encode("utf-8"))
        run.manifest_snapshot = True
        run.events.append(("snapshot", "_manifest.json"))
    records = {}
    for filename in sorted(set(plan.deletes) | set(plan.writes)):
        if filename in run.touched:
            continue            # snapshotted earlier this run: keep the PRE-RUN bytes
        rec = {"filename": filename, "op": plan.op, "kind": "delete" if filename in plan.deletes else "write",
               "before": plan.before.get(filename), "before_sha256": None, "snapshot_key": None, "size": None}
        src = io.download(filename)
        if src is not None:
            rec["bytes_run_time"] = _bytes_run_time(src)
            want = iso((plan.before.get(filename) or {}).get("run_time"))
            if rec["kind"] == "delete" and want and rec["bytes_run_time"] and rec["bytes_run_time"] != want:
                raise SnapshotError(f"{filename}: stored bytes are run {rec['bytes_run_time']}, the pruned registration is {want}")
            dst = f"{run.prefix}/{filename}"
            try:
                io.copy(filename, dst)
            except Exception as exc:          # copy unavailable or refused: download-then-upload
                logger.info("[Rollout 675] copy %s failed (%s); uploading the downloaded bytes", filename, type(exc).__name__)
                io.upload(dst, src)
            got = io.download(dst)
            if got is None or sha256(got) != sha256(src):
                raise SnapshotError(f"snapshot read-back mismatch for {filename}")
            rec.update(before_sha256=sha256(src), snapshot_key=dst, size=len(src))
        records[filename] = rec
    for filename, rec in records.items():
        run.touched[filename] = rec
        run.events.append(("snapshot", filename))
    for filename, run_time in plan.writes.items():
        run.touched[filename]["written_run_time"] = run_time
    try:
        write_index(run)
    except Exception:
        for filename in records:
            run.touched.pop(filename, None)
        raise
    run.count("snapshotted", len(records))


def execute(plan, write=None, publish=None) -> bool:
    """check -> snapshot -> write -> publish -> mark. False = the run is now BLOCKED and this op mutated nothing."""
    run = _RUN
    reasons = check_plan(run, plan)
    if reasons:
        run.block([f"{plan.op}: {r}" for r in reasons])
        return False
    try:
        snapshot(run, plan)
    except Exception as exc:
        run.block([f"{plan.op}: snapshot failed ({type(exc).__name__}: {exc}); no mutation"])
        return False
    if write is not None:
        write()
        run.events.append(("write", plan.op))
    if publish is not None:
        publish()
        run.events.append(("publish", plan.op))
    for filename in plan.deletes:
        run.marks.add(filename)
        run.events.append(("mark", filename))
    run.count(f"{plan.op}_writes", len(plan.writes))
    run.count(f"{plan.op}_marked_deletes", len(plan.deletes))
    return True


# ── plan builders for the three operations ─────────────────────────────────────────────────────────────────────────


def prune_plan(manifest, new_rule, remaining, lane_match, label) -> Plan:
    """(1): the estimates the new rule supersedes. A file still named by a retained registration (local or in the freshly
    read published head, any lane) is a registration-only drop, never a delete; the check then proves the delete set is
    disjoint from every retained name. Continuity: every hour an estimate is pruned at stays covered in its lane."""
    run = _RUN
    keys = {p.product_id or p.filename for p in new_rule}
    retained = {p.filename for p in remaining}
    head = run.head_products(force=True)      # FRESH: the other lane may have registered the name since the last read
    plan = Plan(op="prune")
    if head is None:
        plan.retained = {p.filename for p in new_rule}     # unreadable head: fail closed through the shared-name check
    else:
        plan.retained = retained | {r.get("filename") for r in head
                                    if isinstance(r, dict) and (r.get("product_id") or r.get("filename")) not in keys}
    plan.deletes = sorted({p.filename for p in new_rule} - retained)
    plan.before = {p.filename: p.model_dump(mode="json") for p in new_rule}
    plan.expected = {label: {iso(p.valid_time_start) for p in new_rule}}
    plan.covered = {label: {iso(p.valid_time_start) for p in remaining if lane_match(p)}}
    return plan


def expected_tail_slots(times, step):
    """The tail slots this run must write, from the source cycle's own times and cadence: spacing x step (three-hourly
    NOAA x 1 with (3) PROMOTED, x 3 = nine-hourly otherwise). Never a fixed hour range or count."""
    ts = sorted(datetime.fromisoformat(iso(t).replace("Z", "+00:00")) for t in times)
    if len(ts) < 2:
        return {iso(t) for t in ts}
    cadence = min(b - a for a, b in zip(ts, ts[1:])) * step
    out, slot = set(), ts[0]
    while slot <= ts[-1]:
        out.add(iso(slot))
        slot += cadence
    return out


def tail_filename(layer, valid_time, region_id="global_coarse"):
    return f"euro_marine_{layer.lower()}_{region_id}_{datetime.fromisoformat(iso(valid_time).replace('Z', '+00:00')):%Y%m%dT%H%M%SZ}_estimated.json"


def tail_gate(store, layer, source, step, run_time, legacy_step=3) -> int:
    """(3), before a layer's GFS-ext save: plan, check and snapshot; returns the step the caller saves with."""
    run = _RUN
    if run is None or not source:
        return step
    times = [t for t in (source[0].get("hourly", {}) or {}).get("time", []) or []]
    planned = {iso(t) for t in times[::step]}
    label = f"EURO/marine/{layer}/global_coarse"
    if not run.effective(FLAG_TAIL):
        missing = expected_tail_slots(times, step) - planned
        run.observations.append({"tail": label, "cadence_step": step, "planned": len(planned), "missing": len(missing)})
        return step
    manifest = store.get_manifest()
    by_name = {p.filename: p for p in manifest.products}
    plan = Plan(op="tail")
    plan.writes = {tail_filename(layer, t): iso(run_time) for t in sorted(planned)}
    plan.before = {f: (by_name[f].model_dump(mode="json") if f in by_name else None) for f in plan.writes}
    plan.expected = {label: expected_tail_slots(times, step)}
    plan.covered = {label: planned}
    if execute(plan):
        return step
    return legacy_step


def fill_plan(manifest, lanes, to_save, run_time_of) -> Plan:
    """(2): `lanes` = [{label, expected (slots find_fill_slots computed), stale {slot ISO: filename}}]; `to_save` the
    interpolations about to be written, each with (label, slot ISO, filename)."""
    by_name = {p.filename: p for p in manifest.products}
    plan = Plan(op="fill")
    saved = {}
    for label, slot, filename, (est, _resolution) in to_save:
        saved.setdefault(label, set()).add(slot)
        plan.writes[filename] = run_time_of(est)
    for lane in lanes:
        label = lane["label"]
        plan.expected[label] = set(lane["expected"])
        plan.covered[label] = saved.get(label, set()) | set(lane["stale"])
    plan.before = {f: (by_name[f].model_dump(mode="json") if f in by_name else None) for f in plan.writes}
    return plan
