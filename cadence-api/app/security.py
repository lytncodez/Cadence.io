from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def password_version(changed_at: datetime | None) -> int:
    """A number that changes whenever the password is reset. It goes into every sign-in token."""
    if changed_at is None:
        return 0
    if changed_at.tzinfo is None:  # SQLite returns naive datetimes; values are stored in UTC
        changed_at = changed_at.replace(tzinfo=timezone.utc)
    return int(changed_at.timestamp())


def create_token(user_id: str, pharmacy_id: str, pv: int = 0) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expires_minutes)
    return jwt.encode({"sub": user_id, "ph": pharmacy_id, "pv": pv, "exp": exp}, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
