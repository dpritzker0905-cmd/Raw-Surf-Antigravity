from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
import uuid
import os

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile
from models.bookings import Booking
from models.sessions import LiveSession

router = APIRouter()

EVENT_DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\event_bus.db"
OP_DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\operator_decisions.db"

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

@router.post("/admin/event-dashboard/actions/approve")
async def approve_dashboard_action(req: ApproveActionRequest, admin: Profile = Depends(get_current_admin)):
    """Execute approval of pending admin decisions"""
    try:
        import operator_mcp_server
        res = operator_mcp_server.execute_decision(
            decision_id=req.decision_id,
            caller_role="admin",
            correlation_id=req.correlation_id
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to approve decision"))
        return res
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rejection execution error: {str(e)}")

@router.post("/admin/event-dashboard/actions/override")
async def create_booking_override(req: BookingOverrideRequest, admin: Profile = Depends(get_current_admin)):
    """Manually apply booking overrides (Admin gated override tool)"""
    try:
        import operator_mcp_server
        res = operator_mcp_server.propose_booking_override(
            booking_id=req.booking_id,
            new_capacity=req.new_capacity,
            caller_role="admin",
            explanation=req.explanation,
            correlation_id=req.correlation_id
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to override booking"))
        return res
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
                "photographers_active_shooting": active_shooting_count,
                "photographers_active_booking": active_booking_count,
                "photographers_active_ondemand": active_ondemand_count
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System health calculation error: {str(e)}")
