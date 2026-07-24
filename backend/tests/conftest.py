import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.utils.db_connection import Base
from app.main import app
from fastapi.testclient import TestClient
import uuid

TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(scope="function")
def db_session():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.rollback()
    session.close()
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client():
    return TestClient(app)

@pytest.fixture(scope="function")
def test_engine():
    return create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})

# Authenticated client fixture - uses only valid User fields
@pytest.fixture(scope="function")
def auth_client(db_session):
    from app.models.user import User
    import bcrypt
    # Create a test user (using only valid fields)
    password_hash = bcrypt.hashpw(b"testpass", bcrypt.gensalt()).decode('utf-8')
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        hashed_password=password_hash,
        is_active=True,
        # is_superuser removed – use 'role' if needed, but we'll skip it
    )
    db_session.add(user)
    db_session.commit()
    
    client = TestClient(app)
    response = client.post("/api/auth/login", json={
        "email": "test@example.com",
        "password": "testpass"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json()["Data"]["access_token"]
    client.headers = {"Authorization": f"Bearer {token}"}
    return client
