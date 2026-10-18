"""Offline fault injection against our reader; never changes the sealed bundle."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from check_startup import ROOT, environment


def child():
    sys.path.insert(0, str(ROOT))
    from verify_http import check_adapter
    reviewed = 'a' * 40
    check_adapter(reviewed, reviewed)
    for actual, expected in [('unreviewed-arbitrary-commit', reviewed), ('b' * 40, reviewed), (reviewed, 'short')]:
        try:
            check_adapter(actual, expected)
        except AssertionError:
            pass
        else:
            raise AssertionError('Unreviewed adapter accepted')
    from capture_http import bounded_body

    class Body:
        closed = False
        consumed = 0

        def iter_content(self, chunk_size):
            for part in (b'abc', b'def', b'unread'):
                self.consumed += 1
                yield part

        def close(self):
            self.closed = True

    oversized = Body()
    try:
        bounded_body(oversized, 4)
    except RuntimeError:
        assert oversized.closed and oversized.consumed == 2
    else:
        raise AssertionError('Oversized provider body accepted')
    fitting = Body()
    assert bounded_body(fitting, 12) == b'abcdefunread' and fitting.closed
    from fastapi import HTTPException
    from canary.pr378_real import app as reader

    def refused(call):
        try:
            call()
        except HTTPException as exc:
            assert exc.status_code == 503, exc.status_code
        else:
            raise AssertionError('Changed replay was served successfully')

    case, definition = next(iter(reader.receipt['cases'].items()))
    filename = definition['products'][0]
    valid = reader.receipt['products'][filename]['valid_time']
    original = reader.replay_grid(case, valid)
    assert original['sha256'] == reader.file_hashes[filename]
    product = reader.store.load_product(filename)
    vector = next(v for v in product.grid.vectors if v.is_valid)
    old_valid = vector.is_valid
    try:
        # Actual ProductStore shallow copies retain shared vector objects.
        vector.is_valid = False
        assert reader.integrity(), 'Control must leave sealed disk bytes intact'
        refused(lambda: reader.product_bytes(filename))
        refused(lambda: reader.replay_grid(case, valid))
    finally:
        vector.is_valid = old_valid
    assert reader.replay_grid(case, valid) == original
    path = reader.directory / filename
    raw = path.read_bytes()
    try:
        path.unlink()
        refused(reader.healthz)
        refused(lambda: reader.replay_grid(case, valid))
    finally:
        path.write_bytes(raw)
    assert reader.replay_grid(case, valid) == original
    assert reader.identity()['guard'] == '0' and reader.network_attempts == 0
    print(json.dumps({'memory_grid_corruption_refused': True, 'missing_file_refused': True,
                      'unreviewed_adapter_refused': True, 'stream_budget_refusal': True,
                      'restored_positive_control': True, 'guard': '0', 'network_attempts': 0}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--child', action='store_true')
    args = parser.parse_args()
    if args.child:
        child()
        return
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--child'],
                            cwd=ROOT, env=environment(), capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError('Integrity regression failed:\n' + result.stderr)
    report = json.loads(result.stdout.splitlines()[-1])
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
