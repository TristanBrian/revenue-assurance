"""
Embedding provider using Sentence‑Transformers (free, local).
"""

from sentence_transformers import SentenceTransformer
from app.services.rag.config import EMBEDDING_MODEL_NAME

_model = None

def get_embedding_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model

def embed_texts(texts):
    model = get_embedding_model()
    return model.encode(texts, convert_to_numpy=True).tolist()

def embed_query(text):
    model = get_embedding_model()
    return model.encode([text], convert_to_numpy=True)[0].tolist()