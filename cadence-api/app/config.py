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

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
