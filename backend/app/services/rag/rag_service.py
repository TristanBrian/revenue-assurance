"""
Main RAG service: retrieval + generation.
"""

from typing import Dict
from app.services.rag.vector_store import get_vector_store
from app.services.rag.loader import load_documents_from_url, get_all_chunks
from app.services.rag.config import OLLAMA_MODEL, TOP_K
from langchain_ollama import OllamaLLM

_llm = None

def get_llm():
    global _llm
    if _llm is None:
        _llm = OllamaLLM(model=OLLAMA_MODEL)
    return _llm

def answer_question(question: str, k: int = TOP_K) -> Dict:
    store = get_vector_store()
    chunks = store.search(question, k)
    if not chunks:
        return {
            "question": question,
            "answer": "I don't have enough information to answer that.",
            "context": []
        }

    context = "\n\n---\n\n".join(chunks)
    prompt = f"""You are the FlowGuard Analyst – an expert assistant for the FlowGuard platform (KPC + Inuka).

Based on the following context, answer the user's question concisely and professionally.
If the context does not contain the answer, say "I don't have that information in my knowledge base."

Context:
{context}

User question: {question}

Answer:"""

    llm = get_llm()
    answer = llm.invoke(prompt)
    return {
        "question": question,
        "answer": answer,
        "context": chunks
    }

def ingest_url(url: str) -> Dict:
    new_chunks = load_documents_from_url(url)
    if not new_chunks:
        return {"success": False, "message": "No content could be loaded from URL."}
    store = get_vector_store()
    all_chunks = store.chunks + new_chunks
    store.build_index(all_chunks)
    return {
        "success": True,
        "message": f"Ingested {len(new_chunks)} chunks from URL.",
        "total_chunks": len(all_chunks)
    }

def reload_knowledge_base() -> Dict:
    chunks = get_all_chunks()
    store = get_vector_store()
    store.build_index(chunks)
    return {
        "success": True,
        "message": f"Rebuilt index with {len(chunks)} chunks."
    }