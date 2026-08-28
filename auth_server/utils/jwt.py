"""JWT token creation and verification."""

from datetime import datetime, timedelta, timezone

import jwt

from auth_server.config import JWT_ALGORITHM, JWT_EXPIRE_DAYS, JWT_SECRET


def create_token(user_id: str) -> str:
    """Create a JWT token for the given user ID."""
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> str | None:
    """Verify a JWT token. Returns user_id or None if invalid."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
