"""
Unit test suite for Autonomous Control Plane Actions & Enterprise Integration Architecture (Sections 4 & 5).
"""

import pytest
from types import SimpleNamespace
from app.core.dependencies import get_current_user
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

@pytest.fixture(autouse=True)
def authorized_operator():
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        roles=[SimpleNamespace(name="revenue_assurance")],
        has_permission=lambda code: code in {"view_metrics", "manage_ebilling", "upload_csv", "view_outgoing_data"},
    )
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)



def test_gate_lockout_check_pass():
    payload = {
        "dispatch_id": "DSP-8801",
        "truck_id": "KCF 892Y",
        "omc_name": "Petro Kenya",
        "metered_volume_l": 34000.0,
        "invoiced_volume_l": 34000.0,
        "allowed_evaporation_pct": 0.15,
    }
    response = client.post("/api/v1/control/lockout-check", json=payload)
    assert response.status_code == 200
    data = response.json()["Data"]
    assert data["simulation"] is True
    assert data["authoritative_gate_decision"] is False
    assert data["status"] == "PASS"
    assert data["lockout_triggered"] is False


def test_gate_lockout_check_hold():
    payload = {
        "dispatch_id": "DSP-8802",
        "truck_id": "KDD 104B",
        "omc_name": "Lake Oil",
        "metered_volume_l": 38500.0,
        "invoiced_volume_l": 32000.0,
        "allowed_evaporation_pct": 0.15,
    }
    response = client.post("/api/v1/control/lockout-check", json=payload)
    assert response.status_code == 200
    data = response.json()["Data"]
    assert data["status"] == "GATE_HOLD"
    assert data["lockout_triggered"] is True
    assert data["variance_l"] == 6500.0


def test_icms_adjustment_note():
    payload = {
        "dispatch_id": "DSP-8802",
        "anomaly_id": "ANM-0042",
        "kra_pin": "P051123456Z",
        "original_invoice_ref": "INV-2026-9901",
        "adjusted_volume_l": 6500.0,
        "unit_price_kes": 145.50,
        "note_type": "DEBIT_NOTE",
        "resolution_notes": "Volume discrepancy resolved after meter recalibration.",
    }
    response = client.post("/api/v1/control/icms-adjustment-note", json=payload)
    assert response.status_code == 501
    assert response.json().get("Data") is None


def test_demurrage_invoice():
    payload = {
        "truck_id": "KDD 104B",
        "omc_name": "Lake Oil",
        "depot_id": "NBO-01",
        "gantry_lane": 2,
        "entry_time": "2026-09-14T10:00:00Z",
        "exit_time": "2026-09-14T11:30:00Z",
        "dwell_time_minutes": 90,
        "free_time_sla_minutes": 45,
        "demurrage_rate_per_hour_kes": 2500.0,
    }
    response = client.post("/api/v1/control/demurrage-invoice", json=payload)
    assert response.status_code == 501
    assert response.json().get("Data") is None


def test_sap_idoc_integration():
    payload = {
        "sap_idoc_num": "0000000098412354",
        "document_type": "INVOICE",
        "omc_code": "OMC-004",
        "omc_name": "Petro Kenya",
        "posting_date": "2026-09-14",
        "items": [
            {
                "item_no": 10,
                "material_code": "AGO-01",
                "description": "Automotive Gas Oil",
                "volume_litres": 34000.0,
                "unit_price_kes": 145.50,
            }
        ],
    }
    response = client.post("/api/v1/integrations/sap/idoc", json=payload)
    assert response.status_code == 501
    assert response.json().get("Data") is None


def test_scada_meter_pulse():
    payload = {
        "depot_id": "Mombasa Depot",
        "gantry_lane": 1,
        "meter_id": "FLM-MSA-001",
        "truck_id": "KCF 892Y",
        "flow_rate_lpm": 1200.0,
        "accumulated_volume_l": 34000.0,
        "pulse_count": 3400000,
        "sensor_status": "NORMAL",
    }
    response = client.post("/api/v1/integrations/scada/meter-pulse", json=payload)
    assert response.status_code == 501
    assert response.json().get("Data") is None


@pytest.mark.parametrize("field,value", [("metered_volume_l", -1), ("invoiced_volume_l", 0), ("invoiced_volume_l", -1), ("allowed_evaporation_pct", -1), ("allowed_evaporation_pct", 101)])
def test_lockout_rejects_invalid_input(field, value):
    payload = {"dispatch_id": "DSP-1", "truck_id": "DEMO", "omc_name": "Demo", "metered_volume_l": 100, "invoiced_volume_l": 100, "allowed_evaporation_pct": 0}
    payload[field] = value
    assert client.post("/api/v1/control/lockout-check", json=payload).status_code == 422
