import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import websocket as ws_module

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Warming up models...")
    loop = asyncio.get_event_loop()
    await asyncio.gather(
        loop.run_in_executor(None, _warm_stt),
        loop.run_in_executor(None, _warm_embeddings)
    )
    logger.info("Models ready.")
    yield

def _warm_stt():
    from stt import _get_model
    _get_model()

def _warm_embeddings():
    from embeddings import init_faiss
    # Built ONCE at server startup
    init_faiss()

app = FastAPI(title="AI Interview Integrity Analyzer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_module.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
