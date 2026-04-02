import os
import json
from groq import AsyncGroq
from .base import BasePlugin

class APIAIDetectionPlugin(BasePlugin):
    def __init__(self):
        super().__init__()
        # Ensure API key is set, else we fail gracefully
        api_key = os.getenv("GROQ_API_KEY")
        self.client = AsyncGroq(api_key=api_key) if api_key else None

    async def process_async(self, transcript: str):
        """
        Asynchronously calls standard LLM reasoning to evaluate a transcript excerpt.
        Always returns structured JSON without blocking.
        """
        if not self.client:
            return {"ai_score": 0.0, "label": "API_NOT_CONFIGURED", "reason": "Missing GROQ_API_KEY"}
        
        if not transcript or len(transcript.split()) < 15:
            return {"ai_score": 0.0, "label": "UNCERTAIN", "reason": "Not enough context for API analysis."}

        prompt = f"""Analyze this interview answer:
"{transcript}"

Is this genuinely human, highly memorized/rehearsed, or purely AI-generated?
Consider standard speech patterns, hesitation, perfect grammar, and robotic transitions.

Return ONLY a valid JSON dictionary:
{{
  "ai_score": <float between 0.0 and 1.0 (1.0 is definitely AI)>,
  "label": "<AI_LIKELY, UNCERTAIN, or HUMAN_LIKELY>",
  "reason": "<One concise, punchy sentence explaining the diagnostic>"
}}
"""
        try:
            response = await self.client.chat.completions.create(
                model="llama3-8b-8192",  # Fast and free on Groq
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=150,
                response_format={"type": "json_object"}
            )
            
            content = response.choices[0].message.content
            data = json.loads(content)
            
            # Clean up potential LLM JSON variance
            score = float(data.get("ai_score", 0.0))
            return {
                "ai_score": score,
                "label": str(data.get("label", "UNCERTAIN")).upper().replace(" ", "_"),
                "reason": str(data.get("reason", "API Evaluation Finished."))
            }

        except Exception as e:
            return {"ai_score": 0.0, "label": "API_ERROR", "reason": f"API Failure: {str(e)}"}
