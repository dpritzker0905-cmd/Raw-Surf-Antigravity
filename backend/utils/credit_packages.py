"""Server-owned package offers and frozen receipt validation."""
import ast
import json
from decimal import Decimal, InvalidOperation
from sqlalchemy import select
from models import GlobalPricingConfig

CREDIT_PACKAGE_VERSION = 2
# Frozen default-v1 terms: introduce a new identity if these defaults ever change.
DEFAULT_CREDIT_PACKAGE_BONUSES = {'10': 0, '25': 0, '50': 5, '100': 15}
_V1_BONUSES = {Decimal('50'): 5, Decimal('100'): 15}


def validate_credit_package_bonuses(values):
    if not isinstance(values, dict) or set(values) != set(DEFAULT_CREDIT_PACKAGE_BONUSES):
        raise ValueError('Credit bonuses must contain the four supported package amounts')
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in values.values()):
        raise ValueError('Credit bonuses must be non-negative integers')
    return {key: values[key] for key in DEFAULT_CREDIT_PACKAGE_BONUSES}


def _paid(value):
    paid = Decimal(str(value))
    if not paid.is_finite() or paid <= 0:
        raise ValueError('Invalid wallet payment amount')
    return paid


def _bonus(paid, bonuses):
    return next((bonus for amount, bonus in bonuses.items() if paid == Decimal(amount)), 0)


def credit_package_metadata(paid_amount, version=CREDIT_PACKAGE_VERSION, offer=None):
    paid = _paid(paid_amount)
    if isinstance(version, bool) or version not in (1, 2):
        raise ValueError('Unsupported wallet package version')
    if version == 1:
        bonus = _V1_BONUSES.get(paid, 0)
    else:
        if not offer or not isinstance(offer.get('offer_id'), str):
            raise ValueError('A current credit offer is required')
        bonuses = validate_credit_package_bonuses(offer['bonuses'])
        bonus = _bonus(paid, bonuses)
    terms = {'type': 'wallet_credit_pack', 'package_version': version,
             'base_credits': int(paid), 'bonus_credits': bonus, 'credits': int(paid) + bonus}
    if version == 2:
        terms['offer_id'] = offer['offer_id']
    return terms


def package_credit_amount(metadata, paid_amount):
    version = metadata.get('package_version')
    if isinstance(version, bool) or version not in (1, 2):
        raise ValueError('Unsupported wallet package version')
    try:
        paid = _paid(paid_amount)
        base = Decimal(str(metadata.get('base_credits')))
        bonus = Decimal(str(metadata.get('bonus_credits')))
        total = Decimal(str(metadata.get('credits')))
        if any(not n.is_finite() for n in (base, bonus, total)):
            raise ValueError('Invalid wallet package terms')
        if base != int(paid) or bonus < 0 or bonus != int(bonus) or total != base + bonus or total <= 0:
            raise ValueError('Invalid wallet package terms')
        if version == 1:
            expected = credit_package_metadata(paid, version=1)
            if bonus != expected['bonus_credits']:
                raise ValueError('Invalid frozen version-one terms')
        elif not isinstance(metadata.get('offer_id'), str) or not metadata['offer_id']:
            raise ValueError('Missing frozen credit offer')
    except InvalidOperation as exc:
        raise ValueError('Invalid wallet package terms') from exc
    return float(total)


def _offer(config):
    bonuses = DEFAULT_CREDIT_PACKAGE_BONUSES if config is None or config.credit_package_bonuses is None else config.credit_package_bonuses
    bonuses = validate_credit_package_bonuses(bonuses)
    offer_id = 'default-v1' if config is None else f'pricing:{config.id}:{config.version}'
    return {'offer_id': offer_id, 'bonuses': bonuses}


async def get_credit_package_offer(db):
    result = await db.execute(select(GlobalPricingConfig).where(GlobalPricingConfig.is_active == True)
                              .order_by(GlobalPricingConfig.version.desc()).limit(1))
    return _offer(result.scalar_one_or_none())


def public_credit_package_offer(offer):
    return {'offer_id': offer['offer_id'], 'packages': [
        {'amount': int(amount), 'bonus': bonus, 'credits': int(amount) + bonus}
        for amount, bonus in offer['bonuses'].items()]}


async def validate_credit_package_receipt(db, transaction):
    raw = transaction.transaction_metadata or '{}'
    try:
        metadata = json.loads(raw)
    except json.JSONDecodeError:
        metadata = ast.literal_eval(raw)
    if not isinstance(metadata, dict):
        raise ValueError('Invalid payment metadata')
    if metadata.get('type') != 'wallet_credit_pack':
        return None
    total = package_credit_amount(metadata, transaction.amount)
    if metadata['package_version'] == 2:
        offer_id = metadata['offer_id']
        if offer_id == 'default-v1':
            offer = _offer(None)
        else:
            parts = offer_id.split(':')
            if len(parts) != 3 or parts[0] != 'pricing':
                raise ValueError('Unknown historical credit offer')
            result = await db.execute(select(GlobalPricingConfig).where(
                GlobalPricingConfig.id == parts[1], GlobalPricingConfig.version == int(parts[2])))
            config = result.scalar_one_or_none()
            if config is None:
                raise ValueError('Historical credit offer is unavailable')
            offer = _offer(config)
        expected = credit_package_metadata(transaction.amount, version=2, offer=offer)
        if any(metadata[key] != expected[key] for key in ('base_credits', 'bonus_credits', 'credits')):
            raise ValueError('Credit terms do not match their historical offer')
    return {'base_credits': float(metadata['base_credits']),
            'bonus_credits': float(metadata['bonus_credits']), 'credits': total}
