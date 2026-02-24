import asyncio
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobStatus, Segment
from asr_service.engines.base import AudioInput
from asr_service.engines.whisper_engine import WhisperEngine
from asr_service.processors.audio_preprocessor import preprocess_audio


class JobManager:
    """Manages transcription job lifecycle."""

    def __init__(self):
        self._jobs: dict[str, TranscriptionJob] = {}
        self._engines: dict[str, WhisperEngine] = {
            "whisper": WhisperEngine(),
        }
        self._running_tasks: dict[str, asyncio.Task] = {}

    @property
    def jobs(self) -> dict[str, TranscriptionJob]:
        return self._jobs

    def get_job(self, job_id: str) -> Optional[TranscriptionJob]:
        return self._jobs.get(job_id)

    def create_job(self, **kwargs) -> TranscriptionJob:
        job = TranscriptionJob(**kwargs)
        self._jobs[job.id] = job
        return job

    async def start_file_transcription(
        self, job_id: str, audio_path: str
    ) -> None:
        job = self._jobs.get(job_id)
        if not job:
            raise ValueError("Job not found")
        if job.status != JobStatus.IDLE:
            raise ValueError("Job already started")

        job.audio_path = audio_path
        job.status = JobStatus.RUNNING

        task = asyncio.create_task(self._run_transcription(job))
        self._running_tasks[job_id] = task

    async def _run_transcription(self, job: TranscriptionJob) -> None:
        try:
            engine = self._engines.get(job.engine)
            if not engine:
                raise ValueError(f"Engine '{job.engine}' not available")

            if not engine.is_loaded():
                job.progress = 5.0
                await engine.load_model(job.model_size)

            job.progress = 10.0

            # Preprocess audio
            wav_path = await preprocess_audio(job.audio_path)
            job.progress = 15.0

            # Transcribe
            audio_input = AudioInput(
                file_path=wav_path,
                language=job.language,
                model_size=job.model_size,
            )

            def _update_progress(pct: float):
                job.progress = 15.0 + pct * 0.85

            segments = await engine.transcribe(audio_input, on_progress=_update_progress)
            job.segments = segments
            job.progress = 100.0
            job.status = JobStatus.COMPLETED

        except asyncio.CancelledError:
            job.status = JobStatus.CANCELLED
        except Exception as e:
            job.status = JobStatus.CANCELLED
            job.error = str(e)

    async def cancel_job(self, job_id: str) -> None:
        task = self._running_tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        job = self._jobs.get(job_id)
        if job:
            job.status = JobStatus.CANCELLED

    async def pause_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if not job or job.status != JobStatus.RUNNING:
            raise ValueError("Job is not running")
        job.status = JobStatus.PAUSED

    async def resume_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if not job or job.status != JobStatus.PAUSED:
            raise ValueError("Job is not paused")
        job.status = JobStatus.RUNNING
