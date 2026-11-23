"""The served-frame decoder bridge (gate served-wave-verify-v1 section 4): the client's `decodeFieldCore`, run in Node.

The sampler never decodes a frame in Python: a second decoder would be a second thing to keep in sync with what the map
draws. `decode_frames` writes the gzipped frames to a temp folder and runs `backend/scripts/served_wave_decode.mjs`, which
imports `frontend/src/components/map/ownRasterDecode.js` UNCHANGED. `decoder_version` is that file's git blob SHA (the
SHA git gives the committed file: `git hash-object` of its LF text), so a decoder change starts a new scoring segment.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
DECODER_JS = REPO_ROOT / "frontend" / "src" / "components" / "map" / "ownRasterDecode.js"
BRIDGE_MJS = REPO_ROOT / "backend" / "scripts" / "served_wave_decode.mjs"
HEIGHT, DIRECTION, PERIOD = 0, 1, 2          # frame_binary field ids the wave sets carry
WAVE_FIELDS = (HEIGHT, DIRECTION, PERIOD)


def decoder_version(path=DECODER_JS):
    """git blob SHA-1 of the decoder file (text normalised to LF, as git stores it)."""
    data = Path(path).read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()


def node_binary():
    exe = shutil.which("node")
    if not exe:
        raise RuntimeError("node is not on PATH: the served-wave sampler decodes with the client's own decoder in Node")
    return exe


def decode_frames(items, decoder=DECODER_JS, timeout=300):
    """items: [{"gz": bytes, "fields": [...], "nodes": [...], "mask": bool}] -> the bridge's result items, in order, with
    "mask" turned into a bool numpy array (or None)."""
    with tempfile.TemporaryDirectory(prefix="swv-decode-") as tmp:
        job = []
        for i, it in enumerate(items):
            p = os.path.join(tmp, f"f{i}.bin")
            with open(p, "wb") as f:
                f.write(it["gz"])
            job.append({"file": p, "fields": list(it.get("fields", WAVE_FIELDS)), "nodes": [int(k) for k in it.get("nodes", [])],
                        "mask": bool(it.get("mask"))})
        proc = subprocess.run([node_binary(), str(BRIDGE_MJS), str(decoder)], input=json.dumps({"items": job}),
                              capture_output=True, text=True, timeout=timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"decoder bridge exit {proc.returncode}: {proc.stderr.strip()[:400]}")
        out = json.loads(proc.stdout)["items"]
    for o in out:
        h = o.get("header")
        if o.get("mask") is not None and h:
            bits = np.unpackbits(np.frombuffer(base64.b64decode(o["mask"]), dtype=np.uint8), bitorder="big")
            o["mask"] = bits[: h["cols"] * h["rows"]].astype(bool)
        o["values"] = {int(k): v for k, v in (o.get("values") or {}).items()}
        o["present"] = {int(k): v for k, v in (o.get("present") or {}).items()}
    return out
