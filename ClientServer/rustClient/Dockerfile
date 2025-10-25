# FROM rust:1.90 AS builder
# WORKDIR /app
# COPY Cargo.toml Cargo.lock ./
# COPY src ./src
# RUN cargo build --release

# FROM debian:bookworm-slim
# WORKDIR /app
# COPY --from=builder /app/target/release/rustClient .
# CMD ["./rustClient"]


FROM rust:1.90 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --bin rust-client

FROM debian:bookworm-slim
WORKDIR /app

COPY --from=builder /app/target/release/rust-client .
CMD ["./rust-client"]
