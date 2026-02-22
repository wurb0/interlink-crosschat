import "dotenv/config";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import cookie from "cookie";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import { WebSocketServer } from "ws";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const CHAT_TCP_HOST = process.env.CHAT_TCP_HOST || "localhost";
const CHAT_TCP_PORT = Number(process.env.CHAT_TCP_PORT || 8000);
const CHAT_BACKENDS = parseBackendTargets(
  process.env.CHAT_BACKENDS ||
    `java:tcp:${CHAT_TCP_HOST}:${CHAT_TCP_PORT},rust:tcp:${CHAT_TCP_HOST}:8001,javarmi:tcp:${CHAT_TCP_HOST}:8201,grpc:grpc:${CHAT_TCP_HOST}:50051`
);
const POSTGRES_CONNECTION_STRING = pickPgConnectionString();
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-with-a-long-random-secret-for-production";
const JWT_ISSUER = process.env.JWT_ISSUER || "nimbus-chat";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "nimbus-chat-client";
const COOKIE_NAME = "chat_auth";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters.");
}

const pool = new pg.Pool(createPgConfig(POSTGRES_CONNECTION_STRING));
await ensureSchema();
console.log(`Postgres target: ${describePgTarget(POSTGRES_CONNECTION_STRING)}`);

const grpcProtoPath = path.resolve(__dirname, "../pythonGRPC/chat.proto");
const grpcPackageDefinition = protoLoader.loadSync(grpcProtoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const grpcPackage = grpc.loadPackageDefinition(grpcPackageDefinition);
const GrpcChatService = grpcPackage.chat.ChatService;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/backends", (_req, res) => {
  return res.json({
    backends: Object.values(CHAT_BACKENDS).map((b) => ({
      id: b.id,
      label: b.label,
      transport: b.transport,
      host: b.host,
      port: b.port
    }))
  });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!username || username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: "Username must be 3-24 characters." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const insert = await pool.query(
      `
        insert into users (username, password_hash)
        values ($1, $2)
        on conflict do nothing
        returning username
      `,
      [username, passwordHash]
    );

    if (insert.rowCount === 0) {
      return res.status(400).json({ error: "Username already exists." });
    }

    const token = createJwt(insert.rows[0].username);
    setAuthCookie(res, token);
    return res.json({ username: insert.rows[0].username });
  } catch (err) {
    console.error("signup error", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const result = await pool.query(
      `
        select username, password_hash
        from users
        where lower(username) = lower($1)
      `,
      [username]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const token = createJwt(user.username);
    setAuthCookie(res, token);
    return res.json({ username: user.username });
  } catch (err) {
    console.error("login error", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      const claims = validateJwt(token);
      if (claims?.jti && claims?.exp) {
        await pool.query(
          `
            insert into revoked_tokens (jti, expires_at)
            values ($1, to_timestamp($2))
            on conflict (jti) do nothing
          `,
          [claims.jti, claims.exp]
        );
        await pool.query("delete from revoked_tokens where expires_at <= now()");
      }
    }
  } catch (err) {
    console.error("logout error", err);
  }

  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return res.json({ authenticated: false });
    }

    return res.json({ authenticated: true, username: auth.username });
  } catch (err) {
    console.error("me error", err);
    return res.json({ authenticated: false });
  }
});

app.get("/api/rooms/:room/history", async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const backendId = String(req.query.backend || "java").toLowerCase();
    const backend = CHAT_BACKENDS[backendId] || CHAT_BACKENDS.java || Object.values(CHAT_BACKENDS)[0];
    if (!backend) {
      return res.status(400).json({ error: "Unknown backend." });
    }

    const roomName = String(req.params.room || "").trim();
    if (!roomName) {
      return res.status(400).json({ error: "Invalid room." });
    }

    const rows = await pool.query(
      `
        select username, body, created_at
        from messages
        where room_name = $1 and backend = $2
        order by created_at desc
        limit 100
      `,
      [roomName, backend.id]
    );

    const history = rows.rows
      .map((r) => `${new Date(r.created_at).toISOString()} | ${r.username}: ${r.body}`)
      .reverse();

    return res.json({ history });
  } catch (err) {
    console.error("history error", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  const reqUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
  if (reqUrl.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  try {
    const auth = await authenticateUpgradeRequest(request);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const backendId = String(reqUrl.searchParams.get("backend") || "java").toLowerCase();
    const backend = CHAT_BACKENDS[backendId] || CHAT_BACKENDS.java || Object.values(CHAT_BACKENDS)[0];
    if (!backend) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.auth = auth;
      ws.backend = backend;
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    console.error("upgrade auth error", err);
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  const username = ws.auth.username;
  const backend = ws.backend;

  const session = {
    ws,
    username,
    backend,
    currentRoom: null,
    tcp: null,
    grpcClient: null,
    grpcJoinCall: null
  };

  trace(session, "meta", "session", { message: `WebSocket connected using ${backend.label} (${backend.transport})` });

  if (backend.transport === "grpc") {
    session.grpcClient = new GrpcChatService(
      `${backend.host}:${backend.port}`,
      grpc.credentials.createInsecure()
    );
  } else {
    const tcp = net.createConnection({ host: backend.host, port: backend.port });
    session.tcp = tcp;

    tcp.on("connect", () => {
      sendWs(session.ws, {
        message: `Connected to ${backend.label} backend (${backend.host}:${backend.port})`
      });
      trace(session, "backend", "connect", { host: backend.host, port: backend.port });
    });

    tcp.on("error", (err) => {
      sendWs(session.ws, {
        message: `Failed to connect to ${backend.label} backend (${backend.host}:${backend.port}): ${err.message}`
      });
      trace(session, "backend", "error", { error: err.message });
      session.ws.close();
    });

    let tcpBuffer = "";
    tcp.on("data", (chunk) => {
      tcpBuffer += chunk.toString("utf8");
      let idx = tcpBuffer.indexOf("\n");
      while (idx !== -1) {
        const line = tcpBuffer.slice(0, idx).trim();
        tcpBuffer = tcpBuffer.slice(idx + 1);
        if (line && session.ws.readyState === 1) {
          trace(session, "recv", backend.transport, { raw: line });
          session.ws.send(line);
        }
        idx = tcpBuffer.indexOf("\n");
      }
    });

    tcp.on("close", () => {
      trace(session, "backend", "close", { message: "Backend connection closed" });
      if (session.ws.readyState === 1) {
        session.ws.close();
      }
    });
  }

  ws.on("message", async (raw) => {
    try {
      const text = raw.toString("utf8").trim();
      if (!text) return;

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== "object") return;
      const command = String(parsed.arg || "").trim().toUpperCase();
      if (!command) return;

      trace(session, "send", backend.transport, { command, payload: parsed });

      if (backend.transport === "grpc") {
        await handleGrpcCommand(session, command, parsed);
      } else {
        await handleTcpCommand(session, command, parsed);
      }
    } catch (err) {
      console.error("ws message error", err);
      trace(session, "gateway", "error", { error: err.message || String(err) });
    }
  });

  ws.on("close", () => {
    if (session.grpcJoinCall) {
      session.grpcJoinCall.cancel();
      session.grpcJoinCall = null;
    }
    if (session.tcp) {
      session.tcp.destroy();
      session.tcp = null;
    }
    trace(session, "meta", "session", { message: "WebSocket closed" });
  });

  ws.on("error", () => {
    if (session.grpcJoinCall) {
      session.grpcJoinCall.cancel();
      session.grpcJoinCall = null;
    }
    if (session.tcp) {
      session.tcp.destroy();
      session.tcp = null;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Node frontend listening on http://0.0.0.0:${PORT}`);
  console.log(
    `Backends available: ${Object.values(CHAT_BACKENDS)
      .map((b) => `${b.id}:${b.transport}=${b.host}:${b.port}`)
      .join(", ")}`
  );
});

async function handleTcpCommand(session, command, parsed) {
  const { username, tcp, backend } = session;
  if (!tcp) {
    sendWs(session.ws, { message: "No backend connection." });
    return;
  }

  const outbound = {
    username,
    arg: command
  };

  if (typeof parsed.room === "string" && parsed.room.trim()) {
    outbound.room = parsed.room.trim();
    if (command === "JOINROOM") {
      session.currentRoom = outbound.room;
    }
  }

  if (typeof parsed.msg === "string" && parsed.msg.trim()) {
    outbound.msg = parsed.msg;
  }

  const line = `${JSON.stringify(outbound)}\n`;
  tcp.write(line);

  if (command === "SENDMSG" && outbound.msg && session.currentRoom) {
    await insertMessage(session.currentRoom, username, outbound.msg, backend.id);
  }
}

async function handleGrpcCommand(session, command, parsed) {
  const client = session.grpcClient;
  if (!client) {
    sendWs(session.ws, { message: "gRPC client unavailable." });
    return;
  }

  const room = typeof parsed.room === "string" ? parsed.room.trim() : "";
  const msg = typeof parsed.msg === "string" ? parsed.msg : "";

  if (command === "CREATEROOM") {
    if (!room) {
      sendWs(session.ws, { message: "Room name required." });
      return;
    }

    client.createRoom({ roomName: room }, (err, resp) => {
      if (err) {
        sendWs(session.ws, { message: `gRPC error: ${err.message}` });
        trace(session, "grpc", "createRoom:error", { error: err.message });
        return;
      }
      sendWs(session.ws, { message: resp.success || resp.error || "CreateRoom done." });
      trace(session, "grpc", "createRoom:ok", { room });
    });
    return;
  }

  if (command === "LISTROOMS") {
    client.listRooms({}, (err, resp) => {
      if (err) {
        sendWs(session.ws, { message: `gRPC error: ${err.message}` });
        trace(session, "grpc", "listRooms:error", { error: err.message });
        return;
      }
      sendWs(session.ws, { rooms: resp.rooms || [] });
      trace(session, "grpc", "listRooms:ok", { rooms: resp.rooms || [] });
    });
    return;
  }

  if (command === "JOINROOM") {
    if (!room) {
      sendWs(session.ws, { message: "Room name required." });
      return;
    }

    if (session.grpcJoinCall) {
      session.grpcJoinCall.cancel();
      session.grpcJoinCall = null;
    }

    session.currentRoom = room;
    sendWs(session.ws, { message: `You joined ${room}` });

    const call = client.joinRoom({ roomName: room, username: session.username });
    session.grpcJoinCall = call;

    call.on("data", (streamMsg) => {
      const m = streamMsg?.msg;
      if (!m) return;

      const text = `${m.username}: ${m.msg}`;
      sendWs(session.ws, { message: text });
      trace(session, "grpc", "stream:data", {
        roomName: m.roomName,
        username: m.username,
        msg: m.msg
      });
    });

    call.on("error", (err) => {
      sendWs(session.ws, { message: `gRPC stream error: ${err.message}` });
      trace(session, "grpc", "stream:error", { error: err.message });
    });

    call.on("end", () => {
      trace(session, "grpc", "stream:end", { room });
    });

    trace(session, "grpc", "joinRoom:ok", { room });
    return;
  }

  if (command === "SENDMSG") {
    if (!session.currentRoom) {
      sendWs(session.ws, { message: "Join a room first!" });
      return;
    }

    if (!msg.trim()) {
      return;
    }

    client.sendMsg(
      {
        roomName: session.currentRoom,
        username: session.username,
        msg
      },
      async (err, resp) => {
        if (err) {
          sendWs(session.ws, { message: `gRPC error: ${err.message}` });
          trace(session, "grpc", "sendMsg:error", { error: err.message });
          return;
        }

        if (resp?.error) {
          sendWs(session.ws, { message: resp.error });
          return;
        }

        await insertMessage(session.currentRoom, session.username, msg, session.backend.id);
        trace(session, "grpc", "sendMsg:ok", { room: session.currentRoom });
      }
    );
    return;
  }

  sendWs(session.ws, { message: `Unknown command: ${command}` });
}

async function insertMessage(roomName, username, body, backendId) {
  await pool.query(`insert into messages (room_name, username, body, backend) values ($1, $2, $3, $4)`, [
    roomName,
    username,
    body,
    backendId
  ]);
}

function trace(session, direction, protocol, payload) {
  sendWs(session.ws, {
    __trace: {
      ts: new Date().toISOString(),
      backend: session.backend.id,
      transport: session.backend.transport,
      direction,
      protocol,
      payload
    }
  });
}

function sendWs(ws, obj) {
  if (!ws || ws.readyState !== 1) {
    return;
  }

  try {
    ws.send(JSON.stringify(obj));
  } catch {
    //socket might already be closed
  }
}

function normalizeUsername(input) {
  const username = String(input || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    return null;
  }
  return username;
}

function createJwt(username) {
  return jwt.sign(
    {
      sub: username
    },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: TOKEN_TTL_SECONDS,
      jwtid: randomUUID()
    }
  );
}

function validateJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/"
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

async function authenticateRequest(req) {
  const token = req.cookies?.[COOKIE_NAME];
  return authenticateToken(token);
}

async function authenticateUpgradeRequest(request) {
  const parsed = cookie.parse(request.headers.cookie || "");
  const token = parsed[COOKIE_NAME];
  return authenticateToken(token);
}

async function authenticateToken(token) {
  if (!token) {
    return null;
  }

  const claims = validateJwt(token);
  if (!claims?.sub || !claims?.jti) {
    return null;
  }

  const revoked = await pool.query(
    `select exists(select 1 from revoked_tokens where jti = $1 and expires_at > now()) as revoked`,
    [claims.jti]
  );

  if (revoked.rows[0]?.revoked) {
    return null;
  }

  return {
    username: claims.sub,
    jti: claims.jti
  };
}

async function ensureSchema() {
  await pool.query(`
    create table if not exists users (
      id bigserial primary key,
      username text not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create unique index if not exists uq_users_username_lower on users (lower(username));

    create table if not exists revoked_tokens (
      jti text primary key,
      expires_at timestamptz not null
    );

    create table if not exists messages (
      id bigserial primary key,
      room_name text not null,
      username text not null,
      body text not null,
      backend text not null default 'java',
      created_at timestamptz not null default now()
    );

    alter table messages add column if not exists backend text not null default 'java';

    create index if not exists idx_messages_room_created_at on messages (room_name, created_at desc);
    create index if not exists idx_messages_room_backend_created_at on messages (room_name, backend, created_at desc);
    create index if not exists idx_revoked_tokens_expires_at on revoked_tokens (expires_at);

    delete from revoked_tokens where expires_at <= now();
  `);
}

function createPgConfig(raw) {
  const value = sanitizeConnString(raw);
  if (!value) {
    throw new Error(
      "Postgres connection string is missing. Set POSTGRES_CONNECTION_STRING or DATABASE_URL."
    );
  }

  if (value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    return { connectionString: value };
  }

  const map = Object.create(null);
  for (const pair of value.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const val = trimmed.slice(idx + 1).trim();
    map[key] = val;
  }

  return {
    host: map.host || "localhost",
    port: Number(map.port || 5432),
    database: map.database || map.db || "chatapp",
    user: map.username || map.user || "postgres",
    password: map.password || ""
  };
}

function pickPgConnectionString() {
  const direct = sanitizeConnString(process.env.POSTGRES_CONNECTION_STRING);
  if (direct) {
    return direct;
  }

  const renderDbUrl = sanitizeConnString(process.env.DATABASE_URL);
  if (renderDbUrl) {
    return renderDbUrl;
  }

  return "";
}

function sanitizeConnString(raw) {
  let value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

function describePgTarget(raw) {
  const cfg = createPgConfig(raw);
  if (cfg.connectionString) {
    try {
      const u = new URL(cfg.connectionString);
      return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
    } catch {
      return "invalid connection string";
    }
  }

  return `${cfg.host}:${cfg.port}/${cfg.database}`;
}

function parseBackendTargets(raw) {
  const out = {};
  const text = String(raw || "").trim();
  if (!text) return out;

  for (const item of text.split(",")) {
    const part = item.trim();
    if (!part) continue;

    const pieces = part.split(":").map((x) => x.trim());
    let id = "";
    let transport = "tcp";
    let host = "";
    let port = 0;

    if (pieces.length === 4) {
      [id, transport, host] = pieces;
      port = Number(pieces[3]);
    } else if (pieces.length === 3) {
      [id, host] = pieces;
      port = Number(pieces[2]);
    } else {
      continue;
    }

    id = id.toLowerCase();
    transport = (transport || "tcp").toLowerCase();
    if (!id || !host || Number.isNaN(port) || port <= 0) continue;

    out[id] = {
      id,
      label: displayLabel(id),
      transport,
      host,
      port
    };
  }

  return out;
}

function displayLabel(id) {
  if (id === "javarmi") return "Java RMI";
  if (id === "grpc") return "gRPC";
  return id.charAt(0).toUpperCase() + id.slice(1);
}
