from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import require
from ..models import Pharmacy, User
from ..schemas import AskIn, AskOut
from ..services import ai
from ..services.analytics import summarize, summarize_rows

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat", response_model=AskOut)
async def chat(body: AskIn, user: User = Depends(require("view_insights")), db: AsyncSession = Depends(get_db)):
    """Answer a question. Figures come from the saved inventory, or from `rows` when the user is analysing an uploaded file."""
    if body.rows is not None:
        ph = await db.get(Pharmacy, user.pharmacy_id)
        s = summarize_rows(body.rows, body.dataset_name or "your uploaded file", ph.critical_days, ph.soon_days)
    else:
        s = await summarize(db, user)
    return await ai.answer(body.message, s, body.history)


@router.get("/status")
async def status(user: User = Depends(require("view_insights"))):
    """Lets the app show whether open questions will get a full AI answer."""
    return {"connected": ai.ai_connected()}
