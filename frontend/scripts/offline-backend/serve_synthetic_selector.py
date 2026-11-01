"""serve_synthetic.py on asyncio's SELECTOR loop (Windows), same arguments.

2026-10-28 (the erratic fuzzer): under a browser's request fan-out the default Proactor loop's accept() died on WinError 64
("The specified network name is no longer available") and never recovered: the process stayed up and stopped answering.
uvicorn 0.25 keeps an event-loop policy set before it starts (it sets one itself only for subprocess workers).

    python frontend/scripts/offline-backend/serve_synthetic_selector.py --dir <store> --port 4120 ...
"""
import asyncio
import runpy
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
sys.argv = ["serve_synthetic.py"] + sys.argv[1:]
runpy.run_path(str(Path(__file__).with_name("serve_synthetic.py")), run_name="__main__")
