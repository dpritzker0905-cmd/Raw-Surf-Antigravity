# Architectural Audit Report: Data Integrity, Real-Time Sessions & Social Associations

**Audit Date**: April 10, 2025  
**Scope**: Systemwide Data Integrity, Real-Time Sessions, Social Associations

---

## 1. HANDSHAKE AUDIT: Payment-to-Action Flows

### Current State: ✅ MOSTLY SECURE (with recommendations)

#### Captain Payment Flow (`POST /dispatch/{id}/pay`)
```
ATOMIC TRANSACTION IMPLEMENTED:
1. Credit validation → 2. Credit deduction → 3. Transaction record → 
4. Metadata injection (captain_name, username, avatar) → 5. Status update → 
6. SINGLE COMMIT
```
**Status**: ✅ SECURE - Uses try/except with rollback on failure

#### Crew Payment Flow (`POST /dispatch/crew-invite/{id}/pay`)
```
ATOMIC TRANSACTION IMPLEMENTED:
1. Validation → 2. Credit deduction → 3. Transaction record → 
4. Participant status update → 5. Metadata injection (payer_name, username, avatar) → 
6. All-paid check → 7. SINGLE COMMIT
```
**Status**: ✅ SECURE - Rollback on any failure

#### Stripe Checkout Flow (`POST /dispatch/checkout` → `/payment-success`)
```
FLOW:
1. Create checkout session → 2. Store PaymentTransaction (Pending) → COMMIT
3. User redirects to Stripe
4. On success callback: Verify with Stripe → Update dispatch → Store metadata → COMMIT
```
**Status**: ⚠️ PARTIALLY SECURE

**ISSUE FOUND**: Line 642 commits PaymentTransaction before user completes Stripe checkout.
If user abandons checkout, we have orphaned "Pending" records.

**RECOMMENDATION**:
```python
# Add cleanup job for abandoned Stripe sessions
@scheduler.scheduled_job('interval', hours=1)
async def cleanup_abandoned_stripe_sessions():
    # Find PaymentTransactions with status='Pending' older than 30 min
    # Check Stripe session status
    # Mark as 'Abandoned' or delete
```

### IDENTIFIED GAPS:

| Flow | Metadata Confirmed Before Success? | Atomic? |
|------|-----------------------------------|---------|
| Captain Credit Payment | ✅ Yes | ✅ Yes |
| Crew Credit Payment | ✅ Yes | ✅ Yes |
| Stripe Checkout (Captain) | ⚠️ Yes, but in callback | ⚠️ Two-phase |
| Credit Top-up | ⚠️ Needs audit | Unknown |

---

## 2. LIVE ACTIVE SHOOTING: Session Persistence

### Current State: ⚠️ NEEDS IMPROVEMENT

#### Session Lifecycle Status Enum:
```python
class DispatchRequestStatusEnum(enum.Enum):
    PENDING_PAYMENT = "pending_payment"
    SEARCHING_FOR_PRO = "searching_for_pro"
    ACCEPTED = "accepted"
    EN_ROUTE = "en_route"
    ARRIVED = "arrived"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
```

#### Data Locking Analysis:

**ISSUE FOUND**: When session moves to `ARRIVED`, a `Booking` is auto-created (line 1217), but participant data is NOT locked.

```python
# Current implementation (dispatch.py:1217-1230):
booking = Booking(
    photographer_id=photographer_id,
    surf_spot_id=dispatch.spot_id,
    # ... other fields
    dispatch_request_id=dispatch.id  # Links to dispatch
)
```

**PROBLEM**: Participant list is pulled dynamically from `DispatchRequestParticipant`. If a participant record is modified mid-session, it affects the live session.

**RECOMMENDATION**:
```python
# Snapshot participant data when session goes ARRIVED
class SessionSnapshot(Base):
    __tablename__ = 'session_snapshots'
    id = Column(String(36), primary_key=True)
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id'))
    booking_id = Column(String(36), ForeignKey('bookings.id'))
    snapshot_data = Column(JSON)  # Frozen participant list with selfies
    created_at = Column(DateTime(timezone=True))
```

---

## 3. SOCIAL MEDIA & ASSOCIATION INTEGRITY

### Current State: ✅ SECURE (Proper Foreign Keys)

#### User-Session Associations:
```sql
-- All participant tables have proper CASCADE rules:
participant_id ForeignKey('profiles.id', ondelete='CASCADE')
booking_id ForeignKey('bookings.id', ondelete='CASCADE')
dispatch_request_id ForeignKey('dispatch_requests.id', ondelete='CASCADE')
```

#### Social Handle Linking:
```python
# Profile model (models.py:53-180):
user_id = Column(String(36), unique=True, nullable=False, index=True)
username = Column(String(50), unique=True, nullable=False, index=True)
instagram_handle = Column(String(100), nullable=True)
tiktok_handle = Column(String(100), nullable=True)
```

**VERIFIED**: When user reloads credits, their profile associations remain intact because:
1. `CreditTransaction` links via `user_id` with CASCADE
2. Profile relationships are unaffected by credit balance changes

#### Media Tagging Integrity:
```python
# UserTag model (models.py:1220-1234):
tagged_user_id = ForeignKey('profiles.id', ondelete='CASCADE')
media_id = ForeignKey('user_media.id', ondelete='CASCADE')
```
**Status**: ✅ Tags properly cascade on user/media deletion

---

## 4. STATE PERSISTENCE DURING EXTERNAL REDIRECTS

### Current State: ⚠️ PARTIALLY PERSISTENT

#### Stripe Redirect Flow:
```
1. Frontend calls POST /dispatch/checkout
2. Backend creates PaymentTransaction (Pending) in DB ✅
3. Backend returns checkout_url
4. Frontend redirects to Stripe (client-side state lost)
5. User returns to /dispatch/success?session_id=xxx&dispatch_id=yyy
6. Backend verifies with Stripe, updates records
```

**PERSISTENT STATE**:
- ✅ `PaymentTransaction.session_id` stored in DB
- ✅ `DispatchRequest.stripe_checkout_session_id` stored in DB
- ✅ Dispatch ID passed in success URL

**VOLATILE STATE (Potential Issues)**:
- ⚠️ If user closes browser mid-checkout, pending state remains
- ⚠️ No cleanup mechanism for abandoned sessions

**RECOMMENDATION**:
Add `pending_payment_expires_at` field:
```python
# In DispatchRequest model:
pending_payment_expires_at = Column(DateTime(timezone=True), nullable=True)

# Set on checkout creation:
dispatch.pending_payment_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)

# Scheduler cleans up expired pending payments
```

---

## 5. VISIBILITY & OWNERSHIP: Orphaned Records Scan

### Current State: ⚠️ POTENTIAL ORPHAN SCENARIOS

#### Schema Analysis:

| Table | Link Column | ondelete | Risk |
|-------|-------------|----------|------|
| DispatchRequestParticipant | dispatch_request_id | CASCADE | ✅ Low |
| DispatchRequestParticipant | participant_id | CASCADE | ✅ Low |
| BookingParticipant | booking_id | CASCADE | ✅ Low |
| PaymentTransaction | user_id | CASCADE | ✅ Low |
| CreditTransaction | reference_id | NO FK | ⚠️ Medium |

**ISSUE FOUND**: `CreditTransaction.reference_id` is a soft reference (no FK constraint):
```python
reference_id = Column(String(36), nullable=True)  # No ForeignKey!
```

This means if a dispatch/booking is deleted, the credit transaction still references it by ID but won't cascade.

**RECOMMENDATION**:
```sql
-- Add index for orphan detection:
CREATE INDEX idx_credit_tx_reference ON credit_transactions(reference_type, reference_id);

-- Periodic integrity check:
SELECT * FROM credit_transactions ct
WHERE ct.reference_type = 'dispatch_request'
AND NOT EXISTS (
    SELECT 1 FROM dispatch_requests dr WHERE dr.id = ct.reference_id
);
```

#### "2/2 Paid" Without Participant Link Check:

Current implementation correctly uses **participant list** not just count:
```python
# dispatch.py:2262-2268
all_participants_result = await db.execute(
    select(DispatchRequestParticipant)
    .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
)
all_participants = all_participants_result.scalars().all()
paid_crew = sum(1 for p in all_participants if p.paid or p.id == participant_id)
```

**Status**: ✅ SECURE - Payment status derived from actual participant records, not a separate counter.

---

## 6. DASHBOARD INJECTION LOGIC

### Current State: ✅ SECURE (List-Based, Not Count-Based)

#### Photographer Dashboard Data Fetching:
```python
# dispatch.py:1800-1830 - Pending dispatches endpoint
crew_info = []
for cp in crew_participants:
    if cp.payer_name or cp.payer_username:
        # Use cached metadata (guaranteed present after atomic payment)
        crew_info.append({
            "id": cp.participant_id,
            "name": cp.payer_name,
            "username": cp.payer_username,
            "avatar_url": cp.payer_avatar_url,
            "selfie_url": cp.selfie_url,  # SELFIE INCLUDED
            "status": cp.status,
            "paid": cp.paid,
            ...
        })
```

**VERIFIED**:
1. ✅ Dashboard pulls from `DispatchRequestParticipant` **list**, not a count field
2. ✅ Each paid slot includes user ID, name, username, avatar, selfie
3. ✅ `captain_metadata_verified` flag indicates atomic write completed
4. ✅ Crew payment status includes both `paid_count` AND full `crew` array

#### Response Structure Verification:
```json
{
  "crew_payment_status": {
    "paid_count": 1,        // For quick display
    "total_count": 2,
    "captain_paid": true,
    "all_paid": false,
    "fully_funded": false
  },
  "crew": [                 // FULL LIST for card display
    {
      "id": "user-123",
      "name": "John Doe",
      "selfie_url": "/api/uploads/...",
      "paid": true
    }
  ]
}
```

**Status**: ✅ SECURE - Every paid slot MUST have a participant record with metadata to appear.

---

## SUMMARY: Critical Issues & Recommendations

### 🔴 HIGH PRIORITY

1. **Abandoned Stripe Sessions**: Add cleanup scheduler for PaymentTransactions stuck in "Pending"
2. **Session Snapshot**: Freeze participant data when session goes ARRIVED to prevent mid-session mutations

### 🟡 MEDIUM PRIORITY

3. **Credit Transaction Soft References**: Add FK or periodic integrity checks
4. **Pending Payment Expiry**: Add `pending_payment_expires_at` field

### 🟢 LOW PRIORITY (Already Addressed)

5. ✅ Atomic transactions for credit payments
6. ✅ Metadata injection with rollback
7. ✅ Dashboard uses participant list not count
8. ✅ Proper CASCADE rules on foreign keys

---

## VERIFICATION QUERIES

```sql
-- Find orphaned payment transactions (abandoned checkouts)
SELECT * FROM payment_transactions 
WHERE payment_status = 'Pending' 
AND created_at < NOW() - INTERVAL '30 minutes';

-- Find dispatches with mismatched participant counts
SELECT dr.id, dr.status,
       (SELECT COUNT(*) FROM dispatch_request_participants WHERE dispatch_request_id = dr.id) as participant_count,
       (SELECT COUNT(*) FROM dispatch_request_participants WHERE dispatch_request_id = dr.id AND paid = true) as paid_count
FROM dispatch_requests dr
WHERE dr.is_shared = true AND dr.status NOT IN ('cancelled', 'completed');

-- Find credit transactions referencing deleted dispatches
SELECT ct.* FROM credit_transactions ct
WHERE ct.reference_type = 'dispatch_request'
AND ct.reference_id NOT IN (SELECT id FROM dispatch_requests);
```

---

*Audit completed by Winston (Architect Agent)*
