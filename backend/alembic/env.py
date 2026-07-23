import os
import sys
from logging.config import fileConfig

from alembic import context

# Make `app.*` importable regardless of the CWD alembic is invoked from
# (same pattern as scripts/etl_pipeline.py and scripts/seed_roles.py).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.utils.db_connection import Base, get_engine  # noqa: E402
import app.models  # noqa: E402,F401 — import side effect: registers every ORM class on Base.metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Use the app's real DATABASE_URL (from the repo-root .env via app.config)
# instead of whatever's hardcoded in alembic.ini, so `alembic upgrade head`
# always targets the same DB the app itself connects to.
#
# NOT config.set_main_option("sqlalchemy.url", ...): that routes the value
# through configparser, which treats a literal "%" (e.g. the "%40" from a
# URL-encoded "@" in the password) as the start of a %(...)s interpolation
# and raises. settings.database_url is used directly below instead,
# bypassing the ini file's interpolation entirely.

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Tables owned by mechanisms other than Alembic — do not let autogenerate
# try to manage these here. omcs/depots/products/dispatches/invoices/
# payments/depot_ledger are drop-and-recreated by scripts/etl_pipeline.py's
# pandas .to_sql(if_exists='replace') every run; ebilling_sync/ebilling_dlq/
# ebilling_webhook_log are created idempotently by
# app/services/e_billing.py's init_ebilling_tables(). Bringing either set
# under Alembic would fight with those existing, working mechanisms.
# Remove a table from this set only once you've deliberately decided
# Alembic (not that other mechanism) now owns its schema.
NOT_ALEMBIC_MANAGED_TABLES = {
    "omcs",
    "depots",
    "products",
    "dispatches",
    "invoices",
    "payments",
    "depot_ledger",
    "ebilling_sync",
    "ebilling_dlq",
    "ebilling_webhook_log",
}


def include_object(object, name, type_, reflected, compare_to):
    if type_ == "table" and name in NOT_ALEMBIC_MANAGED_TABLES:
        return False
    return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # Reuse the app's own engine (app.utils.db_connection.get_engine()) so
    # migrations always run against exactly what the app connects to,
    # rather than building a second engine from alembic.ini.
    connectable = get_engine()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
