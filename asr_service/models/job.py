from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import uuid
import time


class JobMode(str, Enum):
    FILE = "file"
    STREAM = "stream"


class JobStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    POST_PROCESSING = "post_processing"
    READY = "ready"


@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker: Optional[str] = None
    confidence: Optional[float] = None


@dataclass
class TranscriptionJob:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    mode: JobMode = JobMode.FILE
    status: JobStatus = JobStatus.IDLE
    engine: str = "whisper"
    model_size: str = "base"
    language: Optional[str] = None
    audio_path: Optional[str] = None
    segments: list[Segment] = field(default_factory=list)
    progress: float = 0.0
    created_at: float = field(default_factory=time.time)
    error: Optional[str] = None
    summary: Optional[dict] = None
