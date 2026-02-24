from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
import json
import tempfile
import shutil
from pathlib import Path

from asr_service.models.job import TranscriptionJob, JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])

# JobManager will be injected via app state
_manager = None


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


class CreateJobRequest(BaseModel):
    mode: str = "file"
    engine: str = "whisper"
    model_size: str = "base"
    language: Optional[str] = None


class JobResponse(BaseModel):
    id: str
    mode: str
    status: str
    engine: str
    model_size: str
    language: Optional[str]
    progress: float
    segment_count: int
    error: Optional[str]


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str
    speaker: Optional[str]
    confidence: Optional[float]


class JobResultResponse(BaseModel):
    id: str
    status: str
    segments: list[SegmentResponse]


def _job_to_response(job: TranscriptionJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        mode=job.mode.value if hasattr(job.mode, "value") else job.mode,
        status=job.status.value if hasattr(job.status, "value") else job.status,
        engine=job.engine,
        model_size=job.model_size,
        language=job.language,
        progress=job.progress,
        segment_count=len(job.segments),
        error=job.error,
    )


@router.post("", response_model=JobResponse)
async def create_job(req: CreateJobRequest):
    manager = get_manager()
    job = manager.create_job(
        engine=req.engine,
        model_size=req.model_size,
        language=req.language,
    )
    return _job_to_response(job)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.post("/{job_id}/start", response_model=JobResponse)
async def start_job(job_id: str, audio_path: Optional[str] = None):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.audio_path and not audio_path:
        raise HTTPException(status_code=400, detail="No audio file provided")
    try:
        path = audio_path or job.audio_path
        await manager.start_file_transcription(job_id, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(job)


@router.post("/{job_id}/upload", response_model=JobResponse)
async def upload_audio(job_id: str, file: UploadFile = File(...)):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Save uploaded file
    upload_dir = Path(tempfile.mkdtemp(prefix="openmeet_upload_"))
    file_path = upload_dir / file.filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    job.audio_path = str(file_path)
    return _job_to_response(job)


@router.get("/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.COMPLETED, JobStatus.READY):
        raise HTTPException(status_code=400, detail="Transcription not complete")
    return JobResultResponse(
        id=job.id,
        status=job.status.value,
        segments=[
            SegmentResponse(
                start=s.start, end=s.end, text=s.text,
                speaker=s.speaker, confidence=s.confidence,
            )
            for s in job.segments
        ],
    )


@router.put("/{job_id}/pause", response_model=JobResponse)
async def pause_job(job_id: str):
    manager = get_manager()
    try:
        await manager.pause_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(manager.get_job(job_id))


@router.put("/{job_id}/resume", response_model=JobResponse)
async def resume_job(job_id: str):
    manager = get_manager()
    try:
        await manager.resume_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(manager.get_job(job_id))


@router.put("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    manager = get_manager()
    await manager.cancel_job(job_id)
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


SUPPORTED_EXPORT_FORMATS = {"markdown", "json", "txt"}


@router.get("/{job_id}/export")
async def export_job(job_id: str, format: str = "markdown"):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.COMPLETED, JobStatus.READY):
        raise HTTPException(status_code=400, detail="Job not ready for export")
    if format not in SUPPORTED_EXPORT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format. Use: {', '.join(SUPPORTED_EXPORT_FORMATS)}",
        )

    if format == "json":
        data = {
            "segments": [
                {
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "speaker": s.speaker,
                }
                for s in job.segments
            ],
            "summary": job.summary,
        }
        return JSONResponse(content=data)

    if format == "txt":
        lines = []
        for s in job.segments:
            minutes = int(s.start // 60)
            seconds = int(s.start % 60)
            prefix = f"[{s.speaker}] " if s.speaker else ""
            lines.append(f"[{minutes:02d}:{seconds:02d}] {prefix}{s.text}")
        return PlainTextResponse("\n".join(lines), media_type="text/plain; charset=utf-8")

    # Default: markdown
    return PlainTextResponse(
        _job_to_markdown(job),
        media_type="text/markdown; charset=utf-8",
    )


def _job_to_markdown(job: TranscriptionJob) -> str:
    """Convert job results to Markdown format."""
    lines = []

    # Summary section
    if job.summary:
        topic = job.summary.get("topic", "Meeting Notes")
        lines.append(f"# {topic}")
        lines.append("")

        conclusions = job.summary.get("conclusions", [])
        if conclusions:
            lines.append("## Conclusions")
            lines.append("")
            for c in conclusions:
                lines.append(f"- {c}")
            lines.append("")

        action_items = job.summary.get("action_items", [])
        if action_items:
            lines.append("## Action Items")
            lines.append("")
            for item in action_items:
                action = item.get("action", "")
                owner = item.get("owner", "")
                deadline = item.get("deadline", "")
                line = f"- [ ] {action}"
                if owner:
                    line += f" (@{owner})"
                if deadline:
                    line += f" [Due: {deadline}]"
                lines.append(line)
            lines.append("")

        discussion = job.summary.get("discussion", "")
        if discussion:
            lines.append("## Discussion")
            lines.append("")
            lines.append(discussion)
            lines.append("")

    # Transcript section
    lines.append("## Transcript")
    lines.append("")
    for s in job.segments:
        minutes = int(s.start // 60)
        seconds = int(s.start % 60)
        speaker = f"**{s.speaker}**: " if s.speaker else ""
        lines.append(f"`[{minutes:02d}:{seconds:02d}]` {speaker}{s.text}")
        lines.append("")

    return "\n".join(lines)
