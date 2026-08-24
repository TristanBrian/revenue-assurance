#!/bin/bash
# run_tests.sh – Full test suite for FlowGuard
# Generates backend coverage (text + HTML) and frontend test output.

set -e

REPORT_DIR="test_reports"
mkdir -p "$REPORT_DIR"

echo "🧪 Running FlowGuard test suite..."
echo "========================================"

# 1. Backend tests with coverage (pytest)
echo "📦 Backend tests (pytest + coverage)..."
docker compose exec backend pytest tests/ \
    --cov=app.services \
    --cov=app.routes \
    --cov=app.core \
    --cov-report=term \
    --cov-report=html:"$REPORT_DIR/htmlcov_backend" \
    > "$REPORT_DIR/backend_coverage.txt" 2>&1

# Also print to console for immediate visibility
docker compose exec backend pytest tests/ \
    --cov=app.services \
    --cov=app.routes \
    --cov=app.core \
    --cov-report=term

echo "✅ Backend coverage saved to $REPORT_DIR/backend_coverage.txt"
echo "   HTML report: $REPORT_DIR/htmlcov_backend/index.html"

# 2. Frontend tests (Vitest)
echo "📦 Frontend tests (Vitest)..."
if command -v docker &> /dev/null && docker compose ps | grep -q frontend; then
    docker compose exec frontend npm test > "$REPORT_DIR/frontend_tests.txt" 2>&1
    docker compose exec frontend npm test
else
    npm --prefix frontend test > "$REPORT_DIR/frontend_tests.txt" 2>&1
    npm --prefix frontend test
fi

echo "✅ Frontend test output saved to $REPORT_DIR/frontend_tests.txt"

# 3. Optional: Lint checks (if you have linting)
# echo "🔍 Running lint checks..."
# docker compose exec backend flake8 app/
# docker compose exec frontend npm run lint

echo ""
echo "========================================"
echo "📊 All test reports are in the '$REPORT_DIR' folder."
echo "   - Backend coverage HTML: $REPORT_DIR/htmlcov_backend/index.html"
echo "   - Backend coverage text: $REPORT_DIR/backend_coverage.txt"
echo "   - Frontend test output: $REPORT_DIR/frontend_tests.txt"
echo ""
echo "✅ Tests completed."
