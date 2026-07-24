from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.schemas.user import UpdateUserRequest, UserOut
from app.services.user_service import (
    CannotDeleteSelfError,
    EmailAlreadyRegisteredError,
    LastSystemAdminError,
    RoleNotFoundError,
    UserNotFoundError,
    delete_user,
    list_users,
    update_user,
)

router = APIRouter()  # prefix="/api/admin" and tags=["Admin"] are supplied by main.py's include_router()


@router.get("/users", response_model=list[UserOut])
def get_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("manage_users")),
):
    return list_users(db)


@router.patch("/users/{user_id}", response_model=UserOut)
def edit_user(
    user_id: str,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    try:
        return update_user(
            db,
            user_id=user_id,
            email=payload.email,
            full_name=payload.full_name,
            role_name=payload.role_name,
            password=payload.password,
            is_active=payload.is_active,
            actor_user_id=admin.id,
        )
    except UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/users/{user_id}")
def remove_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("manage_users")),
):
    try:
        delete_user(db, user_id=user_id, requesting_user_id=current_user.id)
    except UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    except CannotDeleteSelfError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
    except LastSystemAdminError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete the last system_admin")
    return {"status": "success", "message": "User deleted"}
