"""SQLite database for user management."""

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from auth_server.config import DB_PATH


def init_db() -> None:
    """Create tables if they don't exist."""
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id          TEXT PRIMARY KEY,
                username    TEXT NOT NULL,
                email       TEXT DEFAULT '',
                avatar_url  TEXT DEFAULT '',
                provider    TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                last_login  TEXT NOT NULL,
                UNIQUE(provider, provider_id)
            );
        """)


@contextmanager
def get_conn():
    """Context manager for database connections."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def find_user_by_provider(provider: str, provider_id: str) -> Optional[dict]:
    """Find a user by OAuth provider and provider-specific ID."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE provider = ? AND provider_id = ?",
            (provider, provider_id),
        ).fetchone()
        return dict(row) if row else None


def find_user_by_id(user_id: str) -> Optional[dict]:
    """Find a user by internal ID."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None


def upsert_user(
    user_id: str,
    username: str,
    email: str,
    avatar_url: str,
    provider: str,
    provider_id: str,
    now: str,
) -> dict:
    """Create or update a user. Returns the user dict."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (id, username, email, avatar_url, provider, provider_id, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, provider_id) DO UPDATE SET
                username = excluded.username,
                email = excluded.email,
                avatar_url = excluded.avatar_url,
                last_login = excluded.last_login
            """,
            (user_id, username, email, avatar_url, provider, provider_id, now, now),
        )
    return find_user_by_provider(provider, provider_id)
