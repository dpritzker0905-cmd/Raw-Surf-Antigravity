import sys, os, threading, json
TARGETS = {"viewport_upstream.py", "viewport_service.py", "surf_rating.py"}
hits = {}
def local_tracer(frame, event, arg):
    if event == "line":
        b = os.path.basename(frame.f_code.co_filename)
        hits.setdefault(b, set()).add(frame.f_lineno)
    return local_tracer
def global_tracer(frame, event, arg):
    b = os.path.basename(frame.f_code.co_filename)
    if b in TARGETS:
        hits.setdefault(b, set()).add(frame.f_lineno)
        return local_tracer
    return None
threading.settrace(global_tracer)
sys.settrace(global_tracer)
import pytest
code = pytest.main(sys.argv[1:])
sys.settrace(None); threading.settrace(None)
out = {k: sorted(v) for k, v in hits.items()}
with open(os.environ["TRACE_OUT"], "w") as f:
    json.dump(out, f)
print("EXIT", code)
for k in sorted(out):
    print("TRACED", k, "lines_executed=", len(out[k]))
