from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import sqlite3
import uuid
import os

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile
from models.bookings import Booking, BookingParticipant
from models.sessions import LiveSession
from models.spots import SurfSpot
from utils.sqlite_helpers import get_db_path
from utils.credits import add_credits

router = APIRouter()

OP_DB_PATH = get_db_path("operator_decisions.db")

class ApproveActionRequest(BaseModel):
    decision_id: str
    correlation_id: Optional[str] = None

class RejectActionRequest(BaseModel):
    decision_id: str
    explanation: str
    correlation_id: Optional[str] = None

class BookingOverrideRequest(BaseModel):
    booking_id: str
    new_capacity: int
    explanation: str
    correlation_id: Optional[str] = None

class ApproveMediaRequest(BaseModel):
    queue_id: str
    caption: Optional[str] = None
    correlation_id: Optional[str] = None

def init_media_queue_db():
    conn = sqlite3.connect(OP_DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS media_queue (
        queue_id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL,
        status TEXT NOT NULL, -- 'pending_review', 'approved', 'rejected'
        media_url TEXT,
        caption TEXT,
        created_at TEXT NOT NULL,
        correlation_id TEXT
    )
    """)
    conn.commit()
    conn.close()

@router.get("/admin/event-dashboard/events")
async def get_dashboard_events(admin: Profile = Depends(get_current_admin)):
    """Fetch recent system events from SQLite event spine log"""
    try:
        import event_bus_mcp_server
        events = event_bus_mcp_server.get_recent_events(limit=100)
        return {"success": True, "events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query events: {str(e)}")

@router.get("/admin/event-dashboard/actions")
async def get_dashboard_actions(admin: Profile = Depends(get_current_admin)):
    """Fetch pending and historical admin actions from decisions queue"""
    try:
        import operator_mcp_server
        history = operator_mcp_server.get_operator_decision_history()
        return {"success": True, "actions": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query admin actions: {str(e)}")

async def _perform_real_cancellation_refund(booking_id: str, db: AsyncSession) -> dict:
    """
    Actually cancel a booking and refund its participants (100%, matching the same
    policy the app uses for photographer-initiated cancellations), instead of just
    claiming a refund happened. Returns an honest integration_results dict describing
    what really occurred.
    """
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()

    if not booking:
        return {
            "booking_action": {
                "status": "no_match",
                "message": f"No booking found with id={booking_id}. No cancellation or refund was performed."
            },
            "calendar_sync": {
                "status": "not_integrated",
                "message": "Google Calendar integration is not yet built for this app."
            }
        }

    if booking.status in ('Cancelled', 'Completed'):
        return {
            "booking_action": {
                "status": "no_op",
                "message": f"Booking {booking_id} is already {booking.status.lower()}. No further action was taken."
            },
            "calendar_sync": {
                "status": "not_integrated",
                "message": "Google Calendar integration is not yet built for this app."
            }
        }

    now = datetime.now(timezone.utc)
    total_paid = sum(p.paid_amount or 0 for p in booking.participants)

    booking.status = 'Cancelled'
    booking.cancelled_at = now
    booking.cancellation_reason = 'Admin safety cancellation (operator decision approved)'
    booking.refund_amount = total_paid
    booking.refund_percentage = 100
    if booking.escrow_status == 'held':
        booking.escrow_status = 'refunded'

    refunded_total = 0.0
    for participant in booking.participants:
        if participant.paid_amount and participant.paid_amount > 0:
            success, _new_balance, _err = await add_credits(
                user_id=participant.participant_id,
                amount=participant.paid_amount,
                transaction_type='booking_refund',
                db=db,
                description='Refund for admin safety-cancelled booking',
                reference_type='booking',
                reference_id=booking_id,
                counterparty_id=booking.photographer_id
            )
            if success:
                participant.payment_status = 'Refunded'
                refunded_total += participant.paid_amount

    await db.commit()

    return {
        "booking_action": {
            "status": "cancelled",
            "message": f"Booking {booking_id} was cancelled and ${refunded_total:.2f} was credited back to {len(booking.participants)} participant(s)."
        },
        "calendar_sync": {
            "status": "not_integrated",
            "message": "Google Calendar integration is not yet built for this app."
        }
    }


@router.post("/admin/event-dashboard/actions/approve")
async def approve_dashboard_action(req: ApproveActionRequest, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Execute approval of pending admin decisions"""
    try:
        import operator_mcp_server

        real_integration_results = None
        history = operator_mcp_server.get_operator_decision_history()
        decision = next((d for d in history if d["decision_id"] == req.decision_id), None)
        if decision and decision.get("type") == "cancellation":
            # This decision type claims to cancel a booking + refund the customer —
            # actually do that instead of reporting a fabricated success message.
            real_integration_results = await _perform_real_cancellation_refund(
                booking_id=decision.get("proposed_value"), db=db
            )

        res = operator_mcp_server.execute_decision(
            decision_id=req.decision_id,
            caller_role="admin",
            correlation_id=req.correlation_id,
            real_integration_results=real_integration_results
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to approve decision"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Approval execution error: {str(e)}")

@router.post("/admin/event-dashboard/actions/reject")
async def reject_dashboard_action(req: RejectActionRequest, admin: Profile = Depends(get_current_admin)):
    """Reject pending admin decision"""
    try:
        import operator_mcp_server
        res = operator_mcp_server.reject_decision(
            decision_id=req.decision_id,
            caller_role="admin",
            explanation=req.explanation,
            correlation_id=req.correlation_id
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to reject decision"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rejection execution error: {str(e)}")

@router.post("/admin/event-dashboard/actions/override")
async def create_booking_override(req: BookingOverrideRequest, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Manually apply booking overrides (Admin gated override tool)"""
    try:
        import operator_mcp_server

        # Actually update the booking's capacity instead of just claiming it was overridden.
        result = await db.execute(select(Booking).where(Booking.id == req.booking_id))
        booking = result.scalar_one_or_none()
        if booking:
            old_capacity = booking.max_participants
            booking.max_participants = req.new_capacity
            await db.commit()
            real_update_result = f"Booking {req.booking_id} max_participants updated: {old_capacity} -> {req.new_capacity}."
        else:
            real_update_result = f"No booking found with id={req.booking_id}. No capacity change was made."

        res = operator_mcp_server.propose_booking_override(
            booking_id=req.booking_id,
            new_capacity=req.new_capacity,
            caller_role="admin",
            explanation=req.explanation,
            correlation_id=req.correlation_id,
            real_update_result=real_update_result
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to override booking"))
        if not booking:
            raise HTTPException(status_code=404, detail=real_update_result)
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Booking override error: {str(e)}")

@router.get("/admin/event-dashboard/media-queue")
async def get_media_queue(admin: Profile = Depends(get_current_admin)):
    """Fetch social media publication queue"""
    init_media_queue_db()
    try:
        conn = sqlite3.connect(OP_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM media_queue ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
        
        items = [dict(r) for r in rows]
        return {"success": True, "queue": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query media queue: {str(e)}")

@router.post("/admin/event-dashboard/media-queue/approve")
async def approve_media_post(req: ApproveMediaRequest, admin: Profile = Depends(get_current_admin)):
    """Approve post in media queue and publish to social feed"""
    init_media_queue_db()
    try:
        # 1. Update SQLite media_queue record status
        conn = sqlite3.connect(OP_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM media_queue WHERE queue_id = ?", (req.queue_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Media queue item not found")
            
        cursor.execute("UPDATE media_queue SET status = 'approved' WHERE queue_id = ?", (req.queue_id,))
        conn.commit()
        conn.close()
        
        # 2. Emit social_post_published event onto the Event Spine
        import event_bus_mcp_server
        c_id = req.correlation_id or row[6] or f"corr_pub_{uuid.uuid4().hex[:8]}"
        publish_res = event_bus_mcp_server.publish_event(
            event_type="social_post_published",
            payload={
                "queue_id": req.queue_id,
                "booking_id": row[1],
                "media_url": row[3],
                "caption": req.caption or row[4],
                "published_by": admin.id
            },
            correlation_id=c_id,
            source_mcp="operator_mcp",
            source_service="operator_mcp"
        )
        
        return {"success": True, "message": "Social media post approved and published.", "event": publish_res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Media approval error: {str(e)}")

@router.get("/admin/event-dashboard/trace/{correlation_id}")
async def get_chronological_trace(correlation_id: str, admin: Profile = Depends(get_current_admin)):
    """Trace and reconstruct full event lifecycle chronologically by correlation token"""
    try:
        import event_bus_mcp_server
        trace = event_bus_mcp_server.get_event_flow_trace(correlation_id)
        return {"success": True, "trace": trace}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trace reconstruction error: {str(e)}")

@router.get("/admin/event-dashboard/replay")
async def get_event_replay(
    event_type: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    admin: Profile = Depends(get_current_admin)
):
    """
    Browse/replay all events of a given type across a time range (not scoped to a
    single correlation chain, unlike /trace/{correlation_id}). Real Sandbox Replay
    capability - previously this event_bus_core.replay_events() function existed but
    was never wired to any route.
    """
    try:
        import event_bus_mcp_server
        events = event_bus_mcp_server.replay_events(
            event_type=event_type, start_time=start_time, end_time=end_time
        )
        return {"success": True, "events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Replay query error: {str(e)}")

@router.get("/admin/event-dashboard/system-health")
async def get_event_system_health(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Calculate core system indicators from actual event statistics"""
    try:
        import event_bus_mcp_server
        events = event_bus_mcp_server.get_recent_events(limit=250)
        
        # Error Rate calculation
        total_events = len(events)
        error_events = sum(1 for e in events if e["event_type"] == "system_error")
        error_rate = (error_events / total_events * 100) if total_events > 0 else 0.0
        
        # Booking Success Rate
        bookings_created = sum(1 for e in events if e["event_type"] == "booking_created")
        bookings_confirmed = sum(1 for e in events if e["event_type"] == "booking_confirmed")
        booking_success = (bookings_confirmed / bookings_created * 100) if bookings_created > 0 else 100.0
        
        # Propagation Latency indicator
        latencies = [e.get("propagation_latency_ms", 2.5) for e in events if e.get("propagation_latency_ms")]
        avg_latency = (sum(latencies) / len(latencies)) if latencies else 2.5

        # Real events/min rate, computed from the actual timestamp span of the fetched
        # events (previously a fabricated heuristic: total_events_logged / 4, clamped
        # to an arbitrary 8-64 range with no relationship to a real time window).
        event_velocity_per_min = 0.0
        try:
            timestamps = sorted(
                datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
                for e in events if e.get("timestamp")
            )
            if len(timestamps) >= 2:
                span_minutes = (timestamps[-1] - timestamps[0]).total_seconds() / 60.0
                if span_minutes > 0:
                    event_velocity_per_min = len(timestamps) / span_minutes
        except Exception:
            event_velocity_per_min = 0.0

        # Active Photographer Telemetry
        try:
            # 1. Photographers actively shooting (live session mode 'live_join')
            active_shooting_q = select(func.count(func.distinct(LiveSession.photographer_id))).where(
                LiveSession.status == 'active',
                LiveSession.session_mode == 'live_join'
            )
            active_shooting_res = await db.execute(active_shooting_q)
            active_shooting_count = active_shooting_res.scalar() or 0
        except Exception:
            active_shooting_count = 0

        try:
            # 2. Photographers with active/confirmed bookings
            active_booking_q = select(func.count(func.distinct(Booking.photographer_id))).where(
                Booking.status.in_(['Confirmed', 'in_progress', 'active'])
            )
            active_booking_res = await db.execute(active_booking_q)
            active_booking_count = active_booking_res.scalar() or 0
        except Exception:
            active_booking_count = 0

        try:
            # 3. Photographers on-demand (live session mode 'on_demand')
            active_ondemand_q = select(func.count(func.distinct(LiveSession.photographer_id))).where(
                LiveSession.status == 'active',
                LiveSession.session_mode == 'on_demand'
            )
            active_ondemand_res = await db.execute(active_ondemand_q)
            active_ondemand_count = active_ondemand_res.scalar() or 0
        except Exception:
            active_ondemand_count = 0
        
        return {
            "success": True,
            "metrics": {
                "error_rate": round(error_rate, 2),
                "booking_success_rate": round(booking_success, 1),
                "average_propagation_latency_ms": round(avg_latency, 1),
                "total_events_logged": total_events,
                "event_velocity_per_min": round(event_velocity_per_min, 1),
                "photographers_active_shooting": active_shooting_count,
                "photographers_active_booking": active_booking_count,
                "photographers_active_ondemand": active_ondemand_count
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System health calculation error: {str(e)}")

@router.get("/admin/event-dashboard/active-spots")
async def get_active_spots(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db), limit: int = 3):
    """
    Real currently-active surf spots, ranked by live sessions + active bookings.
    Replaces the previous hardcoded Pipeline Reef/Sunset Beach/Waimea Bay placeholder cards.
    """
    try:
        live_counts_q = (
            select(LiveSession.surf_spot_id, func.count(LiveSession.id).label("cnt"))
            .where(LiveSession.status == 'active', LiveSession.surf_spot_id.isnot(None))
            .group_by(LiveSession.surf_spot_id)
        )
        booking_counts_q = (
            select(Booking.surf_spot_id, func.count(Booking.id).label("cnt"))
            .where(Booking.status == 'Confirmed', Booking.surf_spot_id.isnot(None))
            .group_by(Booking.surf_spot_id)
        )
        live_counts = {row[0]: row[1] for row in (await db.execute(live_counts_q)).all()}
        booking_counts = {row[0]: row[1] for row in (await db.execute(booking_counts_q)).all()}

        combined: dict = {}
        for spot_id, cnt in live_counts.items():
            combined[spot_id] = combined.get(spot_id, 0) + cnt
        for spot_id, cnt in booking_counts.items():
            combined[spot_id] = combined.get(spot_id, 0) + cnt

        top_spot_ids = sorted(combined.keys(), key=lambda k: combined[k], reverse=True)[:limit]
        if not top_spot_ids:
            return {"success": True, "spots": []}

        spots_result = await db.execute(select(SurfSpot).where(SurfSpot.id.in_(top_spot_ids)))
        spots_by_id = {s.id: s for s in spots_result.scalars().all()}

        spots = []
        for spot_id in top_spot_ids:
            spot = spots_by_id.get(spot_id)
            if not spot:
                continue
            spots.append({
                "spot_id": spot_id,
                "name": spot.name,
                "region": spot.region,
                "country": spot.country,
                "live_sessions": live_counts.get(spot_id, 0),
                "active_bookings": booking_counts.get(spot_id, 0),
                "total_activity": combined[spot_id]
            })

        return {"success": True, "spots": spots}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Active spots query error: {str(e)}")
