from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_permission
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.user import LoginResponse, RegisterRequest, UserOut
from app.services.user_service import EmailAlreadyRegisteredError, RoleNotFoundError, register_user

router = APIRouter()  # prefix="/api/auth" and tags=["Auth"] are supplied by main.py's include_router(), matching every other route file


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("manage_users")),
):
    """
    Creates a new user and assigns a role. Requires the caller to already
    hold manage_users (i.e. be a system_admin) — the very first
    system_admin is created via scripts/seed_admin.py instead, which
    writes directly to the DB and bypasses this endpoint entirely, since
    nothing exists yet to grant manage_users to anyone at that point.
    """
    try:
        user = register_user(
            db,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role_name=payload.role_name,
        )
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return user


@router.post("/login", response_model=LoginResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2 password flow: form fields are 'username' (=email) and 'password'."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def read_current_user(user: User = Depends(get_current_user)):
    return user
