from .base import BasePlugin

class FinalVerdictPlugin(BasePlugin):
    def process(self, session_data: dict):
        """
        Calculates the final conclusive score, dynamic explanation, and metadata.
        """
        sim_score = session_data.get("similarity_score", 0.0)
        ai_score = session_data.get("ai_detection_score", 0.0)
        
        # Fair weighting
        final_score = (0.5 * sim_score) + (0.5 * ai_score)
        
        # Verdict
        if final_score >= 0.75:
            verdict = "LIKELY SCRIPTED / AI-GENERATED"
        elif final_score >= 0.45:
            verdict = "SUSPICIOUS"
        else:
            verdict = "LIKELY GENUINE"
            
        # Confidence calculation
        conf_val = abs(final_score - 0.5) * 2
        confidence = "LOW"
        if conf_val > 0.6:
            confidence = "HIGH"
        elif conf_val > 0.3:
            confidence = "MEDIUM"

        # Edge Case Explanation breakdown
        sim_reason = "Normal semantic variance."
        if sim_score >= 0.7:
            sim_reason = "Extremely high overlap with known references."
        elif sim_score >= 0.4:
            sim_reason = "Partial overlap with known references."
            
        ai_reason = "Natural phrasing and pacing."
        if ai_score >= 0.7:
            ai_reason = "Highly robotic tone, no fillers, or structured reasoning detected."
        elif ai_score >= 0.4:
            ai_reason = "Slightly rehearsed or formal phrasing."

        final_reason = "Combined signals align with natural speech patterns."
        if sim_score >= 0.7 and ai_score < 0.4:
            final_reason = "Answer shows high similarity but low AI traits → likely a memorized human response."
        elif sim_score < 0.4 and ai_score >= 0.7:
            final_reason = "Answer shows low similarity but high AI traits → likely real-time AI teleprompter usage."
        elif final_score >= 0.75:
            final_reason = "Both signals clearly confirm heavy manipulation (scripted or deeply AI-generated)."

        explanation = {
            "similarity_reason": sim_reason,
            "ai_reason": ai_reason,
            "final_reason": final_reason
        }
            
        return {
            "final_score": round(final_score, 4),
            "verdict": verdict,
            "confidence": confidence,
            "explanation": explanation
        }
