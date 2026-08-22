"""
Document loaders: from local files (txt, md, pdf) and from a URL.
"""

from typing import List
from pathlib import Path
from langchain_community.document_loaders import TextLoader, PyPDFLoader, WebBaseLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from app.services.rag.config import CHUNK_SIZE, CHUNK_OVERLAP, KNOWLEDGE_BASE_DIR

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", ". ", " ", ""]
)

def load_documents_from_files(directory: Path = KNOWLEDGE_BASE_DIR) -> List[str]:
    """Load all .txt, .md, .pdf files from a directory."""
    docs = []
    for file_path in directory.glob("*"):
        if file_path.suffix in [".txt", ".md"]:
            loader = TextLoader(str(file_path))
            docs.extend(loader.load())
        elif file_path.suffix == ".pdf":
            loader = PyPDFLoader(str(file_path))
            docs.extend(loader.load())
    return [doc.page_content for doc in docs]

def load_documents_from_url(url: str) -> List[str]:
    """Load a web page and return its content as a list of chunks."""
    loader = WebBaseLoader(url)
    docs = loader.load()
    chunks = text_splitter.split_documents(docs)
    return [chunk.page_content for chunk in chunks]

def get_all_chunks() -> List[str]:
    """Load all local documents and return a flat list of chunk strings."""
    raw_texts = load_documents_from_files()
    from langchain.docstore.document import Document
    docs = [Document(page_content=t) for t in raw_texts]
    chunks = text_splitter.split_documents(docs)
    return [chunk.page_content for chunk in chunks]