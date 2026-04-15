"""
Revenue Routing Engine for Raw Surf OS

Implements strict differentiation between:
- PROS (Photographers & Approved Pros): Direct income, can withdraw to bank/Stripe
- HOBBYISTS (Grom Parents & Hobbyist Photographers): Gear Credits only, no cash withdrawal

Hobbyist Earning Destinations:
- Save towards a specific gear item in the Gear Hub
- Donate 100% to a cause, grom, or competitive surfer
- Destination is set per-session (when hosting booking or live session)

Fee Structure:
- Hobbyist → Grom: 5% platform fee
- Hobbyist → Competitive Surfer: 10% platform fee
- Hobbyist → Gear Savings: 10% platform fee
- Regular transactions (Pros): 20% platform fee
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import Profile, RoleEnum, SponsorshipTransaction, SponsorshipType, Notification, CreditTransaction
import json
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

# Define role categories
PRO_ROLES = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
HOBBYIST_ROLES = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST]
GROM_ROLES = [RoleEnum.GROM]
SURFER_ROLES = [RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]


def is_pro_creator(role: RoleEnum) -> bool:
    """Check if user is a Pro creator (can withdraw cash)"""
    return role in PRO_ROLES


def is_hobbyist_creator(role: RoleEnum) -> bool:
    """Check if user is a Hobbyist (gear credits only)"""
    return role in HOBBYIST_ROLES


def is_grom(role: RoleEnum) -> bool:
    """Check if user is a Grom (receives sponsorships)"""
    return role in GROM_ROLES


def get_platform_fee_rate(donor_role: RoleEnum, recipient_type: str) -> float:
    """
    Calculate platform fee rate based on donor role and recipient type.
    
    Returns:
        float: Fee rate (0.05 = 5%, 0.10 = 10%, 0.20 = 20%)
    """
    if is_hobbyist_creator(donor_role):
        if recipient_type == 'grom':
            return 0.05  # 5% for donations to Groms
        elif recipient_type in ['surfer', 'comp_surfer']:
            return 0.10  # 10% for donations to competitive surfers
        elif recipient_type == 'gear':
            return 0.10  # 10% for gear savings
        else:
            return 0.10  # Default 10% for hobbyists
    else:
        return 0.20  # Standard 20% for Pros


async def process_creator_earnings(
    creator_id: str,
    gross_amount: float,
    transaction_type: str,
    db: AsyncSession,
    source_transaction_id: str = None,
    description: str = None,
    counterparty_id: str = None,
    session_destination_type: str = None,
    session_destination_id: str = None
) -> dict:
    """
    Process earnings for a creator based on their role and session-specific settings.
    
    For PROS:
        - Deduct platform fee (20%)
        - If split configured: portion goes to cause/grom, rest to withdrawable_credits
        - Otherwise: all to withdrawable_credits
    
    For HOBBYISTS:
        - Deduct platform fee (5-10% based on recipient)
        - 100% goes to session-specific destination OR default destination OR gear_only_credits
        - Session-specific destination overrides profile defaults (set when starting live session)
    
    Args:
        session_destination_type: Per-session override for destination ('grom', 'cause', 'surfer', 'gear')
        session_destination_id: Per-session override for recipient ID (profile ID or gear item ID)
    """
    # Get creator profile
    result = await db.execute(select(Profile).where(Profile.id == creator_id))
    creator = result.scalar_one_or_none()
    
    if not creator:
        return {"success": False, "error": "Creator not found"}
    
    creator_role = creator.role
    is_pro = is_pro_creator(creator_role)
    is_hobbyist = is_hobbyist_creator(creator_role)
    
    # Use session-specific destination if provided, else fall back to profile defaults
    donation_dest_type = session_destination_type or creator.donation_destination_type
    donation_dest_id = session_destination_id or creator.donation_destination_id
    
    # Track balance before
    if is_pro:
        balance_before = creator.withdrawable_credits
    elif is_hobbyist:
        balance_before = creator.gear_only_credits
    else:
        balance_before = creator.credit_balance or 0
    
    # Default fee rate
    fee_rate = 0.20 if is_pro else 0.10
    
    # Calculate amounts
    platform_fee = gross_amount * fee_rate
    net_amount = gross_amount - platform_fee
    
    result_data = {
        "success": True,
        "gross_amount": gross_amount,
        "platform_fee": platform_fee,
        "net_amount": net_amount,
        "creator_role": creator_role.value,
        "distributions": []
    }
    
    if is_pro:
        # PRO: Can split between cause/grom and withdrawable credits
        if donation_dest_type and donation_dest_type not in ['gear', 'split'] and donation_dest_id:
            # Pro has configured donation split
            split_pct = creator.donation_split_percentage or 50
            donation_amount = net_amount * (split_pct / 100)
            creator_amount = net_amount - donation_amount
            
            # Process donation
            if donation_amount > 0:
                await process_sponsorship(
                    donor_id=creator_id,
                    recipient_id=donation_dest_id,
                    amount=donation_amount,
                    sponsorship_type=SponsorshipType.PRO_SPONSORSHIP,
                    recipient_type=donation_dest_type,
                    source_type=transaction_type,
                    source_id=source_transaction_id,
                    db=db
                )
                result_data["distributions"].append({
                    "type": "sponsorship",
                    "recipient_type": donation_dest_type,
                    "amount": donation_amount
                })
            
            # Credit creator's withdrawable balance
            if creator_amount > 0:
                creator.withdrawable_credits += creator_amount
                result_data["distributions"].append({
                    "type": "withdrawable_credits",
                    "amount": creator_amount
                })
        else:
            # No donation configured - all to withdrawable credits
            creator.withdrawable_credits += net_amount
            result_data["distributions"].append({
                "type": "withdrawable_credits",
                "amount": net_amount
            })
        
        # Also update legacy credit_balance for backwards compat
        creator.credit_balance = creator.withdrawable_credits
        balance_after = creator.withdrawable_credits
        
    elif is_hobbyist:
        # HOBBYIST: 100% to one destination (no split)
        if donation_dest_type == 'gear' and donation_dest_id:
            # Hobbyist saving towards a gear item
            fee_rate = 0.10  # 10% for gear savings
            platform_fee = gross_amount * fee_rate
            net_amount = gross_amount - platform_fee
            
            creator.gear_only_credits += net_amount
            creator.credit_balance = creator.gear_only_credits
            
            result_data["platform_fee"] = platform_fee
            result_data["net_amount"] = net_amount
            result_data["distributions"].append({
                "type": "gear_savings",
                "target_gear_id": donation_dest_id,
                "amount": net_amount
            })
            balance_after = creator.gear_only_credits
            
        elif donation_dest_type and donation_dest_id and donation_dest_type != 'gear':
            # Hobbyist donating to grom/cause/surfer
            recipient_result = await db.execute(select(Profile).where(Profile.id == donation_dest_id))
            recipient = recipient_result.scalar_one_or_none()
            
            if recipient:
                # Determine correct fee rate for hobbyist donations
                if is_grom(recipient.role):
                    hobbyist_fee_rate = 0.05  # 5% for grom donations
                    recipient_type = 'grom'
                else:
                    hobbyist_fee_rate = 0.10  # 10% for surfer donations
                    recipient_type = 'surfer'
                
                # Recalculate with correct fee
                platform_fee = gross_amount * hobbyist_fee_rate
                net_amount = gross_amount - platform_fee
                
                await process_sponsorship(
                    donor_id=creator_id,
                    recipient_id=donation_dest_id,
                    amount=net_amount,
                    sponsorship_type=SponsorshipType.IMPACT_DONATION,
                    recipient_type=recipient_type,
                    source_type=transaction_type,
                    source_id=source_transaction_id,
                    db=db
                )
                
                result_data["platform_fee"] = platform_fee
                result_data["net_amount"] = net_amount
                result_data["distributions"].append({
                    "type": "impact_donation",
                    "recipient_type": recipient_type,
                    "recipient_id": donation_dest_id,
                    "amount": net_amount
                })
            balance_after = creator.gear_only_credits
        else:
            # No donation configured - goes to gear credits
            creator.gear_only_credits += net_amount
            creator.credit_balance = creator.gear_only_credits  # Backwards compat
            result_data["distributions"].append({
                "type": "gear_only_credits",
                "amount": net_amount
            })
            balance_after = creator.gear_only_credits
    else:
        # Other roles (surfers, etc.) - regular credit handling
        creator.credit_balance = (creator.credit_balance or 0) + net_amount
        result_data["distributions"].append({
            "type": "credit_balance",
            "amount": net_amount
        })
        balance_after = creator.credit_balance
    
    # Create credit transaction record with correct field names
    credit_tx = CreditTransaction(
        user_id=creator_id,
        amount=net_amount,
        balance_before=balance_before,
        balance_after=balance_after,
        transaction_type=transaction_type,
        description=description or f"Earnings from {transaction_type}",
        reference_type=transaction_type,
        reference_id=source_transaction_id,
        counterparty_id=counterparty_id
    )
    db.add(credit_tx)
    
    logger.info(f"Revenue routed for {creator_id}: gross={gross_amount}, net={net_amount}, type={creator_role.value}")
    
    return result_data


async def process_sponsorship(
    donor_id: str,
    recipient_id: str,
    amount: float,
    sponsorship_type: SponsorshipType,
    recipient_type: str,
    source_type: str,
    source_id: str,
    db: AsyncSession,
    cause_name: str = None
) -> SponsorshipTransaction:
    """
    Process a sponsorship/donation from a creator to a grom/cause/surfer.
    Creates transaction record and notifies recipient.
    """
    # Get donor info
    donor_result = await db.execute(select(Profile).where(Profile.id == donor_id))
    donor = donor_result.scalar_one_or_none()
    
    # Get recipient info
    recipient_result = await db.execute(select(Profile).where(Profile.id == recipient_id))
    recipient = recipient_result.scalar_one_or_none()
    
    if not donor or not recipient:
        return None
    
    # Calculate fee based on recipient type
    if recipient_type == 'grom':
        fee_rate = 0.05
    elif recipient_type in ['surfer', 'comp_surfer']:
        fee_rate = 0.10
    else:
        fee_rate = 0.10
    
    # For sponsorships, the amount coming in is already net
    # So we don't deduct again - just record
    platform_fee = 0  # Fee already taken at source
    net_amount = amount
    
    # Create sponsorship transaction
    sponsorship = SponsorshipTransaction(
        donor_id=donor_id,
        recipient_id=recipient_id,
        amount=amount,
        platform_fee=platform_fee,
        net_amount=net_amount,
        sponsorship_type=sponsorship_type,
        recipient_type=recipient_type,
        cause_name=cause_name,
        source_transaction_type=source_type,
        source_transaction_id=source_id
    )
    db.add(sponsorship)
    await db.flush()
    
    # Credit recipient
    recipient.credit_balance = (recipient.credit_balance or 0) + net_amount
    
    # Update donor's Impact Score
    donor.total_credits_given = (donor.total_credits_given or 0) + net_amount
    
    # Track unique recipients
    if recipient_type == 'grom':
        # Check if this is a new grom supported
        existing_to_grom = await db.execute(
            select(SponsorshipTransaction)
            .where(SponsorshipTransaction.donor_id == donor_id)
            .where(SponsorshipTransaction.recipient_id == recipient_id)
            .where(SponsorshipTransaction.recipient_type == 'grom')
            .where(SponsorshipTransaction.id != sponsorship.id)
        )
        if not existing_to_grom.scalar_one_or_none():
            donor.total_groms_supported = (donor.total_groms_supported or 0) + 1
    elif recipient_type == 'cause':
        # Check if this is a new cause supported
        existing_to_cause = await db.execute(
            select(SponsorshipTransaction)
            .where(SponsorshipTransaction.donor_id == donor_id)
            .where(SponsorshipTransaction.cause_name == cause_name)
            .where(SponsorshipTransaction.id != sponsorship.id)
        )
        if not existing_to_cause.scalar_one_or_none():
            donor.total_causes_supported = (donor.total_causes_supported or 0) + 1
    
    # Record in Impact Ledger for leaderboard tracking
    from models import ImpactLedger
    now = datetime.now(timezone.utc)
    ledger_entry = ImpactLedger(
        photographer_id=donor_id,
        recipient_type=recipient_type,
        recipient_id=recipient_id if recipient_type != 'cause' else None,
        cause_name=cause_name if recipient_type == 'cause' else None,
        amount=net_amount,
        source_type=source_type,
        source_id=source_id,
        month=now.month,
        year=now.year
    )
    db.add(ledger_entry)
    
    # Update weekly challenge score
    from routes.challenges import update_challenge_score
    await update_challenge_score(donor_id, net_amount, recipient_type, db)
    
    # Determine notification type based on sponsorship type
    if sponsorship_type == SponsorshipType.PRO_SPONSORSHIP:
        title = f"{donor.full_name} sponsored your next session! 🤙"
        body = f"You received ${net_amount:.2f} from a Pro photographer"
        notif_type = 'pro_sponsorship'
    else:
        title = f"{donor.full_name} made an impact donation! 🌊"
        body = f"You received ${net_amount:.2f} to support your surfing"
        notif_type = 'impact_donation'
    
    # Send notification to recipient (with Instant Shaka prompt for Groms)
    show_instant_shaka = is_grom(recipient.role)
    
    notification = Notification(
        user_id=recipient_id,
        type=notif_type,
        title=title,
        body=body,
        data=json.dumps({
            "sponsorship_id": sponsorship.id,
            "donor_id": donor_id,
            "donor_name": donor.full_name,
            "donor_avatar": donor.avatar_url,
            "amount": net_amount,
            "sponsorship_type": sponsorship_type.value,
            "show_shaka_prompt": True,
            "show_instant_shaka_prompt": show_instant_shaka  # Groms can send 5-sec video
        })
    )
    db.add(notification)
    
    logger.info(f"Sponsorship processed: {donor_id} -> {recipient_id} ({recipient_type}), amount={net_amount}")
    
    return sponsorship


async def migrate_user_credits(user_id: str, db: AsyncSession) -> dict:
    """
    Migrate existing credit_balance to the new split system based on role.
    - Pros: credit_balance → withdrawable_credits
    - Hobbyists: credit_balance → gear_only_credits
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        return {"success": False, "error": "User not found"}
    
    current_balance = user.credit_balance or 0
    
    if is_pro_creator(user.role):
        user.withdrawable_credits = current_balance
        user.gear_only_credits = 0
        return {
            "success": True,
            "migrated_to": "withdrawable_credits",
            "amount": current_balance
        }
    elif is_hobbyist_creator(user.role):
        user.gear_only_credits = current_balance
        user.withdrawable_credits = 0
        return {
            "success": True,
            "migrated_to": "gear_only_credits",
            "amount": current_balance
        }
    else:
        # Other roles keep credit_balance as-is
        return {
            "success": True,
            "migrated_to": "credit_balance",
            "amount": current_balance
        }


def get_available_credits(user: Profile) -> dict:
    """
    Get available credits for a user based on their role.
    """
    if is_pro_creator(user.role):
        return {
            "total": user.withdrawable_credits + user.gear_only_credits,
            "withdrawable": user.withdrawable_credits,
            "gear_only": user.gear_only_credits,
            "can_withdraw": True
        }
    elif is_hobbyist_creator(user.role):
        return {
            "total": user.gear_only_credits,
            "withdrawable": 0,
            "gear_only": user.gear_only_credits,
            "can_withdraw": False
        }
    else:
        return {
            "total": user.credit_balance,
            "withdrawable": 0,
            "gear_only": 0,
            "can_withdraw": False
        }
