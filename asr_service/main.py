from contextlib import asynccontextmanager
import logging

# Configure logging to show INFO level messages
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asr_service.routers import health, jobs, engines, stream, search
from asr_service.routers import config as config_router
from asr_service.routers import index as index_router
from asr_service.routers import mcp as mcp_router
from asr_service.routers import chat as chat_router
from asr_service.routers import custom as custom_router
from asr_service.job_manager import JobManager
from asr_service.knowledge.embedder import Embedder
from asr_service.knowledge.vector_store import VectorStore
from asr_service.knowledge.sqlite_reader import SQLiteReader
from asr_service.knowledge.indexer import Indexer
from asr_service.knowledge.mcp_tools import MCPTools
from asr_service.knowledge.rag import RAGPipeline
from asr_service.knowledge.reranker import Reranker
from asr_service.services.ollama_client import OllamaClient
from asr_service.services.llm_client import LLMClient
from asr_service.config import get_lance_path, get_sqlite_path

_embedder = Embedder()
_reranker = Reranker()
_ollama = OllamaClient()
_llm_client = LLMClient()
_knowledge_initialized = False
_last_embedding_dimension: int | None = None


async def init_knowledge():
    global _knowledge_initialized, _last_embedding_dimension
    lance_path = get_lance_path()
    sqlite_path = get_sqlite_path()
    if not lance_path or not sqlite_path:
        return

    # Detect actual embedding dimension
    dimension = await _embedder.get_dimension()

    # Skip re-init if already initialized with the same dimension
    if _knowledge_initialized and dimension == _last_embedding_dimension:
        return

    _last_embedding_dimension = dimension
    store = VectorStore(lance_path, dimension=dimension)
    reader = SQLiteReader(sqlite_path)
    indexer = Indexer(_embedder, store, reader)
    mcp_tools = MCPTools(_embedder, store, reader, _reranker)
    rag = RAGPipeline(mcp_tools, _ollama)

    index_router.set_indexer(indexer)
    mcp_router.set_mcp_tools(mcp_tools)
    chat_router.set_rag_pipeline(rag)
    _knowledge_initialized = True


config_router.set_knowledge_initializer(init_knowledge)
config_router.set_embedder(_embedder)
config_router.set_reranker(_reranker)
config_router.set_llm_client(_llm_client)

# Inject LLM client into post-processing pipeline
from asr_service.services.post_processing import set_llm_client as _set_pp_llm
_set_pp_llm(_llm_client)


def _log_gpu_info():
    """Log GPU/CUDA diagnostic information at startup."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        import torch
        logger.info("PyTorch %s, CUDA compiled: %s", torch.__version__, torch.version.cuda)
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                vram = getattr(props, "total_memory", None) or getattr(props, "total_mem", 0)
                logger.info(
                    "GPU %d: %s (%.1f GB VRAM)",
                    i, torch.cuda.get_device_name(i), vram / 1024**3,
                )
        else:
            logger.warning(
                "CUDA not available — all models will run on CPU. "
                "Check NVIDIA driver and PyTorch CUDA version compatibility."
            )
    except ImportError:
        logger.warning("PyTorch not installed — GPU acceleration unavailable")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _log_gpu_info()
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)
    search.set_manager(manager)
    custom_router.set_engine(manager._engines["custom"])
    yield
    # Shutdown: cleanup
    await _ollama.close()


app = FastAPI(title="OpenMeet ASR Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(health.router)
app.include_router(jobs.router)
app.include_router(engines.router)
app.include_router(stream.router)
app.include_router(search.router)
app.include_router(config_router.router)
app.include_router(index_router.router)
app.include_router(mcp_router.router)
app.include_router(chat_router.router)
app.include_router(custom_router.router)


if __name__ == "__main__":
    import uvicorn
    from asr_service.config import HOST, PORT

    uvicorn.run("asr_service.main:app", host=HOST, port=PORT, reload=True)
