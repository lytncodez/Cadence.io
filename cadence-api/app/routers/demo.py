"""Public "Book a demo" form on the website. No sign-in; protected by a honeypot field and a per-address rate limit."""
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..models import DemoRequest
from ..schemas import DemoRequestIn, DemoRequestOut
from ..services.notify import numbers, send_email, send_sms

router = APIRouter(prefix="/demo-requests", tags=["website"])
LIMIT, WINDOW = 5, 3600  # 5 requests per hour per address
_hits: dict[str, deque] = defaultdict(deque)


def _client(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")  # Render sits behind a proxy
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def _limited(key: str) -> bool:
    now, q = time.monotonic(), _hits[key]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return True
    q.append(now)
    return False


@router.post("", response_model=DemoRequestOut, status_code=201)
async def create(body: DemoRequestIn, request: Request, db: AsyncSession = Depends(get_db)):
    if body.website:  # a bot filled the hidden field: pretend it worked, store nothing
        return DemoRequestOut()
    if _limited(_client(request)):
        raise HTTPException(429, "Too many requests from this connection. Try again in an hour, or call us.")
    s = get_settings()
    row = DemoRequest(name=body.name.strip(), pharmacy=body.pharmacy.strip(), phone=body.phone.strip(),
                      email=(body.email or ""), branches=body.branches.strip(), message=body.message.strip())
    db.add(row)
    await db.flush()
    notes = []
    if s.demo_notify_email:
        text = (f"New demo request from the Cadence website\n\nName: {row.name}\nPharmacy: {row.pharmacy}\nPhone: {row.phone}\n"
                f"Email: {row.email or '-'}\nBranches: {row.branches or '-'}\n" + (f"Message: {row.message}\n" if row.message else ""))
        st, _ = await send_email(s.demo_notify_email, f"Demo request: {row.pharmacy}", text)
        notes.append(f"email:{st}")
    if s.demo_notify_sms and numbers(s.demo_notify_sms):
        st, _ = await send_sms(numbers(s.demo_notify_sms), f"Cadence demo request: {row.name}, {row.pharmacy}, {row.phone}")
        notes.append(f"sms:{st}")
    row.notified = " ".join(notes)
    await db.commit()
    return DemoRequestOut()
