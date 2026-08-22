"""
FAISS vector store wrapper. Handles building, saving, loading, searching.
"""

import pickle
import numpy as np
import faiss
from pathlib import Path
from typing import List
from app.services.rag.config import FAISS_INDEX_PATH
from app.services.rag.embeddings import embed_texts, embed_query

class VectorStore:
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = None
        self.chunks = []
        self.is_loaded = False

    def build_index(self, chunks: List[str]):
        if not chunks:
            raise ValueError("Cannot build index with empty chunk list.")
        self.chunks = chunks
        embeddings = embed_texts(chunks)
        vectors = np.array(embeddings).astype(np.float32)
        self.index = faiss.IndexFlatL2(self.dimension)
        self.index.add(vectors)
        self.is_loaded = True
        faiss.write_index(self.index, str(FAISS_INDEX_PATH / "index.faiss"))
        with open(FAISS_INDEX_PATH / "chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)

    def load_index(self):
        index_file = FAISS_INDEX_PATH / "index.faiss"
        chunks_file = FAISS_INDEX_PATH / "chunks.pkl"
        if index_file.exists() and chunks_file.exists():
            self.index = faiss.read_index(str(index_file))
            with open(chunks_file, "rb") as f:
                self.chunks = pickle.load(f)
            self.is_loaded = True
            return True
        return False

    def search(self, query: str, k: int = 5) -> List[str]:
        if not self.is_loaded or self.index is None:
            return []
        q_vec = np.array([embed_query(query)]).astype(np.float32)
        distances, indices = self.index.search(q_vec, min(k, len(self.chunks)))
        results = []
        for idx in indices[0]:
            if 0 <= idx < len(self.chunks):
                results.append(self.chunks[idx])
        return results

# Singleton
_vector_store = None

def get_vector_store() -> VectorStore:
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStore()
        if not _vector_store.load_index():
            from app.services.rag.loader import get_all_chunks
            chunks = get_all_chunks()
            if chunks:
                _vector_store.build_index(chunks)
    return _vector_store