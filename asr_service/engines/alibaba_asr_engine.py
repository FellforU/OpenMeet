"""Alibaba Cloud ASR engine adapter.

Uses Alibaba Cloud's Paraformer API for cloud-based Chinese ASR.
Requires ALIBABA_ACCESS_KEY_ID and ALIBABA_ACCESS_KEY_SECRET environment variables.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional, Callable

import httpx

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

# Alibaba Cloud ASR API endpoint
DASHSCOPE_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"


class AlibabaASREngine:
    """ASR engine using Alibaba Cloud DashScope ASR API."""

    def __init__(self):
        self._access_key_id: Optional[str] = None
        self._access_key_secret: Optional[str] = None

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="alibaba-asr",
            supported_languages=["zh", "en", "ja", "ko", "yue", "auto"],
            supports_streaming=False,
            supports_timestamps=True,
            supports_diarization=True,
            model_sizes=["paraformer-v2"],
        )

    def configure(self, credentials: dict[str, str]) -> None:
        """Set runtime credentials (bypasses env vars)."""
        if "access_key_id" in credentials:
            self._access_key_id = credentials["access_key_id"]
        if "access_key_secret" in credentials:
            self._access_key_secret = credentials["access_key_secret"]

    async def load_model(self, model_size: str = "paraformer-v2") -> None:
        key_id = self._access_key_id or os.environ.get("ALIBABA_ACCESS_KEY_ID")
        key_secret = self._access_key_secret or os.environ.get("ALIBABA_ACCESS_KEY_SECRET")
        if not key_id or not key_secret:
            raise ValueError(
                "ALIBABA_ACCESS_KEY_ID and ALIBABA_ACCESS_KEY_SECRET not set. "
                "Configure them in Settings > ASR Models."
            )
        self._access_key_id = key_id
        self._access_key_secret = key_secret

    async def unload_model(self) -> None:
        self._access_key_id = None
        self._access_key_secret = None

    def is_loaded(self) -> bool:
        return self._access_key_id is not None and self._access_key_secret is not None

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._access_key_id or not self._access_key_secret:
            raise RuntimeError(
                "API credentials not configured. Call load_model() first."
            )

        response = await self._call_api(audio)

        segments = []
        sentences = response.get("output", {}).get("sentence", [])
        for sent in sentences:
            start_ms = sent.get("begin_time", 0)
            end_ms = sent.get("end_time", 0)
            text = sent.get("text", "")
            speaker = sent.get("speaker_id")

            segments.append(
                Segment(
                    start=round(start_ms / 1000.0, 3),
                    end=round(end_ms / 1000.0, 3),
                    text=text,
                    speaker=f"Speaker_{speaker}" if speaker is not None else None,
                )
            )
        return segments

    async def _call_api(self, audio: AudioInput) -> dict:
        """Call Alibaba Cloud DashScope ASR API."""
        with open(audio.file_path, "rb") as f:
            audio_data = f.read()

        audio_base64 = base64.b64encode(audio_data).decode()
        language = audio.language or "zh"

        payload = {
            "model": "paraformer-v2",
            "input": {
                "audio": audio_base64,
                "format": "wav",
                "sample_rate": 16000,
            },
            "parameters": {
                "language": language,
            },
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._access_key_secret}",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                DASHSCOPE_API_URL,
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
