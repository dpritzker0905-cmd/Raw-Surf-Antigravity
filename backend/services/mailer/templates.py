"""Transactional email templates: HTML + plain text, built from one structure so the two never drift.

Design rules (each pinned by a test):
  * No tracking pixels, no remote images, no remote fonts, no click-tracking redirects: every link is a
    plain https URL built from FRONTEND_URL.
  * Authentication links carry only opaque single-use tokens. Support links carry a resource UUID and
    require a signed-in owner; no link embeds an address, support text or authentication credential.
  * Every caller-supplied value is escaped for HTML, stripped of control characters (so a subject can never
    carry a header injection) and length-capped.
  * Accessible: lang attribute, one h1, 16px+ body text, >= 4.5:1 contrast in both schemes, the CTA is a real
    link whose full URL is ALSO printed as text, and nothing is conveyed by colour alone.
  * Themes: email clients expose light and dark only (prefers-color-scheme). The light scheme uses the
    warm "beach" sand surface; dark is a deep ocean surface. The app's three in-app themes cannot be
    chosen by an inbox, so the email follows the reader's client scheme.
"""
import html
import re
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from . import config

INVITE_EXPIRY_HOURS = 48

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,200}$")
_CONTROL_RE = re.compile("[\x00-\x1f\x7f\u2028\u2029]+")


class TemplateError(ValueError):
    """Bad or missing template parameters, or FRONTEND_URL unset. Permanent: retrying cannot fix it."""


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def clean(value, limit: int = 80) -> str:
    """Plain-text, single-line, capped. Escaping for HTML happens separately at render time."""
    text = _CONTROL_RE.sub(" ", str(value if value is not None else "")).strip()
    return re.sub(r"\s{2,}", " ", text)[:limit]


def build_link(path: str, token: Optional[str] = None) -> str:
    base = config.frontend_url()
    if not base:
        raise TemplateError("frontend_url_not_configured")
    if not (base.startswith("https://") or base.startswith("http://localhost") or base.startswith("http://127.0.0.1")):
        raise TemplateError("frontend_url_must_be_https")
    if not path.startswith("/"):
        raise TemplateError("bad_link_path")
    if token is None:
        return base + path
    if not isinstance(token, str) or not _TOKEN_RE.match(token):
        raise TemplateError("token_not_opaque")
    return f"{base}{path}?token={token}"


# ── layout ────────────────────────────────────────────────────────────────────────────────────────

_STYLE = (
    ":root{color-scheme:light dark;supported-color-schemes:light dark}"
    "body{margin:0;padding:24px 16px;background:#fdf6e7;color:#1b2a33;"
    "font:16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}"
    ".card{max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3d5b4;border-radius:12px;padding:28px}"
    "h1{font-size:22px;line-height:1.3;margin:0 0 16px}"
    "p{margin:0 0 14px}"
    "a{color:#0a5f78;text-decoration:underline}"
    ".cta{display:inline-block;margin:6px 0 14px;padding:12px 20px;background:#0a5f78;color:#ffffff !important;"
    "border-radius:8px;font-weight:600;text-decoration:underline}"
    ".small{font-size:14px;color:#4a5a63}"
    "@media (prefers-color-scheme: dark){"
    "body{background:#0b1418;color:#e6eff2}"
    ".card{background:#12202a;border-color:#27414f}"
    "a{color:#7fd0e8}"
    ".cta{background:#7fd0e8;color:#0b1418 !important}"
    ".small{color:#a9bcc5}}"
)


@dataclass(frozen=True)
class _Body:
    subject: str
    heading: str
    paragraphs: Tuple[str, ...]
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None
    footnote: str = ""


def _layout(body: _Body) -> RenderedEmail:
    esc = html.escape
    parts: List[str] = [f"<h1>{esc(body.heading)}</h1>"]
    parts += [f"<p>{esc(p)}</p>" for p in body.paragraphs]
    text_lines: List[str] = [body.heading, ""] + [p + "\n" for p in body.paragraphs]
    if body.cta_url:
        parts.append(f'<p><a class="cta" href="{esc(body.cta_url, quote=True)}">{esc(body.cta_label or "Open")}</a></p>')
        parts.append(f'<p class="small">If the button does not work, copy this link into your browser:<br>'
                     f'<a href="{esc(body.cta_url, quote=True)}">{esc(body.cta_url)}</a></p>')
        text_lines += [f"{body.cta_label or 'Open'}: {body.cta_url}", ""]
    if body.footnote:
        parts.append(f'<p class="small">{esc(body.footnote)}</p>')
        text_lines += [body.footnote, ""]
    parts.append('<p class="small">Raw Surf. You are receiving this because of activity on your account.</p>')
    text_lines.append("Raw Surf. You are receiving this because of activity on your account.")
    html_doc = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
        f"<title>{esc(body.subject)}</title><style>{_STYLE}</style></head>"
        f'<body><div class="card" role="article" aria-label="{esc(body.subject, quote=True)}">'
        + "".join(parts) + "</div></body></html>"
    )
    return RenderedEmail(subject=clean(body.subject, 150), html=html_doc, text="\n".join(text_lines).strip() + "\n")


# ── templates ─────────────────────────────────────────────────────────────────────────────────────

def _guardian_invite(p: dict) -> _Body:
    child = clean(p["child_display_name"], 60)
    hours = int(p.get("expires_hours", INVITE_EXPIRY_HOURS))
    return _Body(
        subject=f"Confirm you are {child}'s parent or guardian on Raw Surf",
        heading="Confirm your link on Raw Surf",
        paragraphs=(
            f"{child} asked to link your account as their parent or guardian on Raw Surf.",
            f"This link is for {child} only, works once, and expires in {hours} hours.",
        ),
        cta_label="Review and confirm",
        cta_url=build_link("/guardian/accept", p["token"]),
        footnote="If you do not know this person or were not expecting this, ignore this email. Nothing is linked until you confirm.",
    )


def _guardian_confirmed(p: dict) -> _Body:
    child = clean(p["child_display_name"], 60)
    return _Body(
        subject=f"Your Raw Surf family link with {child} is confirmed",
        heading="Family link confirmed",
        paragraphs=(
            f"You are now linked as a parent or guardian of {child} on Raw Surf.",
            "You can review controls, approvals and activity from your family settings at any time.",
        ),
        cta_label="Open family settings",
        cta_url=build_link("/family"),
        footnote="If you did not expect this, sign in and remove the link, then change your password.",
    )


def _login_new_device(p: dict) -> _Body:
    device = clean(p["device"], 80)
    when = clean(p["when"], 60)
    return _Body(
        subject="New sign-in to your Raw Surf account",
        heading="New sign-in detected",
        paragraphs=(
            f"Your account was signed in to from {device} at {when}.",
            "If this was you, no action is needed.",
            "If it was not you, secure your account now. The link works once.",
        ),
        cta_label="Secure my account",
        cta_url=build_link("/security/secure-account", p["token"]),
    )


def _account_lockout_notice(p: dict) -> _Body:
    until = clean(p["locked_until"], 60)
    return _Body(
        subject="Your Raw Surf account is temporarily locked",
        heading="Account temporarily locked",
        paragraphs=(
            "We saw several incorrect sign-in attempts, so sign-in is paused for your account.",
            f"You can try again after {until}.",
            "If this was not you, reset your password once sign-in is available.",
        ),
        cta_label="Reset my password",
        cta_url=build_link("/forgot-password"),
    )


def _dispute_opened(p: dict) -> _Body:
    ref = clean(p["reference"], 40)
    return _Body(
        subject=f"A dispute was opened on Raw Surf ({ref})",
        heading="A dispute was opened",
        paragraphs=(
            f"A dispute with reference {ref} was opened on your account.",
            "Sign in to see the details and respond. We do not include the details in email.",
        ),
        cta_label="View disputes",
        cta_url=build_link("/disputes"),
    )


def _password_reset(p: dict) -> _Body:
    return _Body(
        subject="Reset your Raw Surf password",
        heading="Reset your password",
        paragraphs=(
            "We received a request to reset the password for your Raw Surf account.",
            "This link works once and expires soon.",
        ),
        cta_label="Choose a new password",
        cta_url=build_link("/reset-password", p["token"]),
        footnote="If you did not ask for this, ignore this email. Your password stays the same.",
    )


def _support_reply(p: dict) -> _Body:
    ticket_id = str(uuid.UUID(p["ticket_id"]))
    return _Body(
        subject="New reply from Raw Surf support", heading="You have a new support reply",
        paragraphs=("Sign in to your Raw Surf account to read the reply in your support ticket.",),
        cta_label="Open your ticket", cta_url=build_link("/support/tickets/" + ticket_id),
        footnote="Reply inside the app. Replies to this notification email are not added to your ticket.",
    )


MAX_DIGEST_ITEMS = 20


def _notice_digest(p: dict) -> _Body:
    items = p["items"]
    if not isinstance(items, (list, tuple)) or not items:
        raise TemplateError("bad_param")
    lines = tuple(clean(i.get("summary") if isinstance(i, dict) else i, 160) for i in items[:MAX_DIGEST_ITEMS])
    count = len(lines)
    return _Body(
        subject=f"{count} updates on Raw Surf",
        heading=f"{count} updates on your account",
        paragraphs=lines,
        cta_label="Open Raw Surf",
        cta_url=build_link("/notifications"),
        footnote="We combine routine notices into one email. Security emails are always sent on their own.",
    )


SECURITY = "security"  # never delayed by the daily budget; sent on their own
LOW = "low"            # routine notices: held to a share of the daily budget and merged into a digest


@dataclass(frozen=True)
class TemplateSpec:
    required: Tuple[str, ...]
    builder: Callable[[dict], _Body]
    priority: str = SECURITY
    summary: Optional[Callable[[dict], str]] = None  # one line for a digest; only LOW templates have one


TEMPLATES: Dict[str, TemplateSpec] = {
    "guardian_invite": TemplateSpec(("child_display_name", "token"), _guardian_invite),
    "guardian_confirmed": TemplateSpec(("child_display_name",), _guardian_confirmed),
    "login_new_device": TemplateSpec(("device", "when", "token"), _login_new_device),
    "account_lockout_notice": TemplateSpec(("locked_until",), _account_lockout_notice),
    "password_reset": TemplateSpec(("token",), _password_reset),
    "dispute_opened": TemplateSpec(
        ("reference",), _dispute_opened, priority=LOW,
        summary=lambda p: f"A dispute (reference {clean(p['reference'], 40)}) was opened on your account."),
    "notice_digest": TemplateSpec(("items",), _notice_digest, priority=LOW),
    "support_reply": TemplateSpec(("ticket_id",), _support_reply, priority=LOW),
}


def priority_of(template: str) -> str:
    spec = TEMPLATES.get(template)
    return spec.priority if spec else SECURITY


def render(template: str, params: Optional[dict] = None) -> RenderedEmail:
    spec = TEMPLATES.get(template)
    if spec is None:
        raise TemplateError("unknown_template")
    params = params or {}
    missing = [name for name in spec.required if params.get(name) in (None, "")]
    if missing:
        raise TemplateError("missing_param:" + ",".join(missing))
    try:
        return _layout(spec.builder(params))
    except (TypeError, ValueError) as exc:
        if isinstance(exc, TemplateError):
            raise
        raise TemplateError("bad_param") from exc
