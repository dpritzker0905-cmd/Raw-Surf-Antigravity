"""Email configuration: environment reads at CALL time, names only (never values) in code and docs.

  EMAIL_PROVIDER      resend | console | (unset or anything else = disabled)
  EMAIL_API_KEY       provider credential (Render env only)
  EMAIL_FROM          sender, e.g. "Raw Surf <no-reply@notify.raw.surf>" (a SUBDOMAIN, never the apex)
  REPLY_TO            optional Reply-To mailbox (a human-read inbox); unset = no Reply-To header
  FRONTEND_URL        base of every emailed link
  EMAIL_WEBHOOK_SECRET  bounce/complaint webhook signing secret; the webhook is closed while unset
  EMAIL_DAILY_CAP     sends per UTC day the budget guard plans around; default 100 (Resend free plan)
  EMAIL_DIGEST_WINDOW_MINUTES         how long low-priority notices wait to be merged; default 30
  EMAIL_RATE_PER_RECIPIENT_PER_HOUR   default 5 (counted per priority class)
  EMAIL_RATE_GLOBAL_PER_HOUR          default 200 (counted per priority class)
  EMAIL_MAX_ATTEMPTS                  default 3
  EMAIL_CONSOLE_DIR   console provider only: also write each rendered message to this folder (dev)
"""
import os


def _int_env(name: str, default: int, lo: int = 1, hi: int = 100000) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return max(lo, min(hi, value))


def provider() -> str:
    return (os.environ.get("EMAIL_PROVIDER") or "").strip().lower()


def api_key() -> str:
    return (os.environ.get("EMAIL_API_KEY") or "").strip()


def email_from() -> str:
    return (os.environ.get("EMAIL_FROM") or "").strip()


def reply_to() -> str:
    return (os.environ.get("REPLY_TO") or "").strip()


def daily_cap() -> int:
    return _int_env("EMAIL_DAILY_CAP", 100, hi=10_000_000)


def digest_window_minutes() -> int:
    return _int_env("EMAIL_DIGEST_WINDOW_MINUTES", 30, lo=0, hi=1440)


def frontend_url() -> str:
    return (os.environ.get("FRONTEND_URL") or "").strip().rstrip("/")


def webhook_secret() -> str:
    return (os.environ.get("EMAIL_WEBHOOK_SECRET") or "").strip()


def console_dir() -> str:
    return (os.environ.get("EMAIL_CONSOLE_DIR") or "").strip()


def rate_per_recipient_per_hour() -> int:
    return _int_env("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", 5)


def rate_global_per_hour() -> int:
    return _int_env("EMAIL_RATE_GLOBAL_PER_HOUR", 200)


def max_attempts() -> int:
    return _int_env("EMAIL_MAX_ATTEMPTS", 3, hi=10)
