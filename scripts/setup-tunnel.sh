#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Tunnel: Mac mini (Worker) → VPS (API Gateway)
#
# Prerequisites:
#   brew install cloudflared
#   cloudflared tunnel login
#
# Usage:
#   ./scripts/setup-tunnel.sh              # Create tunnel + run
#   ./scripts/setup-tunnel.sh --run-only   # Run existing tunnel

TUNNEL_NAME="text-to-cad-worker"
WORKER_PORT="${WORKER_PORT:-8081}"
HOSTNAME="${TUNNEL_HOSTNAME:-cad-worker.alicelaw.net}"

if [[ "${1:-}" == "--run-only" ]]; then
    echo "Starting tunnel: ${TUNNEL_NAME} → localhost:${WORKER_PORT}"
    cloudflared tunnel run "${TUNNEL_NAME}"
    exit 0
fi

echo "=== Text-to-CAD Cloudflare Tunnel Setup ==="
echo ""
echo "Worker port: ${WORKER_PORT}"
echo "Hostname:    ${HOSTNAME}"
echo ""

# Create tunnel
if cloudflared tunnel list | grep -q "${TUNNEL_NAME}"; then
    echo "Tunnel '${TUNNEL_NAME}' already exists."
else
    echo "Creating tunnel '${TUNNEL_NAME}'..."
    cloudflared tunnel create "${TUNNEL_NAME}"
fi

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list --output json | python3 -c "
import json, sys
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '${TUNNEL_NAME}':
        print(t['id'])
        break
")

echo "Tunnel ID: ${TUNNEL_ID}"

# Configure routing
CONFIG_DIR="${HOME}/.cloudflared"
CONFIG_FILE="${CONFIG_DIR}/config-text-to-cad.yml"

cat > "${CONFIG_FILE}" << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CONFIG_DIR}/${TUNNEL_ID}.json

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${WORKER_PORT}
  - service: http_status:404
EOF

echo "Config written to: ${CONFIG_FILE}"

# DNS routing
echo "Setting up DNS route: ${HOSTNAME} → tunnel"
cloudflared tunnel route dns "${TUNNEL_NAME}" "${HOSTNAME}" 2>/dev/null || echo "DNS route may already exist"

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start the tunnel:"
echo "  cloudflared tunnel --config ${CONFIG_FILE} run"
echo ""
echo "To start worker + tunnel together:"
echo "  cd services/core-engine"
echo "  LLM_ENDPOINT=http://localhost:8000 cargo run --release &"
echo "  cloudflared tunnel --config ${CONFIG_FILE} run"
echo ""
echo "VPS API Gateway config:"
echo "  CORE_ENGINE_URL=https://${HOSTNAME}"
