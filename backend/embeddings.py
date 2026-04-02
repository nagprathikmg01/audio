import json
import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"
_model = None
_index = None
_answers_meta = []

def init_faiss():
    """Build the FAISS index ONCE at server startup."""
    global _model, _index, _answers_meta
    
    if _index is not None:
        return
        
    print("Initializing FAISS and SentenceTransformer...")
    _model = SentenceTransformer(MODEL_NAME, device="cpu")
    
    data_path = os.path.join(os.path.dirname(__file__), "data", "reference_answers.json")
    if os.path.exists(data_path):
        with open(data_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        print("Warning: reference_answers.json not found.")
        data = []

    _answers_meta = data
    if len(data) == 0:
        return
    
    texts = [item["answer"] for item in data]
    
    # Generate embeddings
    embeddings = _model.encode(texts, convert_to_numpy=True)
    
    # CRITICAL: Normalize embeddings to calculate cosine similarity via inner product
    faiss.normalize_L2(embeddings)
    
    dim = embeddings.shape[1]
    _index = faiss.IndexFlatIP(dim)
    _index.add(embeddings)
    print(f"FAISS index loaded with {len(data)} reference answers.")

def get_similarities(text: str, top_k: int = 2):
    """
    Computes cosine similarity for the normalized cleaned transcript text against the FAISS index.
    """
    if not text or not text.strip() or _index is None or _index.ntotal == 0:
        return []

    # Clean text
    clean_text = text.lower().strip()

    emb = _model.encode([clean_text], convert_to_numpy=True)
    
    # Normalize!
    faiss.normalize_L2(emb)
    
    k = min(top_k, _index.ntotal)
    similarities, indices = _index.search(emb, k)
    
    results = []
    for i in range(k):
        score = float(similarities[0][i])
        idx = indices[0][i]
        results.append({
            "question": _answers_meta[idx]["question"],
            "answer_snippet": _answers_meta[idx]["answer"][:100] + "...",
            "score": score
        })
    return results
