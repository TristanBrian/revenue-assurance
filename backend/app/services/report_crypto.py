import hashlib
import hmac
from typing import Dict, Any, Tuple
from app.config import settings


def compute_file_sha256(file_bytes: bytes) -> str:
    """Computes SHA-256 hex digest for report raw file content."""
    hasher = hashlib.sha256()
    hasher.update(file_bytes)
    return hasher.hexdigest()


def compute_hmac_signature(file_hash: str) -> str:
    """Generates HMAC-SHA256 signature using backend SECRET_KEY."""
    key = settings.secret_key.encode('utf-8')
    msg = file_hash.encode('utf-8')
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def sign_report_bytes(file_bytes: bytes) -> Tuple[str, str]:
    """
    Returns (file_hash, signature) tuple for given report raw bytes.
    """
    file_hash = compute_file_sha256(file_bytes)
    signature = compute_hmac_signature(file_hash)
    return file_hash, signature


def verify_report_bytes(file_bytes: bytes, expected_signature: str = None) -> Dict[str, Any]:
    """
    Verifies raw bytes and returns verification payload.
    """
    file_hash = compute_file_sha256(file_bytes)
    computed_sig = compute_hmac_signature(file_hash)
    
    is_valid = True
    if expected_signature:
        is_valid = hmac.compare_digest(computed_sig, expected_signature)
        
    return {
        "file_hash": file_hash,
        "signature": computed_sig,
        "is_valid": is_valid
    }
