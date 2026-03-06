"""WebSocket endpoint for real-time streaming transcription."""

import asyncio
import struct
import tempfile
import wave
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["stream"])

_manager = None


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


class StreamBuffer:
    """Accumulates PCM chunks and produces WAV segments for transcription."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1):
        self.sample_rate = sample_rate
        self.channels = channels
        self._buffer: bytearray = bytearray()
        # Segment every ~5 seconds of audio
        self._segment_bytes = sample_rate * channels * 2 * 5  # 16-bit PCM

    def add_chunk(self, data: bytes) -> None:
        self._buffer.extend(data)

    def has_segment(self) -> bool:
        return len(self._buffer) >= self._segment_bytes

    def pop_segment(self) -> bytes:
        """Pop a segment worth of PCM data."""
        segment = bytes(self._buffer[: self._segment_bytes])
        self._buffer = self._buffer[self._segment_bytes :]
        return segment

    def flush(self) -> Optional[bytes]:
        """Get remaining data if any."""
        if len(self._buffer) > 0:
            data = bytes(self._buffer)
            self._buffer.clear()
            return data
        return None


def pcm_to_wav(pcm_data: bytes, sample_rate: int, channels: int) -> str:
    """Write PCM data to a temporary WAV file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False, prefix="openmeet_stream_")
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return tmp.name


@router.websocket("/ws/stream")
async def stream_transcription(websocket: WebSocket):
    """WebSocket endpoint for real-time audio streaming and transcription.

    Query params:
      - job_id: ID of the pre-created transcription job
      - sample_rate: Audio sample rate (default 16000)
      - channels: Number of audio channels (default 1)

    Client sends: binary PCM frames (16-bit little-endian)
    Server sends: JSON messages with transcription segments
    """
    await websocket.accept()

    # Parse query params
    job_id = websocket.query_params.get("job_id")
    sample_rate = int(websocket.query_params.get("sample_rate", "16000"))
    channels = int(websocket.query_params.get("channels", "1"))

    if not job_id:
        await websocket.send_json({"error": "job_id is required"})
        await websocket.close()
        return

    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        await websocket.send_json({"error": "Job not found"})
        await websocket.close()
        return

    from asr_service.models.job import JobStatus
    job.status = JobStatus.RUNNING
    job.mode = "stream"

    stream_buf = StreamBuffer(sample_rate=sample_rate, channels=channels)
    segment_index = 0
    total_duration = 0.0

    try:
        while True:
            data = await websocket.receive_bytes()
            stream_buf.add_chunk(data)

            # Process complete segments
            while stream_buf.has_segment():
                pcm_data = stream_buf.pop_segment()
                wav_path = pcm_to_wav(pcm_data, sample_rate, channels)

                try:
                    engine = manager._engines.get(job.engine)
                    if not engine:
                        await websocket.send_json({"error": f"Engine '{job.engine}' not available"})
                        continue

                    if not engine.is_loaded():
                        await engine.load_model(job.model_size)

                    from asr_service.engines.base import AudioInput
                    audio_input = AudioInput(
                        file_path=wav_path,
                        language=job.language,
                        model_size=job.model_size,
                    )
                    segments = await engine.transcribe(audio_input)

                    for seg in segments:
                        adjusted_start = round(total_duration + seg.start, 3)
                        adjusted_end = round(total_duration + seg.end, 3)
                        result = {
                            "type": "segment",
                            "index": segment_index,
                            "start": adjusted_start,
                            "end": adjusted_end,
                            "text": seg.text,
                            "speaker": seg.speaker,
                            "confidence": seg.confidence,
                        }
                        await websocket.send_json(result)

                        from asr_service.models.job import Segment as JobSegment
                        job.segments.append(
                            JobSegment(
                                start=adjusted_start,
                                end=adjusted_end,
                                text=seg.text,
                                speaker=seg.speaker,
                                confidence=seg.confidence,
                            )
                        )
                        segment_index += 1

                    # Update total duration based on PCM length
                    pcm_duration = len(pcm_data) / (sample_rate * channels * 2)
                    total_duration += pcm_duration

                finally:
                    # Clean up temp WAV
                    Path(wav_path).unlink(missing_ok=True)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
    finally:
        # Process any remaining audio
        remaining = stream_buf.flush()
        if remaining and len(remaining) > 100:  # Skip very short remnants
            wav_path = pcm_to_wav(remaining, sample_rate, channels)
            try:
                engine = manager._engines.get(job.engine)
                if engine and engine.is_loaded():
                    from asr_service.engines.base import AudioInput
                    audio_input = AudioInput(
                        file_path=wav_path,
                        language=job.language,
                        model_size=job.model_size,
                    )
                    segments = await engine.transcribe(audio_input)
                    for seg in segments:
                        from asr_service.models.job import Segment as JobSegment
                        job.segments.append(
                            JobSegment(
                                start=round(total_duration + seg.start, 3),
                                end=round(total_duration + seg.end, 3),
                                text=seg.text,
                            )
                        )
            finally:
                Path(wav_path).unlink(missing_ok=True)

        job.status = JobStatus.COMPLETED
        job.progress = 100.0

        # Unload model to release GPU memory after streaming ends
        engine = manager._engines.get(job.engine)
        if engine and engine.is_loaded():
            try:
                await engine.unload_model()
            except Exception:
                pass
