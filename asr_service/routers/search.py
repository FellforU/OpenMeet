"""Full-text search across transcription segments."""

from fastapi import APIRouter, HTTPException, Query

from asr_service.models.job import JobStatus

router = APIRouter(tags=["search"])

_manager = None


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


@router.get("/search")
async def search_transcripts(q: str = Query(..., min_length=1)):
    """Search across all completed/ready job transcripts."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    manager = get_manager()
    query_lower = q.lower()
    results = []

    for job_id, job in manager.jobs.items():
        if job.status not in (JobStatus.COMPLETED, JobStatus.READY):
            continue

        for i, seg in enumerate(job.segments):
            if query_lower in seg.text.lower():
                results.append({
                    "job_id": job_id,
                    "segment_index": i,
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text,
                    "speaker": seg.speaker,
                })

    return {"query": q, "results": results, "total": len(results)}
