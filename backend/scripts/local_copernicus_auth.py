"""Opt-in local Marine credentials and private subprocess input transport."""
import json
import os
from pathlib import Path
import subprocess


def enable_local_copernicus(root):
    """Read only the explicitly saved, ignored local Toolbox credential file."""
    root = Path(root).resolve()
    credential = root / ".logfire/copernicus-auth/.copernicusmarine-credentials"
    if not credential.is_file() or any(p.is_symlink() for p in (credential, credential.parent, credential.parent.parent)):
        raise RuntimeError("Marine credential must be a regular local file without symlink parents")
    if subprocess.run(["git", "check-ignore", "-q", "--", str(credential)], cwd=root).returncode:
        raise RuntimeError("Marine credential file must be gitignored")
    if subprocess.check_output(["git", "ls-files", "--", str(credential)], cwd=root).strip():
        raise RuntimeError("Marine credential file must be untracked")
    from copernicusmarine.core_functions.credentials_utils import get_username_password
    username, password = get_username_password(None, None, credential)
    os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = username
    os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = password
    install_private_copernicus_transport()


def install_private_copernicus_transport():
    """Keep the original fetcher and timeout, sending its JSON through stdin."""
    if getattr(subprocess.run, "_local_copernicus_transport", False):
        return
    original = subprocess.run
    entry = str(Path(__file__).with_name("copernicus_stdin_entry.py"))

    def run(args, *positional, **kwargs):
        if (isinstance(args, (list, tuple)) and len(args) >= 4
                and Path(str(args[2])).name in ("copernicus_global_fetcher.py", "copernicus_fetcher.py")):
            # Validate before launch without logging or changing the provider payload.
            json.loads(args[3])
            if "input" in kwargs or "stdin" in kwargs:
                raise RuntimeError("Marine subprocess input is already configured")
            kwargs["input"] = args[3]
            args = [*args[:2], entry, str(args[2]), *args[4:]]
        return original(args, *positional, **kwargs)

    run._local_copernicus_transport = True
    subprocess.run = run
