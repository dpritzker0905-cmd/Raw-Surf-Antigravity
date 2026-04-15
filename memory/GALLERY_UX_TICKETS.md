# Gallery UX Implementation Tickets

**Created**: December 2025  
**Status**: Ready for Implementation  
**Total Tickets**: 8 P0-P2 priorities

---

## P0 - Critical UX Improvements

### TICKET-001: Pricing Transparency Badges
**Priority**: P0 (Critical)  
**Estimated Effort**: Medium  
**Components**: Frontend (GalleryItemModal, GalleryPricingCard)

#### Problem
Multiple pricing override layers (photographer → session → gallery → item) make it hard for surfers to understand why prices differ between photos. A photo might cost $5 from one session and $10 from another with no explanation.

#### Solution
Add visual `price_source` badges in the purchase UI showing the pricing context:
- "Session Deal" (green) - Price locked from session join
- "Gallery Price" (blue) - Gallery-level override
- "Custom Price" (amber) - Photographer set special price
- "Standard Rate" (gray) - Default photographer pricing

#### Technical Implementation

**Backend Changes** (`/app/backend/routes/gallery.py`):
- The `price_source` field already exists in the pricing endpoint response (L593-594)
- Ensure all pricing scenarios return correct source

**Frontend Changes**:

1. **Create PriceSourceBadge component** (`/app/frontend/src/components/gallery/PriceSourceBadge.js`):
```jsx
const PriceSourceBadge = ({ source, originalPrice, currentPrice }) => {
  const badges = {
    'free_from_buyin': { label: 'Included Free', color: 'bg-green-500', icon: Gift },
    'item_locked': { label: 'Session Rate', color: 'bg-cyan-500', icon: Lock },
    'participant_locked': { label: 'Your Deal', color: 'bg-emerald-500', icon: Star },
    'session_override': { label: 'Session Price', color: 'bg-blue-500', icon: Zap },
    'general': { label: 'Standard', color: 'bg-zinc-600', icon: Tag }
  };
  // Show savings if applicable
  const savings = originalPrice && currentPrice < originalPrice 
    ? ((originalPrice - currentPrice) / originalPrice * 100).toFixed(0) 
    : null;
  // ... render badge with optional "Save X%" chip
};
```

2. **Update GalleryPricingCard** (`/app/frontend/src/components/gallery/GalleryPricingCard.js`):
- Add PriceSourceBadge next to each tier price
- Show crossed-out "general_price" when session deal applies

3. **Update GalleryItemModal** (`/app/frontend/src/components/gallery/GalleryItemModal.js`):
- Display price source context in purchase confirmation

#### Files to Modify
- `/app/frontend/src/components/gallery/GalleryPricingCard.js`
- `/app/frontend/src/components/gallery/GalleryItemModal.js`
- `/app/frontend/src/components/gallery/PriceSourceBadge.js` (NEW)

#### Acceptance Criteria
- [ ] Badge shows correct source for all 5 pricing scenarios
- [ ] Savings percentage shown when session price < general price
- [ ] Tooltip explains what each badge means on hover
- [ ] Works on mobile (touch to show tooltip)

---

### TICKET-002: Selection Deadline Countdown
**Priority**: P0 (Critical)  
**Estimated Effort**: Medium  
**Components**: Frontend (PhotoSelectionQueue, SurferGallery)

#### Problem
Surfers have limited time to select their "included" photos but the deadline and auto-select behavior isn't prominently displayed. Many surfers miss the window and forfeit free photos.

#### Solution
Add prominent countdown timer with clear explanation of what happens at deadline:
- Real-time countdown (days/hours/minutes)
- Visual urgency indicators (yellow < 24h, red < 1h)
- Clear "What happens" explanation panel
- Push notification 24h and 1h before deadline

#### Technical Implementation

**Backend Changes** (`/app/backend/routes/surfer_gallery.py`):
- Endpoint already returns `selection_deadline` and `time_remaining_seconds` (L1289-1329)
- Add new endpoint for batch deadline check across all quotas

```python
@router.get("/selection-deadlines/{surfer_id}")
async def get_all_selection_deadlines(surfer_id: str, db: AsyncSession = Depends(get_db)):
    """Get all pending selection deadlines for notification scheduling"""
    # Return list of {quota_id, deadline, photos_remaining, urgency_level}
```

**Frontend Changes**:

1. **Create SelectionCountdown component** (`/app/frontend/src/components/gallery/SelectionCountdown.js`):
```jsx
const SelectionCountdown = ({ deadline, photosRemaining, onExpired }) => {
  const [timeLeft, setTimeLeft] = useState(null);
  
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = new Date(deadline) - new Date();
      if (diff <= 0) {
        onExpired?.();
        clearInterval(timer);
      }
      setTimeLeft(diff);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  
  const urgency = timeLeft < 3600000 ? 'critical' : timeLeft < 86400000 ? 'warning' : 'normal';
  
  return (
    <div className={`selection-countdown ${urgency}`}>
      <Clock className="animate-pulse" />
      <span>{formatTimeLeft(timeLeft)}</span>
      <span>to select {photosRemaining} photos</span>
      <Tooltip content="After deadline, photos will be auto-selected based on quality or forfeited based on your preference" />
    </div>
  );
};
```

2. **Update PhotoSelectionQueue** (`/app/frontend/src/components/PhotoSelectionQueue.js`):
- Add SelectionCountdown at top of queue
- Add "What happens at deadline" expandable panel
- Add preference toggle (auto-select vs forfeit)

3. **Add to main navigation badge** (`/app/frontend/src/components/BottomNav.js` or similar):
- Show red dot on Gallery icon when urgent selections pending

#### Files to Modify
- `/app/frontend/src/components/gallery/SelectionCountdown.js` (NEW)
- `/app/frontend/src/components/PhotoSelectionQueue.js`
- `/app/frontend/src/components/SurferGallery.js`
- `/app/backend/routes/surfer_gallery.py`

#### Acceptance Criteria
- [ ] Countdown updates every second
- [ ] Color changes: green (>24h) → yellow (<24h) → red (<1h)
- [ ] "What happens" panel explains auto-select vs forfeit
- [ ] Preference toggle saves to backend
- [ ] Navigation badge shows count of urgent selections
- [ ] Push notification sent at 24h and 1h marks

---

## P1 - High Priority Improvements

### TICKET-003: Crew Payment Progress Visibility
**Priority**: P1 (High)  
**Estimated Effort**: Medium  
**Components**: Frontend (OnDemandTab, Bookings), Backend (dispatch)

#### Problem
Media shows "Pending" until all crew members pay, causing frustration. Surfers don't know who hasn't paid or how long they'll be waiting.

#### Solution
- Show individual progress bar per crew member
- Display who has paid vs pending
- Allow captain to "cover" remaining shares to unlock immediately
- Send gentle reminder push to unpaid crew members

#### Technical Implementation

**Backend Changes** (`/app/backend/routes/dispatch.py`):

1. Add crew status endpoint (may already exist as `/crew-status`):
```python
@router.get("/{dispatch_id}/crew-payment-status")
async def get_crew_payment_status(dispatch_id: str, db: AsyncSession = Depends(get_db)):
    """Get detailed payment status per crew member"""
    # Return: [{user_id, name, avatar, share_amount, paid, paid_at}]
```

2. Add captain cover endpoint:
```python
@router.post("/{dispatch_id}/cover-remaining")
async def captain_cover_remaining(dispatch_id: str, captain_id: str, db: AsyncSession = Depends(get_db)):
    """Captain pays remaining unpaid crew shares to unlock media immediately"""
    # Calculate total unpaid, deduct from captain credits, mark all as paid
```

**Frontend Changes**:

1. **Create CrewPaymentProgress component** (`/app/frontend/src/components/dispatch/CrewPaymentProgress.js`):
```jsx
const CrewPaymentProgress = ({ dispatchId, crewMembers, captainId, onAllPaid }) => {
  const paidCount = crewMembers.filter(m => m.paid).length;
  const totalCount = crewMembers.length;
  const unpaidAmount = crewMembers.filter(m => !m.paid).reduce((sum, m) => sum + m.share_amount, 0);
  
  return (
    <div>
      <ProgressBar value={paidCount} max={totalCount} />
      <div className="crew-avatars">
        {crewMembers.map(m => (
          <CrewMemberChip key={m.user_id} {...m} />
        ))}
      </div>
      {captainId === currentUserId && unpaidAmount > 0 && (
        <Button onClick={() => coverRemaining(unpaidAmount)}>
          Cover ${unpaidAmount} to unlock now
        </Button>
      )}
    </div>
  );
};
```

2. **Update OnDemandTab** (`/app/frontend/src/components/bookings/OnDemandTab.js`):
- Replace generic "Waiting for crew" with CrewPaymentProgress
- Poll for status updates every 10 seconds

3. **Add reminder functionality**:
- "Send reminder" button for captain
- Backend sends push notification to unpaid crew

#### Files to Modify
- `/app/frontend/src/components/dispatch/CrewPaymentProgress.js` (NEW)
- `/app/frontend/src/components/bookings/OnDemandTab.js`
- `/app/frontend/src/components/CrewPaymentModal.js`
- `/app/backend/routes/dispatch.py`

#### Acceptance Criteria
- [ ] Progress bar shows X/Y paid visually
- [ ] Each crew member shown with avatar + paid/pending status
- [ ] Captain sees "Cover $X to unlock" button
- [ ] Cover action deducts credits and unlocks media
- [ ] "Send reminder" sends push to unpaid members
- [ ] Real-time updates when crew member pays

---

### TICKET-004: Quality Tier Comparison Preview
**Priority**: P1 (High)  
**Estimated Effort**: Large  
**Components**: Frontend (GalleryItemModal), Backend (gallery)

#### Problem
Surfers booking On-Demand may not realize they're locked to 1080p max (vs. 4K for Scheduled). When purchasing, they don't see what they're getting at each tier.

#### Solution
- Show quality tier badge at booking time
- Add side-by-side quality comparison in purchase modal
- "Zoom preview" showing actual resolution difference
- Clear labeling: "Standard Quality (1080p)" vs "Pro Quality (4K)"

#### Technical Implementation

**Backend Changes** (`/app/backend/routes/gallery.py`):

Add preview generation endpoint:
```python
@router.get("/gallery/item/{item_id}/quality-preview")
async def get_quality_previews(item_id: str, db: AsyncSession = Depends(get_db)):
    """Generate comparison preview URLs at different quality tiers"""
    # Return: {
    #   web: { url, dimensions: "800x600", file_size: "120KB" },
    #   standard: { url, dimensions: "1920x1080", file_size: "450KB" },
    #   high: { url, dimensions: "4000x3000", file_size: "2.1MB" }
    # }
```

**Frontend Changes**:

1. **Create QualityComparisonModal** (`/app/frontend/src/components/gallery/QualityComparisonModal.js`):
```jsx
const QualityComparisonModal = ({ itemId, availableTiers }) => {
  const [selectedTier, setSelectedTier] = useState('standard');
  const [zoomArea, setZoomArea] = useState(null);
  
  return (
    <Dialog>
      {/* Tier selector tabs */}
      <Tabs value={selectedTier} onValueChange={setSelectedTier}>
        {availableTiers.map(tier => (
          <TabsTrigger key={tier.name} value={tier.name}>
            {tier.label} ({tier.dimensions})
          </TabsTrigger>
        ))}
      </Tabs>
      
      {/* Main preview with zoom capability */}
      <div className="preview-container" onClick={handleZoom}>
        <img src={previews[selectedTier].url} />
        {zoomArea && <ZoomLens area={zoomArea} />}
      </div>
      
      {/* Quality info */}
      <div className="quality-info">
        <span>Resolution: {previews[selectedTier].dimensions}</span>
        <span>File size: {previews[selectedTier].file_size}</span>
        <span>Best for: {tierUseCases[selectedTier]}</span>
      </div>
    </Dialog>
  );
};
```

2. **Add tier badge to booking flow**:
- `/app/frontend/src/components/OnDemandRequestDrawer.js` - Add "Standard Quality (1080p max)" badge
- `/app/frontend/src/components/ScheduledBookingDrawer.js` - Add "Pro Quality (4K)" badge

3. **Update GalleryItemModal**:
- Add "Compare quality" button that opens QualityComparisonModal
- Show tier-appropriate "Best for: Social sharing / Prints / Large prints" labels

#### Files to Modify
- `/app/frontend/src/components/gallery/QualityComparisonModal.js` (NEW)
- `/app/frontend/src/components/gallery/GalleryItemModal.js`
- `/app/frontend/src/components/OnDemandRequestDrawer.js`
- `/app/frontend/src/components/ScheduledBookingDrawer.js`
- `/app/backend/routes/gallery.py`

#### Acceptance Criteria
- [ ] Booking drawers show quality tier badge
- [ ] Purchase modal has "Compare quality" button
- [ ] Comparison shows actual resolution + file size
- [ ] Zoom preview works on both desktop and mobile
- [ ] "Best for" labels help surfers choose appropriate tier
- [ ] Unavailable tiers (due to service type) shown as locked

---

## P2 - Medium Priority Improvements

### TICKET-005: Bulk Purchase Discount
**Priority**: P2 (Medium)  
**Estimated Effort**: Medium  
**Components**: Frontend (SurferGallery), Backend (gallery)

#### Problem
Surfers who want multiple photos from a session must purchase one at a time with no volume incentive. This reduces average order value.

#### Solution
- Add "Select multiple" mode in gallery
- Show running total with volume discount tiers
- Discount tiers: 3+ photos (10% off), 5+ (15% off), 10+ (20% off)
- Photographer can customize discount tiers

#### Technical Implementation

**Backend Changes**:

1. Add bulk purchase endpoint (`/app/backend/routes/gallery.py`):
```python
class BulkPurchaseRequest(BaseModel):
    item_ids: List[str]
    quality_tiers: Dict[str, str]  # {item_id: tier}
    buyer_id: str

@router.post("/gallery/bulk-purchase")
async def bulk_purchase_items(data: BulkPurchaseRequest, db: AsyncSession = Depends(get_db)):
    """Purchase multiple items with volume discount"""
    # Calculate base total
    # Apply discount tier
    # Single credit transaction
    # Create GalleryPurchase records for each item
```

2. Add photographer discount settings to Profile model:
```python
# Already in models.py - just need to use them:
group_discount_2_plus = Column(Float, default=0.0)
group_discount_3_plus = Column(Float, default=0.0)
group_discount_5_plus = Column(Float, default=0.0)
```

**Frontend Changes**:

1. **Create BulkPurchaseBar** (`/app/frontend/src/components/gallery/BulkPurchaseBar.js`):
```jsx
const BulkPurchaseBar = ({ selectedItems, onPurchase, discountTiers }) => {
  const baseTotal = selectedItems.reduce((sum, item) => sum + item.price, 0);
  const discount = calculateDiscount(selectedItems.length, discountTiers);
  const finalTotal = baseTotal * (1 - discount);
  
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4">
      <div className="flex items-center justify-between">
        <div>
          <span>{selectedItems.length} photos selected</span>
          {discount > 0 && (
            <Badge className="bg-green-500">{discount * 100}% off</Badge>
          )}
        </div>
        <div className="text-right">
          {discount > 0 && <span className="line-through text-muted">${baseTotal}</span>}
          <span className="text-xl font-bold">${finalTotal.toFixed(2)}</span>
        </div>
        <Button onClick={onPurchase}>Purchase All</Button>
      </div>
      {/* Next discount tier hint */}
      <NextDiscountHint currentCount={selectedItems.length} tiers={discountTiers} />
    </div>
  );
};
```

2. **Update SurferGallery** (`/app/frontend/src/components/SurferGallery.js`):
- Add multi-select mode toggle
- Show BulkPurchaseBar when items selected
- Checkbox UI on each gallery item

#### Files to Modify
- `/app/frontend/src/components/gallery/BulkPurchaseBar.js` (NEW)
- `/app/frontend/src/components/SurferGallery.js`
- `/app/frontend/src/components/gallery/GalleryItemCard.js` (add checkbox)
- `/app/backend/routes/gallery.py`

#### Acceptance Criteria
- [ ] Multi-select mode toggleable
- [ ] Running total updates as items selected
- [ ] Discount applied automatically at tier thresholds
- [ ] "Add X more for Y% off" hint shown
- [ ] Single transaction for all items
- [ ] Individual download links generated for each purchase

---

### TICKET-006: Photographer Earnings Dashboard
**Priority**: P2 (Medium)  
**Estimated Effort**: Large  
**Components**: Frontend (new page), Backend (analytics)

#### Problem
Photographers lack visibility into their earnings trends, best-selling content, and revenue optimization opportunities.

#### Solution
Comprehensive earnings dashboard with:
- Daily/weekly/monthly revenue charts
- Top-selling photos/videos
- Average sale price by tier
- Session type breakdown (on-demand vs scheduled)
- Pending vs cleared earnings
- Payout history

#### Technical Implementation

**Backend Changes** (`/app/backend/routes/analytics.py` or new `earnings.py`):

```python
@router.get("/earnings/dashboard/{photographer_id}")
async def get_earnings_dashboard(
    photographer_id: str,
    period: str = "30d",  # 7d, 30d, 90d, 1y
    db: AsyncSession = Depends(get_db)
):
    """Get comprehensive earnings analytics"""
    return {
        "summary": {
            "total_earnings": float,
            "pending_earnings": float,
            "cleared_earnings": float,
            "total_sales": int,
            "avg_sale_price": float
        },
        "daily_revenue": [{"date": str, "amount": float, "sales": int}],
        "top_items": [{"id": str, "thumbnail": str, "sales": int, "revenue": float}],
        "tier_breakdown": {"web": float, "standard": float, "high": float},
        "service_breakdown": {"on_demand": float, "scheduled": float, "live_session": float},
        "recent_sales": [{"buyer_name": str, "item_thumbnail": str, "amount": float, "date": str}]
    }
```

**Frontend Changes**:

1. **Create EarningsDashboard page** (`/app/frontend/src/pages/EarningsDashboard.js`):
```jsx
const EarningsDashboard = () => {
  const [period, setPeriod] = useState('30d');
  const { data } = useEarningsData(period);
  
  return (
    <div className="earnings-dashboard">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Earnings" value={data.summary.total_earnings} trend={+12} />
        <StatCard title="Pending" value={data.summary.pending_earnings} />
        <StatCard title="Sales" value={data.summary.total_sales} />
        <StatCard title="Avg Sale" value={data.summary.avg_sale_price} />
      </div>
      
      {/* Revenue chart */}
      <RevenueChart data={data.daily_revenue} period={period} />
      
      {/* Top sellers */}
      <TopSellingItems items={data.top_items} />
      
      {/* Breakdowns */}
      <div className="grid grid-cols-2 gap-4">
        <TierBreakdownPie data={data.tier_breakdown} />
        <ServiceBreakdownPie data={data.service_breakdown} />
      </div>
      
      {/* Recent activity */}
      <RecentSalesFeed sales={data.recent_sales} />
    </div>
  );
};
```

2. **Add navigation entry**:
- Add "Earnings" tab in photographer profile/dashboard
- Add earnings summary widget on home feed

#### Files to Modify
- `/app/frontend/src/pages/EarningsDashboard.js` (NEW)
- `/app/frontend/src/components/earnings/RevenueChart.js` (NEW)
- `/app/frontend/src/components/earnings/TopSellingItems.js` (NEW)
- `/app/backend/routes/earnings.py` (NEW) or extend `/app/backend/routes/analytics.py`
- `/app/frontend/src/App.js` (add route)

#### Acceptance Criteria
- [ ] Dashboard loads within 2 seconds
- [ ] Period selector (7d/30d/90d/1y) updates all widgets
- [ ] Revenue chart shows daily/weekly bars based on period
- [ ] Top sellers show thumbnail + revenue + sale count
- [ ] Tier breakdown shows which quality tiers sell best
- [ ] Recent sales feed updates in real-time via WebSocket
- [ ] Export to CSV option for accounting

---

### TICKET-007: AI Claim Queue Awareness
**Priority**: P2 (Medium)  
**Estimated Effort**: Small  
**Components**: Frontend (navigation), Backend (notifications)

#### Problem
AI-suggested photos go to a separate "Review & Claim" queue that surfers often miss, leaving potential matches unclaimed.

#### Solution
- Add badge count in main navigation for pending AI matches
- Push notification when new AI match detected
- Highlight in Gallery tab as sub-section
- Weekly digest email of unclaimed matches

#### Technical Implementation

**Backend Changes**:

1. Add claim queue count to user profile fetch (`/app/backend/routes/auth.py` or profile endpoint):
```python
# Include in profile response:
"pending_ai_matches": await get_pending_ai_match_count(user_id, db)
```

2. Trigger push notification on new AI match (`/app/backend/routes/ai_tagging.py`):
```python
# After adding to SurferGalleryClaimQueue:
await send_push_notification(
    surfer_id,
    title="New photo match!",
    body=f"{photographer_name} may have captured you at {spot_name}",
    data={"type": "ai_match", "queue_item_id": queue_item.id}
)
```

**Frontend Changes**:

1. **Update BottomNav/Navigation** (`/app/frontend/src/components/BottomNav.js`):
```jsx
const GalleryNavItem = ({ pendingMatches }) => (
  <NavItem to="/gallery">
    <ImageIcon />
    {pendingMatches > 0 && (
      <Badge className="absolute -top-1 -right-1 bg-cyan-500 text-xs">
        {pendingMatches}
      </Badge>
    )}
  </NavItem>
);
```

2. **Update SurferGallery** (`/app/frontend/src/components/SurferGallery.js`):
- Add "AI Matches" section at top when pending matches exist
- Animated highlight effect to draw attention

#### Files to Modify
- `/app/frontend/src/components/BottomNav.js` (or main navigation)
- `/app/frontend/src/components/SurferGallery.js`
- `/app/backend/routes/ai_tagging.py`
- `/app/backend/routes/auth.py` or profile endpoint

#### Acceptance Criteria
- [ ] Badge shows count of pending AI matches in navigation
- [ ] Badge updates in real-time when new match added
- [ ] Push notification sent for each new AI match
- [ ] Tapping notification deep-links to claim queue
- [ ] "AI Matches" section prominently displayed in gallery

---

### TICKET-008: Download Limit & Visibility Clarity
**Priority**: P2 (Medium)  
**Estimated Effort**: Small  
**Components**: Frontend (download UI, visibility toggle)

#### Problem
1. `max_downloads = 5` limit per purchase isn't shown until downloads are depleted
2. The Locker (private) vs Sessions Tab (public) distinction isn't immediately clear

#### Solution
1. Show "3/5 downloads remaining" prominently in download button
2. Visual metaphor: 🔒 Locker icon vs 🌐 Globe icon with tooltip explaining visibility

#### Technical Implementation

**Frontend Changes**:

1. **Update download button** (`/app/frontend/src/components/SurferGallery.js`):
```jsx
const DownloadButton = ({ item, onDownload }) => {
  const remaining = item.max_downloads - item.download_count;
  const isLow = remaining <= 2;
  
  return (
    <Button onClick={onDownload} disabled={remaining === 0}>
      <Download />
      <span>{remaining}/{item.max_downloads}</span>
      {isLow && <Tooltip content="Limited downloads remaining" />}
    </Button>
  );
};
```

2. **Update visibility toggle** (`/app/frontend/src/components/SurferGallery.js`):
```jsx
const VisibilityToggle = ({ isPublic, onChange }) => (
  <div className="flex items-center gap-2">
    <button 
      onClick={() => onChange(false)}
      className={!isPublic ? 'active' : ''}
    >
      <Lock className="w-4 h-4" />
      <span>Locker</span>
      <Tooltip content="Only you can see this photo" />
    </button>
    <button 
      onClick={() => onChange(true)}
      className={isPublic ? 'active' : ''}
    >
      <Globe className="w-4 h-4" />
      <span>Public</span>
      <Tooltip content="Visible on your Sessions tab for followers" />
    </button>
  </div>
);
```

3. **Add onboarding tooltip**:
- First-time users see brief explanation of Locker vs Public
- Dismissable "Got it" that sets localStorage flag

#### Files to Modify
- `/app/frontend/src/components/SurferGallery.js`
- `/app/frontend/src/components/gallery/GalleryItemCard.js`

#### Acceptance Criteria
- [ ] Download button shows X/5 remaining
- [ ] Warning color when ≤2 downloads remaining
- [ ] Disabled state when 0 remaining with "Contact support" message
- [ ] Visibility toggle uses clear Lock vs Globe icons
- [ ] Tooltips explain each visibility state
- [ ] First-time onboarding explains the difference

---

## Implementation Order Recommendation

```
Phase 1 (Week 1-2): P0 Critical
├── TICKET-001: Pricing Transparency Badges
└── TICKET-002: Selection Deadline Countdown

Phase 2 (Week 3-4): P1 High Priority
├── TICKET-003: Crew Payment Progress
└── TICKET-004: Quality Tier Comparison

Phase 3 (Week 5-6): P2 Medium Priority
├── TICKET-005: Bulk Purchase Discount
├── TICKET-006: Earnings Dashboard
├── TICKET-007: AI Claim Queue Awareness
└── TICKET-008: Download Limit & Visibility Clarity
```

---

## Testing Requirements

Each ticket should include:
1. Unit tests for new backend endpoints
2. Component tests for new React components
3. E2E test for complete user flow
4. Mobile responsiveness verification
5. Accessibility check (ARIA labels, keyboard navigation)

---

## Related Files Reference

| Component | Path |
|-----------|------|
| Gallery Routes | `/app/backend/routes/gallery.py` |
| Surfer Gallery Routes | `/app/backend/routes/surfer_gallery.py` |
| Dispatch Routes | `/app/backend/routes/dispatch.py` |
| Models | `/app/backend/models.py` |
| SurferGallery Component | `/app/frontend/src/components/SurferGallery.js` |
| GalleryItemModal | `/app/frontend/src/components/gallery/GalleryItemModal.js` |
| PhotoSelectionQueue | `/app/frontend/src/components/PhotoSelectionQueue.js` |
| OnDemandTab | `/app/frontend/src/components/bookings/OnDemandTab.js` |
