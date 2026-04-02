from .base import BasePlugin
from embeddings import get_similarities

class SimilarityPlugin(BasePlugin):
    def process(self, data: str):
        """
        Takes a sentence-based slice of text and returns the raw similarity scores.
        """
        if not data or not data.strip():
            return None
        
        results = get_similarities(data, top_k=2)
        if not results:
            return None
            
        top_score = results[0]["score"]
        top_question = results[0]["question"]
        
        return {
            "score": top_score,
            "matched_question": top_question,
            "top_matches": [
                {"question": res["question"], "score": round(res["score"], 4)}
                for res in results
            ]
        }
