"""Ollama HTTP client for LLM inference.

Connects to local Ollama instance at http://localhost:11434.
Supports streaming generation for real-time summary output.
"""

import json
from typing import AsyncIterator, Optional

import httpx


DEFAULT_HOST = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5:7b"
DEFAULT_TIMEOUT = 120.0


class OllamaClient:
    """HTTP client for Ollama API."""

    def __init__(self, host: str = DEFAULT_HOST):
        self.host = host.rstrip("/")
        self._client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)

    async def close(self):
        await self._client.aclose()

    async def is_available(self) -> bool:
        """Check if Ollama is running and accessible."""
        try:
            resp = await self._client.get(f"{self.host}/api/tags")
            return resp.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        """List installed Ollama models."""
        try:
            resp = await self._client.get(f"{self.host}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                return data.get("models", [])
        except Exception:
            pass
        return []

    async def generate(
        self,
        prompt: str,
        model: str = DEFAULT_MODEL,
        system: Optional[str] = None,
    ) -> str:
        """Generate text (non-streaming). Returns complete response."""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system

        resp = await self._client.post(
            f"{self.host}/api/generate",
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")

    async def generate_stream(
        self,
        prompt: str,
        model: str = DEFAULT_MODEL,
        system: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Stream generated text token by token."""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True,
        }
        if system:
            payload["system"] = system

        async with self._client.stream(
            "POST",
            f"{self.host}/api/generate",
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    token = data.get("response", "")
                    if token:
                        yield token
                    if data.get("done", False):
                        return
                except json.JSONDecodeError:
                    continue
