# FROM rust:1.90 AS builder

# WORKDIR /app
# COPY Cargo.toml Cargo.lock ./
# COPY src ./src

# RUN cargo build --release || true
# FROM debian:bookworm-slim
# WORKDIR /app

# COPY --from=builder /app/target/release/rustServer .
# EXPOSE 8000
# CMD ["./rustServer"]

FROM rust:1.90 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --bin rust-server

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/rust-server .
EXPOSE 8000
CMD ["./rust-server"]
