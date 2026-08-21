import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get absolute path to repo root .env file
_REPO_ROOT_ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')

load_dotenv(_REPO_ROOT_ENV)


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./kpc.db"
    
    secret_key: str = os.getenv("SECRET_KEY", "change-me-in-production-please-use-env-var")
    algorithm: str = os.getenv("ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

    # --- Immutable audit trail: on-chain anchor (Base Sepolia) ---
    # All optional/empty-default — anchor_service.is_configured() gates
    # on these being non-empty rather than raising at import time, same
    # "not configured, not an error" posture as the alerts system's
    # SMTP_* settings. See web3/.env.example for what each one is.
    cdp_api_key_id: str = ""
    cdp_api_key_secret: str = ""
    cdp_wallet_secret: str = ""
    base_rpc_url: str = "https://sepolia.base.org"
    audit_anchor_contract_address: str = ""
    audit_backend_wallet_name: str = "inuka-audit-backend"

    model_config = SettingsConfigDict(env_file=_REPO_ROOT_ENV, extra="ignore")


settings = Settings()

if settings.database_url and settings.database_url.startswith("postgres://"):
    settings.database_url = settings.database_url.replace("postgres://", "postgresql://", 1)

if os.getenv("DATABASE_URL"):
    db_url = os.getenv("DATABASE_URL")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    settings.database_url = db_url

if os.getenv("SECRET_KEY"):
    settings.secret_key = os.getenv("SECRET_KEY")