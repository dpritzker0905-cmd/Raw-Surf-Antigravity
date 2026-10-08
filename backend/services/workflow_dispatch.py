"""workflow_dispatch.py — fire a data lane's GitHub workflow when GitHub's own schedule did not (dark by default).

WHY. Every data lane lives on a GitHub `schedule:` trigger, and GitHub delays and drops scheduled runs in this repo
by hours. Measured 2026-09-28 over the three days before 23:45Z (scheduled slot -> first scheduled run in that
slot's window):

    Forecast Ingestion (decoupled)  '15 */4'       18 slots, 44% never ran, the rest median 106 min late (max 211)
    Forecast Ingestion Pilots       '45 3,11,19'    9 slots, 11% never ran, the rest median 305 min late (max 419)
    MOP Nearshore Ingest            '40 */6'       12 slots, 75% never ran, the rest median 290 min late (max 311)

Data Health pages around midday almost daily because the 08:15Z ingest slot never fires (audit 15.0 section 3.4).
More crons do not help: GitHub gives every scheduled workflow here roughly one run per 4-6 h whatever its cron.

WHAT. Every 15 min, for each lane below: find the lane's most recent cron slot; if it passed more than GRACE_MIN ago,
no run of the workflow has been CREATED since it, and none is queued or running, POST a `workflow_dispatch` for
`dev`. Otherwise do nothing, so a slot GitHub does honour is never doubled and a run already in flight is never
stacked. The slots are the workflow files' own crons (pinned by tests/test_workflow_dispatch.py, so the two
cannot drift apart), and each workflow's concurrency group still serialises whatever does get queued.

DARK UNTIL THE OWNER SUPPLIES A TOKEN. Nothing happens unless GITHUB_DISPATCH_TOKEN is set in the environment: a
fine-grained token scoped to this repository only, with Actions read and write and nothing else. The token is
read from the environment on every call, sent only to api.github.com, and never logged. Kill switch even with a
token set: WORKFLOW_DISPATCH=0. Repository: GITHUB_DISPATCH_REPO (defaults to this repo).
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

API = "https://api.github.com"
DEFAULT_REPO = "dpritzker0905-cmd/Raw-Surf-Antigravity"
REF = "dev"
GRACE_MIN = 30          # GitHub's own on-time runs start within minutes; past this the slot is late or dropped
INTERVAL_MIN = 15       # how often the scheduler asks
ACTIVE = {"queued", "in_progress", "waiting", "requested", "pending"}

# workflow file -> (cron minute field, cron hour field): the SAME strings as the file's `schedule:` entry.
LANES: Dict[str, Tuple[str, str]] = {
    "forecast-ingest.yml": ("15", "*/4"),
    "forecast-ingest-pilots.yml": ("45", "3,11,19"),
    "mop-nearshore-ingest.yml": ("40", "*/6"),
    "data-health-monitor.yml": ("*/30", "*"),
}
MONITOR = 'data-health-monitor.yml'
MONITOR_GRACE_MIN = 5  # A 30min grace can never expire before this lane's next slot.
MONITOR_COMPLETION_MAX_MIN = 120

_last: Dict[str, dict] = {}   # workflow -> the latest decision, for /api/health


def _field(expr: str, lo: int, hi: int) -> List[int]:
    """Expand one cron field of the forms '*', 'N', 'a,b', 'a-b', '*/s', 'a-b/s'. PURE."""
    out = set()
    for part in str(expr).split(","):
        rng, _, step = part.partition("/")
        if rng == "*":
            a, b = lo, hi
        elif "-" in rng:
            a, b = (int(x) for x in rng.split("-"))
        else:
            a = b = int(rng)
        out.update(range(a, b + 1, int(step) if step else 1))
    return sorted(out)


def daily_slots(minute_expr: str, hour_expr: str) -> List[int]:
    """Minutes-of-day a daily cron fires at. PURE."""
    return sorted(h * 60 + m for h in _field(hour_expr, 0, 23) for m in _field(minute_expr, 0, 59))


def last_slot(now: datetime, slots: Iterable[int]) -> datetime:
    """The most recent slot at or before `now` (yesterday's last one before today's first). PURE."""
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    past = [day + timedelta(minutes=m) for m in slots if day + timedelta(minutes=m) <= now]
    if past:
        return max(past)
    return day - timedelta(days=1) + timedelta(minutes=max(slots))


def _dt(iso) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def decide(runs: List[dict], now: datetime, slots: Iterable[int], grace_min: int = GRACE_MIN) -> Tuple[bool, str]:
    """(dispatch?, why) from the workflow's recent runs (GitHub's `workflow_runs`: status, created_at). PURE."""
    slot = last_slot(now, list(slots))
    stamp = slot.strftime("%H:%MZ")
    if now - slot < timedelta(minutes=grace_min):
        return False, f"slot {stamp} is {int((now - slot).total_seconds() // 60)} min old: GitHub may still fire it"
    for r in runs or []:
        if r.get("status") in ACTIVE:
            return False, f"run {r.get('id')} is {r.get('status')}"
    for r in runs or []:
        created = _dt(r.get("created_at"))
        if created is not None and created >= slot:
            return False, f"slot {stamp} served by run {r.get('id')} ({r.get('event')}, {r.get('created_at')})"
    return True, f"slot {stamp} passed {int((now - slot).total_seconds() // 60)} min ago with no run"


def enabled() -> bool:
    return bool(os.environ.get("GITHUB_DISPATCH_TOKEN")) and os.environ.get("WORKFLOW_DISPATCH", "1") != "0"


def _headers() -> dict:
    return {"Authorization": f"Bearer {os.environ.get('GITHUB_DISPATCH_TOKEN', '')}",
            "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "raw-surf-workflow-dispatch"}


def _monitor_completion(runs, now):
    """A dispatch ACK is not a completed health check, nor evidence of healthy data."""
    completed = []
    for run in runs:
        if run.get('status') != 'completed':
            continue
        stamp = _dt(run.get('updated_at') or run.get('created_at'))
        if stamp is not None and stamp.tzinfo is not None and stamp <= now:
            completed.append(stamp)
    latest = max(completed, default=None)
    age = (now - latest).total_seconds() / 60 if latest else None
    return {'last_completed_at': latest.isoformat().replace('+00:00', 'Z') if latest else None,
            'last_completed_age_min': round(age, 1) if age is not None else None,
            'completion_overdue': age is None or age > MONITOR_COMPLETION_MAX_MIN}


def run_once(now: Optional[datetime] = None, http=None) -> Dict[str, dict]:
    """One pass over every lane. Never raises: a lane that cannot be read is skipped and says why."""
    if not enabled():
        return {}
    if http is None:
        import requests as http
    now = now or datetime.now(timezone.utc)
    repo = os.environ.get("GITHUB_DISPATCH_REPO", DEFAULT_REPO)
    out = {}
    for wf, (minute, hour) in LANES.items():
        base = f"{API}/repos/{repo}/actions/workflows/{wf}"
        try:
            resp = http.get(f"{base}/runs", headers=_headers(), params={"per_page": 10}, timeout=20)
            if resp.status_code != 200:
                raise RuntimeError(f"runs listing HTTP {resp.status_code}")
            runs = resp.json().get("workflow_runs") or []
            grace = MONITOR_GRACE_MIN if wf == MONITOR else GRACE_MIN
            fire, why = decide(runs, now, daily_slots(minute, hour), grace_min=grace)
            if fire:
                post = http.post(f"{base}/dispatches", headers=_headers(), json={"ref": REF}, timeout=20)
                if post.status_code != 204:
                    raise RuntimeError(f"dispatch HTTP {post.status_code}")
                why = "DISPATCHED: " + why
            out[wf] = {"dispatched": fire, "why": why}
            if wf == MONITOR:
                out[wf].update(_monitor_completion(runs, now))
                if out[wf]['completion_overdue']:
                    logger.error('[workflow-dispatch] Health monitor has no completed check within %s min; '
                                 'a dispatch ACK does not clear this condition.', MONITOR_COMPLETION_MAX_MIN)
        except Exception as e:                                          # noqa: BLE001 — one lane, never the pass
            out[wf] = {"dispatched": False, "why": f"error: {type(e).__name__}: {str(e)[:120]}"}
        out[wf]["at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        (logger.warning if out[wf]["dispatched"] else logger.info)(f"[workflow-dispatch] {wf}: {out[wf]['why']}")
    _last.update(out)
    return out


def status() -> dict:
    """For /api/health: armed or not, and each lane's latest decision. Never includes the token."""
    return {"armed": enabled(), "lanes": sorted(LANES), "last": dict(_last)}
