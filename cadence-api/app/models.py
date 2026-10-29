"""Database schema.

pharmacies ─┬─ roles
            ├─ users ── (role by name within the pharmacy)
            └─ products ── batches ── sales

A product is identified by its barcode within a pharmacy. Each delivery is a batch with
its own batch number, expiry date and quantity. Sales record which batch they came from,
so revenue, cost and "sold this month" are always derived, never stored twice.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


class Pharmacy(Base):
    __tablename__ = "pharmacies"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160))
    location: Mapped[str] = mapped_column(String(160), default="")
    licence_no: Mapped[str] = mapped_column(String(60), default="")
    critical_days: Mapped[int] = mapped_column(Integer, default=30)
    soon_days: Mapped[int] = mapped_column(Integer, default=90)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("pharmacy_id", "name"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(String(200), default="")
    perms: Mapped[list[str]] = mapped_column(JSON, default=list)
    locked: Mapped[bool] = mapped_column(default=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="Active")  # Active | Invited | Suspended
    position: Mapped[str] = mapped_column(String(120), default="")
    staff_id: Mapped[str] = mapped_column(String(40), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    department: Mapped[str] = mapped_column(String(80), default="")
    reg_no: Mapped[str] = mapped_column(String(60), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    photo: Mapped[str] = mapped_column(Text, default="")  # data URL for now; move to object storage later
    joined: Mapped[date] = mapped_column(Date, default=date.today)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when a password is reset; sign-in tokens issued before this stop working.
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("pharmacy_id", "barcode"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80), default="")
    supplier: Mapped[str] = mapped_column(String(120), default="")
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    reorder_level: Mapped[int] = mapped_column(Integer, default=20)
    batches: Mapped[list["Batch"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("product_id", "batch_no"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    batch_no: Mapped[str] = mapped_column(String(60))
    expiry_date: Mapped[date] = mapped_column(Date, index=True)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    product: Mapped[Product] = relationship(back_populates="batches", lazy="joined")


class Sale(Base):
    __tablename__ = "sales"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), index=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True)
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class NotificationSettings(Base):
    """Where and when a pharmacy's alerts are delivered."""
    __tablename__ = "notification_settings"
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), primary_key=True)
    sms_enabled: Mapped[bool] = mapped_column(default=True)
    sms_numbers: Mapped[str] = mapped_column(String(400), default="")
    email_enabled: Mapped[bool] = mapped_column(default=False)
    email: Mapped[str] = mapped_column(String(254), default="")
    digest_time: Mapped[str] = mapped_column(String(5), default="07:30")  # HH:MM, Ghana time (UTC)
    on_expired: Mapped[bool] = mapped_column(default=True)
    on_critical: Mapped[bool] = mapped_column(default=True)
    on_soon: Mapped[bool] = mapped_column(default=False)
    on_low_stock: Mapped[bool] = mapped_column(default=True)
    last_digest_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class AlertRead(Base):
    """Which alerts a user has marked read. Alerts themselves are computed, not stored."""
    __tablename__ = "alert_reads"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class NotificationLog(Base):
    __tablename__ = "notification_log"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pharmacies.id", ondelete="CASCADE"), index=True)
    channel: Mapped[str] = mapped_column(String(10))  # sms | email
    recipient: Mapped[str] = mapped_column(String(254))
    subject: Mapped[str] = mapped_column(String(200), default="")
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10))  # sent | mock | failed
    error: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="digest")  # digest | test
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class PasswordReset(Base):
    """One-time reset link. Only a SHA-256 of the token is stored, so a database leak can't be used to reset passwords."""
    __tablename__ = "password_resets"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_by: Mapped[str] = mapped_column(String(20), default="self")  # self | admin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DemoRequest(Base):
    """A "Book a demo" request from the public website. Not tied to any pharmacy."""
    __tablename__ = "demo_requests"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    pharmacy: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(40))
    email: Mapped[str] = mapped_column(String(254), default="")
    branches: Mapped[str] = mapped_column(String(40), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="new")  # new | contacted | booked | closed
    notified: Mapped[str] = mapped_column(String(200), default="")  # e.g. "email:sent sms:mock"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
