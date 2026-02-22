# Node Frontend Gateway

This is the Node.js frontend + gateway for your chat system.

## Features

- Login/signup with JWT auth (stored in HttpOnly cookie)
- PostgreSQL persistence for users, revoked JWTs, and durable messages
- Protected WebSocket bridge to interchangeable backends:
  - Java TCP
  - Rust TCP
  - Java RMI (through an RMI bridge)
  - Python gRPC
- Durable room history endpoint (`/api/rooms/:room/history`)
- In-app interoperability trace terminal

## Run

1. Start PostgreSQL and ensure credentials match `POSTGRES_CONNECTION_STRING`.
2. Start your chat TCP backend on `CHAT_TCP_HOST:CHAT_TCP_PORT` (e.g. `localhost:8000`).
3. Install deps and start:

```bash
cd ClientServer/node-frontend
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080).

`npm start` now does two things:
- starts Docker dependencies (`chat-postgres` + Java/Rust/JavaRMI/gRPC backend services)
- starts the Node frontend server

## Environment

Copy `.env.example` to `.env` and set values.

- `PORT`
- `CHAT_TCP_HOST`
- `CHAT_TCP_PORT`
- `CHAT_BACKENDS` (example: `java:tcp:localhost:8000,rust:tcp:localhost:8001,javarmi:tcp:localhost:8201,grpc:grpc:localhost:50051`)
- `POSTGRES_CONNECTION_STRING`
- `JWT_SECRET` (must be at least 32 chars)
- `JWT_ISSUER`
- `JWT_AUDIENCE`

## Render (single service, no extra backend hosts)

Use one Docker web service that starts:
- Node frontend (`PORT`)
- Java TCP backend (`8000`)
- Rust TCP backend (`8001`)
- Java RMI backend (`8101`) + bridge (`8201`)
- Python gRPC backend (`50051`)

Render setup:
1. Service type: `Web Service`
2. Environment: `Docker`
3. Root Directory: repo root (leave empty)
4. Dockerfile Path: `ClientServer/node-frontend/Dockerfile`
5. Add env vars:
   - `JWT_SECRET` (32+ chars)
   - `POSTGRES_CONNECTION_STRING` (or `DATABASE_URL`) from your Render Postgres
   - `NODE_ENV=production`
6. Deploy.

Notes:
- Do not set a Start Command; Docker `CMD` handles startup.
- `CHAT_BACKENDS` defaults to local in-container services, so no extra backend hosting is required.
