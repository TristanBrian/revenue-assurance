# Auth/RBAC integration notes

## 1. Dependencies to add (requirements.txt)
```
passlib[bcrypt]
python-jose[cryptography]
python-multipart   # required by FastAPI's OAuth2PasswordRequestForm
psycopg2-binary
python-dotenv
```

## 2. .env additions
```
DATABASE_URL=postgresql+psycopg2://obunde:<password>@localhost:5432/kpc
SECRET_KEY=<generate with: openssl rand -hex 32>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

## 3. Wire into main.py
```python
from app.routes import auth
app.include_router(auth.router)
```

## 4. Changes in this round
- All `users`/`roles`/`permissions` ids are now `UUID` (Postgres-native
  `sqlalchemy.dialects.postgresql.UUID`, generated with `uuid.uuid4()`).
  This requires Postgres — fine since you're moving off SQLite anyway, but
  note it means this specific model file won't work if you ever test against
  SQLite locally (SQLite has no native UUID type).
- Added `system_admin` role, scoped **only** to `manage_users` and
  `manage_permissions` — it does not get dashboard/reconciliation/e-billing
  access, per your instruction that its job is user control, not revenue
  assurance work. Add more permissions to it later if that scope changes.
- `revenue_assurance` no longer has `manage_users` — that's system_admin's
  job now.

## 5. Bootstrap problem (needs your decision)
`/api/auth/register` is still open (no auth) so that a **first** system_admin
can be created at all. Once one exists, I'd gate `/register` behind
`Depends(require_permission("manage_users"))`. Two ways to bootstrap the
first admin instead of leaving `/register` permanently open — tell me which:
  - **(a)** a one-off CLI script (`create_first_admin.py`) run manually on
    the server, DB direct-write, no HTTP endpoint involved at all
  - **(b)** keep `/register` open but add an env flag (`ALLOW_OPEN_REGISTER=true`)
    you flip off after the first admin is created

## 6. Things I could NOT do without your actual files (need these to finish wiring)
- **`app.utils.db_connection`**: I assumed it exposes `Base` (declarative base)
  and `SessionLocal` (sessionmaker). If your actual file uses different names
  or raw `sqlite3`, the imports in `models/user.py` and `core/dependencies.py`
  need adjusting to match.
- **Table creation**: with SQLAlchemy + no Alembic yet, `Base.metadata.create_all(engine)`
  needs to run somewhere (e.g. in main.py on startup, or via a one-off script)
  to actually create `users`, `roles`, `permissions`, `user_roles`, `role_permissions`
  tables in the `kpc` Postgres DB. I'd recommend setting up Alembic instead of
  relying on `create_all`, given you'll be adding audit/anomaly-persistence
  tables soon too — happy to scaffold that next.
- **Permission matrix**: `seed_roles.py`'s `ROLE_PERMISSIONS` dict is a guess.
  Replace it with your README's actual matrix.
- **register endpoint is open** (no auth required to call it) — fine for
  hackathon seeding, but flag if you want it locked behind `manage_users`
  before demo day.

## 5. Open decision for you
Existing routes (`/reconcile/update`, `/e-billing/*` etc.) aren't permission-gated
yet. Once you confirm the real permission matrix, I can go through
`routes/reconcile.py`, `routes/e_billing.py` etc. and add the right
`Depends(require_permission("..."))` to each endpoint.
