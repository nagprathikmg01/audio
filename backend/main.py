"""
main.py — FastAPI application entry point.

Routes:
  GET  /health           → Health check
  POST /analyze          → Full analysis of uploaded audio (multipart)
  WS   /ws               → Real-time streaming: audio chunks → transcript + live score
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lifespan: warm up models on startup
# ---------------------------------------------------------------------------

model_loaded = False

def ensure_models_loaded():
    global model_loaded
    if not model_loaded:
        print("Loading models lazily...")
        try:
            from embeddings import _get_model as get_emb, _get_answer_embeddings as get_ans
            get_emb()
            get_ans()
        except ImportError:
            pass  # Fallback if names differ slightly
            
        try:
            from stt import _get_model as get_whisper
            get_whisper()
        except ImportError:
            pass
            
        model_loaded = True

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 FastAPI app started successfully")
    yield


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AI Interview Integrity Analyzer",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AnalysisResponse(BaseModel):
    transcript: str
    semantic_similarity: float
    memorization_score: float
    memorization_explanation: str
    behavior_score: float
    final_score: float
    verdict: str
    matched_question: str
    matched_phrases: list[str]
    speech_metrics: dict
    all_scores: list[dict]


class LiveUpdate(BaseModel):
    type: str          # "transcript" | "score" | "error"
    transcript: str = ""
    semantic_similarity: float = 0.0
    verdict: str = "ANALYZING"
    chunk_index: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_verdict(final_score: float) -> str:
    if final_score >= 0.70:
        return "SCRIPTED"
    if final_score >= 0.40:
        return "SUSPICIOUS"
    return "GENUINE"


async def _full_analysis(audio_bytes: bytes, duration: float | None = None) -> dict:
    """Run the complete pipeline: STT → similarity → LLM → behavior → verdict."""
    import asyncio
    from stt import transcribe_bytes
    from embeddings import compute_similarity
    from behavior import analyze_behavior
    from llm import evaluate_response

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, ensure_models_loaded)

    # 1. Transcribe
    stt_result = await loop.run_in_executor(None, transcribe_bytes, audio_bytes)
    transcript = stt_result["transcript"]
    audio_duration = duration or stt_result.get("duration", 30.0)

    if not transcript.strip():
        raise ValueError("Could not transcribe audio. Please check audio quality.")

    # 2. Semantic similarity (CPU-bound → thread)
    sim_result = await loop.run_in_executor(None, compute_similarity, transcript)

    # 3. LLM evaluation (async)
    llm_result = await evaluate_response(transcript, sim_result["matched_question"])

    # 4. Behavioral analysis
    behavior_result = await loop.run_in_executor(
        None, analyze_behavior, transcript, audio_duration
    )

    # 5. Final score
    semantic_sim = sim_result["semantic_similarity"]
    memorization = llm_result["memorization_score"]
    behavior = behavior_result["behavior_score"]

    final_score = round(
        0.50 * semantic_sim + 0.30 * memorization + 0.20 * behavior, 4
    )
    verdict = _compute_verdict(final_score)

    return {
        "transcript": transcript,
        "semantic_similarity": semantic_sim,
        "memorization_score": memorization,
        "memorization_explanation": llm_result["explanation"],
        "behavior_score": behavior,
        "final_score": final_score,
        "verdict": verdict,
        "matched_question": sim_result["matched_question"],
        "matched_phrases": sim_result["matched_phrases"],
        "speech_metrics": behavior_result,
        "all_scores": sim_result["all_scores"],
    }


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "running"}

@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI Interview Integrity Analyzer"}


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_audio(
    file: UploadFile = File(...),
    duration: float = Form(default=0.0),
):
    """
    Accept an uploaded audio file (mp3/wav/webm) and return a full analysis.
    """
    if file.content_type and not any(
        ct in file.content_type for ct in ["audio", "video", "octet-stream"]
    ):
        raise HTTPException(status_code=400, detail="File must be an audio file.")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        result = await _full_analysis(audio_bytes, duration or None)
        return AnalysisResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")


# ---------------------------------------------------------------------------
# WebSocket — Real-time streaming
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket for real-time audio streaming.

    Protocol (client → server):
      - Binary frames: raw audio chunk bytes
      - Text frame "DONE": signals end of recording

    Protocol (server → client):
      - JSON LiveUpdate messages after each chunk
    """
    await websocket.accept()
    logger.info("WebSocket connection opened.")

    audio_buffer = bytearray()
    chunk_index = 0
    last_transcript = ""

    try:
        while True:
            message = await websocket.receive()

            # Binary audio chunk
            if "bytes" in message and message["bytes"]:
                chunk_bytes = message["bytes"]
                audio_buffer.extend(chunk_bytes)
                chunk_index += 1

                # Transcribe accumulated audio every chunk
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, ensure_models_loaded)
                
                from stt import transcribe_bytes
                from embeddings import compute_similarity

                try:
                    stt_result = await loop.run_in_executor(
                        None, transcribe_bytes, bytes(audio_buffer)
                    )
                    transcript = stt_result["transcript"]
                    if transcript and transcript != last_transcript:
                        last_transcript = transcript

                        # Quick similarity score
                        sim_result = await loop.run_in_executor(
                            None, compute_similarity, transcript
                        )
                        similarity = sim_result["semantic_similarity"]

                        if similarity >= 0.70:
                            live_verdict = "SCRIPTED"
                        elif similarity >= 0.40:
                            live_verdict = "SUSPICIOUS"
                        else:
                            live_verdict = "GENUINE"

                        await websocket.send_json({
                            "type": "transcript",
                            "transcript": transcript,
                            "semantic_similarity": similarity,
                            "verdict": live_verdict,
                            "chunk_index": chunk_index,
                        })
                    else:
                        # Still send heartbeat
                        await websocket.send_json({
                            "type": "heartbeat",
                            "chunk_index": chunk_index,
                        })
                except Exception as e:
                    logger.warning("Chunk transcription error: %s", e)
                    await websocket.send_json({
                        "type": "error",
                        "message": str(e),
                        "chunk_index": chunk_index,
                    })

            # Text control message
            elif "text" in message:
                text = message["text"]
                if text == "DONE":
                    logger.info("Client sent DONE signal — running full analysis.")
                    if audio_buffer:
                        try:
                            result = await _full_analysis(bytes(audio_buffer))
                            await websocket.send_json({"type": "final", **result})
                        except Exception as e:
                            await websocket.send_json({"type": "error", "message": str(e)})
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected.")
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        logger.info("WebSocket connection closed. Chunks received: %d", chunk_index)
