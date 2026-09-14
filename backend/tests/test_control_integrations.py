"""
Unit test suite for Autonomous Control Plane Actions & Enterprise Integration Architecture (Sections 4 & 5).
"""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


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
    data = response.json()
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
    data = response.json()
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
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["status"] == "SUBMITTED_TO_ICMS"
    assert data["tax_adjustment_kes"] > 0


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
    assert response.status_code == 200
    data = response.json()
    assert data["billable_demurrage_minutes"] == 45
    assert data["total_demurrage_kes"] == 1875.0
    assert data["status"] == "ISSUED_TO_SAP"


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
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "IDOC_PROCESSED_SUCCESS"
    assert data["total_value_kes"] == 4947000.0


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
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "TELEMETRY_RECORDED"
    assert data["metered_volume_l"] == 34000.0
