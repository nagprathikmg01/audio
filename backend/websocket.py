import logging
import asyncio
import re
import os
import uuid
import tempfile
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from plugins.stt_plugin import STTPlugin
from plugins.similarity_plugin import SimilarityPlugin
from plugins.local_ai_detection_plugin import LocalAIDetectionPlugin
from plugins.api_ai_detection_plugin import APIAIDetectionPlugin
from report import generate_report

logger = logging.getLogger(__name__)
router = APIRouter()

stt_plugin = STTPlugin()
similarity_plugin = SimilarityPlugin()
local_ai_plugin = LocalAIDetectionPlugin()
api_ai_plugin = APIAIDetectionPlugin()

def get_last_n_sentences(text: str, n=3) -> str:
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
    if not sentences:
        return text
    return ". ".join(sentences[-n:]) + "."

async def run_api_detection(state: dict, text: str):
    """Background async wrapper that updates ai evaluation dict."""
    try:
        result = await api_ai_plugin.process_async(text)
        state["api_score"] = result.get("ai_score", 0.0)
        state["reason"] = result.get("reason", "")
        state["label"] = result.get("label", "UNCERTAIN")
    except Exception as e:
        logger.error("API task failure: %s", e)

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection opened.")
    
    session_id = str(uuid.uuid4())
    temp_file = os.path.join(tempfile.gettempdir(), f"session_{session_id}.webm")
    
    audio_buffer = bytearray()
    current_transcript = ""
    chunk_index = 0
    max_similarity = 0.0
    smoothed_score = 0.0
    
    last_sim_result = {
        "score": 0.0,
        "label": "LOW",
        "reason": "Waiting for enough speech context...",
        "matched_question": "None",
        "rolling_max": 0.0,
        "top_matches": []
    }
    
    ai_state = {
        "api_score": 0.0,
        "label": "UNCERTAIN",
        "reason": "Awaiting initial API evaluation..."
    }
    
    last_ai_payload = {
        "local_score": 0.0,
        "api_score": 0.0,
        "final_score": 0.0,
        "label": "UNCERTAIN",
        "reason": "Gathering baseline context..."
    }

    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message and message["bytes"]:
                chunk_bytes = message["bytes"]
                audio_buffer.extend(chunk_bytes)
                chunk_index += 1

                try:
                    # Write full buffer to temp file
                    with open(temp_file, "wb") as f:
                        f.write(audio_buffer)

                    loop = asyncio.get_event_loop()
                    
                    # 1. Pipeline Part A: STT (Process accumulated buffer to prevent 'Invalid data' WebM fragment errors)
                    new_text = await loop.run_in_executor(None, stt_plugin.process, temp_file)
                    
                    if new_text:
                        current_transcript = new_text.strip()
                    
                    # 2. Pipeline Part B: Semantic Embeddings (Throttled)
                    if current_transcript and chunk_index % 2 == 0:
                        window_text = get_last_n_sentences(current_transcript, n=3)
                        raw_sim_result = await loop.run_in_executor(None, similarity_plugin.process, window_text)
                        
                        if raw_sim_result:
                            current_raw_score = raw_sim_result.get("score", 0.0)
                            
                            if smoothed_score == 0.0:
                                smoothed_score = current_raw_score
                            else:
                                smoothed_score = 0.7 * smoothed_score + 0.3 * current_raw_score
                            
                            max_similarity = max(max_similarity, smoothed_score)
                            
                            label = "LOW"
                            reason = "Scattered or generic vocabulary"
                            if smoothed_score > 0.75:
                                label = "HIGH"
                                reason = "Highly structured overlap with expected pattern"
                            elif smoothed_score >= 0.50:
                                label = "MODERATE"
                                reason = "Partial semantic match detected"
                            
                            valid_matches = raw_sim_result.get("top_matches", []) if smoothed_score >= 0.50 else []
                            matched_q = raw_sim_result.get("matched_question", "None") if smoothed_score >= 0.50 else "None"
                            
                            last_sim_result = {
                                "score": round(smoothed_score, 4),
                                "label": label,
                                "reason": reason,
                                "matched_question": matched_q,
                                "rolling_max": round(max_similarity, 4),
                                "top_matches": valid_matches
                            }

                    # 3. Pipeline Part C: Hybrid AI Detection
                    local_result = local_ai_plugin.process(current_transcript)
                    local_score = local_result.get("score", 0.0)
                    
                    api_score = ai_state["api_score"]
                    if ai_state["label"] in ("API_NOT_CONFIGURED", "API_ERROR"):
                        final_ai_score = local_score # Fallback locally
                    else:
                        final_ai_score = (0.6 * api_score) + (0.4 * local_score)

                    final_label = "UNCERTAIN"
                    if final_ai_score > 0.70:
                        final_label = "AI_LIKELY"
                    elif final_ai_score < 0.40:
                        final_label = "HUMAN_LIKELY"

                    last_ai_payload = {
                        "local_score": round(local_score, 4),
                        "api_score": round(api_score, 4),
                        "final_score": round(final_ai_score, 4),
                        "label": final_label,
                        "reason": ai_state["reason"]
                    }

                    if current_transcript and chunk_index % 6 == 0:
                        window_text = get_last_n_sentences(current_transcript, n=4)
                        asyncio.create_task(run_api_detection(ai_state, window_text))

                    # 4. Standardized Output
                    await websocket.send_json({
                        "type": "partial",
                        "transcript": current_transcript,
                        "chunk_index": chunk_index,
                        "similarity": last_sim_result,
                        "ai_detection": last_ai_payload
                    })
                    
                except Exception as e:
                    logger.error("Error on chunk %d: %s", chunk_index, e)
                    await websocket.send_json({"type": "error", "message": str(e), "chunk_index": chunk_index})

            elif "text" in message and message["text"] == "DONE":
                logger.info("Client sent DONE signal. Aggregating final report.")
                
                # We compile the Final JSON Report to send back and end the stream
                session_data = {
                    "transcript": current_transcript,
                    "similarity_max": max_similarity,
                    "ai_final_score": last_ai_payload["final_score"],
                    "similarity_data": last_sim_result,
                    "ai_detection_data": last_ai_payload,
                    "chunks_processed": chunk_index
                }
                
                report = generate_report(session_data)
                
                await websocket.send_json({
                    "type": "final",
                    "report": report
                })
                break
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected.")
    except Exception as e:
        logger.exception("WebSocket fatal error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": f"Fatal error: {str(e)}", "chunk_index": chunk_index})
        except Exception:
            pass
    finally:
        logger.info("WebSocket connection closed. Processed %d chunks.", chunk_index)
        try:
            if os.path.exists(temp_file):
                os.remove(temp_file)
        except Exception as e:
            logger.error("Failed to remove temp file: %s", e)
