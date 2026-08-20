from app.services.report_crypto import sign_report_bytes, verify_report_bytes, compute_file_sha256


def test_report_crypto_hashing_and_verification():
    file_content = b"KPC Order to Cash Reconciliation Report Data 2026"
    file_hash, signature = sign_report_bytes(file_content)

    assert len(file_hash) == 64
    assert len(signature) == 64

    # Verification with correct signature
    res = verify_report_bytes(file_content, signature)
    assert res["is_valid"] is True
    assert res["file_hash"] == file_hash

    # Verification with altered signature
    res_invalid = verify_report_bytes(file_content, "0" * 64)
    assert res_invalid["is_valid"] is False


def test_report_crypto_tamper_detection():
    file_content = b"Original Dispatch Data"
    file_hash, signature = sign_report_bytes(file_content)

    tampered_content = b"Tampered Dispatch Data"
    res_tampered = verify_report_bytes(tampered_content, signature)
    assert res_tampered["file_hash"] != file_hash
    assert res_tampered["is_valid"] is False
