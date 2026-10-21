#!/usr/bin/env bash
# The in-runner weather backend for CI (2026-10-21, owner: "move the CI load off the live server").
#
#   bash frontend/scripts/offline-backend/ci_weather_backend.sh start   # from the repo root, backend deps installed
#   bash frontend/scripts/offline-backend/ci_weather_backend.sh wait [tries]
#
# `start` launches serve_synthetic.py in the background and returns at once: building the synthetic store takes ~3-4 min
# (every model and marine layer + wind, 3-hourly to 336 h, the Florida 0.25-deg tile, ~2 GB), so the caller overlaps it
# with `npm ci` and the browser install. `wait` polls /api/weather/capabilities and FAILS the job (with the server log)
# if it never answers: a job that silently fell back to the live box would defeat the point.
# The store mirrors production's tiers (see README.md); --dynamic 1 answers narrow zoomed viewports from the same
# synthetic field. The server blocks every outbound name lookup, so it cannot reach a provider, bucket or database.
set -euo pipefail

PORT="${SYNTH_WEATHER_PORT:-4100}"
DIR="${SYNTH_WEATHER_DIR:-/tmp/synthetic-weather-store}"
LOG="${SYNTH_WEATHER_LOG:-/tmp/synthetic-weather.log}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  start)
    nohup python "$HERE/serve_synthetic.py" --dir "$DIR" --port "$PORT" \
      --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind \
      --regions florida_east_coast --dynamic 1 > "$LOG" 2>&1 &
    echo "synthetic weather backend starting (pid $!) on 127.0.0.1:$PORT; store: $DIR; log: $LOG"
    ;;
  wait)
    tries="${2:-120}"
    for i in $(seq 1 "$tries"); do
      if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$PORT/api/weather/capabilities"; then
        echo "synthetic weather backend answering on 127.0.0.1:$PORT (poll $i)"
        head -1 "$LOG" || true
        exit 0
      fi
      sleep 5
    done
    echo "::error::the in-runner synthetic weather backend never answered on 127.0.0.1:$PORT; weather requests would fail (they are never sent to the live box)"
    tail -60 "$LOG" || true
    exit 1
    ;;
  *)
    echo "usage: $0 start|wait [tries]" >&2
    exit 2
    ;;
esac
