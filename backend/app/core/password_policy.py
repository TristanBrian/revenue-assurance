"""Central password and username policy.

The policy is intentionally code/deployment controlled. It is displayed to
administrators, but is not editable in the browser: allowing a user with
manage_users to weaken the platform's authentication baseline would create a
security control bypass.
"""
import re


MIN_PASSWORD_LENGTH = 12
PASSWORD_POLICY = {
    "min_length": MIN_PASSWORD_LENGTH,
    "requires_uppercase": True,
    "requires_lowercase": True,
    "requires_number": True,
    "requires_symbol": True,
    "rejects_identity_fragment": True,
}

_COMMON_PASSWORDS = {
    "password",
    "password123",
    "password123!",
    "qwerty",
    "qwerty123",
    "letmein",
    "welcome",
    "changeme",
    "admin123",
}


class PasswordPolicyError(ValueError):
    """Raised when a password does not meet the platform baseline."""


def validate_password(password: str, identity: str | None = None) -> None:
    """Validate a password before hashing it.

    ``identity`` is normally the user's email. We reject the local-part as a
    substring so passwords such as ``inuka_manager-2026!`` are not accepted.
    The raw password is never logged or included in this exception.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.")
    if not re.search(r"[A-Z]", password):
        raise PasswordPolicyError("Password must contain at least one uppercase letter.")
    if not re.search(r"[a-z]", password):
        raise PasswordPolicyError("Password must contain at least one lowercase letter.")
    if not re.search(r"\d", password):
        raise PasswordPolicyError("Password must contain at least one number.")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise PasswordPolicyError("Password must contain at least one symbol.")
    if password.casefold() in _COMMON_PASSWORDS:
        raise PasswordPolicyError("Choose a less common password.")
    if identity:
        local_part = identity.split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ")
        for fragment in local_part.split():
            if len(fragment) >= 4 and fragment.casefold() in password.casefold():
                raise PasswordPolicyError("Password must not contain part of your email address.")


def normalize_email(email: str) -> str:
    """Return the canonical username representation used for login and lookup."""
    return email.strip().casefold()
