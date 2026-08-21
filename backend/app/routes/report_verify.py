from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.models.audit import AuditLog
from app.services.report_crypto import verify_report_bytes, sign_report_bytes
from app.services.audit_service import log_action

router = APIRouter()


@router.post("/verify")
async def verify_report_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Public or Auditor endpoint to verify an exported CSV/Excel/PDF report file.
    Computes file SHA-256 digest and checks if a matching audit record exists.
    """
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    crypto_res = verify_report_bytes(file_bytes)
    file_hash = crypto_res["file_hash"]
    computed_signature = crypto_res["signature"]

    # Search audit log metadata for matching file_hash
    audit_matches = (
        db.query(AuditLog)
        .filter(AuditLog.action == "report.export")
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    matching_log = None
    for log in audit_matches:
        if log.extra_metadata and log.extra_metadata.get("file_hash") == file_hash:
            matching_log = log
            break

    status_str = "VERIFIED" if matching_log else "UNKNOWN"

    match_details = None
    if matching_log:
        match_details = {
            "log_id": str(matching_log.id),
            "created_at": matching_log.created_at.isoformat(),
            "report_type": matching_log.extra_metadata.get("report_type", "revenue_assurance"),
            "rows_exported": matching_log.extra_metadata.get("rows_exported", 0),
            "contains_sensitive_omc_pii": matching_log.extra_metadata.get("contains_sensitive_omc_pii", False),
        }

    return {
        "status": status_str,
        "filename": file.filename,
        "file_hash": file_hash,
        "signature": computed_signature,
        "audit_match": match_details,
    }
