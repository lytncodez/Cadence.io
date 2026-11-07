"""What's switched on: SMS, email, AI, the daily digest trigger and encryption. Admins see this in Settings → Integrations.
These are server settings shared by every pharmacy on this Cadence install; no secrets are returned."""
from fastapi import APIRouter, Depends

from .. import crypto
from ..config import get_settings
from ..deps import require
from ..models import User
from ..schemas import CamelModel, SendResult
from ..services import ai, notify

router = APIRouter(prefix="/integrations", tags=["integrations"])


class Integration(CamelModel):
    provider: str
    status: str  # live | demo | needs_setup
    detail: str


class IntegrationsOut(CamelModel):
    sms: Integration
    email: Integration
    ai: Integration
    digest: Integration
    encryption: Integration


def _row(provider: str, problem: str, live_detail: str, demo_detail: str) -> Integration:
    if provider == "mock":
        return Integration(provider="mock", status="demo", detail=demo_detail)
    if problem:
        return Integration(provider=provider, status="needs_setup", detail=problem)
    return Integration(provider=provider, status="live", detail=live_detail)


@router.get("", response_model=IntegrationsOut)
async def integrations(user: User = Depends(require("manage_alerts", "company"))):
    s = get_settings()
    return IntegrationsOut(
        sms=_row(s.sms_provider, notify.sms_problem(), notify.sms_live_detail(), notify.SMS_DEMO_DETAIL),
        email=_row(s.email_provider, notify.email_problem(), f"Sending from {s.email_from or s.smtp_from or s.smtp_user} via {s.email_provider.title()}.",
                   "Demo mode: emails are logged, not sent. Set EMAIL_PROVIDER=brevo (or resend), its API key and EMAIL_FROM."),
        ai=_row(s.ai_provider, ai.ai_problem(), f"{s.ai_provider.title()} · {ai.model_label()}. Answers general questions too.",
                "Built-in wording for stock questions; general questions are off. Set AI_PROVIDER and its API key (AI_MODEL is optional)."),
        digest=Integration(provider="cron", status="live" if s.cron_secret else "needs_setup",
                           detail="The daily digest runs when your scheduler calls /alerts/cron." if s.cron_secret
                           else "Set CRON_SECRET on Render, then add a cron-job.org job every 15 minutes for <this API address>/api/v1/alerts/cron?secret=<your CRON_SECRET>."),
        encryption=Integration(provider="fernet", status="live" if crypto.enabled() else "needs_setup",
                               detail="Personal details are encrypted in the database." if crypto.enabled()
                               else "Set DATA_ENCRYPTION_KEY to encrypt personal details at rest."),
    )


@router.post("/test-ai", response_model=SendResult)
async def test_ai(user: User = Depends(require("manage_alerts", "company"))):
    status, detail = await ai.ping()
    return SendResult(channel="ai", status=status, detail=detail)
