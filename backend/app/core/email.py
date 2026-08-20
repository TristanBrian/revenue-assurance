"""
SMTP sending mechanics — the "how" of email delivery. The "when/who/what"
(deciding an alert is worth emailing, picking recipients, composing the
message) lives one layer up in services/alert_service.py, same split as
security.py (JWT/password mechanics) vs. user_service.py (orchestration).

Requires env vars (add to .env — see .env.example):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD

Deliberately NOT fail-loud like security.py's SECRET_KEY: email is optional
infrastructure, not core security, so a missing/wrong SMTP config should
degrade to "alerts stay in-app only" rather than crash the app at import
time or take down whatever business action triggered the notification.

Known limitation: send_email() runs synchronously inside whatever request
handler triggered it (e.g. POST /reconcile/metrics blocks on it via
alert_service's notify_* calls) — there's no background task queue for
this yet. Fine at this app's current alert volume/frequency, but a real
SMTP round-trip (or several, across multiple triggers in one request) adds
real latency to the response. Moving this behind a task queue (Celery, an
in-process background task, etc.) is the natural next step if that
latency ever becomes a problem, not something this pass builds preemptively.
"""
import logging
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Iterable, Optional

from app import config  # noqa: F401 — import side effect: loads .env into os.environ before we read it below

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL") or SMTP_USER
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "KPC Revenue Assurance")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() == "true"

_TAG_RE = re.compile(r"<[^<]+?>")


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def send_email(
    to: Iterable[str],
    subject: str,
    html_body: str,
    text_body: Optional[str] = None,
) -> bool:
    """
    Sends one email addressed to every recipient in `to`. Returns True on
    success, False on any failure — never raises. A notification failing to
    send must never take down the reconciliation run / sync task / route
    handler that triggered it, so every failure mode here (no config, bad
    credentials, SMTP server unreachable) is caught and logged instead.
    """
    recipients = list(dict.fromkeys(addr for addr in to if addr))  # de-dup, drop falsy, keep order
    if not recipients:
        logger.info("send_email: no recipients for %r, skipping", subject)
        return False
    if not is_configured():
        logger.warning(
            "send_email: SMTP not configured (need SMTP_HOST/SMTP_USER/SMTP_PASSWORD in .env) "
            "— skipping send for %r to %d recipient(s)",
            subject, len(recipients),
        )
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text_body or _strip_html(html_body), "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        # 30s, not the original 10s: observed live under this app's own
        # alert traffic — a burst of individual sends (before
        # notify_omc_risk_escalation was batched into one digest, see
        # alert_service.py) measurably contributed to a subsequent send
        # timing out at 10s. 30s gives real headroom without hanging the
        # request indefinitely (this runs synchronously inside route
        # handlers today — see the module docstring's note on that).
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM_EMAIL, recipients, msg.as_string())
        logger.info("send_email: sent %r to %d recipient(s)", subject, len(recipients))
        return True
    except Exception as e:
        logger.error("send_email: failed to send %r: %s", subject, e)
        return False


def _strip_html(html: str) -> str:
    """Crude fallback plain-text body when the caller doesn't supply one."""
    return _TAG_RE.sub("", html)
