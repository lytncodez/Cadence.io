import os
import re
from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _env(*names: str):
    """Accept a few common spellings of the same setting (Render variable names are easy to get slightly wrong)."""
    return Field(default="", validation_alias=AliasChoices(*names))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./cadence.db"
    jwt_secret: str = "dev-only-change-me"
    jwt_expires_minutes: int = 720
    allowed_origins: str = "http://localhost:5173"
    seed_password: str = "cadence2026"
    api_prefix: str = "/api/v1"

    # SMS: mock (log only) | africastalking | arkesel | hubtel
    sms_provider: str = "mock"
    # Max 11 characters, approved by your provider. Africa's Talking: leave blank to use their default sender until yours is approved.
    sms_sender_id: str = ""
    # your app's username; "sandbox" sends to the Africa's Talking simulator instead of real phones
    africastalking_username: str = _env("AFRICASTALKING_USERNAME", "AFRICAS_TALKING_USERNAME", "AFRICASTALKING_USER", "AT_USERNAME")
    africastalking_api_key: str = _env("AFRICASTALKING_API_KEY", "AFRICAS_TALKING_API_KEY", "AFRICASTALKING_APIKEY", "AFRICASTALKING_KEY", "AT_API_KEY")
    arkesel_api_key: str = ""
    hubtel_client_id: str = ""
    hubtel_client_secret: str = ""

    # Email: mock (log only) | brevo | resend | smtp
    # Render's free plan blocks SMTP ports, so use brevo or resend (HTTPS APIs) there; smtp works locally and on paid plans.
    email_provider: str = "mock"
    email_from: str = ""  # the verified sender address, e.g. alerts@yourpharmacy.com
    email_from_name: str = "Cadence"
    brevo_api_key: str = ""
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # AI wording: mock (templates) | anthropic | openai. Numbers always come from the analytics service.
    ai_provider: str = "mock"
    ai_model: str = _env("AI_MODEL", "ANTHROPIC_MODEL", "OPENAI_MODEL", "MODEL")  # blank = pick your account's newest model
    anthropic_api_key: str = _env("ANTHROPIC_API_KEY", "CLAUDE_API_KEY")
    openai_api_key: str = _env("OPENAI_API_KEY", "OPENAI_KEY")
    gemini_api_key: str = _env("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY")  # free tier: aistudio.google.com

    # Public address of the web app, used in password-reset links (no trailing slash).
    app_url: str = "http://localhost:5173"
    reset_link_minutes: int = 60
    # Cadence HQ: where "Get help" requests from pharmacies are sent (falls back to DEMO_NOTIFY_EMAIL / DEMO_NOTIFY_SMS).
    hq_notify_email: str = ""
    hq_notify_sms: str = ""
    # Daily HQ email (sign-ups, who's gone quiet, open help requests, AI briefing), sent by the same cron after this time (UTC).
    hq_digest_enabled: bool = True
    hq_digest_time: str = "08:00"

    # Let pharmacies create their own account from the website. Set to false to only add pharmacies yourself.
    signup_enabled: bool = True

    # Where "Book a demo" requests from the website are sent (leave blank to only store them).
    demo_notify_email: str = ""
    demo_notify_sms: str = ""

    # Fernet key(s) for encrypting personal data at rest (comma-separated; the first one encrypts). See app/crypto.py.
    data_encryption_key: str = ""

    # Shared secret for an external cron (e.g. cron-job.org) to trigger the daily digest.
    cron_secret: str = ""

    @field_validator("*", mode="before")
    @classmethod
    def _clean(cls, v):
        """Trim spaces, line breaks and wrapping quotes pasted along with a value (a common reason a key 'doesn't work')."""
        if isinstance(v, str):
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1].strip()
        return v

    @field_validator("sms_provider", "email_provider", "ai_provider", mode="after")
    @classmethod
    def _lower(cls, v: str) -> str:
        v = v.lower().replace("'", "").replace(" ", "").replace("_", "") or "mock"
        return {"google": "gemini", "googleai": "gemini", "claude": "anthropic", "chatgpt": "openai"}.get(v, v)

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def env_names_like(*words: str) -> list[str]:
    """Names (never values) of server variables that mention any of these words, e.g. to spot a misspelt key."""
    pat = re.compile("|".join(map(re.escape, words)), re.I)
    return sorted(k for k in os.environ if pat.search(k))
