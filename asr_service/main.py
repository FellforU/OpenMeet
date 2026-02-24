from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asr_service.routers import health, jobs

app = FastAPI(title="OpenMeet ASR Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(jobs.router)


if __name__ == "__main__":
    import uvicorn
    from asr_service.config import HOST, PORT

    uvicorn.run("asr_service.main:app", host=HOST, port=PORT, reload=True)
