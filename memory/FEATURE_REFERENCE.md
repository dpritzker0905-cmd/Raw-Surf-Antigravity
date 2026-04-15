# Raw Surf OS - Feature Reference

> Comprehensive guide to all features, components, and their relationships.
> Last Updated: April 9, 2026

## Table of Contents
1. [Core Architecture](#core-architecture)
2. [User Roles & Personas](#user-roles--personas)
3. [Booking System](#booking-system)
4. [Messaging System](#messaging-system)
5. [Social Features](#social-features)
6. [Payment System](#payment-system)
7. [Media & Content](#media--content)
8. [Notifications](#notifications)
9. [External Integrations](#external-integrations)
10. [Component Map](#component-map)

---

## Core Architecture

### Tech Stack
- **Frontend**: React + Tailwind CSS + Shadcn/UI
- **Backend**: FastAPI + PostgreSQL + SQLAlchemy
- **Real-time**: Supabase WebSocket subscriptions
- **Storage**: Supabase Storage (with local fallback)
- **Auth**: JWT tokens + optional Google OAuth

### Directory Structure
```
/app/
├── backend/
│   ├── routes/           # API endpoints
│   │   ├── auth.py       # Authentication & signup
│   │   ├── bookings.py   # Booking CRUD, invites, payments
│   │   ├── messages.py   # DMs, conversations, GIFs
│   │   ├── profiles.py   # User profiles, follows, search
│   │   ├── waves.py      # Short-form video content
│   │   └── ...
│   ├── models.py         # SQLAlchemy models
│   ├── scheduler.py      # Background jobs
│   └── server.py         # FastAPI app
├── frontend/
│   └── src/
│       ├── components/   # React components
│       │   ├── bookings/ # Booking tab components
│       │   ├── ui/       # Shadcn/UI components
│       │   └── ...
│       └── contexts/     # React contexts
└── memory/
    ├── PRD.md
    └── FEATURE_REFERENCE.md  # This file
```

---

## User Roles & Personas

### Role Hierarchy
| Role | Description | Key Features |
|------|-------------|--------------|
| `GOD_MODE` | Admin/super user | Full access, can impersonate |
| `PROFESSIONAL` | Pro surfer | Pro Lounge access, verified badge |
| `COMP_SURFER` | Competition surfer | Leaderboards, competition entry |
| `PHOTOGRAPHER` | Session photographer | Booking management, media sales |
| `BRAND` | Business/sponsor | Brand dashboard |
| `SURF_COACH` | Instructor | Coaching features |
| `SURFER` | Standard user | Core features |
| `GROM` | Minor (under 18) | Parental controls |

### Key Files
- Model: `/app/backend/models.py` → `RoleEnum`, `Profile`
- Context: `/app/frontend/src/contexts/PersonaContext.js`
- Helper: `isProLevelRole()`, `isBusinessRole()`

---

## Booking System

### Booking Types
1. **Instant Booking** - Immediate confirmation
2. **Scheduled Booking** - Future date/time slot
3. **On-Demand** - Request-based
4. **Shared/Split** - Multiple surfers share cost

### Booking Flow
```
User → Browse Photographers → Select Session Type → Choose Time
  → Configure (Solo/Split) → Payment → Confirmation
```

### Split Booking Features
- **Split Modes**: `solo`, `friends_only`, `open_nearby`
- **Countdown Timer**: 24-hour invite expiration
- **Auto-Kick**: Expired invites removed by scheduler
- **Nearby Invites**: GPS-based discovery

### Key Components
| Component | File | Purpose |
|-----------|------|---------|
| BookingCard | `BookingCard.js` | Display booking details |
| ScheduledBookingDrawer | `ScheduledBookingDrawer.js` | Create scheduled bookings |
| LineupManagerDrawer | `LineupManagerDrawer.js` | Manage crew/participants with surfboard UI |
| SessionActionDrawer | `SessionActionDrawer.js` | Booking actions menu |
| CrewPaymentDashboard | `CrewPaymentDashboard.js` | Split payment visualization |

### Key Endpoints
- `POST /api/bookings` - Create booking
- `GET /api/bookings/{id}` - Get booking details
- `POST /api/bookings/{id}/invite-by-handle` - Invite by username
- `GET /api/bookings/{id}/search-users` - Search for invite targets
- `GET /api/bookings/nearby` - Find nearby open sessions

### Database Models
- `Booking` - Main booking record
- `BookingParticipant` - Crew members
- `BookingInvite` - Pending invitations (with `expires_at`)

---

## Messaging System

### Conversation Types
| Folder | Description | Routing Rule |
|--------|-------------|--------------|
| `primary` | Main inbox | Mutual follows or accepted |
| `channel` | Public/business chats | Non-pro users messaging businesses |
| `requests` | Message requests | Non-followers |
| `pro_lounge` | Pro-only chat | Both users are pros |
| `hidden` | Deleted/archived | User deleted conversation |

### Features
- **GIF Support**: Tenor API integration
- **Reactions**: Hover emoji picker on messages
- **Voice Notes**: Audio recording
- **Media**: Photo/video sharing
- **Pin/Mute/Unread**: Conversation controls

### Key Components
| Component | File | Purpose |
|-----------|------|---------|
| MessagesPage | `MessagesPage.js` | Main messaging UI |
| GifPicker | Inside MessagesPage | Tenor GIF search |
| ConversationItem | Inside MessagesPage | Conversation list item |

### Key Endpoints
- `POST /api/messages/send` - Send message
- `GET /api/messages/conversations/{user_id}` - List conversations
- `GET /api/messages/conversation/{conv_id}` - Get messages
- `POST /api/messages/conversation/{id}/pin` - Toggle pin
- `POST /api/messages/conversation/{id}/mute` - Toggle mute
- `POST /api/messages/conversation/{id}/mark-unread` - Toggle unread

### Database Models
- `Conversation` - DM threads with status per participant
- `Message` - Individual messages
- `MessageReaction` - Emoji reactions

---

## Social Features

### Following System
- Mutual follow detection
- Follow suggestions
- Activity feed

### Waves (Short Videos)
- TikTok-style vertical video feed
- Likes, comments, shares
- Sound/music integration (planned)

### Key Components
- `Waves.js` - Video feed
- `ProfilePage.js` - User profiles
- `FollowersList.js` - Follow management

---

## Payment System

### Stripe Integration
- Checkout sessions for bookings
- Split payments with Connect
- Escrow hold/release

### Payment States
```
pending → processing → paid → (refunded)
                    → escrow_hold → released
```

### Key Endpoints
- `POST /api/payments/create-checkout` - Stripe checkout
- `POST /api/payments/webhook` - Stripe webhooks
- `GET /api/payments/history/{user_id}` - Payment history

---

## Media & Content

### Storage
- Primary: Supabase Storage
- Fallback: Local `/uploads/` directory
- Route: `GET /api/uploads/chat_media/{filename}`

### Media Types
- `image` - Photos
- `video` - Videos
- `gif` - Tenor GIFs
- `voice_note` - Audio messages

---

## Notifications

### OneSignal Integration
- Push notifications
- In-app notifications
- DM notifications for booking invites

### Notification Types
- `booking_invite` - Crew invitation
- `booking_confirmed` - Session confirmed
- `message_received` - New DM
- `invite_expired` - Invite timed out

### Key Files
- `/app/backend/routes/push.py`
- `/app/backend/scheduler.py` (session reminders)

---

## External Integrations

| Service | Purpose | Key File |
|---------|---------|----------|
| Stripe | Payments | `routes/payments.py` |
| OneSignal | Push notifications | `routes/push.py` |
| Tenor | GIFs | `MessagesPage.js` |
| Supabase | Storage + Realtime | `lib/supabase.js` |
| LiveKit | Video streaming | `routes/broadcast.py` |

---

## Component Map

### Booking Flow Components
```
Bookings.js
├── ScheduledTab.js
│   └── BookingCard.js
│       └── SessionActionDrawer.js
│           ├── Invite Crew
│           ├── The Crew → LineupManagerDrawer.js
│           │                ├── SurferPosition (surfboard + timer)
│           │                ├── Settings (nearby toggle)
│           │                └── Invite search
│           ├── Post to Feed
│           ├── Modify Time
│           └── Cancel Session
├── OnDemandTab.js
└── ScheduledBookingDrawer.js
```

### Messaging Components
```
MessagesPage.js
├── ConversationItem
├── MessageBubble
│   ├── Reactions overlay
│   └── Media renderer (GIF/Image/Video)
├── GifPicker (Tenor API)
├── VoiceRecorder
└── DropdownMenu (pin/mute/delete)
```

### Photographer Components
```
PhotographerBookingsManager.js
├── Pending tab
├── Confirmed tab
│   └── PhotographerSessionManager.js
│       ├── ParticipantCard (surfboard)
│       ├── Invite search
│       └── Session actions
└── History tab
```

---

## Background Jobs (Scheduler)

| Job | Interval | Purpose |
|-----|----------|---------|
| `expire_booking_invites` | 5 min | Auto-expire 24hr old invites |
| `session_reminders` | 5 min | Send upcoming session alerts |
| `payment_expiry` | 5 min | Expire pending payments |
| `surf_alerts` | 15 min | Check surf conditions |
| `story_cleanup` | 1 hr | Delete expired stories |
| `auto_escrow_release` | Daily 3am | Release held payments |

---

## Common Patterns

### API URL Pattern
```javascript
const API = process.env.REACT_APP_BACKEND_URL + '/api';
```

### MongoDB-style ID Generation
```python
from models import generate_uuid
id = generate_uuid()  # Returns UUID string
```

### Theme Support
```javascript
const isLight = theme === 'light';
const textPrimary = isLight ? 'text-gray-900' : 'text-white';
```

### Real-time Updates
```javascript
import { supabase } from '../lib/supabase';
supabase.channel('messages').on('INSERT', handleNewMessage);
```

---

## Quick Debug Reference

### Check Backend Logs
```bash
tail -f /var/log/supervisor/backend.err.log
```

### Test API Endpoint
```bash
curl -X POST "$REACT_APP_BACKEND_URL/api/messages/send" \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"...","recipient_id":"...","content":"test"}'
```

### Database Query
```python
cd /app/backend && python3 -c "
import asyncio
from database import async_session_maker
from models import Profile
# ... query code
"
```

---

## Known Issues & Workarounds

1. **GIPHY API banned** → Switched to Tenor API
2. **Fake usernames** → Fixed to use actual `username` field
3. **Messages going to hidden** → Fixed conversation status restore on new message
4. **GIF not displaying** → Check if URL is valid (test in browser)

---

*This document should be updated whenever major features are added or changed.*
