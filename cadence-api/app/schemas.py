"""API shapes. JSON uses camelCase to match the frontend (src/lib/types.ts)."""
import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---------- Items (a batch, flattened with its product) ----------
class ItemBase(CamelModel):
    name: str = Field(min_length=2, max_length=200)
    category: str = Field(default="", max_length=80)
    barcode: str = Field(pattern=r"^\d{6,14}$")
    batch: str = Field(min_length=1, max_length=60)
    expiry: date
    qty: int = Field(ge=0)
    unit_cost: float = Field(gt=0)
    unit_price: float = Field(gt=0)
    supplier: str = Field(default="", max_length=120)
    reorder_level: int | None = Field(default=None, ge=0)
    sold_this_month: int | None = Field(default=None, ge=0)  # optional; used when analysing an uploaded file

    @model_validator(mode="after")
    def price_not_below_cost(self):
        if self.unit_price < self.unit_cost:
            raise ValueError("Selling price is below unit cost")
        return self


class ItemCreate(ItemBase):
    pass


class ItemUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    category: str | None = None
    batch: str | None = Field(default=None, min_length=1, max_length=60)
    expiry: date | None = None
    qty: int | None = Field(default=None, ge=0)
    unit_cost: float | None = Field(default=None, gt=0)
    unit_price: float | None = Field(default=None, gt=0)
    supplier: str | None = None
    reorder_level: int | None = Field(default=None, ge=0)


class ItemOut(CamelModel):
    id: str
    name: str
    category: str
    barcode: str
    batch: str
    expiry: date
    qty: int
    unit_cost: float
    unit_price: float
    supplier: str
    sold_this_month: int
    reorder_level: int


# ---------- Users & roles ----------
class UserOut(CamelModel):
    id: str
    name: str
    email: str
    role: str
    status: str
    position: str
    staff_id: str
    phone: str
    department: str
    reg_no: str
    joined: str
    last_login: str
    photo: str
    bio: str


class UserUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=600)
    reg_no: str | None = Field(default=None, max_length=60)
    photo: str | None = Field(default=None, max_length=1_500_000)
    # admin-only fields
    position: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=80)
    role: str | None = None
    status: Literal["Active", "Invited", "Suspended"] | None = None

    @field_validator("phone")
    @classmethod
    def phone_format(cls, v: str | None):
        if v and not re.fullmatch(r"\+?\d[\d\s]{7,}", v):
            raise ValueError("Enter the phone number in +233 format")
        return v

    @field_validator("photo")
    @classmethod
    def photo_is_image(cls, v: str | None):
        if v and not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
            raise ValueError("Photo must be a PNG or JPEG")
        return v


class RoleOut(CamelModel):
    name: str
    summary: str
    perms: list[str]
    locked: bool = False


class PharmacyOut(CamelModel):
    name: str
    location: str
    licence_no: str
    critical_days: int
    soon_days: int


# ---------- Auth ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PasswordChange(BaseModel):
    current: str
    next: str = Field(min_length=10, max_length=200)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=200)


class ResetCheckOut(CamelModel):
    valid: bool
    name: str = ""
    email: str = ""


class ResetLinkOut(CamelModel):
    status: Literal["sent", "mock", "failed"]
    detail: str = ""
    email: str
    # Only returned when the email wasn't actually delivered, so the admin can pass the link on in person.
    link: str | None = None
    expires_minutes: int


# ---------- Demo requests (public website) ----------
class DemoRequestIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    pharmacy: str = Field(min_length=2, max_length=160)
    phone: str = Field(min_length=7, max_length=40, pattern=r"^[0-9+()\-\s]{7,40}$")
    email: EmailStr | None = None
    branches: str = Field(default="", max_length=40)
    message: str = Field(default="", max_length=1000)
    website: str = Field(default="", max_length=200)  # honeypot: real people never see or fill this

    @field_validator("email", mode="before")
    @classmethod
    def blank_email(cls, v):
        return v or None


class DemoRequestOut(CamelModel):
    ok: bool = True


# ---------- Analytics ----------
class MonthOut(BaseModel):
    label: str
    year: int
    revenue: float
    cost: float


# ---------- Pharmacy settings ----------
class PharmacyUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    licence_no: str | None = Field(default=None, max_length=60)
    critical_days: int | None = Field(default=None, ge=1, le=365)
    soon_days: int | None = Field(default=None, ge=2, le=730)


# ---------- Alerts & notifications ----------
class NotifySettingsIO(CamelModel):
    sms_enabled: bool = True
    sms_numbers: str = Field(default="", max_length=400)
    email_enabled: bool = False
    email: str = Field(default="", max_length=254)
    digest_time: str = Field(default="07:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    on_expired: bool = True
    on_critical: bool = True
    on_soon: bool = False
    on_low_stock: bool = True

    @field_validator("email")
    @classmethod
    def email_ok(cls, v: str):
        if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("That email address doesn't look right")
        return v

    @field_validator("sms_numbers")
    @classmethod
    def numbers_ok(cls, v: str):
        for n in [x.strip() for x in re.split(r"[,;\n]+", v) if x.strip()]:
            if not re.fullmatch(r"\+?\d[\d\s]{7,}", n):
                raise ValueError(f'"{n}" isn\'t a valid phone number')
        return v


class AlertOut(CamelModel):
    key: str
    type: str
    status: str
    title: str
    text: str
    item_id: str | None = None
    days: int
    read: bool


class DeliveryOut(CamelModel):
    id: str
    channel: str
    recipient: str
    subject: str
    message: str
    status: str
    error: str
    kind: str
    created_at: str


class SendResult(CamelModel):
    channel: str
    status: str
    detail: str


# ---------- AI ----------
class ChatTurn(BaseModel):
    role: Literal["user", "ai"]
    text: str = Field(max_length=4000)


class AskIn(CamelModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    # When set, the question is about this uploaded file instead of the saved inventory.
    dataset_name: str | None = Field(default=None, max_length=200)
    rows: list[ItemCreate] | None = Field(default=None, max_length=5000)


class AskOut(BaseModel):
    kind: Literal["report", "losses", "margins", "dashboard", "reorder", "text"]
    text: str
    facts: dict


# ---------- Import ----------
class ImportRowError(CamelModel):
    row: int
    error: str


class ParseResult(CamelModel):
    total: int
    rows: list[ItemCreate]
    errors: list[ImportRowError]


class ImportResult(CamelModel):
    dry_run: bool
    total: int
    added: int
    updated: int
    errors: list[ImportRowError]
    preview: list[ItemCreate]
