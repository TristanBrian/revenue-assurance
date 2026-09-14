from contextlib import contextmanager
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
import app.main as main


@pytest.mark.parametrize("path", ["/health", "/api/health"])
def test_database_failure_returns_service_unavailable(monkeypatch, path):
    engine = Mock()
    engine.connect.side_effect = RuntimeError("private-connection-details")
    monkeypatch.setattr(main, "get_engine", lambda: engine)
    response = TestClient(main.app).get(path)
    assert response.status_code == 503
    assert "private-connection-details" not in response.text
    assert response.json()["Success"] == 0


def test_head_health_checks_database(monkeypatch):
    engine = Mock()
    engine.connect.side_effect = RuntimeError("unavailable")
    monkeypatch.setattr(main, "get_engine", lambda: engine)
    assert TestClient(main.app).head("/health").status_code == 503


def test_healthy_database_returns_success(monkeypatch):
    @contextmanager
    def connect():
        yield Mock()
    engine = Mock()
    engine.connect = connect
    monkeypatch.setattr(main, "get_engine", lambda: engine)
    response = TestClient(main.app).get("/health")
    assert response.status_code == 200
    assert response.json()["Data"]["database"] == "connected"
