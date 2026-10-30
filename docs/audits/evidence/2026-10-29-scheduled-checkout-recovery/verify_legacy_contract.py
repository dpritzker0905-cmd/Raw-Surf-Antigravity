"""Retain the previous 18 scheduled checks, updating only superseded recovery assertions in memory.

The original harness remains unchanged. Its two old checks require raw errors
and unconditional expiry even for an uncertain commit; that is the repaired gap.
"""
from pathlib import Path
source_path=Path(__file__).resolve().parents[1]/'2026-10-28-scheduled-checkout-repair/verify_checkout.py'
source=source_path.read_text(encoding='utf-8')
old=''' except Exception as e:assert 'Synthetic local commit failure' in str(e),'Original local failure must be preserved'
 else:raise AssertionError('Commit failure accepted')
 unchanged();assert provider.expired==['cs_fixture_1']
 print('PASS local commit failure rolls back reservation; expiry attempted; original failure preserved'+(' when expiry also fails' if expire_fails else ''))'''
new=''' except HTTPException as e:assert e.status_code==409 and e.headers.get('X-Checkout-Recovery')=='review-required'
 else:raise AssertionError('Uncertain commit accepted')
 unchanged();assert not provider.expired
 print('PASS uncertain commit rolls back local staged state; explicit review409; no provider expiry')'''
assert source.count(old)==1
exec(compile(source.replace(old,new),str(source_path),'exec'),dict(__file__=str(source_path),__name__='__main__'))
