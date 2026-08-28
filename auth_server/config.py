"""Auth server configuration from environment variables."""

import os
from pathlib import Path

# Server
HOST = os.environ.get("AUTH_HOST", "127.0.0.1")
PORT = int(os.environ.get("AUTH_PORT", "18091"))
BASE_URL = os.environ.get("AUTH_BASE_URL", f"http://{HOST}:{PORT}")

# JWT
JWT_SECRET = os.environ.get("JWT_SECRET", "openmeet-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

# GitHub OAuth
GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = f"{BASE_URL}/auth/github/callback"

# WeChat OAuth (Phase 2)
WECHAT_APP_ID = os.environ.get("WECHAT_APP_ID", "")
WECHAT_APP_SECRET = os.environ.get("WECHAT_APP_SECRET", "")
WECHAT_REDIRECT_URI = f"{BASE_URL}/auth/wechat/callback"

# Desktop app deep link
APP_SCHEME = "openmeet"

# Database
DB_PATH = Path(os.environ.get("AUTH_DB_PATH", str(Path(__file__).parent / "auth.db")))

# CORS
CORS_ORIGINS = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "https://tauri.localhost",
]
