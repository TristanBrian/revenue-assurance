from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.user import LoginResponse, RegisterRequest, UserOut
from app.services.user_service import EmailAlreadyRegisteredError, RoleNotFoundError, register_user

router = APIRouter()  # prefix="/api/auth" and tags=["Auth"] are supplied by main.py's include_router(), matching every other route file


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """
    Minimal registration endpoint — currently open (no auth required).

    Bootstrapping note: the very first system_admin has to be created through
    this open endpoint (or seeded directly in the DB), since there's no admin
    yet to gate it behind. Once that first system_admin exists, swap this to
    require Depends(require_permission("manage_users")) so only system_admin
    can create/assign users afterward. Flagging rather than doing it now since
    it changes your bootstrap flow — let me know if you want that swap made.
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
