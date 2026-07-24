#!/usr/bin/env python3
"""
Permission test suite for the KPC Revenue Assurance API.

WHAT THIS TESTS
    For every documented endpoint, this script sends a request as each
    seeded role AND with no token at all, then checks whether the response
    matches what the permission matrix (README) says should happen.

    PASS = the permission gate behaved correctly (allowed role got past
           auth, disallowed role got blocked).
    FAIL = a role got through that shouldn't have, or was blocked that
           shouldn't have been.

    This does NOT validate full business logic. A role that IS allowed to
    hit a route may still get 422/404/500 back because of a placeholder
    payload below that doesn't match your real request schema exactly --
    that still counts as PASS, since "got past the permission gate" is
    the thing being tested here, not "the request was fully valid."

SETUP REQUIRED BEFORE RUNNING
    1. Backend running and reachable at KPC_BASE_URL (default localhost:8000)
    2. First system_admin bootstrapped via scripts/seed_admin.py
    3. Roles/permissions seeded via scripts/seed_roles.py
    4. Set KPC_ADMIN_EMAIL / KPC_ADMIN_PASSWORD env vars (or edit below) to
       that bootstrapped admin's real credentials -- the script uses this
       account to auto-create one throwaway test user per role if they
       don't already exist.

USAGE
    pip install requests
    KPC_ADMIN_EMAIL=admin@kpc-hackathon.dev KPC_ADMIN_PASSWORD=... python test_permissions.py
"""

import os
import sys
import uuid

import requests

BASE_URL = os.environ.get("KPC_BASE_URL", "http://localhost:8000").rstrip("/")
ADMIN_EMAIL = os.environ.get("KPC_ADMIN_EMAIL", "admin@kpc-hackathon.dev")
ADMIN_PASSWORD = os.environ.get("KPC_ADMIN_PASSWORD", "changeme")

PASS_MARK = "✅"
FAIL_MARK = "❌"

# One throwaway test user per role. The script creates these via the admin
# account if they don't already exist. Change these if you already have
# real users with these emails, or just let it reuse them (idempotent —
# registration failures for "already exists" are treated as OK).
TEST_USERS = {
    "depot_supervisor":  {"email": "test.depot@kpc-hackathon.dev",   "password": "TestPass123!", "full_name": "Test Depot",   "role_name": "depot_supervisor"},
    "manager":           {"email": "test.manager@kpc-hackathon.dev", "password": "TestPass123!", "full_name": "Test Manager", "role_name": "manager"},
    "revenue_assurance": {"email": "test.revenue@kpc-hackathon.dev", "password": "TestPass123!", "full_name": "Test Revenue", "role_name": "revenue_assurance"},
    "system_admin":      {"email": "test.sysadmin@kpc-hackathon.dev","password": "TestPass123!", "full_name": "Test Admin",   "role_name": "system_admin"},
}

# Which roles hold which permission, per the README's Permission Mapping
# table. Keep this in sync with scripts/seed_roles.py if that changes.
ROLE_PERMISSIONS = {
    "depot_supervisor": {
        "view_live_feed", "upload_csv", "view_metrics",
    },
    "manager": {
        "view_live_feed", "view_heatmap", "view_omc_risk_profile",
        "view_metrics", "view_anomaly_table", "export_reports",
    },
    "revenue_assurance": {
        "view_live_feed", "view_heatmap", "view_omc_risk_profile",
        "view_metrics", "view_anomaly_table", "upload_csv",
        "resolve_anomaly", "manage_ebilling", "export_reports",
        "view_fraud_graph", "view_risk_analytics", "view_audit",
    },
    "system_admin": {
        "manage_users", "manage_permissions",
    },
}

ALL_ROLES = list(TEST_USERS.keys())


def rid():
    return str(uuid.uuid4())


# -----------------------------------------------------------------------
# Endpoint test cases.
#   permission: "public" (no auth needed), "any_auth" (any logged-in user),
#               or a permission code string from ROLE_PERMISSIONS above.
#   json / files / path_params: ASSUMPTIONS about real request shape —
#   adjust field names if your actual schemas differ.
# -----------------------------------------------------------------------
ENDPOINTS = [
    # -- auth --
    dict(method="POST", path="/api/auth/login", permission="public",
         json={"email": "nonexistent@kpc-hackathon.dev", "password": "wrong"}),
    dict(method="POST", path="/api/auth/register", permission="manage_users",
         json={"email": f"probe.{rid()}@kpc-hackathon.dev", "password": "Probe123!",
               "full_name": "Probe User", "role_name": "manager"}),
    dict(method="GET", path="/api/auth/me", permission="any_auth"),

    # -- reconciliation / live feed --
    dict(method="GET", path="/api/feed", permission="view_live_feed"),
    dict(method="POST", path="/api/reconcile/metrics", permission="view_metrics", json={}),
    dict(method="GET", path="/api/reconcile/anomalies", permission="view_anomaly_table"),
    dict(method="GET", path="/api/reconcile/omc-risk-profile", permission="view_omc_risk_profile"),
    dict(method="GET", path="/api/heatmap", permission="view_heatmap"),
    dict(method="POST", path="/api/reconcile/upload", permission="upload_csv",
         files={"file": ("probe.csv", "col_a,col_b\n1,2\n", "text/csv")}),  # ASSUMPTION: field name "file"
    dict(method="GET", path="/api/reconcile/template/{type}", permission="upload_csv",
         path_params={"type": "dispatches"}),
    dict(method="POST", path="/api/reconcile/update", permission="resolve_anomaly",
         json={"dispatch_id": "PROBE", "status": "reviewed"}),  # ASSUMPTION: body shape
    dict(method="GET", path="/api/reconcile/export", permission="export_reports"),
    dict(method="POST", path="/api/reconcile/sync", permission="manage_ebilling", json={}),

    # -- e-billing --
    dict(method="GET", path="/api/e-billing/status", permission="manage_ebilling"),
    dict(method="POST", path="/api/e-billing/sync", permission="manage_ebilling", json={}),
    dict(method="POST", path="/api/e-billing/sync/async", permission="manage_ebilling", json={}),
    dict(method="GET", path="/api/e-billing/task/{task_id}", permission="manage_ebilling",
         path_params={"task_id": rid()}),
    dict(method="POST", path="/api/e-billing/retry/{id}", permission="manage_ebilling",
         path_params={"id": rid()}),
    dict(method="GET", path="/api/e-billing/logs", permission="manage_ebilling"),
    dict(method="GET", path="/api/e-billing/pending", permission="manage_ebilling"),
    dict(method="POST", path="/api/e-billing/webhook", permission="public", json={}),
    dict(method="GET", path="/api/e-billing/reconcile", permission="manage_ebilling"),
    dict(method="GET", path="/api/e-billing/monitor", permission="manage_ebilling"),

    # -- admin --
    dict(method="GET", path="/api/admin/users", permission="manage_users"),
    dict(method="PATCH", path="/api/admin/users/{user_id}", permission="manage_users",
         path_params={"user_id": rid()}, json={"full_name": "Probe"}),
    dict(method="DELETE", path="/api/admin/users/{user_id}", permission="manage_users",
         path_params={"user_id": rid()}),

    # -- audit --
    dict(method="GET", path="/api/audit/logs", permission="view_audit"),
    dict(method="GET", path="/api/audit/logs/{log_id}", permission="view_audit",
         path_params={"log_id": rid()}),

    # -- graph / detective --
    dict(method="GET", path="/api/graph/network", permission="view_fraud_graph"),
    dict(method="GET", path="/api/graph/communities", permission="view_fraud_graph"),
    dict(method="GET", path="/api/graph/omc/{omc_id}", permission="view_fraud_graph",
         path_params={"omc_id": "PROBE_OMC"}),
    dict(method="GET", path="/api/detective/risk-features", permission="view_risk_analytics"),
    dict(method="GET", path="/api/detective/risk-features/{omc_id}", permission="view_risk_analytics",
         path_params={"omc_id": "PROBE_OMC"}),
    dict(method="GET", path="/api/detective/risk-features/export", permission="view_risk_analytics"),

    # -- health --
    dict(method="GET", path="/health", permission="public"),
]


def check_health():
    """Confirms the API is even reachable before attempting anything else."""
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=5)
        print(f"Health check: {resp.status_code} {resp.text[:200]}")
        return resp.status_code == 200
    except requests.RequestException as e:
        print(f"Health check FAILED: {e.__class__.__name__}: {e}")
        print(f"  -> Is the backend actually running and reachable at {BASE_URL}?")
        return False


def login(email, password, verbose=False):
    """Returns a bearer token, or None if login failed."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": password},  # server expects JSON, not OAuth2 form
            timeout=10,
        )
    except requests.RequestException as e:
        if verbose:
            print(f"  Login request FAILED to send: {e.__class__.__name__}: {e}")
        return None

    if resp.status_code == 200:
        body = resp.json()
        # API wraps responses in a {"Success", "Message", "Data", "Timestamp"}
        # envelope -- the token is nested under "Data", not top-level.
        data = body.get("Data", body)  # falls back to top-level if unwrapped
        token = data.get("access_token") if isinstance(data, dict) else None
        if not token and verbose:
            print(f"  Login returned 200 but no access_token found. Full body: {body}")
        return token

    if verbose:
        print(f"  Login failed for {email}: HTTP {resp.status_code}")
        print(f"  Response body: {resp.text[:500]}")
        print(f"  -> If this is 422, check the exact field names your login schema "
              f"expects (this script sends {{'email': ..., 'password': ...}}).")
        print(f"  -> If this is 401, the email/password is wrong, or seed_admin.py "
              f"created the admin with a different email/password than what you passed in.")
        print(f"  -> If this is 404, check the actual login path — it may not be "
              f"mounted at /api/auth/login (check main.py's include_router prefix).")
    return None


def ensure_test_users(admin_token):
    """Creates each throwaway test user via the admin account. Ignores
    'already exists' failures so this is safe to re-run."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    for role, user in TEST_USERS.items():
        resp = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": user["email"],
                "password": user["password"],
                "full_name": user["full_name"],
                "role_name": user["role_name"],
            },
            headers=headers,
            timeout=10,
        )
        if resp.status_code not in (200, 201, 400):
            print(f"  WARNING: unexpected status creating {role} test user: {resp.status_code} {resp.text[:200]}")


def get_tokens():
    """Logs in as bootstrapped admin, ensures test users exist, logs in as
    each role. Returns {role_name: token}. Exits with a clear error if the
    admin login itself fails, since nothing else can proceed without it."""
    if not check_health():
        print("FATAL: backend not reachable, aborting before attempting login.")
        sys.exit(1)

    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD, verbose=True)
    if not admin_token:
        print(f"\nFATAL: could not log in as admin ({ADMIN_EMAIL}). See diagnostics above.")
        sys.exit(1)

    ensure_test_users(admin_token)

    tokens = {}
    for role, user in TEST_USERS.items():
        token = login(user["email"], user["password"])
        if not token:
            print(f"  WARNING: could not log in as {role} test user ({user['email']}) — "
                  f"skipping this role in the test run.")
            continue
        tokens[role] = token
    return tokens


def build_url(path, path_params):
    if not path_params:
        return f"{BASE_URL}{path}"
    filled = path
    for key, value in path_params.items():
        filled = filled.replace("{" + key + "}", str(value))
    return f"{BASE_URL}{filled}"


def send_request(case, token):
    url = build_url(case["path"], case.get("path_params"))
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    kwargs = {"headers": headers, "timeout": 10}
    if "json" in case:
        kwargs["json"] = case["json"]
    if "files" in case:
        kwargs["files"] = case["files"]
    try:
        return requests.request(case["method"], url, **kwargs)
    except requests.RequestException as e:
        return e  # handled by caller as a failure


def expected_outcome(permission, actor):
    """Returns 'allow', 'deny_401', or 'deny_403' for this actor+permission."""
    if permission == "public":
        return "allow"
    if actor == "no_auth":
        return "deny_401"
    if permission == "any_auth":
        return "allow"
    return "allow" if permission in ROLE_PERMISSIONS.get(actor, set()) else "deny_403"


def check_pass(expected, status_code):
    if expected == "allow":
        return status_code not in (401, 403)
    if expected == "deny_401":
        return status_code == 401
    if expected == "deny_403":
        return status_code == 403
    return False


def run():
    print(f"Target: {BASE_URL}\n")
    print("Logging in as admin and preparing test users...")
    tokens = get_tokens()
    print(f"Ready. Logged in as: {', '.join(tokens.keys()) or '(none)'}\n")

    actors = ALL_ROLES + ["no_auth"]
    total = 0
    passed = 0
    failures = []

    for case in ENDPOINTS:
        for actor in actors:
            token = tokens.get(actor) if actor != "no_auth" else None
            if actor != "no_auth" and actor not in tokens:
                continue  # role login failed earlier, already warned

            total += 1
            resp = send_request(case, token)
            expected = expected_outcome(case["permission"], actor)

            if isinstance(resp, Exception):
                ok = False
                status_display = f"ERR({resp.__class__.__name__})"
            else:
                status_display = str(resp.status_code)
                ok = check_pass(expected, resp.status_code)

            mark = PASS_MARK if ok else FAIL_MARK
            if ok:
                passed += 1
            else:
                failures.append((case["method"], case["path"], actor, expected, status_display))

            print(f"{mark}  {case['method']:6s} {case['path']:45s} "
                  f"actor={actor:18s} expected={expected:10s} got={status_display}")

    print(f"\n{passed}/{total} checks passed.")
    if failures:
        print("\nFailures:")
        for method, path, actor, expected, got in failures:
            print(f"  {FAIL_MARK} {method} {path} — actor={actor}, expected={expected}, got={got}")
        sys.exit(1)


if __name__ == "__main__":
    run()