"""Read-only Render events probe -- closes OPEN_EVIDENCE_GAPS G-01.

Question: has the serve box been oomKilled, and specifically since the load-time-stride deploy?

The key is read from backend/.env and NEVER printed, logged, or included in any output. Only
GET requests are made -- no service is modified, no deploy is triggered.
"""
import json
import os
import re
import urllib.error
import urllib.request
from collections import Counter

ENV = r"C:\Users\dprit\Raw-Surf\backend\.env"


def api_key():
    for line in open(ENV, encoding="utf-8", errors="replace"):
        m = re.match(r"\s*RENDER_API_KEY\s*=\s*(.+)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    raise SystemExit("RENDER_API_KEY not found")


KEY = api_key()


def get(path):
    req = urllib.request.Request(
        "https://api.render.com/v1" + path,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # NEVER echo the request headers -- only the status and a short body snippet.
        return {"_http_error": e.code, "_body": e.read().decode()[:200]}


def main():
    svcs = get("/services?limit=50")
    if isinstance(svcs, dict) and svcs.get("_http_error"):
        print("  services: HTTP", svcs["_http_error"], svcs["_body"][:120])
        return
    rows = [s.get("service", s) for s in svcs] if isinstance(svcs, list) else []
    print("=== services visible to this key ===")
    target = None
    for s in rows:
        nm, sid, typ = s.get("name"), s.get("id"), s.get("type")
        print(f"   {sid}  {typ:<14} {nm}")
        if nm and "antigravity" in nm.lower() and typ == "web_service":
            target = sid
    if not target and rows:
        target = rows[0].get("id")
    if not target:
        print("  no service found")
        return

    print(f"\n=== events for {target} (most recent 100) ===")
    ev = get(f"/services/{target}/events?limit=100")
    if isinstance(ev, dict) and ev.get("_http_error"):
        print("  events: HTTP", ev["_http_error"], ev["_body"][:150])
        return
    items = [e.get("event", e) for e in ev] if isinstance(ev, list) else []
    kinds = Counter(e.get("type") for e in items)
    print("  event types:", dict(kinds))

    print("\n=== FAILURES / RESTARTS, newest first ===")
    interesting = [e for e in items if e.get("type") in
                   ("server_failed", "service_suspended", "deploy_ended", "deploy_started")]
    oom = 0
    for e in interesting[:40]:
        d = e.get("details") or {}
        reason = d.get("reason") or {}
        rn = reason.get("nonZeroExit") or reason.get("oomKilled") or reason
        flag = ""
        s = json.dumps(reason)
        if "oom" in s.lower():
            oom += 1
            flag = "   <== OOM KILLED"
        if e.get("type") in ("server_failed", "service_suspended"):
            print(f"  {e.get('timestamp','?')}  {e.get('type'):<18} {json.dumps(rn)[:90]}{flag}")

    print(f"\n=== VERDICT ===")
    print(f"  oomKilled events in the last 100 events: {oom}")
    fails = [e for e in items if e.get("type") == "server_failed"]
    if fails:
        print(f"  server_failed events: {len(fails)}   newest: {fails[0].get('timestamp')}")
        print(f"                                    oldest: {fails[-1].get('timestamp')}")
    else:
        print("  server_failed events: 0 in this window")
    deploys = [e for e in items if e.get("type") == "deploy_ended"]
    if deploys:
        print(f"  deploy_ended: {len(deploys)}   newest: {deploys[0].get('timestamp')}")


if __name__ == "__main__":
    main()
