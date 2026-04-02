from plugins.final_verdict_plugin import FinalVerdictPlugin

final_plugin = FinalVerdictPlugin()

def generate_report(session_data: dict) -> dict:
    plugin_input = {
        "similarity_score": session_data.get("similarity_max", 0.0),
        "ai_detection_score": session_data.get("ai_final_score", 0.0)
    }
    
    verdict_info = final_plugin.process(plugin_input)
    
    # Calculate simple metadata
    transcript = session_data.get("transcript", "")
    words = len(transcript.split())
    chunks = session_data.get("chunks_processed", 0)
    
    # 1 chunk = roughly 2 seconds based on MediaRecorder timeslice
    duration_sec = chunks * 2
    
    metadata = {
        "duration": f"{duration_sec} seconds",
        "total_words": words,
        "chunks_processed": chunks
    }
    
    timeline_insight = {
        "peak_similarity": session_data.get("similarity_max", 0.0),
        "peak_ai_score": session_data.get("ai_final_score", 0.0)
    }
        
    return {
        "transcript": transcript,
        "metadata": metadata,
        "timeline_insight": timeline_insight,
        "similarity": session_data.get("similarity_data", {}),
        "ai_detection": session_data.get("ai_detection_data", {}),
        "final_score": verdict_info["final_score"],
        "verdict": verdict_info["verdict"],
        "confidence": verdict_info["confidence"],
        "explanation": verdict_info["explanation"]
    }
