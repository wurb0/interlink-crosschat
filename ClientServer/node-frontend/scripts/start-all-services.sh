#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PIDS=()

start_proc() {
  local name="$1"
  shift
  echo "Starting ${name}"
  "$@" &
  PIDS+=("$!")
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local retries="${3:-40}"
  local i=0
  until bash -lc "exec 3<>/dev/tcp/${host}/${port}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$retries" ]; then
      echo "Timed out waiting for ${host}:${port}"
      return 1
    fi
    sleep 0.5
  done
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

export RMI_HOST="${RMI_HOST:-127.0.0.1}"
export RMI_PORT="${RMI_PORT:-8101}"
export BRIDGE_PORT="${BRIDGE_PORT:-8201}"
export RUST_SERVER_PORT="${RUST_SERVER_PORT:-8001}"

start_proc "java tcp backend" bash -lc "cd '$ROOT_DIR' && java server"
start_proc "rust tcp backend" bash -lc "cd '$ROOT_DIR' && ./rust-server"
start_proc "java rmi backend" bash -lc "cd '$ROOT_DIR/JavaRMI' && java server"

wait_for_port "127.0.0.1" "$RMI_PORT" 40
start_proc "java rmi bridge" bash -lc "cd '$ROOT_DIR/JavaRMI' && java rmi_bridge"
start_proc "python grpc backend" bash -lc "cd '$ROOT_DIR/pythonGRPC' && python3 server.py"

sleep 1
start_proc "node frontend" bash -lc "cd '$ROOT_DIR/node-frontend' && node server.js"

wait -n "${PIDS[@]}"
