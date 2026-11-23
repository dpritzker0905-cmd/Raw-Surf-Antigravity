"""switch_scan.py - every 0/1 switch and lane setting, found by SCANNING the code and the workflows (P0-3, 2026-11-23).

WHY: the admin flag board listed only `_RATING_FLAGS` (138 hand-written rows) and showed "Off, code default" for flags
the ingest lanes run ON (GFS_WORLD_FULL_HORIZON, ECMWF_WAVE_LAND_CENTRE_BLOCK, MARINE_EXT_CEILING_MARGIN_H via repo
variables; MANIFEST_PUBLISH_ONE_STEP as a literal '1' in four workflows). 144 code-read switches and 25 of 32 repo
variables were not listed at all. A hand-kept list drifts; a scan cannot miss a name it can see, and
`tests/test_switch_scan_parity.py` fails when a read the scan cannot see appears.

WHAT IT FINDS (pure: standard library, no project imports, no network; the CI snapshot runs it by path too):
  * code reads: `os.environ.get("NAME", "<default>")`, `os.getenv(...)`, `environ.get(...)`, `os.environ["NAME"]`,
    and the guarded reads `flag("NAME")` / `on("NAME")` (runtime_flags; their default is runtime_flags.GUARDED).
    A name is a SWITCH when a literal default is '0' or '1', a SETTING when it is a number. Other env reads (hosts,
    paths, model names) are not switches and are not listed.
  * workflow lanes: every `NAME: <value>` line in `.github/workflows/*.yml` whose value is a literal, a repo variable
    (`${{ vars.X || 'fallback' }}`) or another expression, for a name that is a code switch or reads a repo variable.

NEVER A SECRET: a name with a credential word in it (KEY, SECRET, TOKEN, PASSWORD, URL, DSN, ...) is dropped before
anything else, and a workflow line that mentions `secrets.` is never recorded. Values are only ever 0/1, numbers or
boolean words (`safe_value`, default-deny); anything else is shown as "(not shown)".
"""
from __future__ import annotations

import os
import re
from typing import Dict, Iterable, List, Optional

SECRET_WORDS = frozenset({"KEY", "SECRET", "SECRETS", "TOKEN", "TOKENS", "PASSWORD", "PASS", "PASSWD", "PWD",
                          "DSN", "URL", "URI", "CREDENTIAL", "CREDENTIALS", "SALT", "CERT", "PRIVATE", "COOKIE",
                          "SESSION", "SIGNING", "WEBHOOK", "AUTHORIZATION", "BEARER", "JWT", "HOST", "EMAIL"})
SKIP_DIRS = frozenset({"tests", "test", "node_modules", "__pycache__", ".venv", "venv", "site-packages", "_archive"})
_NAME = r"([A-Z][A-Z0-9_]{2,})"
_READ = re.compile(r"(?:\bos\.environ\.get|\bos\.getenv|\benviron\.get|\b_?rf\.flag|\bruntime_flags\.flag|\b_?rf\.on"
                   r"|\bruntime_flags\.on)\(\s*[\"']" + _NAME + r"[\"']\s*(?:,\s*[\"']([^\"'\n]{0,40})[\"'])?")
# Project helpers that read the environment by a literal name: env_int / env_float / env_positive_int, _env_int,
# _env_hours, _env_f, _env_number, _env, _flag, _sim_flag ... (their first argument is the variable's name).
_HELPER = re.compile(r"\b(_?env_[a-z_]+|_env[a-z_]*|_?[a-z_]*_flag|_flag)\(\s*[\"']" + _NAME + r"[\"']\s*"
                     r"(?:,\s*(?:default\s*=\s*)?[\"']?([^,\"'\)\s]{0,40})[\"']?)?")
_NUMERIC_HELPER = re.compile(r"int|float|number|hours|_f$|_s$")
_INDEX = re.compile(r"\bos\.environ\[\s*[\"']" + _NAME + r"[\"']\s*\]")
_WF_LINE = re.compile(r"^\s+" + _NAME + r":\s*(.+?)\s*$")
_VAR = re.compile(r"vars\.([A-Z][A-Z0-9_]{2,})\b")
_VAR_FALLBACK = re.compile(r"^\$\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\|\s*[\"']([^\"']*)[\"'])?\s*\}\}$")
_NUMBER = re.compile(r"^-?\d+(?:\.\d+)?$")
_BOOL = {"true": "1", "false": "0", "True": "1", "False": "0"}      # getenv("X", "false") reads as a switch
# DEFAULT-DENY (design review 2026-11-23, SubQ / Reflection / LongCat): a credential can hide under a benign name and
# look like a plain token, so only values a switch or setting can take are ever shown: 0/1, a number, or one of a few
# boolean words. Anything else (a word, a token, a host) is "set, not shown".
_SAFE = re.compile(r"^(?:-?\d+(?:\.\d+)?|true|false|True|False|TRUE|FALSE|on|off|yes|no)$")


def is_secret_name(name: str) -> bool:
    """True when any underscore-separated word of `name` is a credential word (FRAME_WIND_GFS_HOURLY is not: HOURLY
    is one word)."""
    return any(w in SECRET_WORDS for w in str(name).upper().split("_"))


def safe_value(value) -> Optional[str]:
    """The value as shown in the admin: 0/1, a number or a boolean word; None for anything else (never shown)."""
    if value is None:
        return None
    s = str(value)
    return s if _SAFE.match(s) else None


def _strip_comment(v: str) -> str:
    out, q = [], None
    for i, ch in enumerate(v):
        if q:
            if ch == q:
                q = None
        elif ch in "'\"":
            q = ch
        elif ch == "#" and (i == 0 or v[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).strip()


def _unquote(v: str) -> str:
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def classify_lane_value(raw: str) -> Optional[dict]:
    """One workflow `NAME: value` right-hand side -> {form, value|var, fallback}; None for a secret or an empty line."""
    v = _strip_comment(raw)
    if not v or "secrets." in v or v in ("|", ">", "|-", ">-"):
        return None
    m = _VAR_FALLBACK.match(v)
    if m:
        return {"form": "var", "var": m.group(1), "fallback": m.group(2) if m.group(2) is not None else ""}
    if "${{" in v:
        vs = sorted(set(_VAR.findall(v)))
        return {"form": "expr", "vars": vs, "value": None}
    lit = _unquote(v)
    return {"form": "literal", "value": safe_value(lit)}


def _py_files(root: str) -> Iterable[str]:
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        for f in sorted(files):
            if f.endswith(".py") and not f.startswith("test_"):
                yield os.path.join(d, f)


def scan_code(backend_dir: str, guarded: Optional[Dict[str, str]] = None) -> Dict[str, dict]:
    """{name: {defaults: [...], files: [...]}} for every literal env read under `backend_dir` (tests excluded)."""
    guarded = guarded or {}
    out: Dict[str, dict] = {}
    for path in _py_files(backend_dir):
        try:
            with open(path, encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
        except OSError:
            continue
        rel = os.path.relpath(path, os.path.dirname(backend_dir)).replace(os.sep, "/")
        for m in _READ.finditer(text):
            name, default = m.group(1), m.group(2)
            if default is None and name in guarded:
                default = guarded[name]
            rec = out.setdefault(name, {"defaults": set(), "files": set()})
            if default is not None:
                rec["defaults"].add(_BOOL.get(default, default))
            rec["files"].add(rel)
        for m in _HELPER.finditer(text):
            helper, name, default = m.group(1), m.group(2), m.group(3)
            rec = out.setdefault(name, {"defaults": set(), "files": set()})
            if default is not None and (default in _BOOL or _NUMBER.match(default)):
                rec["defaults"].add(_BOOL.get(default, default))
            elif "flag" in helper:
                rec.setdefault("hints", set()).add("switch")
            elif _NUMERIC_HELPER.search(helper):
                rec.setdefault("hints", set()).add("setting")
            rec["files"].add(rel)
        for m in _INDEX.finditer(text):
            out.setdefault(m.group(1), {"defaults": set(), "files": set()})["files"].add(rel)
    return out


def scan_workflows(workflows_dir: str) -> Dict[str, List[dict]]:
    """{name: [{workflow, form, value|var|vars, fallback}]} for every uppercase env-style line in the workflows, plus a
    `gate` row (keyed by the variable's own name) where a repo variable is read outside an env line (a job `if:`)."""
    out: Dict[str, List[dict]] = {}
    if not os.path.isdir(workflows_dir):
        return out
    for f in sorted(os.listdir(workflows_dir)):
        if not f.endswith((".yml", ".yaml")):
            continue
        try:
            with open(os.path.join(workflows_dir, f), encoding="utf-8", errors="ignore") as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        seen = set()
        for line in lines:
            m = _WF_LINE.match(line)
            env_var = None
            if m:
                c0 = classify_lane_value(m.group(2))
                env_var = (c0 or {}).get("var")
            for v in sorted(set(_VAR.findall(_strip_comment(line)))):   # `if: vars.X == '1'`: the variable GATES a job
                if v != env_var and ("gate", v, f) not in seen:
                    seen.add(("gate", v, f))
                    out.setdefault(v, []).append({"form": "gate", "var": v, "workflow": f})
            if not m:
                continue
            c = classify_lane_value(m.group(2))
            if c is None:
                continue
            key = (m.group(1), tuple(sorted((k, str(v)) for k, v in c.items())))
            if key in seen:
                continue
            seen.add(key)
            out.setdefault(m.group(1), []).append(dict(c, workflow=f))
    return out


def kind_of(defaults: Iterable[str], gate: bool = False) -> Optional[str]:
    """'switch' (a 0/1 default, or a repo variable that gates a job), 'setting' (a number), else None."""
    ds = set(defaults)
    if gate and not ds:
        return "switch"
    if ds & {"0", "1"}:
        return "switch"
    if any(_NUMBER.match(d or "") for d in ds):
        return "setting"
    return None


def build_registry(repo_root: str, guarded: Optional[Dict[str, str]] = None,
                   registered: Optional[Dict[str, str]] = None) -> Dict[str, dict]:
    """The switch registry: {name: {kind, defaults, files, lanes, repo_vars, guarded, registered}}.

    A name is listed when (a) code reads it with a 0/1 or numeric literal default, (b) it is GUARDED or registered in
    `_RATING_FLAGS` (`registered`: name -> code default), or (c) a workflow sets it from a repo variable or sets a
    code switch. Credential-like names are never listed."""
    guarded = guarded or {}
    registered = registered or {}
    code = scan_code(os.path.join(repo_root, "backend"), guarded)
    lanes = scan_workflows(os.path.join(repo_root, ".github", "workflows"))
    names = set()
    for n, rec in code.items():
        if kind_of(rec["defaults"]) or rec.get("hints"):
            names.add(n)
    names |= set(guarded) | set(registered)
    for n, ls in lanes.items():
        if n in names or any(x["form"] in ("var", "gate") for x in ls):
            names.add(n)
    reg: Dict[str, dict] = {}
    for n in sorted(names):
        if is_secret_name(n):
            continue
        rec = code.get(n, {"defaults": set(), "files": set()})
        defaults = set(rec["defaults"])
        if n in guarded:
            defaults.add(guarded[n])
        if n in registered:
            defaults.add(str(registered[n]))
        ls = [x for x in lanes.get(n, []) if not (x["form"] in ("var", "gate") and is_secret_name(x["var"]))]
        rv = sorted({x["var"] for x in ls if x["form"] in ("var", "gate")}
                    | {v for x in ls if x["form"] == "expr" for v in x["vars"]})
        hint = "switch" if "switch" in rec.get("hints", ()) else None
        reg[n] = {"kind": kind_of(defaults, any(x["form"] == "gate" for x in ls)) or hint or "setting",
                  "defaults": sorted(d for d in (safe_value(x) for x in defaults) if d is not None),
                  "files": sorted(rec["files"])[:4], "file_count": len(rec["files"]),
                  "lanes": sorted(ls, key=lambda x: (x["workflow"], x["form"])),
                  "repo_vars": [v for v in rv if not is_secret_name(v)],
                  "guarded": n in guarded, "registered": n in registered}
    return reg


def repo_vars_referenced(workflows_dir: str) -> List[str]:
    """Every `vars.X` name any workflow reads (credential-like names dropped)."""
    out = set()
    if os.path.isdir(workflows_dir):
        for f in os.listdir(workflows_dir):
            if f.endswith((".yml", ".yaml")):
                with open(os.path.join(workflows_dir, f), encoding="utf-8", errors="ignore") as fh:
                    out |= set(_VAR.findall(fh.read()))
    return sorted(v for v in out if not is_secret_name(v))
