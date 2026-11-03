"""Small in-memory rate limiter (per API process). Enough for one Render instance; use Redis if you scale out."""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")  # Render sits behind a proxy
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def hit(key: str, limit: int, window: int) -> bool:
    """Record one attempt. True if this attempt is over the limit."""
    now, q = time.monotonic(), _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def over(key: str, limit: int, window: int) -> bool:
    """Check without recording an attempt."""
    now, q = time.monotonic(), _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    return len(q) >= limit


def enforce(key: str, limit: int, window: int, message: str) -> None:
    if hit(key, limit, window):
        raise HTTPException(429, message)


def reset() -> None:
    _hits.clear()
