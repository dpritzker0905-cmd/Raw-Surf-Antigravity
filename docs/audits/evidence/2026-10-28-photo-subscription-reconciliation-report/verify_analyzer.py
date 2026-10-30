"""Disconnected ordinary-export fixtures; imports only the pure analyzer by path."""
import copy
import importlib.util
import json
import sys
from pathlib import Path
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[4]
path = root / 'backend/utils/photo_subscription_reconciliation.py'
spec = importlib.util.spec_from_file_location('photo_subscription_report_fixture', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def base():
    return {'schema_version': 1, 'snapshot': {'id': 'snapshot-1', 'exported_at': '2026-10-28T12:00:00+00:00',
            'source_label': 'synthetic offline export', 'coverage': {}},
        'profiles': [{'id': 'seller-1', 'subscription_tier': 'premium', 'credit_balance': '40',
                      'spend_only_credits': '5', 'withdrawable_credits': '51', 'gear_only_credits': '7'}],
        'subscriptions': [{'id': 'sub-1', 'photographer_id': 'seller-1', 'surfer_id': 'buyer-1',
                           'plan_id': 'plan-1', 'amount_paid': '20', 'payment_method': 'credits'}],
        'payment_transactions': [], 'credit_transactions': [{'id': 'debit-1', 'user_id': 'buyer-1',
            'amount': '-20', 'transaction_type': 'photo_subscription_payment',
            'reference_type': 'photo_subscription_plan', 'reference_id': 'plan-1', 'spend_only_amount': '-15'}]}

def no_corrections(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == 'money_correction': assert item is None
            if key == 'apply_ready': assert item is False
            no_corrections(item)
    elif isinstance(value, list):
        for item in value: no_corrections(item)

def report(payload):
    before = copy.deepcopy(payload)
    answer = module.analyze_export(payload)
    assert payload == before, 'Input mutated'
    assert answer == module.analyze_export(payload), 'Report changed on repeat'
    assert answer['input_digest'] == module.canonical_digest(payload)
    no_corrections(answer)
    return answer

def add_receipt(payload, amount='16'):
    payload['credit_transactions'].append({'id': 'earning-1', 'user_id': 'seller-1',
        'amount': amount, 'spend_only_amount': '0', 'transaction_type': 'photo_subscription_earning',
        'reference_type': 'photo_subscription', 'reference_id': 'sub-1', 'counterparty_id': 'buyer-1'})

def card(payload):
    payload['subscriptions'][0].update(payment_method='card', stripe_session_id='checkout-1')
    payload['payment_transactions'] = [{'id': 'payment-1', 'session_id': 'checkout-1',
        'user_id': 'buyer-1', 'amount': '20', 'currency': 'USD', 'payment_status': 'completed',
        'transaction_metadata': {'type': 'photo_subscription', 'plan_id': 'plan-1', 'photographer_id': 'seller-1'}}]

def claim(payload, amount='16', identity='fee-1'):
    payload.setdefault('historical_fee_evidence', []).append({'id': identity,
        'subscription_id': 'sub-1', 'net_amount': amount, 'currency': 'USD',
        'reviewed': True, 'evidence_ref': 'review-document-1'})

cases = []
def test(name):
    def decorate(fn): cases.append((name, fn)); return fn
    return decorate

@test('single plan debit remains ambiguous and cash excess is diagnostic')
def ordinary():
    result = report(base()); flags = result['cases'][0]['classifications']
    assert {'ledger_missing', 'payment_link_ambiguous', 'historical_fee_unknown'} <= set(flags)
    wallet = result['accounts'][0]['wallet']
    assert wallet['cash_excess'] == '16' and wallet['meaning'] == 'snapshot_diagnostic_not_amount_owed'

@test('linked receipt is recorded once with no new grant')
def present():
    payload = base(); add_receipt(payload); case = report(payload)['cases'][0]
    assert 'ledger_present' in case['classifications'] and case['recorded_net'] == '16'

@test('current tier is ignored for historical fee and net')
def tier():
    payload = base(); first = report(payload); payload['profiles'][0]['subscription_tier'] = 'basic'
    second = report(payload)
    assert first['cases'] == second['cases'] and first['accounts'] == second['accounts']
    assert first['input_digest'] != second['input_digest']

@test('missing table means unknown instead of empty ledger')
def missing():
    payload = base(); del payload['credit_transactions']; result = report(payload)
    assert 'credit_transactions' in result['summary']['unknown_tables']
    assert 'ledger_coverage_unknown' in result['cases'][0]['classifications']
    assert 'ledger_missing' not in result['cases'][0]['classifications']

@test('missing promo snapshot does not default to zero')
def promo_unknown():
    payload = base(); del payload['profiles'][0]['spend_only_credits']; account = report(payload)['accounts'][0]
    assert account['wallet']['cash_excess'] is None and account['wallet']['spend_only_credits'] is None
    assert 'wallet_snapshot_incomplete' in account['classifications']

@test('duplicate profile IDs remain two visible rows')
def duplicates():
    payload = base(); payload['profiles'].append(copy.deepcopy(payload['profiles'][0])); result = report(payload)
    assert len(result['accounts']) == 2
    assert any(f['code'] == 'duplicate_record_id' for f in result['findings'])

@test('duplicate receipt rows are not collapsed')
def duplicate_receipt():
    payload = base(); add_receipt(payload); payload['credit_transactions'].append(copy.deepcopy(payload['credit_transactions'][-1]))
    case = report(payload)['cases'][0]
    assert case['ledger_ids'] == ['earning-1', 'earning-1'] and 'receipt_conflict' in case['classifications']

@test('local completed card remains local assertion')
def local_card():
    payload = base(); card(payload); case = report(payload)['cases'][0]
    assert case['payment']['status'] == 'local_card_paid_only' and case['payment']['independently_verified'] is False

@test('local refunded card requires review and no grant')
def refunded():
    payload = base(); card(payload); payload['payment_transactions'][0]['payment_status'] = 'refunded'
    assert 'payment_refund_review_required' in report(payload)['cases'][0]['classifications']

@test('one card checkout reused by two subscriptions is ambiguous')
def reused_card():
    payload = base(); card(payload); other = copy.deepcopy(payload['subscriptions'][0]); other['id'] = 'sub-2'; payload['subscriptions'].append(other)
    for case in report(payload)['cases']:
        assert 'card_session_reused' in case['classifications'] and 'payment_link_ambiguous' in case['classifications']
        assert case['payment']['status'] != 'local_card_paid_only'

@test('reviewed exact credit link remains unverified claim')
def exact_link():
    payload = base(); payload['payment_links'] = [{'id': 'link-1', 'subscription_id': 'sub-1',
        'credit_transaction_id': 'debit-1', 'reviewed': True, 'evidence_ref': 'link-review-1'}]
    case = report(payload)['cases'][0]
    assert case['payment']['status'] == 'reviewed_credit_link_claim' and not case['payment']['independently_verified']
    assert 'historical_fee_unknown' in case['classifications']

@test('fee reviewer claim is diagnostic only')
def fee_claim():
    payload = base(); claim(payload); case = report(payload)['cases'][0]
    assert case['historical_net_claims'][0]['amount'] == '16' and not case['historical_net_claims'][0]['independently_verified']
    assert 'carry_forward_review_required' in case['classifications']

@test('fee claim without proof reference is not accepted')
def fee_no_proof():
    payload = base(); claim(payload); del payload['historical_fee_evidence'][0]['evidence_ref']
    case = report(payload)['cases'][0]
    assert not case['historical_net_claims'] and 'historical_fee_unknown' in case['classifications']

@test('historical net claim above paid gross is flagged')
def net_above_gross():
    payload = base(); claim(payload, '21')
    assert 'historical_net_exceeds_recorded_gross' in report(payload)['cases'][0]['classifications']

@test('linked earning above gross is flagged')
def earning_above_gross():
    payload = base(); add_receipt(payload, '21')
    assert 'earning_exceeds_recorded_gross' in report(payload)['cases'][0]['classifications']

@test('historical claim differing from recorded receipt is flagged')
def claim_conflict():
    payload = base(); add_receipt(payload); claim(payload, '17')
    assert 'historical_net_conflicts_with_receipt' in report(payload)['cases'][0]['classifications']

@test('equivalent decimal claims do not falsely conflict')
def equivalent_claims():
    payload = base(); claim(payload, '16.0'); claim(payload, '16.00', 'fee-2')
    case = report(payload)['cases'][0]
    assert len(case['historical_net_claims']) == 2 and 'historical_fee_claim_conflict' not in case['classifications']

@test('non-cent historical gross is retained and flagged')
def precision():
    payload = base(); payload['subscriptions'][0]['amount_paid'] = '19.999'; result = report(payload)
    assert payload['subscriptions'][0]['amount_paid'] == '19.999'
    assert 'historical_money_precision_review' in result['cases'][0]['classifications']

@test('large exported decimal does not fail quantization')
def large_decimal():
    payload = base(); payload['subscriptions'][0]['amount_paid'] = '1000000000000000000000000000000000.001'
    assert 'historical_money_precision_review' in report(payload)['cases'][0]['classifications']

@test('coverage complete assertion never clears hold')
def complete_claim():
    payload = base(); payload['snapshot']['coverage'] = {key: {'complete': True} for key in module.CORE_TABLES}
    result = report(payload)
    assert 'carry_forward_review_required' in result['cases'][0]['classifications']
    assert all(value == 'declared_complete_unverified' for value in result['coverage'].values())

@test('explicit partial coverage remains declared incomplete')
def partial_claim():
    payload = base(); payload['snapshot']['coverage'] = {'credit_transactions': {'complete': False}}
    assert report(payload)['coverage']['credit_transactions'] == 'declared_incomplete'

@test('pocket-unit ledger and aggregate payout cannot prove carry-forward')
def pockets():
    payload = base(); payload['credit_transactions'].append({'id': 'sponsor-1', 'user_id': 'seller-1',
        'amount': '-4', 'transaction_type': 'stoke_sponsor_contribution', 'balance_before': '16', 'balance_after': '12'})
    payload['payout_evidence'] = [{'id': 'batch-1', 'kind': 'aggregate_batch', 'total_recipients': 1, 'total_amount': '16', 'status': 'completed'}]
    account = report(payload)['accounts'][0]
    assert {'mixed_pocket_ledger_units', 'aggregate_payout_only', 'carry_forward_review_required'} <= set(account['classifications'])

@test('conflicting currency remains a finding without conversion')
def currency():
    payload = base(); card(payload); payload['payment_transactions'][0]['currency'] = 'EUR'
    result = report(payload)
    assert any(item['code'] == 'currency_conflict' for item in result['findings'])
    assert 'currency_conflict' in result['cases'][0]['classifications']

@test('nonstring ID fails with safe field-path ValueError')
def id_shape():
    payload = base(); payload['subscriptions'][0]['id'] = ['not-an-id']
    try: module.analyze_export(payload)
    except ValueError as error: assert 'subscriptions' in str(error) and 'not-an-id' not in str(error)
    else: raise AssertionError('Expected schema error')

@test('canonical digest ignores key order and detects changed values')
def digest():
    assert module.canonical_digest({'a': 1, 'b': 2}) == module.canonical_digest({'b': 2, 'a': 1})
    assert module.canonical_digest({'a': 1}) != module.canonical_digest({'a': 2})

failures = []
for name, fn in cases:
    try: fn(); print('PASS', name)
    except Exception as error: failures.append(name); print('FAIL', name, type(error).__name__, str(error))
print(f'{len(cases)-len(failures)}/{len(cases)} offline analyzer cases passed')
raise SystemExit(bool(failures))
