"""
Configuration for the RAG (Retrieval-Augmented Generation) service.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

# Where local knowledge base documents are stored
KNOWLEDGE_BASE_DIR = BASE_DIR / "app" / "data" / "knowledge_base"

# Where the FAISS index will be persisted
FAISS_INDEX_PATH = BASE_DIR / "app" / "data" / "faiss_index"

# Free embedding model (sentence-transformers, runs on CPU)
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Local LLM via Ollama – install and pull a model (e.g., llama3, mistral)
OLLAMA_MODEL = "llama3"

# Text splitting
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Number of chunks to retrieve
TOP_K = 5

# Create directories if they don't exist
os.makedirs(KNOWLEDGE_BASE_DIR, exist_ok=True)
os.makedirs(FAISS_INDEX_PATH, exist_ok=True)