import pytest
from types import SimpleNamespace
from fastapi import HTTPException

from app.core.dependencies import enforce_reconciliation_scope


def user(*roles):
    return SimpleNamespace(roles=[SimpleNamespace(name=role) for role in roles])


def test_inuka_manager_is_outbound_only():
    assert enforce_reconciliation_scope(user("inuka_manager"), "outbound") == "outbound"
    with pytest.raises(HTTPException) as error:
        enforce_reconciliation_scope(user("inuka_manager"), "inbound")
    assert error.value.status_code == 403


def test_depot_supervisor_is_inbound_only():
    assert enforce_reconciliation_scope(user("depot_supervisor"), "inbound") == "inbound"
    with pytest.raises(HTTPException) as error:
        enforce_reconciliation_scope(user("depot_supervisor"), "all")
    assert error.value.status_code == 403


@pytest.mark.parametrize("role", ["manager", "revenue_assurance"])
def test_dual_workspace_roles_can_select_either_direction(role):
    assert enforce_reconciliation_scope(user(role), "inbound") == "inbound"
    assert enforce_reconciliation_scope(user(role), "outbound") == "outbound"
    assert enforce_reconciliation_scope(user(role), "all") == "all"


def test_invalid_direction_is_rejected():
    with pytest.raises(HTTPException) as error:
        enforce_reconciliation_scope(user("manager"), "sideways")
    assert error.value.status_code == 400
