from setuptools import setup, find_packages

setup(
    name="flowguard",
    version="2.0.0",
    description="KPC Revenue Assurance + Inuka Governance (Hackathon 2)",
    author="Null Terminators",
    packages=find_packages(where="backend"),
    package_dir={"": "backend"},
    install_requires=[
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.30.0",
        "pandas>=2.2.0",
        "numpy>=1.26.0",
        "sqlalchemy>=2.0.0",
        "alembic>=1.18.0",
        "psycopg2-binary>=2.9.0",
        "pydantic>=2.5.0",
        "python-jose[cryptography]>=3.3.0",
        "passlib[bcrypt]>=1.7.4",
        "python-dotenv>=1.0.0",
        "openpyxl>=3.1.0",
        "networkx>=3.0",
        "python-louvain>=0.16",
        "requests>=2.31.0",
        "httpx>=0.27.0",
    ],
    python_requires=">=3.11",
)
