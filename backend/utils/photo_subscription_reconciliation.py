"""Offline diagnostics for historical photo subscriptions; never a balance writer.

Inputs are asserted export records, not independently verified economic proof.
No application, database, environment, provider, filesystem or clock access.
"""
import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation

TABLES = ('profiles', 'subscriptions', 'payment_transactions', 'credit_transactions',
          'historical_fee_evidence', 'payout_evidence', 'payment_links')
CORE_TABLES = TABLES[:4]
ID_FIELDS = ('id', 'user_id', 'surfer_id', 'photographer_id', 'plan_id', 'stripe_session_id',
             'session_id', 'counterparty_id', 'reference_id', 'subscription_id',
             'credit_transaction_id', 'profile_id', 'refund_of_transaction_id')
POCKET_TYPES = {'stoke_sponsor_contribution', 'stoke_sponsor_income'}
CARRY_FORWARD = 'Independent account carry-forward review of opening balances, spend, refunds, payouts, role changes and prior corrections is required.'


def canonical_digest(value):
    """SHA256 of sorted-key UTF-8 JSON; array order and numeric values remain significant."""
    try:
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, OverflowError):
        raise ValueError('payload: JSON-compatible values required') from None
    return hashlib.sha256(encoded).hexdigest()


def _money(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    try:
        amount = Decimal(str(value))
        return amount if amount.is_finite() else None
    except InvalidOperation:
        return None


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _decimal(value):
    return format(value, 'f') if value is not None else None


def _metadata(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return None
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError('duplicate metadata key')
            result[key] = item
        return result
    def constant(_value):
        raise ValueError('nonfinite metadata value')
    try:
        parsed = json.loads(value, object_pairs_hook=pairs, parse_constant=constant)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, ValueError):
        return None


def _has_precision(amount):
    if amount is None:
        return False
    digits, exponent = amount.as_tuple().digits, amount.as_tuple().exponent
    extra = -exponent - 2
    return extra > 0 and any(digits[-extra:])


def analyze_export(payload):
    """Analyze explicit JSON records, with every possible correction held at null.

    Raises ValueError with field paths only for structural input errors. Duplicate
    record IDs remain visible findings and are never silently deduplicated.
    """
    digest = canonical_digest(payload)
    if not isinstance(payload, dict) or type(payload.get('schema_version')) is not int or payload['schema_version'] != 1:
        raise ValueError('schema_version: expected integer 1')
    snapshot = payload.get('snapshot')
    if not isinstance(snapshot, dict):
        raise ValueError('snapshot: object required')
    for field in ('id', 'exported_at', 'source_label'):
        if not _text(snapshot.get(field)):
            raise ValueError('snapshot.' + field + ': nonempty string required')
    try:
        exported = datetime.fromisoformat(snapshot['exported_at'].replace('Z', '+00:00'))
        if exported.tzinfo is None or exported.utcoffset() is None:
            raise ValueError('timezone missing')
    except ValueError:
        raise ValueError('snapshot.exported_at: timezone-aware ISO8601 required') from None
    if not isinstance(snapshot.get('coverage'), dict):
        raise ValueError('snapshot.coverage: object required')

    findings, cases, accounts = [], [], []
    tables, indexes = {}, {}
    def finding(code, table=None, row_index=None, record_ids=None, requirement=None):
        item = {'code': code, 'table': table, 'row_index': row_index,
                'record_ids': record_ids or [], 'evidence_status': 'asserted_local_records'}
        if requirement:
            item['requirement'] = requirement
        findings.append(item)
    for name in TABLES:
        if name not in payload:
            tables[name], indexes[name] = None, {}
            if name in CORE_TABLES:
                finding('table_coverage_unknown', name, requirement='Supply this export table; absence is not an empty history.')
            continue
        rows = payload[name]
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError(name + ': array of objects required')
        tables[name], indexes[name] = rows, {}
        for index, row in enumerate(rows):
            for field in ID_FIELDS:
                if field in row and row[field] is not None and not _text(row[field]):
                    raise ValueError(name + '[' + str(index) + '].' + field + ': nonempty string required')
            identity = row.get('id')
            if not _text(identity):
                finding('record_id_missing', name, index)
                continue
            indexes[name].setdefault(identity, []).append(row)
            currency = row.get('currency')
            if currency is not None and (not isinstance(currency, str) or currency.upper() != 'USD'):
                finding('currency_conflict', name, index, [identity], 'Do not combine or convert unsupported currencies.')
        for identity, group in indexes[name].items():
            if len(group) > 1:
                finding('duplicate_record_id', name, record_ids=[identity], requirement='Resolve duplicate or conflicting records without collapsing source rows.')

    credit_rows = tables['credit_transactions'] or []
    payment_rows = tables['payment_transactions'] or []
    links = tables['payment_links'] or []
    fee_rows = tables['historical_fee_evidence'] or []
    # Reference groupings retain every row, including conflicts and duplicates.
    # Building them once avoids rescanning the whole export for each subscription.
    receipts_by_sub, payments_by_session, debits_by_plan = {}, {}, {}
    links_by_sub, links_by_debit, fees_by_sub, subs_by_session = {}, {}, {}, {}
    pocket_users = set()
    for row in credit_rows:
        if row.get('transaction_type') == 'photo_subscription_earning' and row.get('reference_type') == 'photo_subscription':
            receipts_by_sub.setdefault(row.get('reference_id'), []).append(row)
        if row.get('transaction_type') == 'photo_subscription_payment' and row.get('reference_type') == 'photo_subscription_plan':
            amount = _money(row.get('amount'))
            if amount is not None and amount < 0:
                debits_by_plan.setdefault((row.get('user_id'), row.get('reference_id')), []).append(row)
        if row.get('transaction_type') in POCKET_TYPES:
            pocket_users.add(row.get('user_id'))
    for row in payment_rows:
        payments_by_session.setdefault(row.get('session_id'), []).append(row)
    for row in links:
        links_by_sub.setdefault(row.get('subscription_id'), []).append(row)
        links_by_debit.setdefault(row.get('credit_transaction_id'), []).append(row)
    for row in fee_rows:
        fees_by_sub.setdefault(row.get('subscription_id'), []).append(row)
    for row in tables['subscriptions'] or []:
        if _text(row.get('stripe_session_id')):
            subs_by_session.setdefault(row['stripe_session_id'], []).append(row)
    finding('history_completeness_unverified', requirement=CARRY_FORWARD)
    payout_rows = tables['payout_evidence']
    aggregate_payouts = []
    for index, row in enumerate(payout_rows or []):
        if row.get('kind') == 'aggregate_batch' or ('total_recipients' in row and not row.get('user_id')):
            aggregate_payouts.append(row.get('id'))
            finding('aggregate_payout_only', 'payout_evidence', index,
                    [row['id']] if _text(row.get('id')) else [],
                    'Recipient-level payout evidence is required; aggregate or simulated completion proves no recipient payment.')
    if payout_rows is None:
        finding('payout_history_unknown', 'payout_evidence', requirement='Supply recipient payout history and independent settlement evidence.')
    elif payout_rows:
        finding('payout_evidence_not_independently_verified', 'payout_evidence')

    for position, sub in enumerate(tables['subscriptions'] or []):
        sid, seller, buyer = sub.get('id'), sub.get('photographer_id'), sub.get('surfer_id')
        flags, requirements = ['carry_forward_review_required'], [CARRY_FORWARD]
        def flag(code, requirement=None):
            if code not in flags:
                flags.append(code)
            if requirement and requirement not in requirements:
                requirements.append(requirement)
        if not all(_text(value) for value in (sid, seller, buyer)):
            flag('subscription_identity_incomplete', 'Supply exact subscription, seller and buyer IDs.')
        if len(indexes['subscriptions'].get(sid, [])) > 1:
            flag('duplicate_record_id')
        if len(indexes['profiles'].get(seller, [])) != 1:
            flag('seller_profile_unresolved', 'Supply a unique seller snapshot.')
        gross = _money(sub.get('amount_paid'))
        if gross is None or gross < 0:
            flag('paid_gross_unknown', 'Supply the original paid amount without using current plan price.')
        if _has_precision(gross):
            flag('historical_money_precision_review', 'Preserve non-cent historical amounts; do not silently round paid gross.')
        if sub.get('currency') is not None and str(sub['currency']).upper() != 'USD':
            flag('currency_conflict')

        receipts = receipts_by_sub.get(sid, []) if _text(sid) else []
        ledger_ids = [row.get('id') for row in receipts]
        recorded_net = None
        if tables['credit_transactions'] is None:
            flag('ledger_coverage_unknown')
        elif not receipts:
            flag('ledger_missing', 'A missing exported seller receipt is not proof of an amount owed.')
        else:
            flag('ledger_present')
            if len(receipts) != 1 or any(len(indexes['credit_transactions'].get(row.get('id'), [])) != 1 for row in receipts):
                flag('receipt_conflict', 'Resolve multiple, duplicate or conflicting seller receipts.')
            else:
                row = receipts[0]
                net = _money(row.get('amount'))
                if row.get('user_id') != seller or row.get('counterparty_id') != buyer or net is None or net < 0:
                    flag('receipt_conflict', 'Review seller, buyer and amount on the linked receipt.')
                else:
                    recorded_net = _decimal(net)
                    if gross is not None and net > gross:
                        flag('earning_exceeds_recorded_gross')
                if 'spend_only_amount' not in row or _money(row.get('spend_only_amount')) is None:
                    flag('receipt_classification_unknown')
                elif _money(row['spend_only_amount']) != 0:
                    flag('receipt_conflict')
                if row.get('currency') is not None and str(row['currency']).upper() != 'USD':
                    flag('currency_conflict')
                if _has_precision(net):
                    flag('historical_money_precision_review')

        payment = {'status': 'unresolved', 'transaction_ids': [], 'independently_verified': False}
        if sub.get('payment_method') == 'card':
            session_id = sub.get('stripe_session_id')
            candidates = payments_by_session.get(session_id, []) if _text(session_id) else []
            payment['transaction_ids'] = [row.get('id') for row in candidates]
            if tables['payment_transactions'] is None:
                flag('payment_coverage_unknown')
            elif len(subs_by_session.get(session_id, [])) > 1:
                payment['status'] = 'ambiguous_reused_session'
                flag('card_session_reused', 'Resolve one checkout referenced by multiple subscription rows.')
                flag('payment_link_ambiguous')
            elif len(candidates) != 1 or len(indexes['payment_transactions'].get(candidates[0].get('id'), [])) != 1:
                flag('payment_link_ambiguous', 'Supply a unique original checkout/payment link.')
            else:
                row = candidates[0]
                metadata = _metadata(row.get('transaction_metadata'))
                amount = _money(row.get('amount'))
                if row.get('user_id') != buyer or metadata is None or metadata.get('type') != 'photo_subscription' or metadata.get('plan_id') != sub.get('plan_id') or metadata.get('photographer_id') != seller:
                    flag('receipt_conflict')
                if gross is not None and amount is not None and gross != amount:
                    flag('receipt_amount_conflict')
                if amount is None:
                    flag('payment_amount_unknown')
                if _has_precision(amount):
                    flag('historical_money_precision_review')
                currency = row.get('currency')
                if not isinstance(currency, str) or currency.upper() != 'USD':
                    flag('currency_conflict')
                status = str(row.get('payment_status', '')).lower()
                if status in ('paid', 'completed'):
                    payment['status'] = 'local_card_paid_only'
                    flag('local_card_paid_only', 'Local completion is asserted data; independent payment/refund evidence is still required.')
                elif status == 'refunded':
                    payment['status'] = 'local_refund_record'
                    flag('payment_refund_review_required')
                else:
                    flag('funding_unproved')
        elif sub.get('payment_method') == 'credits':
            candidates = debits_by_plan.get((buyer, sub.get('plan_id')), [])
            payment['transaction_ids'] = [row.get('id') for row in candidates]
            if any(row.get('currency') is not None and str(row['currency']).upper() != 'USD' for row in candidates):
                flag('currency_conflict')
            reviewed = [row for row in links_by_sub.get(sid, []) if row.get('reviewed') is True and _text(row.get('evidence_ref'))]
            if len(reviewed) == 1:
                link = reviewed[0]
                exact = [row for row in candidates if row.get('id') == link.get('credit_transaction_id')]
                reused = [row for row in links_by_debit.get(link.get('credit_transaction_id'), []) if row.get('subscription_id') != sid]
                if len(exact) == 1 and len(indexes['credit_transactions'].get(exact[0].get('id'), [])) == 1 and not reused and len(indexes['payment_links'].get(link.get('id'), [])) == 1:
                    payment.update(status='reviewed_credit_link_claim', transaction_ids=[exact[0]['id']], evidence_ref=link['evidence_ref'])
                    flag('reviewed_credit_link_claim', 'The supplied review/link claim is not independently verified by this tool.')
                    if gross is not None and -_money(exact[0]['amount']) != gross:
                        flag('receipt_amount_conflict')
                else:
                    flag('payment_link_ambiguous')
            else:
                flag('payment_link_ambiguous', 'Plan-ID candidates, even a single match, do not prove the exact renewal payment.')
        else:
            flag('payment_method_unknown')

        claims = []
        for row in fees_by_sub.get(sid, []):
            net = _money(row.get('net_amount'))
            if row.get('reviewed') is not True or not _text(row.get('evidence_ref')) or net is None or net < 0 or str(row.get('currency', '')).upper() != 'USD' or len(indexes['historical_fee_evidence'].get(row.get('id'), [])) != 1:
                flag('historical_fee_evidence_incomplete')
                continue
            claims.append({'evidence_id': row['id'], 'amount': _decimal(net), 'currency': 'USD',
                           'evidence_ref': row['evidence_ref'], 'independently_verified': False})
            if _has_precision(net):
                flag('historical_money_precision_review')
            if gross is not None and net > gross:
                flag('historical_net_exceeds_recorded_gross')
            if recorded_net is not None and net != Decimal(recorded_net):
                flag('historical_net_conflicts_with_receipt')
        if claims:
            flag('reviewer_supplied_historical_net', 'Review claims remain diagnostic and authorize no wallet correction.')
            if len({Decimal(claim['amount']) for claim in claims}) > 1:
                flag('historical_fee_claim_conflict')
        elif recorded_net is None:
            flag('historical_fee_unknown', 'Supply historical fee/net proof; current tier is not historical evidence.')
        cases.append({'subscription_id': sid, 'row_index': position, 'seller_id': seller, 'buyer_id': buyer,
                      'classifications': flags, 'ledger_ids': ledger_ids, 'recorded_net': recorded_net,
                      'payment': payment, 'historical_net_claims': claims, 'requirements': requirements,
                      'money_correction': None, 'apply_ready': False})

    for position, profile in enumerate(tables['profiles'] or []):
        identity = profile.get('id')
        flags = ['carry_forward_review_required']
        wallet = {key: _decimal(_money(profile.get(key))) for key in
                  ('credit_balance', 'spend_only_credits', 'withdrawable_credits', 'gear_only_credits')}
        total, promo, cash = [_money(profile.get(key)) for key in
                              ('credit_balance', 'spend_only_credits', 'withdrawable_credits')]
        capacity = excess = None
        if any(value is None for value in (total, promo, cash)):
            flags.append('wallet_snapshot_incomplete')
        elif not 0 <= promo <= total or cash < 0:
            flags.append('wallet_composition_invalid')
        else:
            capacity = total - promo
            excess = max(Decimal(0), cash - capacity)
            if excess > 0:
                flags.append('unsupported_withdrawable_snapshot')
        if any(_has_precision(_money(profile.get(key))) for key in wallet):
            flags.append('historical_money_precision_review')
        if len(indexes['profiles'].get(identity, [])) > 1:
            flags.append('duplicate_record_id')
        if identity in pocket_users:
            flags.append('mixed_pocket_ledger_units')
        if aggregate_payouts:
            flags.append('aggregate_payout_only')
        wallet.update(cash_capacity=_decimal(capacity), cash_excess=_decimal(excess),
                      meaning='snapshot_diagnostic_not_amount_owed')
        accounts.append({'profile_id': identity, 'row_index': position, 'wallet': wallet,
                         'classifications': flags, 'requirements': [CARRY_FORWARD],
                         'money_correction': None, 'apply_ready': False})

    coverage = {}
    for table in CORE_TABLES:
        claim = snapshot['coverage'].get(table)
        if isinstance(claim, dict):
            claim = claim.get('complete', claim.get('status'))
        text = claim.strip().lower() if isinstance(claim, str) else None
        if tables[table] is None:
            coverage[table] = 'unknown_missing_table'
        elif claim is False or text in ('incomplete', 'partial'):
            coverage[table] = 'declared_incomplete'
        elif claim is True or text == 'complete':
            coverage[table] = 'declared_complete_unverified'
        else:
            coverage[table] = 'unspecified'
    return {'report_schema_version': 1, 'mode': 'report_only', 'input_digest': digest,
            'snapshot': {key: snapshot[key] for key in ('id', 'exported_at', 'source_label')},
            'coverage': coverage, 'findings': findings, 'cases': cases, 'accounts': accounts,
            'summary': {'subscription_rows': len(cases), 'profile_rows': len(accounts),
                        'findings': len(findings), 'unknown_tables': [name for name in CORE_TABLES if tables[name] is None]},
            'requirements': [CARRY_FORWARD, 'No automated balance correction is proposed; independently review local records and external economic evidence.'],
            'money_correction': None, 'apply_ready': False}
