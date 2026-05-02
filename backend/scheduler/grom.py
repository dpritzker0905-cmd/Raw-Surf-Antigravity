"""Weekly Grom parent reports — runs Sunday 9am EST."""
import logging
from datetime import datetime, timezone, timedelta
import json

logger = logging.getLogger(__name__)
async def weekly_grom_report_task():
    """
    Send weekly Grom activity reports to parents every Sunday at 9am EST.
    Aggregates: Waves caught, Earnings, Highlights, Posts, Badges earned.
    """
    from database import async_session_maker
    from sqlalchemy import select, func
    from models import Profile, RoleEnum, Post, PhotoTag
    from datetime import timedelta
    import resend
    import os
    
    logger.info("[Scheduler] Running weekly Grom report generation...")
    
    RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
    if not RESEND_API_KEY:
        logger.warning("[Scheduler] RESEND_API_KEY not set, skipping weekly Grom reports")
        return
    
    resend.api_key = RESEND_API_KEY
    
    try:
        async with async_session_maker() as db:
            # Get all Grom Parents with linked Groms
            parent_result = await db.execute(
                select(Profile).where(Profile.role == RoleEnum.GROM_PARENT)
            )
            parents = parent_result.scalars().all()
            
            reports_sent = 0
            week_ago = datetime.now(timezone.utc) - timedelta(days=7)
            
            for parent in parents:
                linked_groms = parent.linked_grom_ids or []
                if not linked_groms:
                    continue
                
                # Get grom data
                grom_result = await db.execute(
                    select(Profile).where(Profile.id.in_(linked_groms))
                )
                groms = grom_result.scalars().all()
                
                if not groms:
                    continue
                
                # Build report for each grom
                grom_reports = []
                for grom in groms:
                    # Count posts this week
                    post_count = await db.execute(
                        select(func.count(Post.id)).where(
                            Post.user_id == grom.id,
                            Post.created_at >= week_ago
                        )
                    )
                    posts_this_week = post_count.scalar() or 0
                    
                    # Count highlights (tags) this week
                    highlight_count = await db.execute(
                        select(func.count(PhotoTag.id)).where(
                            PhotoTag.tagged_user_id == grom.id,
                            PhotoTag.created_at >= week_ago
                        )
                    )
                    highlights_this_week = highlight_count.scalar() or 0
                    
                    grom_reports.append({
                        "name": grom.full_name,
                        "posts": posts_this_week,
                        "highlights": highlights_this_week,
                        "xp": grom.total_xp or 0,
                        "level": grom.surf_level or "Beginner"
                    })
                
                # Generate email HTML
                grom_html = ""
                for gr in grom_reports:
                    grom_html += f"""
                    <div style="background: #1f1f1f; padding: 16px; border-radius: 12px; margin-bottom: 12px;">
                        <h3 style="color: #ffffff; margin: 0 0 8px 0;">{gr['name']}</h3>
                        <div style="display: flex; gap: 24px; color: #a1a1aa;">
                            <span>ðŸ“ {gr['posts']} Posts</span>
                            <span>ðŸ“¸ {gr['highlights']} Highlights</span>
                            <span>â­ {gr['xp']} XP</span>
                        </div>
                        <p style="color: #facc15; margin: 8px 0 0 0; font-size: 14px;">Level: {gr['level']}</p>
                    </div>
                    """
                
                email_html = f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h1 style="color: #facc15; margin: 0;">ðŸ„ Weekly Grom Report</h1>
                        <p style="color: #a1a1aa; margin-top: 8px;">Here's what your Groms have been up to!</p>
                    </div>
                    
                    {grom_html}
                    
                    <div style="text-align: center; margin-top: 24px;">
                        <a href="https://raw-surf-os.preview.emergentagent.com/grom-hq" 
                           style="display: inline-block; background: linear-gradient(to right, #facc15, #f97316); 
                                  color: #000; padding: 12px 24px; text-decoration: none; 
                                  border-radius: 50px; font-weight: bold;">
                            View Full Activity in Grom HQ
                        </a>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;">
                    <p style="color: #6b7280; font-size: 12px; text-align: center;">
                        Raw Surf OS - Keeping parents connected ðŸ¤™
                    </p>
                </div>
                """
                
                try:
                    resend.Emails.send({
                        "from": "Raw Surf <noreply@raw.surf>",
                        "to": [parent.email],
                        "subject": f"ðŸ„ Weekly Grom Report - {datetime.now().strftime('%B %d')}",
                        "html": email_html
                    })
                    reports_sent += 1
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to send weekly report to {parent.email}: {e}")
            
            logger.info(f"[Scheduler] Sent {reports_sent} weekly Grom reports")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in weekly Grom report: {str(e)}")
