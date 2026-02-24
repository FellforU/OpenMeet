from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobMode, JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])

# In-memory job store (will be replaced by proper persistence later)
_jobs: dict[str, TranscriptionJob] = {}


class CreateJobRequest(BaseModel):
    mode: JobMode = JobMode.FILE
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


def _job_to_response(job: TranscriptionJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        mode=job.mode.value,
        status=job.status.value,
        engine=job.engine,
        model_size=job.model_size,
        language=job.language,
        progress=job.progress,
        segment_count=len(job.segments),
        error=job.error,
    )


@router.post("", response_model=JobResponse)
async def create_job(req: CreateJobRequest):
    job = TranscriptionJob(
        mode=req.mode,
        engine=req.engine,
        model_size=req.model_size,
        language=req.language,
    )
    _jobs[job.id] = job
    return _job_to_response(job)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.put("/{job_id}/pause", response_model=JobResponse)
async def pause_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Job is not running")
    job.status = JobStatus.PAUSED
    return _job_to_response(job)


@router.put("/{job_id}/resume", response_model=JobResponse)
async def resume_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Job is not paused")
    job.status = JobStatus.RUNNING
    return _job_to_response(job)


@router.put("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.RUNNING, JobStatus.PAUSED):
        raise HTTPException(status_code=400, detail="Job cannot be cancelled")
    job.status = JobStatus.CANCELLED
    return _job_to_response(job)
