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


# ---------- Analytics ----------
class MonthOut(BaseModel):
    label: str
    year: int
    revenue: float
    cost: float
