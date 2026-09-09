"""Exercise the real monitor CLI over localhost HTTP, then replay with HTTP stopped."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = Path(__file__).resolve().parent
BACKEND = OUT.parents[1] / 'backend'
NOW = '2026-09-08T12:00:00+00:00'
state = {'error': 0.1}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path.endswith('/api/health'):
            value = {'version': 'SYNTHETIC-HTTP-CONTROL'}
        elif self.path.endswith('/api/weather/buoy-calibration'):
            value = {'available': True, 'generated_at': NOW,
                     'summary': {'height_mae_m': 0.2, 'height_n': 60, 'height_bias_m': 0},
                     'forecast_skill_ops': {'ledgered': 600, 'scored': 300,
                                            'pending_kept': 500, 'pending_evicted_cap': 0}}
        elif '/history/' in self.path:
            value = [{'buoy_time': NOW}]
        else:
            value = [{'source': source, 'buoy_id': str(i), 'target_time': NOW,
                      'lead_h': 24, 'err_m': error, 'hs_m': 1 + error,
                      'obs_time': NOW, 'obs_hs_m': 1.0}
                     for i in range(220)
                     for source, error in [('raw_surf', state['error']), ('persistence', 0.2)]]
        raw = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
base = 'http://127.0.0.1:%d' % server.server_port
env = dict(os.environ, SUPABASE_URL=base, SUPABASE_SERVICE_ROLE_KEY='SYNTHETIC-SECRET-NOT-FOR-OUTPUT',
           ACCURACY_PAIRED_GATE='1')
results = {}
try:
    for label, error, expected in [('healthy', 0.1, 0), ('paired_loss', 0.3, 1)]:
        state['error'] = error
        directory = OUT / ('http-control-' + label)
        run = subprocess.run([sys.executable, 'scripts/forecast_accuracy_monitor.py', '--base', base,
                              '--as-of', NOW, '--evidence-dir', str(directory)],
                             cwd=BACKEND, env=env, capture_output=True, text=True)
        assert run.returncode == expected, run.stdout + run.stderr
        assert all('SYNTHETIC-SECRET-NOT-FOR-OUTPUT' not in f.read_text() for f in directory.iterdir())
        results[label] = {'monitor_exit': run.returncode}
finally:
    server.shutdown()
    server.server_close()
    thread.join()

for label in results:
    directory = OUT / ('http-control-' + label)
    replay = subprocess.run([sys.executable, '-m', 'scripts.accuracy_evidence', str(directory)],
                            cwd=BACKEND, capture_output=True, text=True)
    assert replay.returncode == 0 and 'REPLAY VERIFIED' in replay.stdout, replay.stderr
    results[label]['offline_replay_verified'] = True
    with (directory / 'inputs.json').open('a') as f:
        f.write(' ')
    corrupt = subprocess.run([sys.executable, '-m', 'scripts.accuracy_evidence', str(directory)],
                             cwd=BACKEND, capture_output=True, text=True)
    assert corrupt.returncode != 0 and 'hash mismatch' in corrupt.stderr
    results[label]['tampering_rejected'] = True
(OUT / 'independent-accuracy-result.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
