#!/usr/bin/env bash
set -euo pipefail

# Quantis - Phase 6 Full E2E & Integration Script (Spec §12)
echo "=========================================================="
echo "Starting Quantis Full Integration & E2E Validation"
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# 1. Clean down and prune old dev resources
echo "[1/4] Cleaning previous docker containers and dev volumes..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev down -v --remove-orphans || true

# Ensure host data dirs exist
mkdir -p data/raw data/compressed data/tmp data/snapshots

# 2. Start all containers with dev profile
echo "[2/4] Building and starting all containers (dev profile)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d --build

# 3. Wait for database and api-server health
echo "[3/4] Waiting for services to become healthy..."
TIMEOUT=90
ELAPSED=0
until docker compose ps | grep -q "vms-api-server" && curl -sf http://localhost:3000/healthz >/dev/null 2>&1; do
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
        echo "Error: Timed out waiting for api-server to become healthy."
        docker compose ps
        docker compose logs api-server
        exit 1
    fi
    echo "Waiting for services... (${ELAPSED}s / ${TIMEOUT}s)"
done
echo "All core services healthy and responding."

# 4. Run automated E2E gate verifier
echo "[4/4] Executing Phase 6 E2E Gate Verifier..."
if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
else
    NODE_CMD="node.exe"
fi
"${NODE_CMD}" scripts/e2e-verifier.mjs

echo "=========================================================="
echo "Phase 6 E2E Verification Complete!"
echo "=========================================================="

