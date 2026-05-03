"""Financial scheduler tasks.
- Auto-release escrow (daily 3am)
- Weekly sales reports (Monday 9am)
- Cleanup abandoned Stripe sessions (30min)
- Credit transaction integrity check (daily 5am)
"""
import logging
import json
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)
async def auto_release_escrow_task():
    """
    Automatically release escrow to photographers 7 days after session
    if they haven't uploaded content yet.
    
    This prevents funds from being stuck indefinitely.
    Runs daily at 3am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select, and_
    from sqlalchemy.orm import selectinload
    from models import Booking, Profile, Notification
    from utils.credits import add_credits
    
    logger.info("[Scheduler] Checking for auto escrow release (7 days after session)...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            from datetime import timedelta
            seven_days_ago = now - timedelta(days=7)
            
            # Find bookings that:
            # 1. Status is 'Confirmed' or 'Completed' (session happened)
            # 2. Session date was 7+ days ago
            # 3. Escrow is still held
            # 4. Content NOT delivered (photographer didn't upload)
            result = await db.execute(
                select(Booking)
                .where(
                    and_(
                        Booking.status.in_(['Confirmed', 'Completed']),
                        Booking.session_date <= seven_days_ago,
                        Booking.escrow_status == 'held',
                        Booking.escrow_amount > 0
                    )
                )
                .options(
                    selectinload(Booking.photographer),
                    selectinload(Booking.creator)
                )
            )
            bookings = result.scalars().all()
            
            released_count = 0
            
            for booking in bookings:
                try:
                    # Release escrow to photographer
                    await add_credits(
                        user_id=booking.photographer_id,
                        amount=booking.escrow_amount,
                        transaction_type='escrow_auto_release',
                        db=db,
                        description=f"Auto-released 7 days after session (content not required)",
                        reference_type='booking',
                        reference_id=booking.id,
                        counterparty_id=booking.creator_id
                    )
                    
                    booking.escrow_status = 'released'
                    booking.escrow_released_at = now
                    
                    # Mark booking as completed if not already
                    if booking.status == 'Confirmed':
                        booking.status = 'Completed'
                    
                    # Notify photographer
                    photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
                    notification = Notification(
                        user_id=booking.photographer_id,
                        type='escrow_auto_released',
                        title='Payment Released!',
                        body=f'${booking.escrow_amount:.2f} auto-released for session on {booking.session_date.strftime("%b %d")}',
                        data=json.dumps({
                            "booking_id": booking.id,
                            "amount": booking.escrow_amount,
                            "reason": "auto_7_days"
                        })
                    )
                    db.add(notification)
                    
                    # Notify surfer that payment was released
                    surfer_notification = Notification(
                        user_id=booking.creator_id,
                        type='escrow_released_to_photographer',
                        title='Session Payment Released',
                        body=f'Payment for your session with {photographer_name} has been released.',
                        data=json.dumps({
                            "booking_id": booking.id,
                            "photographer_name": photographer_name
                        })
                    )
                    db.add(surfer_notification)
                    
                    released_count += 1
                    logger.info(f"[Scheduler] Auto-released escrow for booking {booking.id}: ${booking.escrow_amount}")
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to auto-release escrow for booking {booking.id}: {e}")
            
            await db.commit()
            
            if released_count > 0:
                logger.info(f"[Scheduler] Auto-released escrow for {released_count} bookings")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in auto escrow release: {str(e)}")



async def send_weekly_sales_reports_task():
    """
    Send weekly sales report emails to photographers.
    Runs every Monday at 9am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select, func, text
    from models import Profile, GalleryPurchase, GalleryItem, CreditTransaction, Notification
    from datetime import timedelta
    
    logger.info("[Scheduler] Sending weekly sales reports to photographers...")
    
    try:
        async with async_session_maker() as db:
            # Get all photographers with sales activity
            week_ago = datetime.now(timezone.utc) - timedelta(days=7)
            
            # Find photographers with any gallery sales or earnings in the past week
            raw_query = text("""
                SELECT DISTINCT p.id, p.email, p.full_name
                FROM profiles p
                WHERE p.role IN ('photographer', 'pro_photographer', 'approved_pro_photographer')
                AND EXISTS (
                    SELECT 1 FROM credit_transactions ct 
                    WHERE ct.user_id = p.id 
                    AND ct.amount > 0 
                    AND ct.created_at >= :week_ago
                )
            """)
            
            result = await db.execute(raw_query, {"week_ago": week_ago})
            photographers = result.fetchall()
            
            logger.info(f"[Scheduler] Found {len(photographers)} photographers with activity")
            
            reports_sent = 0
            
            for photographer in photographers:
                photographer_id = photographer.id
                photographer_email = photographer.email
                photographer_name = photographer.full_name or "Photographer"
                
                try:
                    # Get this week's earnings breakdown
                    earnings_query = text("""
                        SELECT 
                            SUM(CASE WHEN transaction_type IN ('gallery_sale', 'gallery_purchase') THEN amount ELSE 0 END) as gallery_sales,
                            SUM(CASE WHEN transaction_type IN ('live_session_buyin', 'live_session_earning', 'live_photo_purchase') THEN amount ELSE 0 END) as live_sessions,
                            SUM(CASE WHEN transaction_type IN ('booking_earning', 'booking_payment') THEN amount ELSE 0 END) as bookings,
                            SUM(amount) as total
                        FROM credit_transactions 
                        WHERE user_id = :photographer_id 
                        AND amount > 0 
                        AND created_at >= :week_ago
                    """)
                    
                    earnings_result = await db.execute(
                        earnings_query, 
                        {"photographer_id": photographer_id, "week_ago": week_ago}
                    )
                    earnings = earnings_result.fetchone()
                    
                    total_earnings = float(earnings.total or 0)
                    gallery_sales = float(earnings.gallery_sales or 0)
                    live_sessions = float(earnings.live_sessions or 0)
                    bookings = float(earnings.bookings or 0)
                    
                    if total_earnings <= 0:
                        continue  # Skip if no actual earnings
                    
                    # Get top selling items
                    top_items_query = text("""
                        SELECT gi.id, gi.title, gi.thumbnail_url, COUNT(gp.id) as sales
                        FROM gallery_items gi
                        JOIN gallery_purchases gp ON gi.id = gp.gallery_item_id
                        WHERE gi.photographer_id = :photographer_id
                        AND gp.purchased_at >= :week_ago
                        GROUP BY gi.id, gi.title, gi.thumbnail_url
                        ORDER BY sales DESC
                        LIMIT 3
                    """)
                    
                    top_items_result = await db.execute(
                        top_items_query,
                        {"photographer_id": photographer_id, "week_ago": week_ago}
                    )
                    top_items = top_items_result.fetchall()
                    
                    # Create in-app notification with summary
                    summary_text = f"Weekly earnings: ${total_earnings:.2f}"
                    if gallery_sales > 0:
                        summary_text += f" (Gallery: ${gallery_sales:.2f})"
                    if live_sessions > 0:
                        summary_text += f" (Live: ${live_sessions:.2f})"
                    if bookings > 0:
                        summary_text += f" (Bookings: ${bookings:.2f})"
                    
                    if top_items:
                        summary_text += f". Top seller: {top_items[0].title or 'Untitled'}"
                    
                    notification = Notification(
                        user_id=photographer_id,
                        type='weekly_sales_report',
                        title='Weekly Sales Report',
                        body=summary_text,
                        data=json.dumps({
                            "total_earnings": total_earnings,
                            "gallery_sales": gallery_sales,
                            "live_sessions": live_sessions,
                            "bookings": bookings,
                            "top_items": [{"id": str(item.id), "title": item.title, "sales": item.sales} for item in top_items],
                            "week_ending": datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        })
                    )
                    db.add(notification)
                    
                    # Send email via Resend if configured
                    RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
                    if RESEND_API_KEY and photographer_email:
                        try:
                            import resend
                            resend.api_key = RESEND_API_KEY
                            
                            # Build top items HTML
                            top_items_html = ""
                            if top_items:
                                top_items_html = "<h3 style='margin-top:20px;'>Top Sellers This Week</h3><ul>"
                                for item in top_items:
                                    top_items_html += f"<li>{item.title or 'Untitled'} - {item.sales} sales</li>"
                                top_items_html += "</ul>"
                            
                            html_content = f"""
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h1 style="color: #06b6d4;">Weekly Sales Report</h1>
                                <p>Hi {photographer_name},</p>
                                <p>Here's your earnings summary for the past week:</p>
                                
                                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <h2 style="color: #10b981; margin-top: 0;">Total Earnings: ${total_earnings:.2f}</h2>
                                    <ul style="list-style: none; padding: 0;">
                                        <li>Gallery Sales: ${gallery_sales:.2f}</li>
                                        <li>Live Sessions: ${live_sessions:.2f}</li>
                                        <li>Bookings: ${bookings:.2f}</li>
                                    </ul>
                                </div>
                                
                                {top_items_html}
                                
                                <p style="margin-top: 30px;">
                                    <a href="https://raw-surf-os.preview.emergentagent.com/dashboard" 
                                       style="background: #06b6d4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                                        View Full Dashboard
                                    </a>
                                </p>
                                
                                <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
                                    You're receiving this because you have earnings activity on Raw Surf OS.
                                </p>
                            </div>
                            """
                            
                            resend.Emails.send({
                                "from": "Raw Surf OS <noreply@rawsurfos.com>",
                                "to": [photographer_email],
                                "subject": f"Weekly Earnings Report: ${total_earnings:.2f}",
                                "html": html_content
                            })
                            logger.info(f"[Scheduler] Sent email to {photographer_email}")
                        except Exception as email_err:
                            logger.warning(f"[Scheduler] Failed to send email: {email_err}")
                    
                    reports_sent += 1
                    logger.info(f"[Scheduler] Sent weekly report to {photographer_name}: ${total_earnings:.2f}")
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to send weekly report to photographer {photographer_id}: {e}")
            
            await db.commit()
            logger.info(f"[Scheduler] Sent {reports_sent} weekly sales reports")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in weekly sales reports: {str(e)}")



async def cleanup_abandoned_stripe_sessions_task():
    """
    Cleanup abandoned Stripe checkout sessions.
    Marks PaymentTransactions as 'Abandoned' if older than 30 minutes and still 'Pending'.
    Also resets dispatch requests that were waiting for payment.
    
    DATA INTEGRITY: This prevents orphaned pending records from accumulating
    when users abandon Stripe checkout.
    """
    from database import async_session_maker
    from sqlalchemy import select, update
    from models import PaymentTransaction, DispatchRequest, DispatchRequestStatusEnum
    import stripe
    import os
    
    stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")
    
    logger.info("[Scheduler] Running abandoned Stripe session cleanup...")
    
    try:
        async with async_session_maker() as db:
            cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=30)
            
            # Find pending payment transactions older than 30 minutes
            result = await db.execute(
                select(PaymentTransaction)
                .where(
                    PaymentTransaction.payment_status == 'Pending',
                    PaymentTransaction.created_at < cutoff_time
                )
            )
            abandoned_transactions = result.scalars().all()
            
            cleaned_count = 0
            dispatch_reset_count = 0
            
            for tx in abandoned_transactions:
                try:
                    # Check actual Stripe session status
                    if stripe.api_key and tx.session_id:
                        try:
                            stripe_session = stripe.checkout.Session.retrieve(tx.session_id)
                            if stripe_session.payment_status == 'paid':
                                # Actually paid - update our record
                                tx.payment_status = 'Completed'
                                tx.status = 'Completed'
                                logger.info(f"[Scheduler] Found completed payment: {tx.session_id}")
                                continue
                            elif stripe_session.status == 'expired':
                                tx.payment_status = 'Expired'
                                tx.status = 'Expired'
                            else:
                                tx.payment_status = 'Abandoned'
                                tx.status = 'Abandoned'
                        except stripe.error.InvalidRequestError:
                            # Session doesn't exist in Stripe
                            tx.payment_status = 'Abandoned'
                            tx.status = 'Abandoned'
                    else:
                        tx.payment_status = 'Abandoned'
                        tx.status = 'Abandoned'
                    
                    # Parse metadata to find related dispatch
                    if tx.transaction_metadata:
                        try:
                            metadata = json.loads(tx.transaction_metadata)
                            dispatch_id = metadata.get('dispatch_id')
                            
                            if dispatch_id:
                                # Reset dispatch back to pending payment
                                dispatch_result = await db.execute(
                                    select(DispatchRequest)
                                    .where(
                                        DispatchRequest.id == dispatch_id,
                                        DispatchRequest.status == DispatchRequestStatusEnum.PENDING_PAYMENT
                                    )
                                )
                                dispatch = dispatch_result.scalar_one_or_none()
                                
                                if dispatch:
                                    # Mark dispatch as cancelled due to payment timeout
                                    dispatch.status = DispatchRequestStatusEnum.CANCELLED
                                    dispatch.status_changed_at = datetime.now(timezone.utc)
                                    dispatch_reset_count += 1
                                    logger.info(f"[Scheduler] Cancelled dispatch {dispatch_id} due to payment timeout")
                        except json.JSONDecodeError:
                            pass
                    
                    cleaned_count += 1
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Error cleaning up transaction {tx.id}: {e}")
            
            await db.commit()
            
            if cleaned_count > 0 or dispatch_reset_count > 0:
                logger.info(f"[Scheduler] Cleaned up {cleaned_count} abandoned payment transactions, cancelled {dispatch_reset_count} dispatches")
            else:
                logger.info("[Scheduler] No abandoned Stripe sessions found")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in abandoned Stripe session cleanup: {str(e)}")



async def check_credit_transaction_integrity_task():
    """
    Periodic integrity check for credit transactions.
    Identifies orphaned records where reference_id points to non-existent entities.
    DATA INTEGRITY: Logs warnings for manual review, doesn't auto-delete.
    """
    from database import async_session_maker
    from sqlalchemy import select, text
    from models import CreditTransaction, DispatchRequest, Booking
    
    logger.info("[Scheduler] Running credit transaction integrity check...")
    
    try:
        async with async_session_maker() as db:
            # Check for orphaned dispatch references
            orphaned_dispatch_count = 0
            result = await db.execute(text('''
                SELECT COUNT(*) FROM credit_transactions ct
                WHERE ct.reference_type = 'dispatch_request'
                AND ct.reference_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM dispatch_requests dr WHERE dr.id = ct.reference_id
                )
            '''))
            orphaned_dispatch_count = result.scalar() or 0
            
            # Check for orphaned booking references
            orphaned_booking_count = 0
            result = await db.execute(text('''
                SELECT COUNT(*) FROM credit_transactions ct
                WHERE ct.reference_type = 'booking'
                AND ct.reference_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM bookings b WHERE b.id = ct.reference_id
                )
            '''))
            orphaned_booking_count = result.scalar() or 0
            
            if orphaned_dispatch_count > 0 or orphaned_booking_count > 0:
                logger.warning(f"[Scheduler] INTEGRITY CHECK: Found {orphaned_dispatch_count} orphaned dispatch refs, {orphaned_booking_count} orphaned booking refs in credit_transactions")
            else:
                logger.info("[Scheduler] Credit transaction integrity check passed - no orphaned records")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in credit transaction integrity check: {str(e)}")

