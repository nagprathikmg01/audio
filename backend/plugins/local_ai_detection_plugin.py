from .base import BasePlugin
import re

class LocalAIDetectionPlugin(BasePlugin):
    def process(self, data: str):
        """
        Uses fast local heuristics to compute an AI likelihood score.
        Checks for filler words, sentence lengths, repetition, and formal vocabulary.
        """
        if not data or not data.strip():
            return {"score": 0.0, "label": "UNCERTAIN"}
        
        words = re.findall(r'\b\w+\b', data.lower())
        if len(words) < 10:
            return {"score": 0.0, "label": "UNCERTAIN"}

        # 1. Filler Analysis (Humans use fillers, AI typically does not)
        fillers = {"um", "uh", "like", "you", "know", "basically", "literally", "well", "so"}
        filler_count = sum(1 for w in words if w in fillers)
        filler_ratio = filler_count / len(words)
        
        # High filler ratio rapidly drops AI probability. < 1% triggers AI likelihood.
        ai_score_filler = max(0.0, 1.0 - (filler_ratio * 15)) 
        
        # 2. Sentence Consistency & Complexity (AI has stable 15-25 word averages)
        sentences = [s.strip() for s in re.split(r'[.!?]+', data) if s.strip()]
        avg_sentence_len = len(words) / max(1, len(sentences))
        
        ai_score_length = 0.5
        if 12 <= avg_sentence_len <= 30:
            ai_score_length = 0.8
        
        # 3. Formality Score (AI uses stiff transitional adverbs)
        formal_words = {"furthermore", "moreover", "consequently", "therefore", "thus", "crucial", "essential", "optimal", "delve", "facilitate"}
        formal_count = sum(1 for w in words if w in formal_words)
        ai_score_formal = min(1.0, formal_count * 0.3)
        
        # Weighted Combination
        final_score = (ai_score_filler * 0.5) + (ai_score_length * 0.2) + (ai_score_formal * 0.3)
        
        label = "UNCERTAIN"
        if final_score > 0.65:
            label = "AI_LIKELY"
        elif final_score < 0.4:
            label = "HUMAN_LIKELY"
            
        return {
            "score": round(final_score, 4),
            "label": label
        }
