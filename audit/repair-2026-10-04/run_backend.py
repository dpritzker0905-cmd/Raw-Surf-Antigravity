"""Offline targeted test runner; avoids unrelated route-package initialization."""
import os
import faulthandler
from pathlib import Path
import secrets
import socket
import sys
import types
from sqlalchemy.engine import URL

ROOT = Path(__file__).resolve().parents[2]
faulthandler.dump_traceback_later(20, repeat=False)
os.chdir(ROOT / "backend")
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = str(URL.create("sqlite+aiosqlite", database=":memory:"))
os.environ["SECRET_KEY"] = secrets.token_urlsafe(48)
for key in list(os.environ):
    if key.startswith(("SUPABASE_", "STRIPE_", "RESEND_", "CLOUDINARY_", "REACT_APP_BACKEND_URL")):
        os.environ.pop(key)
sys.path.insert(0, str(ROOT / "backend"))
routes = types.ModuleType("routes")
routes.__path__ = [str(ROOT / "backend/routes")]
sys.modules["routes"] = routes
# Gallery's aggregate imports unrelated integrations; load the selected real modules.
gallery = types.ModuleType("routes.gallery")
gallery.__path__ = [str(ROOT / "backend/routes/gallery")]
sys.modules["routes.gallery"] = gallery
original_connect = socket.socket.connect


def offline_connect(self, address):
    if isinstance(address, tuple) and address[0] in ("127.0.0.1", "::1"):
        return original_connect(self, address)  # Windows asyncio self-pipe only.
    raise AssertionError("External network forbidden during offline tests")


socket.socket.connect = offline_connect
if "--baseline" in sys.argv:
    import importlib
    import subprocess
    sys.argv.remove("--baseline")
    for name in ["routes.surfer_gallery.gallery_core", "routes.surfer_gallery.claims", "routes.surfer_gallery.schemas",
                 "routes.gallery.gallery_purchases", "routes.surfer_gallery.selection"]:
        module = importlib.import_module(name)
        path = "backend/" + name.replace(".", "/") + ".py"
        source = subprocess.check_output(["git", "show", "a2213ee9:" + path], cwd=ROOT, text=True, encoding="utf-8")
        exec(compile(source, path, "exec"), module.__dict__)
import pytest

sys.exit(pytest.main(sys.argv[1:] + ["-q", "--tb=short", "-p", "no:cacheprovider"]))
