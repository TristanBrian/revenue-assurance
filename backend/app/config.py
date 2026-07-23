"""
Application configuration – reads DATABASE_URL (and other settings) from
the environment / repo-root .env file.
"""
import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT_ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')

# pydantic-settings (below) only loads .env into its own Settings object, not into
# real os.environ. Modules that read os.environ directly (e.g. core/security.py's
# SECRET_KEY) need it actually populated, so load it here too.
load_dotenv(_REPO_ROOT_ENV)


class Settings(BaseSettings):
    database_url: str = "sqlite:///./kpc.db"

    model_config = SettingsConfigDict(env_file=_REPO_ROOT_ENV, extra="ignore")


settings = Settings()
