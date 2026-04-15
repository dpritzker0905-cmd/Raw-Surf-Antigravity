# Raw Surf OS - Product Requirements Document

## Overview
Raw Surf OS is a social platform for surfers and surf photographers. The app manages live and on-demand photography dispatch, photographer directory, feed posts, subscriptions, admin verification queues, and AI identity matching.

## Tech Stack
- **Frontend**: React, Shadcn/UI, Tailwind CSS
- **Backend**: FastAPI, PostgreSQL, SQLAlchemy
- **Payments**: Stripe Payments & Custom Credit System
- **Maps**: Mapbox/Leaflet with Geofencing

## Core Features

### Implemented (as of April 2025)
- User authentication and profiles
- Photographer directory and booking system
- On-demand dispatch (Uber-style reverse requests for photographers)
- Live photography sessions
- Feed posts (social features)
- Credit system with Stripe payments
- Admin verification queue for Pro applications
- Grom (youth) accounts with parental controls
- Push notifications (OneSignal)
- Real-time GPS tracking during sessions

### Recent Updates (April 10, 2025)

**1. On-Demand Stripe Payment Flow Fix**
- **Issue**: Card payments were taking users backwards instead of forward
- **Fix**: 
  - Added `POST /api/dispatch/checkout` for Stripe Checkout session creation
  - Added `GET /api/dispatch/payment-success` for payment confirmation
  - Created `DispatchPaymentSuccess.js` component for post-payment flow
  - Card payments now redirect to Stripe, then return to selfie upload

**2. Booking Fulfillment Data Flow Fix**  
- **Issue**: Crew members who paid couldn't see dispatch on their schedule; photographer dashboard missing crew selfies
- **Fix**:
  - Enhanced `/api/dispatch/user/{user_id}/active` to check `DispatchRequestParticipant` for paid crew members
  - Returns `role: "crew_member"` for paid participants
  - Frontend now shows dispatches for all roles: requester, crew_member, photographer
  - Crew info with selfie URLs included in response

**3. Gallery Upload 404 Error Fix**
- **Issue**: Photographer gallery uploads returning "not found" error
- **Fix**:
  - Fixed `PhotographerGalleryManager.js` to use correct endpoint `/upload/photographer-gallery` instead of non-existent `/uploads/gallery-item`
  - Changed form field from `photographer_id` to `user_id`
  - Added watermark preview option and detailed error messages

**4. Data Integrity & Metadata Sync Fix**
- **Issue**: Phantom bookings (payment succeeds but metadata missing), empty photographer dashboard cards
- **Fix**:
  - Atomic transactions for crew payments (credit deduction + metadata written together or rolled back)
  - Added cached metadata columns to `DispatchRequestParticipant`: `payer_name`, `payer_username`, `payer_avatar_url`
  - Dashboard endpoints now use cached metadata for instant display
  - Selfie validation: Backend returns `needs_selfie: true` if photographer is en route and no selfie provided

**5. Booking Atomicity & Reactive Dashboard Sync**
- **Issue**: "Paid 2/2" status could trigger without proper participant metadata, no reactive updates
- **Fix**:
  - Atomic crew payment transaction: Credit deduction + status + metadata ALL in single DB transaction with rollback
  - Added `all_participants_paid` and `all_participants_paid_at` columns to `DispatchRequest`
  - New `GET /api/dispatch/{id}/crew-status` endpoint for real-time polling
  - Enhanced pending dispatch response with `crew_payment_status` object
  - 5-second polling in photographer dashboard for reactive card injection

**6. Phantom Participant Bug Fix (Complete Architectural Lockdown)**
- **Issue**: Credits taken but no user record created; phantom bookings
- **Fix**:
  - Atomic captain payment: Credit deduction + metadata stored together or rolled back
  - Added `captain_name`, `captain_username`, `captain_avatar_url` to `DispatchRequest`
  - New `GET /api/dispatch/{id}/verify-payment` endpoint for frontend verification
  - Frontend calls verification BEFORE showing success screen
  - Photographer dashboard uses cached metadata (guaranteed present after payment)
  - `captain_metadata_verified` and `metadata_verified` flags for validation

**7. Architecture Audit & Data Integrity Enhancements (April 10, 2025)**
- **SessionSnapshot Model**: Freezes participant data when session marked "ARRIVED" to prevent data loss from mid-session profile changes
- **Credit Transaction Indexing**: Added `idx_credit_tx_reference` for efficient FK lookups
- **Pending Payment Expiry**: Added `pending_payment_expires_at` column to DispatchRequest for checkout timeout tracking
- **Background Schedulers**: Added `cleanup_stripe_sessions` and `credit_integrity_check` periodic jobs
- **Documentation**: Created `/app/ARCHITECTURE_AUDIT.md` with full system analysis

### Gallery UX Improvements (April 11, 2025) - IMPLEMENTED
**Analysis completed** - See `/app/memory/GALLERY_UX_TICKETS.md` for full specifications
**Testing completed** - See `/app/test_reports/iteration_287.json` for test results (100% pass rate)

**P0 - Critical (DONE):**
- ✅ TICKET-001: Pricing Transparency Badges - `PriceSourceBadge`, `QualityTierBadge`, `PriceTierCard` components
- ✅ TICKET-002: Selection Deadline Countdown - Live timer in PhotoSelectionQueue

**P1 - High Priority (DONE):**
- ✅ TICKET-003: Crew Payment Progress - `CrewPaymentProgress` component + `/api/dispatch/{id}/cover-remaining` + `/api/dispatch/{id}/remind-crew`
- ✅ TICKET-004: Quality Tier Comparison - `QualityComparisonModal` + `/api/gallery/item/{id}/quality-previews`

**P2 - Medium Priority (DONE):**
- ✅ TICKET-005: Bulk Purchase - `BulkPurchaseBar`, `MultiSelectToggle` + `/api/gallery/bulk-purchase` with 10/15/20% volume discounts
- ✅ TICKET-006: Earnings Dashboard - Backend endpoints implemented
- ✅ TICKET-007: AI Match Badge - Integrated into Sessions Hub "My Gallery" button with count + `/api/surfer-gallery/claim-queue-count/{surfer_id}`
- ✅ TICKET-008: Download/Visibility - `DownloadButton` (X/5), `VisibilityToggle` (Lock/Globe), `VisibilityOnboarding`

### Upcoming Tasks (P1)
- Travel Commerce Area: Build retreat and surf lodge sales UI inside Passport modal
- End-to-End Itinerary: Full multi-spot travel itinerary planning

### Future/Backlog (P2+)
- Used Surfboard Marketplace: Allow users to sell uploaded surfboards
- Creator Economy Tools: Video editing, AI Session Recaps, Crew Challenges v2
- Music Integration (ON HOLD): Adaptr for Waves, Epidemic Sound for videos

## Key API Endpoints

### Dispatch
- `POST /api/dispatch/request` - Create on-demand dispatch request
- `POST /api/dispatch/{id}/pay` - Pay with credits
- `POST /api/dispatch/checkout` - Create Stripe checkout for card payment
- `GET /api/dispatch/payment-success` - Confirm Stripe payment
- `GET /api/dispatch/user/{id}/active` - Get user's active dispatch (requester, photographer, OR crew member)
- `POST /api/dispatch/{id}/accept` - Photographer accepts request
- `POST /api/dispatch/{id}/update-selfie` - Upload identification selfie
- `POST /api/dispatch/crew-invite/{id}/pay` - Crew member pays their share
- `POST /api/dispatch/{id}/cover-remaining` - Captain covers remaining crew shares (NEW)
- `POST /api/dispatch/{id}/remind-crew` - Send payment reminder to crew (NEW)

### Gallery/Uploads
- `POST /api/upload/photographer-gallery` - Upload media to photographer gallery
- `POST /api/galleries/{id}/items` - Add uploaded item to gallery
- `GET /api/galleries/{id}` - Get gallery details
- `POST /api/gallery/bulk-purchase` - Purchase multiple items with volume discount (NEW)
- `GET /api/gallery/item/{id}/quality-previews` - Get quality tier comparison data (NEW)

### Credits
- `GET /api/credits/balance/{user_id}` - Get user credit balance

## Database Models
- `Profile` - User profiles
- `DispatchRequest` - On-demand photography requests (includes `captain_share_amount`, `pending_payment_expires_at`)
- `DispatchRequestParticipant` - Crew members for split sessions (includes selfie_url, paid boolean, cached metadata)
- `SessionSnapshot` - Frozen participant data captured at session arrival
- `Booking` - Scheduled photography sessions
- `CreditTransaction` - Credit balance tracking (indexed on reference_type/reference_id)
- `PaymentTransaction` - Stripe payment records
- `Gallery` - Photographer galleries
- `GalleryItem` - Individual photos/videos in galleries

## Third-Party Integrations
- OpenAI GPT-4o (Emergent LLM Key)
- Resend (Email)
- Stripe (Payments)
- LiveKit Cloud (Real-time Streaming)
- OneSignal (Push Notifications)

## Recent Updates (April 12, 2025)

**Mobile Dialog/Modal Layout Fixes**

1. **ConditionsModal.js - Camera & Layout Fix**
   - **Camera Issue**: Mobile devices weren't defaulting to rear camera on startup
   - **Fix**: Changed `facingMode: facing` to proper constraint structure `facingMode: { ideal: facing }` with fallback chain (ideal → exact → no constraint)
   - **Layout Issue**: Modal content was overflowing on mobile, buttons cut off at bottom
   - **Fix**: Removed `max-h-[90vh]` override, restructured with proper `flex-1 overflow-y-auto` scrollable content wrapper, buttons in horizontal `flex-row` layout

2. **BookingSelfieModal.js - Mobile Layout Fix**
   - **Issue**: Using `!important` CSS overrides that bypassed base Dialog mobile-friendly styling
   - **Fix**: Removed `!w-[100vw]`, `!left-0` etc., now uses `sm:max-w-[420px]` and lets base Dialog handle mobile

3. **SurferRosterCard.js - Mobile Layout Fix**
   - **Issue**: Same pattern - `!important` overrides causing mobile layout issues
   - **Fix**: Removed overrides, uses proper `sm:max-w-[400px]` constraint

4. **CreatePostModal.js - Mobile Layout Fix**
   - **Issue**: `max-h-[90vh]` with inline style `maxHeight: calc(90vh - 100px)` causing content clipping
   - **Fix**: Restructured with proper scrollable content area and fixed footer with safe-area padding

**Comprehensive Mobile Dialog/Modal Layout Audit (April 12, 2025)**

Fixed 15+ components with mobile layout issues. Pattern applied:
- Removed `max-h-[90vh]` and `!important` CSS overrides
- Added `sm:max-w-[XXpx]` for desktop sizing, letting base Dialog handle mobile
- Restructured with `shrink-0` headers, `flex-1 overflow-y-auto` scrollable content, fixed footers
- Added safe-area padding via `env(safe-area-inset-bottom)`

Components fixed:
| Component | Issue | Fix Applied |
|-----------|-------|-------------|
| LineupManagerDrawer.js | `!important` overrides, `max-h-[85vh]` | Proper Dialog structure, `hideCloseButton` prop |
| ScheduledBookingDrawer.js | Complex `!important` chain | Simplified to `sm:max-w-lg` |
| SessionActionDrawer.js | `!important` overrides, `max-h-[90vh]` | Proper Dialog structure |
| AIProposedMatches.js | `max-h-[90vh]` | Proper scrollable content wrapper |
| CrewPaymentModal.js | `max-h-[90vh]`, nested scroll containers | Single scrollable wrapper |
| GPSSettingsGuide.js | `max-h-[85vh]`, `w-[95vw]` | Proper Dialog mobile handling |
| PhotoUploadModal.js | `max-h-[90vh]` | Proper header/content/footer structure |
| PostMenu.js | `max-h-[90vh]` | Proper Dialog structure |
| WatermarkSettings.js | `max-h-[90vh]` | Proper Dialog structure |
| CreateAdModal.js | `max-h-[90vh]` | Proper Dialog structure |
| PhotographerBookingsManager.js | `max-h-[90vh]` | Proper Dialog structure |

**Remaining files (intentional full-screen behavior):**
- OnDemandRequestDrawer.js - Uses `h-[100dvh]` for full-screen mobile drawer (intentional)
- JumpInSessionModal.js - Custom full-screen implementation with safe-area padding (already fixed)
- UnifiedSpotDrawer.js - Already has proper safe-area handling

## Additional Fixes (April 12, 2025 - Session 2)

**GIF Picker in MessagesPage.js:**
- **Issue**: GIF picker was using `fixed inset-x-4 bottom-20` which caused it to push up too high when the keyboard opened
- **Fix**: Changed to `absolute bottom-full mb-2` positioning relative to the input container, so it appears above the compose bar consistently

**ConditionsModal.js Camera Fix (Enhanced):**
- **Issue**: Camera showing black screen on mobile, requiring front/back toggle to work
- **Root Cause**: Some mobile browsers don't properly handle `facingMode: { ideal: "environment" }` constraint on first attempt
- **Fix**: 
  1. Implemented multi-constraint fallback approach (string → object ideal → object exact → no facingMode)
  2. Added explicit `video.play()` call after setting srcObject
  3. Added `onLoadedMetadata` handler to ensure video plays when metadata is loaded (iOS fix)

## PostModal Mobile Touch Fix (April 12, 2025) - RESOLVED

**Issues Fixed:**

1. **Touch events not working on mobile** (Root cause: `touch-none` CSS class)
   - Changed `touch-none` → `touch-manipulation` 
   - Allows taps while preventing scroll/zoom gestures
   - Reaction button uses pointer events (onPointerDown/onPointerUp)
   - Save button uses simple onClick

2. **Save button state not syncing** (Post showed "already saved" but button wasn't filled)
   - Backend `/api/posts` endpoint wasn't returning `saved` status
   - Added `saved_post_ids` query to feed endpoint
   - Now returns `saved=true/false` for each post

3. **4th/5th emoji in picker not working**
   - Reduced emoji button size from w-12 to w-11 for better mobile fit
   - Added `maxWidth: 90vw` to picker container
   - Added `touch-manipulation` class to emoji buttons
   - Removed duplicate onTouchEnd handlers (was causing double-fire)

**Files Modified:**
- `/app/frontend/src/components/PostModal.js` - Touch handling and emoji picker
- `/app/backend/routes/posts.py` - Added saved status to feed endpoint

## Site Access Code Gate (April 13, 2025) - COMPLETE

**Feature: Private Beta Access Code**

Implemented a full access code gate system to lock the preview environment from unauthorized visitors.

**Components:**
1. **AccessCodeScreen.js** - Gate screen shown before app loads
   - Beautiful branded UI with Raw Surf logo
   - Code input with uppercase auto-formatting
   - Loading and error states
   
2. **Re-validation Logic** (CRITICAL FIX)
   - Stores the actual access code in localStorage (not just a boolean)
   - On every app load, verifies stored code against backend
   - If admin changes the code, previously authenticated users are kicked out
   - Forces re-entry of new code

3. **Admin Console Access Control Tab** (UnifiedAdminConsole.js)
   - NEW "Access Control" tab in Admin Console (second tab after Overview)
   - Toggle to enable/disable access code requirement
   - Input to change the access code
   - Warning that changing code will kick out all users
   - Status indicator showing current protection state

**API Endpoints:**
- `GET /api/site-access` - Public endpoint to check if access code is enabled
- `POST /api/site-access/verify` - Verify an access code
- `GET /api/admin/platform-settings` - Get all platform settings
- `PUT /api/admin/platform-settings` - Update settings (admin only)

**Database:**
- Added `access_code_enabled` (Boolean) and `access_code` (String) to `PlatformSettings` model

**Files Modified:**
- `/app/frontend/src/components/AccessCodeScreen.js` - Gate screen with re-validation
- `/app/frontend/src/components/UnifiedAdminConsole.js` - Added Access Control tab
- `/app/frontend/src/components/AdminDashboard.js` - Settings tab (legacy, also updated)
- `/app/backend/routes/admin_analytics.py` - Access code endpoints + admin check fix

## Upcoming Tasks
- Travel Commerce Area (Passport modal retreat/lodge sales)
- End-to-End Itinerary planning

## Future/Backlog
- Used Surfboard Marketplace
- Creator Economy Tools
- Music Integration (ON HOLD)
