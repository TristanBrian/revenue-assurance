# backend/app/utils/masking.py
import hashlib
from typing import Any, List

def mask_beneficiary_id(value: str | None) -> str:
    """
    Unified beneficiary masking – "bank statement" style.
    - BEN-0158 → BEN-****0158
    - Audrey Anderson → BEN-****5837 (consistent hash-based)
    """
    if not value:
        return "Beneficiary"

    # If it's already a BEN-XXXX format, mask it
    if value.startswith("BEN-"):
        clean = value.replace("BEN-", "")
        if "****" in clean:
            return value
        suffix = clean[-4:] if len(clean) >= 4 else clean.zfill(4)
        return f"BEN-****{suffix}"

    # If it contains a space (likely a person's name)
    if " " in value:
        hash_value = hashlib.md5(value.encode()).hexdigest()
        suffix = str(int(hash_value[:8], 16) % 10000).zfill(4)
        return f"BEN-****{suffix}"

    # Company names remain unchanged
    return value


def mask_omcs_list(omcs: List[str]) -> List[str]:
    """Mask all names in an OMCs list."""
    return [mask_beneficiary_id(name) for name in omcs]