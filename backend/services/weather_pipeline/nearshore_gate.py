"""nearshore_gate.py -- the SURF-ZONE GATE: grade the nearshore judge's report (WS-CAN-0076 follow-up).

WHY. The 'Nearshore Validation' workflow grades the served nearshore height against nearshore buoys every six
hours, and until this gate it only PRINTED: no threshold, no warning, no page (audit 12.2, GAP-offshore-vs-nearshore-
validation-estate). The accuracy monitor that pages reads OFFSHORE buoy skill, so a wrong or drifting surf-zone number
could not turn anything yellow or red. `grade_nearshore_gate` reads the report the runner writes
(`nearshore_report.json`, built by `nearshore_validation.build_report`) and gives it a level. The CI wrapper is
`scripts/nearshore_gate_ci.py`; the workflow step runs only after the runner SUCCEEDED (see the workflow header).

PURE: no I/O, no network and no environment reads (the caller injects `env`, None = no overrides, and `today`, None =
the current UTC date). Stdlib only, plus the one integer it must not copy: the runner's graded floor, read at call
time from `nearshore_validation.GRADED_MIN_STATION_HOURS`. The house pattern is forecast_accuracy_monitor.py: RED vs
REFUSE vs WARN, the measured basis printed beside every live value, thresholds tunable, self-expiring grace, and
'blind is never green'.

THE LEVELS (the report is graded on what every report carries, the BULK arm; MOP / NWPS / consensus blocks are ignored):
  REFUSE  the gate is blind: no report (missing, unreadable, not an object), available != true, no integer
          n_station_hours, n_station_hours below the runner's own floor, or no usable per-station n / mae_m.
          Never graced: a green that cannot tell 'healthy' from 'not measured' is the defect this lane had.
          (The floor is in STATION-hours, the honest unit: linked spots share one buoy reading, so n_matched counts
          the same reading up to six times; the runner's header says no sample-size gate may read that number.)
  RED     only AFTER the grace date (NEARSHORE_GATE_GRACE, default 2026-11-15, strictly after it; the date arms the
          gate, no person does): the n-weighted aggregate MAE over every matched spot-hour above NEARSHORE_GATE_MAE_RED,
          or the observed/modelled median outside the RED band. Before the grace date the same breach is a WARN.
  WARN    (exit 0, never a page) a STANDING product condition, not an incident: observed/modelled median outside the
          WARN band, with a plain sentence ('the served surf height runs N percent low against nearshore buoys') and the
          worst stations; fewer than NEARSHORE_GATE_MIN_STATIONS distinct stations graded; a ratio the report does not
          carry; and any override of the thresholds that could not be read (named, the default used).
  OK      none of the above.
The kill switch NEARSHORE_GATE=0 returns a disabled Gate (no lines, no summary, exit 0): today's behaviour exactly.

THRESHOLDS AND THEIR MEASURED BASIS (provisional: ONE reading, and these are meant to be re-tuned once a week of
reports has been read, the way the accuracy monitor's were):
  NEARSHORE_GATE_MAE_RED        0.32 m   Aggregate MAE 0.162 m (station geometry; per-station 0.11-0.22 m) on hosted
                                         run 38982682625 (n_matched=183 spot-hours, 96 station-hours). 0.32 is 2x that.
                                         Earlier readings: 0.148 m (2026-09-28, before Kr 0.873 and #146) and 0.139 m
                                         after (SCOREBOARD S3).
  NEARSHORE_GATE_RATIO_WARN_*   0.85-1.15 Observed/modelled median 1.2496 on run 38982682625 (station geometry; 1.261
                                         at the spot's geometry; per-station bias -0.11 to -0.22 m), i.e. the served
                                         number ran about 20 percent low. 1.23 on 2026-09-28 before Kr and #146 and 1.12
                                         after: the band flags the standing bias today and would not have flagged 1.12.
  NEARSHORE_GATE_RATIO_RED_*    0.60-1.60 The 'beyond a plausible standing bias' bound: no recorded reading is above
                                         1.26, so 1.6 (the model reading about 38 percent low) is a drift, not weather.
  NEARSHORE_GATE_MIN_STATIONS   3        The census of 2026-08-16 found 7 of the 20 pair-table stations live and the live
                                         run's per-station spread came from at least two. Fewer than three instruments
                                         cannot separate the transform's error from one buoy's quirk. The station count of
                                         run 38982682625 was not recorded: this floor has the least basis of the five.
  NEARSHORE_GATE_GRACE          2026-11-15 About 30 days after this gate: ~one graded run a day (GitHub drops most cron
                                         slots), so ~30 readings to re-tune from before a breach can page.
ENV_VARS lists every variable the gate reads; the workflow wires each from the repo variable of the same name, and a
blank value is no override. The graded quantity is the transform evaluated at the BUOY's depth (an Hs statistic, no
breaking cap), the one chain the app serves; its sentence says so.
"""
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone

from services.weather_pipeline import nearshore_validation as _nv

OK, WARN, RED, REFUSE = "OK", "WARN", "RED", "REFUSE"

DEFAULT_MAE_RED_M = 0.32
DEFAULT_GRACE = "2026-11-15"
DEFAULT_RATIO_BANDS = (0.6, 0.85, 1.15, 1.6)        # red low, warn low, warn high, red high
DEFAULT_MIN_STATIONS = 3
_BAND_KEYS = ("RED_LOW", "WARN_LOW", "WARN_HIGH", "RED_HIGH")
_WORST_N = 3
ENV_VARS = ("NEARSHORE_GATE", "NEARSHORE_GATE_MAE_RED", "NEARSHORE_GATE_GRACE", "NEARSHORE_GATE_MIN_STATIONS",
            *("NEARSHORE_GATE_RATIO_" + k for k in _BAND_KEYS))       # what the workflow wires from repo variables
_BASIS_MAE = "run 38982682625, n=183 spot-hours: MAE 0.162 m, stations 0.11-0.22 m; red = 2x that; ONE reading, provisional"
_BASIS_RATIO = ("run 38982682625: station geometry 1.2496 (spot geometry 1.261); 2026-09-28 post-Kr 1.12; "
                "ONE reading, provisional")


@dataclass(frozen=True)
class Finding:
    level: str      # WARN | RED | REFUSE
    code: str       # report | mae | ratio | stations | config
    text: str       # one ASCII sentence, no '%' (GitHub workflow commands treat it specially)

    @property
    def line(self) -> str:
        return "GATE %s %s: %s" % (self.level, self.code, self.text)


@dataclass(frozen=True)
class Gate:
    level: str = OK
    lines: tuple = ()               # the log: every line starts with 'GATE'
    findings: tuple = ()            # every non-OK finding, in the order raised
    summary_markdown: str = ""      # for $GITHUB_STEP_SUMMARY
    enabled: bool = True            # False only under the kill switch NEARSHORE_GATE=0

    @property
    def exit_code(self) -> int:
        return 1 if self.level in (RED, REFUSE) else 0

    @property
    def annotations(self) -> tuple:
        """GitHub workflow commands: ::warning:: for WARN, ::error:: for RED and REFUSE."""
        return tuple(("::warning::" if f.level == WARN else "::error::") + f.line for f in self.findings)


def clean(text, limit: int = 200) -> str:
    """ASCII, one line, no '%': GitHub workflow commands decode '%' sequences and end at a newline, and a Windows
    cp1252 console chokes on anything else. Applied to every foreign string (overrides, the runner's reason)."""
    return "".join(c if c.isascii() and c.isprintable() and c != "%" else "?" for c in str(text))[:limit]


def _env_str(env, key: str) -> str:
    v = env.get(key)
    return "" if v is None else str(v).strip()


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _dig(obj, *path):
    for key in path:
        obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def _as_date(v) -> date:
    """A date from a date, a datetime (its UTC date when aware) or an ISO string. ValueError on anything else."""
    if isinstance(v, datetime):
        return (v.astimezone(timezone.utc) if v.tzinfo else v).date()
    if isinstance(v, date):
        return v
    text = str(v).strip()
    try:
        return date.fromisoformat(text)
    except ValueError:
        return _as_date(datetime.fromisoformat(text.replace("Z", "+00:00")))


def _read(report):
    """(facts, None) for a report the gate can grade, or (None, reason) when it is blind."""
    if not isinstance(report, dict):
        return None, "no report: nearshore_report.json is missing or is not a JSON object"
    if report.get("available") is not True:
        return None, "the report says available=false (%s)" % clean(report.get("reason") or "no reason given")
    hours = report.get("n_station_hours")
    if not _is_int(hours):
        return None, "the report carries no usable n_station_hours (%s)" % clean(repr(hours), 60)
    floor = _nv.GRADED_MIN_STATION_HOURS
    if hours < floor:
        return None, "n_station_hours=%d is below the runner's own graded floor %d" % (hours, floor)
    raw = report.get("stations")
    if not isinstance(raw, dict) or not raw:
        return None, "the report carries no per-station errors"
    stations = {}
    for name, s in raw.items():
        if not (isinstance(s, dict) and _is_int(s.get("n")) and s["n"] > 0 and _is_num(s.get("mae_m"))):
            return None, "station %s carries no usable n / mae_m" % clean(name, 40)
        stations[str(name)] = s
    return {"report": report, "n_station_hours": hours, "stations": stations,
            "n_spot": sum(s["n"] for s in stations.values())}, None


def _config(env):
    """(cfg, notes). A blank variable is no override; a bad one falls back to the default AND is named in a note,
    so a typo never silently loosens or hides the gate."""
    notes = []

    def number(key, default, integer=False):
        raw = _env_str(env, key)
        if not raw:
            return default
        try:
            v = float(raw)
        except ValueError:
            v = float("nan")
        if not (math.isfinite(v) and v > 0 and (not integer or v == int(v))):
            notes.append("ignored %s=%s (not a positive %s); using the default %g"
                         % (key, clean(repr(raw), 60), "integer" if integer else "number", default))
            return default
        return int(v) if integer else v

    grace, raw = _as_date(DEFAULT_GRACE), _env_str(env, "NEARSHORE_GATE_GRACE")
    if raw:
        try:
            grace = _as_date(raw)
        except ValueError:
            notes.append("ignored NEARSHORE_GATE_GRACE=%s (not an ISO date); using the default %s"
                         % (clean(repr(raw), 60), DEFAULT_GRACE))
    bands = [number("NEARSHORE_GATE_RATIO_" + k, d) for k, d in zip(_BAND_KEYS, DEFAULT_RATIO_BANDS)]
    if not bands[0] <= bands[1] < bands[2] <= bands[3]:
        notes.append("ignored the ratio bands %s (need RED_LOW <= WARN_LOW < WARN_HIGH <= RED_HIGH); using the defaults %s"
                     % (tuple(bands), DEFAULT_RATIO_BANDS))
        bands = list(DEFAULT_RATIO_BANDS)
    return {"mae_red": number("NEARSHORE_GATE_MAE_RED", DEFAULT_MAE_RED_M), "grace": grace, "bands": bands,
            "min_stations": number("NEARSHORE_GATE_MIN_STATIONS", DEFAULT_MIN_STATIONS, integer=True)}, notes


def _markdown(level: str, lines) -> str:
    body = "\n".join("- " + line[len("GATE "):] for line in lines[:-1])
    return ("### Nearshore surf-zone gate: **%s**\n\n%s\n\n- kill switch: repo variable NEARSHORE_GATE=0\n"
            % (level, body))


def _refuse(reason: str) -> Gate:
    text = ("BLIND (%s). This is refusal, not health and not a measured breach: the surf-zone number may be "
            "fine or broken, nothing can currently say which." % reason)
    finding = Finding(REFUSE, "report", text)
    lines = (finding.line, "GATE verdict REFUSE")
    return Gate(level=REFUSE, lines=lines, findings=(finding,), summary_markdown=_markdown(REFUSE, lines))


def _mae_check(facts, cfg, armed):
    """([log lines], Finding or None): the n-weighted aggregate MAE over every matched spot-hour."""
    mae = round(sum(s["n"] * s["mae_m"] for s in facts["stations"].values()) / facts["n_spot"], 4)
    grace = cfg["grace"].isoformat()
    line = ("GATE mae %.3f m over n=%d spot-hours | red above %g m (WARN until %s, RED after) [basis: %s]"
            % (mae, facts["n_spot"], cfg["mae_red"], grace, _BASIS_MAE))
    if mae <= cfg["mae_red"]:
        return [line], None
    text = "aggregate MAE %.3f m over n=%d spot-hours is above the %g m red bound" % (mae, facts["n_spot"], cfg["mae_red"])
    if armed:
        return [line], Finding(RED, "mae", text + " (grace ended %s). This is an observed threshold breach, not a "
                                                  "diagnosis of its cause: compare station and sea-state cohorts "
                                                  "before attributing it to the transform." % grace)
    return [line], Finding(WARN, "mae", text + ". Inside the grace window this is a WARN; it is RED after %s." % grace)


def _worst(stations):
    """Stations most off first: those with an observed/modelled ratio by distance from 1 (in log, so low and high
    count alike), then those without one by |bias|; ties by name. Top _WORST_N as (name, ratio|None, n, bias|None)."""
    def key(item):
        name, s = item
        r = s.get("obs_over_model_median")
        if _is_num(r) and r > 0:
            return (0, -abs(math.log(r)), name)
        b = s.get("bias_m")
        return (1, -abs(b) if _is_num(b) else 0.0, name)
    out = []
    for name, s in sorted(stations.items(), key=key)[:_WORST_N]:
        r, b = s.get("obs_over_model_median"), s.get("bias_m")
        out.append((clean(name, 40), r if _is_num(r) and r > 0 else None, s["n"], b if _is_num(b) else None))
    return out


def _fmt_worst(worst, sep):
    return sep.join("%s x%s (n=%d, bias %s m)" % (name, "%.3f" % r if r else "?", n, "%+.3f" % b if b is not None else "n/a")
                    for name, r, n, b in worst)


def _ratio_check(facts, cfg, armed):
    """([log lines], Finding or None): which way, and how far, the served number sits from the buoys."""
    report, grace = facts["report"], cfg["grace"].isoformat()
    red_lo, warn_lo, warn_hi, red_hi = cfg["bands"]
    ratio = label = n = None
    for value, rows, name in ((_dig(report, "spot_geometry", "station", "obs_over_model_median"),
                               _dig(report, "spot_geometry", "n"), "graded geometry"),
                              (_dig(report, "obs_over_model", "median"), _dig(report, "obs_over_model", "n"),
                               "all-rows median")):
        if _is_num(value) and value > 0:
            ratio, label, n = float(value), name, rows if _is_int(rows) and rows > 0 else facts["n_spot"]
            break
    if ratio is None:
        text = ("observed/modelled ratio unreadable: the report carries neither spot_geometry.station."
                "obs_over_model_median nor obs_over_model.median, so which way the surf-zone number is biased "
                "is unmeasured.")
        return ["GATE ratio observed/modelled median unreadable"], Finding(WARN, "ratio", text)
    worst = _worst(facts["stations"])
    line = ("GATE ratio observed/modelled median %.3f (n=%d, %s) | warn outside %.2f-%.2f, red outside %.2f-%.2f after %s "
            "[basis: %s]" % (ratio, n, label, warn_lo, warn_hi, red_lo, red_hi, grace, _BASIS_RATIO))
    lines = [line, "GATE stations worst first (by distance from 1): " + _fmt_worst(worst, "; ")]
    if warn_lo <= ratio <= warn_hi:
        return lines, None
    pct, way = (round((1 - 1 / ratio) * 100), "low") if ratio > 1 else (round((1 / ratio - 1) * 100), "high")
    said = ("the served surf height runs %d percent %s against nearshore buoys (observed/modelled median %.3f over "
            "n=%d spot-hours / %d station-hours, graded at the buoys' depth before breaking)"
            % (pct, way, ratio, n, facts["n_station_hours"]))
    tail = "worst stations: " + _fmt_worst(worst, ", ") + "."
    if red_lo <= ratio <= red_hi:
        return lines, Finding(WARN, "ratio", "%s. Standing product condition, not an incident, deliberately not a page: "
                                             "it pages only if the ratio leaves %.2f-%.2f once the grace date %s has passed. %s"
                              % (said, red_lo, red_hi, grace, tail))
    beyond = "%s. This is beyond a plausible standing bias (outside %.2f-%.2f)" % (said, red_lo, red_hi)
    if armed:
        return lines, Finding(RED, "ratio", "%s, and the grace window ended %s. %s" % (beyond, grace, tail))
    return lines, Finding(WARN, "ratio", "%s: a WARN inside the grace window, RED after %s. %s" % (beyond, grace, tail))


def _stations_check(facts, cfg, _armed):
    n = len(facts["stations"])
    if n >= cfg["min_stations"]:
        return [], None
    return [], Finding(WARN, "stations", "only %d distinct station(s) graded (floor %d): the verdict rests on too few "
                                         "instruments (n_station_hours=%d), so one buoy's quirk cannot be told from "
                                         "the transform's error." % (n, cfg["min_stations"], facts["n_station_hours"]))


def grade_nearshore_gate(report, *, env=None, today=None) -> Gate:
    """Grade one nearshore_report.json. `env` is the injected environment (None = no overrides: the CLI passes
    os.environ); `today` is a date, datetime or ISO string (None = the current UTC date)."""
    env = {} if env is None else env
    if _env_str(env, "NEARSHORE_GATE") == "0":
        return Gate(enabled=False)
    facts, reason = _read(report)
    if facts is None:
        return _refuse(reason)
    cfg, notes = _config(env)
    armed = _as_date(datetime.now(timezone.utc) if today is None else today) > cfg["grace"]
    lines = ["GATE nearshore surf-zone gate: n_matched=%d spot-hours, n_station_hours=%d (runner floor %d), stations=%d"
             % (facts["n_spot"], facts["n_station_hours"], _nv.GRADED_MIN_STATION_HOURS, len(facts["stations"]))]
    findings = [Finding(WARN, "config", n) for n in notes]
    for check in (_mae_check, _ratio_check, _stations_check):
        more, finding = check(facts, cfg, armed)
        lines += more
        findings += [finding] if finding else []
    lines += [f.line for f in findings]
    level = RED if any(f.level == RED for f in findings) else WARN if findings else OK
    lines.append("GATE verdict " + level)
    return Gate(level=level, lines=tuple(lines), findings=tuple(findings), summary_markdown=_markdown(level, lines))
