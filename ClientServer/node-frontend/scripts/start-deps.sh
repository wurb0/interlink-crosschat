#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! docker ps -a --format '{{.Names}}' | grep -Eq '^chat-postgres$'; then
  echo "Creating postgres container: chat-postgres"
  docker run --name chat-postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=chatapp \
    -p 5432:5432 \
    -d postgres:16 >/dev/null
else
  echo "Starting postgres container: chat-postgres"
  docker start chat-postgres >/dev/null || true
fi

echo "Starting docker interoperability services (java, rust, javarmi, grpc)"
cd "$PROJECT_ROOT"
docker compose up -d --build server rust-server javarmi-server rmi-bridge grpc-server

echo "Dependencies ready: postgres + all language backends"
