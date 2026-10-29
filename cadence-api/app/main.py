from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .db import engine
from .routers import analytics, auth, items, team

settings = get_settings()
app = FastAPI(title="Cadence.io API", version="0.2.0", docs_url="/docs", redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # Vercel preview deployments
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def readable_validation_errors(_: Request, exc: RequestValidationError):
    """Return one human sentence in `detail` (the frontend shows it as-is), plus the raw errors."""
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    msg = str(first.get("msg", "Invalid input")).removeprefix("Value error, ")
    return JSONResponse(status_code=422, content={"detail": f"{field}: {msg}", "errors": exc.errors()})


for r in (auth.router, items.router, team.router, analytics.router):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/health", tags=["meta"])
async def health():
    """Render pings this. Also wakes a sleeping Neon database."""
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))
    return {"status": "ok"}
