# backend/app/routes/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import logging

from app.core.dependencies import get_current_user, get_db, require_permission
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.user import LoginRequest, LoginResponse, RegisterRequest, UserOut
from app.services.audit_service import log_action
from app.services.user_service import EmailAlreadyRegisteredError, RoleNotFoundError, register_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    try:
        user = register_user(
            db,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role_name=payload.role_name,
            actor_user_id=admin.id,
        )
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return user


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        user = db.query(User).filter(User.email == payload.email).first()
        if not user or not verify_password(payload.password, user.hashed_password):
            log_action(
                db,
                actor_user_id=None,
                action="auth.login_failure",
                target_type="user",
                metadata={"attempted_email": payload.email},
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not user.is_active:
            log_action(
                db,
                actor_user_id=None,
                action="auth.login_failure",
                target_type="user",
                target_id=str(user.id),
                metadata={"attempted_email": payload.email, "reason": "inactive"},
            )
            db.commit()
            raise HTTPException(status_code=403, detail="User is inactive")

        log_action(db, actor_user_id=user.id, action="auth.login_success", target_type="user", target_id=str(user.id))
        db.commit()

        token = create_access_token(subject=user.email)
        return {"access_token": token, "token_type": "bearer"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during login",
        )


@router.get("/me", response_model=UserOut)
def read_current_user(user: User = Depends(get_current_user)):
    return user