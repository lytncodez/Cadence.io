"""Field-level encryption for personal data at rest.

Phone numbers, licence/registration numbers, alert recipients and demo-request contact details are
encrypted with Fernet (AES-128-CBC + HMAC-SHA256) before they reach the database, so a leaked backup or a
read-only database credential doesn't expose them. Emails used to sign in stay readable, because login
has to look them up.

Keys: DATA_ENCRYPTION_KEY holds one or more comma-separated Fernet keys. The first encrypts; all of them
can decrypt, so you can rotate by putting a new key first and running `python -m app.encrypt_existing`.
Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Values written before encryption was switched on are read as-is and encrypted the next time they're saved
(or all at once with `python -m app.encrypt_existing`)."""
import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from .config import get_settings

log = logging.getLogger("cadence.crypto")
PREFIX = "enc:v1:"


def _build() -> MultiFernet | None:
    keys = [k.strip() for k in get_settings().data_encryption_key.split(",") if k.strip()]
    if not keys:
        log.warning("DATA_ENCRYPTION_KEY is not set: personal data is stored unencrypted. Set it before going live.")
        return None
    return MultiFernet([Fernet(k.encode()) for k in keys])


_fernet = _build()


def enabled() -> bool:
    return _fernet is not None


def encrypt(value: str) -> str:
    if not value or _fernet is None or value.startswith(PREFIX):
        return value
    return PREFIX + _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value or not value.startswith(PREFIX):
        return value  # empty, or written before encryption was switched on
    if _fernet is None:
        raise RuntimeError("Found encrypted data but DATA_ENCRYPTION_KEY isn't set. Use the same key the data was written with.")
    try:
        return _fernet.decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("Couldn't decrypt stored data: DATA_ENCRYPTION_KEY doesn't match the key it was written with.") from e


def rotate(value: str) -> str:
    """Re-encrypt with the first (newest) key."""
    if _fernet is None or not value:
        return value
    if value.startswith(PREFIX):
        return PREFIX + _fernet.rotate(value[len(PREFIX):].encode()).decode()
    return encrypt(value)


class EncryptedText(TypeDecorator):
    """A text column that is encrypted in the database and plain text in Python."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else encrypt(str(value))

    def process_result_value(self, value, dialect):
        return None if value is None else decrypt(value)
