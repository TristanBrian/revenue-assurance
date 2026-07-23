# Models vs. Schemas convention

Going forward, this backend keeps two separate layers instead of one:

- **`app/models/`** — SQLAlchemy ORM classes. These describe the *database*
  shape: tables, columns, relationships (`Base`, `Column`, `relationship`,
  etc.). One class per file: `user.py`, `role.py`, `permission.py` (join
  tables shared between them live in `associations.py` so none of the three
  has to import from another), and `omc.py`, `depot.py`, `dispatch.py`,
  `invoice.py`, `payment.py`, `depot_ledger.py` for the reconciliation
  domain's 6 tables (see `SCHEMA_NOTES.md`). `app/models/__init__.py`
  imports all of them — `relationship()` targets are resolved by string
  name ("Role", "Dispatch", etc.) against the shared registry, so every
  model needs to have been imported somewhere before the first query;
  importing any single `app.models.*` file runs this `__init__.py` first,
  which pulls in the rest. `audit.py`, `e_billing.py`, `reconciliation.py`,
  and `transactions.py` stay empty placeholders — "reconciliation" and
  "e_billing" aren't tables themselves (just domain names), "audit" and
  "transactions" don't have a real backing table yet at all.

- **`app/schemas/`** — Pydantic models. These describe the *API* shape:
  request bodies and response payloads. One schema file per route file
  (`schemas/reconciliation.py` ↔ `routes/reconcile.py`,
  `schemas/e_billing.py` ↔ `routes/e_billing.py`, etc.), plus `feed.py` and
  `heatmap.py` for the two routes that have no backing ORM model to mirror.

**Why split them**: a DB row and an API response aren't always the same
shape (e.g. `User.hashed_password` must never leave the API; `User.roles`
is a list of `Role` objects in the DB but a list of role-name strings over
the wire). Conflating the two, or leaving response shapes untyped, is how
`app/models/reconciliation.py` and `app/models/e_billing.py` ended up with
Pydantic classes that had silently drifted from what the routes actually
returned (missing fields, wrong field names) — nothing ever validated
against them, since no route declared `response_model=`. Both files were
cleared out once `app/schemas/reconciliation.py` and
`app/schemas/e_billing.py` (built directly from the real return shapes, not
copied from the old ones) were verified against every endpoint.

## Rules for new work

1. Every route declares `response_model=` (or `response_model=list[...]`),
   matching what it actually returns — not what you assume it returns.
   Verify against the real dict/object, not the other way around.
2. Request bodies use a Pydantic schema (`payload: SomeRequest`), not a pile
   of individual `Query(...)`/raw parameters — see `routes/auth.py`'s
   `register(payload: RegisterRequest, ...)` vs. its old
   `register(email: str, password: str, ...)`.
3. Services stay framework-agnostic: no `app.schemas` or FastAPI imports in
   `app/services/*.py`. Routes unpack a schema into plain arguments before
   calling a service, and services raise plain Python exceptions that routes
   translate into `HTTPException` (see `services/user_service.py`'s
   `EmailAlreadyRegisteredError`/`RoleNotFoundError` and how
   `routes/auth.py` catches them).
4. If a service function returns genuinely different key sets on different
   code paths (several of the e_billing ones do — e.g. `retry_failed_sync()`
   omits `invoice_id`/`new_status`/`retry_count`/`timestamp` on its
   not-found/not-failed early returns), model that with `Optional[...] =
   None` fields rather than forcing one rigid shape or silently changing
   what the route returns.
5. Two endpoints don't get a `response_model`: `GET /reconcile/template/{type}`
   and `GET /reconcile/export`, both `StreamingResponse` (CSV/xlsx bytes).
   FastAPI passes a returned `Response` subclass straight through and skips
   `response_model` entirely, so declaring one would just be a misleading
   entry in the OpenAPI schema.
6. ORM objects can usually be returned directly from a route (`return user`)
   when the schema has `model_config = ConfigDict(from_attributes=True)`.
   If the ORM shape doesn't map 1:1 onto the API shape (relationships,
   computed values, renamed fields), use a `@model_validator(mode="before")`
   on the schema to adapt it — see `schemas/user.py`'s `UserOut`, which turns
   `User.roles` (list of `Role` objects) into `list[str]` and derives
   `permissions` from `User.permission_codes()`, which isn't even an ORM
   attribute. Don't hand-build the response dict in the route.
7. One ORM class per file under `app/models/`. Shared association
   (many-to-many join) tables go in `associations.py`, not in whichever
   model file happens to come first alphabetically. If you add a model that
   needs `app/models/__init__.py` importing it for the registry to resolve
   correctly (see above), add it there too.
