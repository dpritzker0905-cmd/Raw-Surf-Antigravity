# Not produced by this audit — the good instrument is server-side

Backend peak memory is read live from `/api/health` (`peak_rss_mb` via `ru_maxrss`) and captured in
`../network/health-791fdf78-window.json`: **1231.6 MB of a 2048 MB cgroup limit**.

**No browser heap snapshot was taken.** Recorded as an open item — one deliberate sustained-load run
closes WS-OBJ-303 (VERIFY item V4). ⚠️ The 2026-07-24 incident was diagnosed on a **512 MB** box; any
comparison to it across machines is invalid.
