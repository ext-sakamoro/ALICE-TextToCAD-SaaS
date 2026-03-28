#!/usr/bin/env bash
set -euo pipefail

# Mac mini Text-to-CAD Worker 起動スクリプト
#
# Usage:
#   ./scripts/start-worker.sh                    # デフォルト (localhost:8000 LLM)
#   LLM_ENDPOINT=http://gpu:8000 ./scripts/start-worker.sh
#
# Prerequisites:
#   - LLM server running (llama.cpp / vLLM / Ollama)
#   - Rust toolchain installed

cd "$(dirname "$0")/../services/core-engine"

export LLM_ENDPOINT="${LLM_ENDPOINT:-http://localhost:8000}"
export WORKER_ADDR="${WORKER_ADDR:-0.0.0.0:8081}"
export OUTPUT_DIR="${OUTPUT_DIR:-/tmp/text-to-cad}"
export RUST_LOG="${RUST_LOG:-text_to_cad_worker=info,tower_http=info}"

echo "=== Text-to-CAD Worker ==="
echo "LLM:    ${LLM_ENDPOINT}"
echo "Listen: ${WORKER_ADDR}"
echo "Output: ${OUTPUT_DIR}"
echo ""

cargo run --release
