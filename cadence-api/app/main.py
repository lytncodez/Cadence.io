from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .db import engine
from .routers import ai, alerts, analytics, auth, demo, hq, items, support, system, team

settings = get_settings()
# Refuse to run against a real database with the development signing key: anyone could forge logins.
if not settings.database_url.startswith("sqlite") and (settings.jwt_secret == "dev-only-change-me" or len(settings.jwt_secret) < 32):
    raise RuntimeError("Set JWT_SECRET to a random value of at least 32 characters (Render generates one for you).")
app = FastAPI(title="Cadence.io API", version="0.6.0", docs_url="/docs", redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # Vercel preview deployments
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """HTTPS-only (HSTS) plus the usual browser hardening. Render serves everything over TLS."""
    response = await call_next(request)
    h = response.headers
    h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("Cache-Control", "no-store")  # API answers hold pharmacy data; never cache them
    return response


@app.exception_handler(RequestValidationError)
async def readable_validation_errors(_: Request, exc: RequestValidationError):
    """Return one human sentence in `detail` (the frontend shows it as-is), plus the raw errors."""
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    msg = str(first.get("msg", "Invalid input")).removeprefix("Value error, ")
    errors = [{"loc": list(e.get("loc", [])), "msg": str(e.get("msg", "")), "type": e.get("type", "")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": f"{field}: {msg}", "errors": errors})


for r in (auth.router, items.router, team.router, analytics.router, alerts.router, ai.router, demo.router, system.router, support.router, hq.router):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/health", tags=["meta"])
async def health():
    """Render pings this. Also wakes a sleeping Neon database."""
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))
    return {"status": "ok"}
