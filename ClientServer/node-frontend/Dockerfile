FROM rust:1.90-bookworm AS rust-builder
WORKDIR /build/rustServer
COPY ClientServer/rustServer/Cargo.toml ClientServer/rustServer/Cargo.lock ./
COPY ClientServer/rustServer/src ./src
RUN cargo build --release --bin rust-server

FROM node:22-bookworm-slim
WORKDIR /app/ClientServer

RUN apt-get update && apt-get install -y --no-install-recommends \
  default-jdk \
  python3 \
  python3-venv \
  python3-pip \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY ClientServer/server.java ./
COPY ClientServer/JavaRMI ./JavaRMI
COPY ClientServer/pythonGRPC ./pythonGRPC
COPY ClientServer/node-frontend ./node-frontend

COPY --from=rust-builder /build/rustServer/target/release/rust-server /app/ClientServer/rust-server

RUN javac server.java
RUN cd JavaRMI && javac *.java
RUN python3 -m venv /opt/pyenv
RUN /opt/pyenv/bin/pip install --no-cache-dir grpcio grpcio-tools
RUN cd node-frontend && npm ci --omit=dev

ENV CHAT_BACKENDS=java:tcp:127.0.0.1:8000,rust:tcp:127.0.0.1:8001,javarmi:tcp:127.0.0.1:8201,grpc:grpc:127.0.0.1:50051
ENV RUST_SERVER_PORT=8001
ENV PYTHON_BIN=/opt/pyenv/bin/python
ENV JWT_ISSUER=nimbus-chat
ENV JWT_AUDIENCE=nimbus-chat-client

WORKDIR /app/ClientServer/node-frontend
CMD ["./scripts/start-all-services.sh"]
