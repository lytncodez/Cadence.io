from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./cadence.db"
    jwt_secret: str = "dev-only-change-me"
    jwt_expires_minutes: int = 720
    allowed_origins: str = "http://localhost:5173"
    seed_password: str = "cadence2026"
    api_prefix: str = "/api/v1"

    # SMS: mock (log only) | arkesel | hubtel
    sms_provider: str = "mock"
    sms_sender_id: str = "Cadence"  # max 11 characters, registered with your provider
    arkesel_api_key: str = ""
    hubtel_client_id: str = ""
    hubtel_client_secret: str = ""

    # Email: mock (log only) | smtp
    email_provider: str = "mock"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # AI wording: mock (templates) | anthropic | openai. Numbers always come from the analytics service.
    ai_provider: str = "mock"
    ai_model: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Shared secret for an external cron (e.g. cron-job.org) to trigger the daily digest.
    cron_secret: str = ""

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
