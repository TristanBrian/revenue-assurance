"""Exercise real route dependencies: unauthorized requests must stop before service IO."""
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.dependencies import get_current_user, get_db
from app.routes import inuka, control, integrations
from app.routes.reconciliation import reconcile
from app.routes.fraud import graph, detective
from app.routes.feed import feed
from app.routes.ebilling import e_billing

@pytest.fixture
def scoped_client():
    app = FastAPI()
    for router in [feed.router, inuka.router, reconcile.router, graph.router, detective.router, e_billing.router, control.router, integrations.router]:
        app.include_router(router, prefix="/test")
    app.dependency_overrides[get_db] = lambda: None
    def make(role, permissions):
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(roles=[SimpleNamespace(name=role)], has_permission=lambda code: code in permissions)
        return TestClient(app)
    return make

@pytest.mark.parametrize("path", ["/feed", "/reconcile/trend", "/reconcile/gantry-lanes", "/reconcile/depot-risk", "/reconcile/omc-depot-map", "/network", "/communities", "/omc/OMC-1", "/risk-features", "/e-billing/status"])
def test_inuka_cannot_access_oil_even_with_feature_permission(scoped_client, path):
    client = scoped_client("inuka_manager", {"view_live_feed", "view_metrics", "view_heatmap", "view_fraud_graph", "view_risk_analytics", "manage_ebilling", "view_outgoing_data"})
    assert client.get("/test" + path).status_code == 403

@pytest.mark.parametrize("path", ["/cases/CASE-1/actions", "/reconcile/anomalies/DISP-1/actions?direction=outbound", "/stream/events"])
def test_viewer_cannot_mutate_cases_or_ingest(scoped_client, path):
    client = scoped_client("inuka_manager", {"view_anomaly_table", "view_outgoing_data"})
    assert client.post("/test" + path, json={"action": "acknowledge", "note": "review"}).status_code == 403

@pytest.mark.parametrize("path", ["/summary", "/pillars", "/officers", "/cases"])
def test_oil_only_custom_role_cannot_access_inuka(scoped_client, path):
    client = scoped_client("custom_oil_reader", {"view_metrics", "view_anomaly_table"})
    assert client.get("/test" + path).status_code == 403

@pytest.mark.parametrize("path", ["/api/v1/control/lockout-check", "/api/v1/control/demurrage-invoice", "/api/v1/control/icms-adjustment-note", "/api/v1/integrations/sap/idoc", "/api/v1/integrations/scada/meter-pulse"])
def test_autonomous_stubs_require_authentication(path):
    app = FastAPI(); app.include_router(control.router); app.include_router(integrations.router)
    app.dependency_overrides[get_db] = lambda: None
    assert TestClient(app).post(path, json={}).status_code == 401
