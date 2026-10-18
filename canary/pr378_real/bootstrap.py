"""Unpack and verify only the immutable #378 Python source used by this canary."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

HERE = Path(__file__).resolve().parent
BASE = '6fbf439ac2bb2da5337f9a45864ffd3af8be8423'
SOURCE_SHA256 = '4292087f9952686dac7a458845789864653284058bdb7273b29794c46c6f4df2'


def prepare():
    pins = json.loads((HERE / 'source-pins.json').read_text())
    archive = HERE / 'source.tar.gz'
    if (pins['base_commit'] != BASE or pins['archive_sha256'] != SOURCE_SHA256 or
            hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256):
        raise RuntimeError('Pinned source archive identity mismatch')
    root = HERE / '_pinned'
    root.mkdir(exist_ok=True)
    with tarfile.open(archive) as tf:
        members = tf.getmembers()
        if {m.name for m in members} != set(pins['files']):
            raise RuntimeError('Unexpected pinned source archive members')
        for member in members:
            if not member.isfile() or '..' in Path(member.name).parts or Path(member.name).is_absolute():
                raise RuntimeError('Unsafe pinned source path')
            target = root / member.name
            content = tf.extractfile(member).read()
            if hashlib.sha256(content).hexdigest() != pins['files'][member.name]['sha256']:
                raise RuntimeError('Pinned source member mismatch')
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or target.read_bytes() != content:
                target.write_bytes(content)
    for rel, metadata in pins['files'].items():
        if hashlib.sha256((root / rel).read_bytes()).hexdigest() != metadata['sha256']:
            raise RuntimeError('Extracted pinned source mismatch')
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(root / 'backend'))
    return root / 'backend', pins


if __name__ == '__main__':
    root, pins = prepare()
    print(json.dumps({'base_commit': BASE, 'verified_python_files': len(pins['files']), 'root': str(root)}))
