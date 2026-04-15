"""
Password Reset Routes
- Request password reset (generates token)
- Reset password with token
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import secrets
import os
import resend
import logging

logger = logging.getLogger(__name__)
import logging

from database import get_db
from models import Profile, PasswordResetToken

router = APIRouter()
logger = logging.getLogger(__name__)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Initialize Resend
RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# App URL for reset links - read at runtime to pick up env changes
def get_app_url():
    url = os.environ.get('APP_URL')
    if not url:
        url = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')
    return url

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def generate_reset_token() -> str:
    """Generate a secure random token"""
    return secrets.token_urlsafe(48)


async def send_password_reset_email(email: str, reset_link: str, user_name: str = None) -> bool:
    """Send password reset email via Resend"""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set, skipping email send")
        return False
    
    # DEBUG: Log the exact reset_link being used
    print(f"[EMAIL_DEBUG] Sending reset email to {email} with link: {reset_link}", flush=True)
    
    try:
        display_name = user_name or email.split('@')[0]
        
        params = {
            "from": "Raw Surf <noreply@raw.surf>",
            "to": [email],
            "subject": "Reset Your Raw Surf Password 🏄",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #f59e0b; margin: 0;">🏄 Raw Surf</h1>
                </div>
                
                <h2 style="color: #1f2937;">Hey {display_name},</h2>
                
                <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                    We received a request to reset your password. Click the button below to create a new password:
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="{reset_link}" 
                       style="display: inline-block; background: linear-gradient(to right, #facc15, #f97316); 
                              color: #000; padding: 14px 28px; text-decoration: none; 
                              border-radius: 50px; font-weight: bold; font-size: 16px;">
                        Reset Password
                    </a>
                </div>
                
                <p style="color: #6b7280; font-size: 14px;">
                    Or copy this link: <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; word-break: break-all;">{reset_link}</code>
                </p>
                
                <p style="color: #6b7280; font-size: 14px;">
                    This link will expire in <strong>1 hour</strong>. If you didn't request this reset, 
                    you can safely ignore this email.
                </p>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    Raw Surf OS - Your surf. Captured live. 🤙
                </p>
            </div>
            """,
            "text": f"""
Hey {display_name},

We received a request to reset your Raw Surf password.

Click here to reset your password: {reset_link}

This link will expire in 1 hour.

If you didn't request this reset, you can safely ignore this email.

- Raw Surf OS Team 🤙
            """
        }
        
        response = resend.Emails.send(params)
        logger.info(f"Password reset email sent to {email}, ID: {response.get('id', 'unknown')}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send password reset email to {email}: {str(e)}")
        return False


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class VerifyTokenRequest(BaseModel):
    token: str


@router.post("/auth/forgot-password")
async def request_password_reset(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """
    Request a password reset. Generates a token that expires in 1 hour.
    Sends email with reset link via Resend.
    """
    # Find user
    result = await db.execute(select(Profile).where(Profile.email == data.email))
    user = result.scalar_one_or_none()
    
    # Always return success to prevent email enumeration
    if not user:
        return {
            "message": "If an account exists with this email, you will receive a reset link.",
            "success": True
        }
    
    # Invalidate any existing tokens for this user
    existing_tokens = await db.execute(
        select(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id)
        .where(PasswordResetToken.used == False)
    )
    for token in existing_tokens.scalars().all():
        token.used = True
    
    # Generate new token
    token = generate_reset_token()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=expires_at
    )
    
    db.add(reset_token)
    await db.commit()
    
    # Build reset link and send email
    app_url = get_app_url()
    reset_link = f"{app_url}/reset-password?token={token}"
    email_sent = await send_password_reset_email(
        email=user.email,
        reset_link=reset_link,
        user_name=user.full_name
    )
    
    response = {
        "message": "If an account exists with this email, you will receive a reset link.",
        "success": True
    }
    
    # Include email status in dev mode (remove in production)
    if not email_sent:
        response["_dev_note"] = "Email service unavailable, check logs"
        response["_dev_reset_link"] = reset_link
    
    return response


@router.post("/auth/verify-reset-token")
async def verify_reset_token(data: VerifyTokenRequest, db: AsyncSession = Depends(get_db)):
    """Verify if a reset token is valid (not expired, not used)"""
    result = await db.execute(
        select(PasswordResetToken)
        .where(PasswordResetToken.token == data.token)
    )
    token_record = result.scalar_one_or_none()
    
    if not token_record:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    if token_record.used:
        raise HTTPException(status_code=400, detail="This reset link has already been used")
    
    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired")
    
    # Get user email for display
    user_result = await db.execute(select(Profile).where(Profile.id == token_record.user_id))
    user = user_result.scalar_one_or_none()
    
    return {
        "valid": True,
        "email": user.email if user else None,
        "expires_at": token_record.expires_at.isoformat()
    }


@router.post("/auth/reset-password")
async def reset_password(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Reset password using a valid token"""
    # Find token
    result = await db.execute(
        select(PasswordResetToken)
        .where(PasswordResetToken.token == data.token)
    )
    token_record = result.scalar_one_or_none()
    
    if not token_record:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    
    if token_record.used:
        raise HTTPException(status_code=400, detail="This reset link has already been used")
    
    if token_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired")
    
    # Validate new password
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    # Get user and update password
    user_result = await db.execute(select(Profile).where(Profile.id == token_record.user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    
    # Hash and save new password
    user.password_hash = hash_password(data.new_password)
    
    # Mark token as used
    token_record.used = True
    
    await db.commit()
    
    return {
        "message": "Password reset successful! You can now log in with your new password.",
        "success": True
    }
