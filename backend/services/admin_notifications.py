"""
Admin Notification Service
Sends multi-channel notifications to admins for important events like new pro applications
"""

import os
import json
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

try:
    import resend
    RESEND_AVAILABLE = True
except ImportError:
    RESEND_AVAILABLE = False

from services.onesignal_service import onesignal_service


class AdminNotificationService:
    """Service for sending notifications to admin users"""
    
    def __init__(self):
        self.resend_api_key = os.environ.get('RESEND_API_KEY')
        self.from_email = os.environ.get('EMAIL_FROM', 'Raw Surf <noreply@rawsurf.io>')
        self.app_url = os.environ.get('FRONTEND_URL', 'https://rawsurf.io')
        
        if self.resend_api_key and RESEND_AVAILABLE:
            resend.api_key = self.resend_api_key
    
    async def notify_new_pro_application(
        self,
        db: AsyncSession,
        applicant_id: str,
        applicant_name: str,
        applicant_username: str,
        applicant_email: str,
        company_name: Optional[str] = None,
        verification_request_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send notifications to all admins when a new Approved Pro application is submitted.
        
        Channels:
        1. In-app notification (stored in DB)
        2. Email notification (via Resend)
        3. Push notification (via OneSignal)
        """
        from models import Profile, Notification
        
        results = {
            "in_app": {"sent": 0, "failed": 0},
            "email": {"sent": 0, "failed": 0},
            "push": {"sent": 0, "failed": 0}
        }
        
        # Get all admin users
        admin_result = await db.execute(
            select(Profile).where(Profile.is_admin == True)
        )
        admins = admin_result.scalars().all()
        
        if not admins:
            return {"success": False, "error": "No admins found", "results": results}
        
        # Prepare notification content
        title = "New Pro Photographer Application"
        body = f"{applicant_name} (@{applicant_username}) has applied for Approved Pro status."
        if company_name:
            body += f" Company: {company_name}"
        
        notification_data = {
            "applicant_id": applicant_id,
            "applicant_name": applicant_name,
            "applicant_username": applicant_username,
            "applicant_email": applicant_email,
            "company_name": company_name,
            "verification_request_id": verification_request_id,
            "verification_type": "approved_pro_photographer",
            "submitted_at": datetime.now(timezone.utc).isoformat()
        }
        
        admin_ids = []
        admin_emails = []
        
        for admin in admins:
            admin_ids.append(admin.id)
            if admin.email:
                admin_emails.append(admin.email)
            
            # 1. Create in-app notification
            try:
                notification = Notification(
                    user_id=admin.id,
                    type='new_pro_application',
                    title=title,
                    body=body,
                    data=json.dumps(notification_data)
                )
                db.add(notification)
                results["in_app"]["sent"] += 1
            except Exception as e:
                print(f"Failed to create in-app notification for admin {admin.id}: {e}")
                results["in_app"]["failed"] += 1
        
        # Commit in-app notifications
        try:
            await db.commit()
        except Exception as e:
            print(f"Failed to commit in-app notifications: {e}")
            await db.rollback()
        
        # 2. Send email notifications
        if self.resend_api_key and RESEND_AVAILABLE and admin_emails:
            for email in admin_emails:
                try:
                    email_html = self._build_pro_application_email(
                        applicant_name=applicant_name,
                        applicant_username=applicant_username,
                        applicant_email=applicant_email,
                        company_name=company_name
                    )
                    
                    resend.Emails.send({
                        "from": self.from_email,
                        "to": email,
                        "subject": f"[Action Required] {title}",
                        "html": email_html
                    })
                    results["email"]["sent"] += 1
                except Exception as e:
                    print(f"Failed to send email to {email}: {e}")
                    results["email"]["failed"] += 1
        
        # 3. Send push notifications
        if admin_ids:
            try:
                push_result = await onesignal_service.send_notification(
                    external_user_ids=admin_ids,
                    title=title,
                    message=body,
                    data={
                        "type": "new_pro_application",
                        **notification_data
                    },
                    url=f"{self.app_url}/admin?tab=verification"
                )
                if push_result.get("success"):
                    results["push"]["sent"] = len(admin_ids)
                else:
                    results["push"]["failed"] = len(admin_ids)
            except Exception as e:
                print(f"Failed to send push notifications: {e}")
                results["push"]["failed"] = len(admin_ids)
        
        return {
            "success": True,
            "admins_notified": len(admins),
            "results": results
        }
    
    def _build_pro_application_email(
        self,
        applicant_name: str,
        applicant_username: str,
        applicant_email: str,
        company_name: Optional[str] = None
    ) -> str:
        """Build HTML email for pro application notification"""
        company_section = f"<p><strong>Company:</strong> {company_name}</p>" if company_name else ""
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: linear-gradient(135deg, #10b981, #f59e0b); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }}
                .header h1 {{ color: white; margin: 0; font-size: 24px; }}
                .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }}
                .applicant-card {{ background: white; border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
                .applicant-card h3 {{ margin-top: 0; color: #1f2937; }}
                .btn {{ display: inline-block; background: linear-gradient(135deg, #10b981, #f59e0b); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }}
                .footer {{ text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Pro Photographer Application</h1>
                </div>
                <div class="content">
                    <p>A new photographer has applied for Approved Pro status and needs your review.</p>
                    
                    <div class="applicant-card">
                        <h3>{applicant_name}</h3>
                        <p><strong>Username:</strong> @{applicant_username}</p>
                        <p><strong>Email:</strong> {applicant_email}</p>
                        {company_section}
                        <p><strong>Applied:</strong> {datetime.now(timezone.utc).strftime('%B %d, %Y at %I:%M %p UTC')}</p>
                    </div>
                    
                    <p>Please review their application and verify their credentials before approving.</p>
                    
                    <center>
                        <a href="{self.app_url}/admin?tab=verification" class="btn">Review Application</a>
                    </center>
                </div>
                <div class="footer">
                    <p>Raw Surf - Admin Notification</p>
                    <p>This is an automated message. Please do not reply directly.</p>
                </div>
            </div>
        </body>
        </html>
        """
    
    async def notify_verification_approved(
        self,
        db: AsyncSession,
        user_id: str,
        user_email: str,
        user_name: str,
        verification_type: str
    ) -> Dict[str, Any]:
        """
        Send notification to user when their verification is approved.
        """
        from models import Notification
        
        # Determine notification content based on type
        if verification_type == 'approved_pro_photographer':
            title = "You're Approved! Welcome to Raw Surf Pro"
            body = "Congratulations! Your Approved Pro application has been verified. You can now access all pro features."
        elif verification_type == 'pro_surfer':
            title = "WSL Verification Complete"
            body = "Your Pro Surfer status has been verified. Your WSL credentials are now linked to your profile."
        else:
            title = "Verification Approved"
            body = "Your verification request has been approved."
        
        # Create in-app notification
        try:
            notification = Notification(
                user_id=user_id,
                type='verification_approved',
                title=title,
                body=body,
                data=json.dumps({
                    "verification_type": verification_type,
                    "approved_at": datetime.now(timezone.utc).isoformat()
                })
            )
            db.add(notification)
            await db.commit()
        except Exception as e:
            print(f"Failed to create approval notification: {e}")
            await db.rollback()
        
        # Send email
        if self.resend_api_key and RESEND_AVAILABLE:
            try:
                email_html = self._build_approval_email(user_name, verification_type)
                resend.Emails.send({
                    "from": self.from_email,
                    "to": user_email,
                    "subject": title,
                    "html": email_html
                })
            except Exception as e:
                print(f"Failed to send approval email: {e}")
        
        # Send push notification
        try:
            await onesignal_service.send_notification(
                external_user_ids=[user_id],
                title=title,
                message=body,
                data={"type": "verification_approved", "verification_type": verification_type},
                url=f"{self.app_url}/profile"
            )
        except Exception as e:
            print(f"Failed to send approval push notification: {e}")
        
        return {"success": True}
    
    def _build_approval_email(self, user_name: str, verification_type: str) -> str:
        """Build HTML email for verification approval"""
        if verification_type == 'approved_pro_photographer':
            features = """
            <ul>
                <li>Priority in search results and "Find a Photographer" listings</li>
                <li>Verified badge on your profile</li>
                <li>Access to On-Demand dispatch system</li>
                <li>Higher commission rates on photo sales</li>
                <li>Exclusive pro tools and analytics</li>
            </ul>
            """
        else:
            features = """
            <ul>
                <li>Verified badge on your profile</li>
                <li>Enhanced credibility with the community</li>
                <li>Access to exclusive features</li>
            </ul>
            """
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: linear-gradient(135deg, #10b981, #f59e0b); padding: 40px; border-radius: 12px 12px 0 0; text-align: center; }}
                .header h1 {{ color: white; margin: 0; font-size: 28px; }}
                .header .badge {{ font-size: 48px; margin-bottom: 10px; }}
                .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }}
                .features {{ background: white; border-radius: 8px; padding: 20px; margin: 20px 0; }}
                .btn {{ display: inline-block; background: linear-gradient(135deg, #10b981, #f59e0b); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }}
                .footer {{ text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="badge">✅</div>
                    <h1>You're Verified!</h1>
                </div>
                <div class="content">
                    <p>Hey {user_name},</p>
                    <p>Great news! Your application has been reviewed and approved. Welcome to the Raw Surf pro community!</p>
                    
                    <div class="features">
                        <h3>What's unlocked for you:</h3>
                        {features}
                    </div>
                    
                    <p>Start showcasing your work and connecting with surfers today!</p>
                    
                    <center>
                        <a href="{self.app_url}/profile" class="btn">View Your Profile</a>
                    </center>
                </div>
                <div class="footer">
                    <p>Raw Surf - Your Surf, Captured Live</p>
                </div>
            </div>
        </body>
        </html>
        """


# Singleton instance
admin_notification_service = AdminNotificationService()
