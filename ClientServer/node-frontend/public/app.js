let ws = null;
let connected = false;
let currentRoom = null;
let authMode = "login";
let authenticatedUsername = null;
let currentTheme = "dark";
let selectedBackend = "java";
let availableBackends = [];

const authView = document.getElementById("auth-view");
const chatView = document.getElementById("chat-view");
const themeToggleBtn = document.getElementById("theme-toggle");
const themeSwitchLabel = themeToggleBtn.querySelector(".switch-label");

const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const authForm = document.getElementById("auth-form");
const authUsernameInput = document.getElementById("auth-username");
const authPasswordInput = document.getElementById("auth-password");
const authSubmitBtn = document.getElementById("auth-submit");
const authMessage = document.getElementById("auth-message");

const activeUsername = document.getElementById("active-username");
const activeBackend = document.getElementById("active-backend");
const logoutBtn = document.getElementById("logout-btn");
const roomNameInput = document.getElementById("room-name");
const msgInput = document.getElementById("msg-input");
const backendSelect = document.getElementById("backend-select");
const switchBackendBtn = document.getElementById("switch-backend-btn");
const clearTraceBtn = document.getElementById("clear-trace-btn");

const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const listRoomsBtn = document.getElementById("list-rooms-btn");
const sendBtn = document.getElementById("send-btn");

const chatLog = document.getElementById("chat-log");
const roomsList = document.getElementById("rooms-list");
const currentRoomLabel = document.getElementById("current-room");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const interopLog = document.getElementById("interop-log");

init();

async function init() {
  initTheme();
  wireEvents();
  setConnected(false);
  setAuthMode("login");
  await loadBackends();
  await bootstrapSession();
}

function wireEvents() {
  themeToggleBtn.addEventListener("click", toggleTheme);
  tabLogin.addEventListener("click", () => setAuthMode("login"));
  tabSignup.addEventListener("click", () => setAuthMode("signup"));
  authForm.addEventListener("submit", submitAuth);

  logoutBtn.addEventListener("click", logout);
  switchBackendBtn.addEventListener("click", switchBackend);
  clearTraceBtn.addEventListener("click", () => {
    interopLog.textContent = "";
  });
  createRoomBtn.addEventListener("click", () => sendCommand("CREATEROOM", { room: roomNameInput.value.trim() }));
  joinRoomBtn.addEventListener("click", () => {
    const room = roomNameInput.value.trim();
    sendCommand("JOINROOM", { room });
    if (room) {
      currentRoom = room;
      renderCurrentRoom();
    }
  });
  listRoomsBtn.addEventListener("click", () => sendCommand("LISTROOMS"));
  sendBtn.addEventListener("click", sendMessage);
  msgInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem("chat_theme");
  if (savedTheme === "light") {
    applyTheme("light");
    return;
  }

  applyTheme("dark");
}

function toggleTheme() {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  currentTheme = theme === "light" ? "light" : "dark";

  if (currentTheme === "light") {
    document.body.setAttribute("data-theme", "light");
    themeToggleBtn.setAttribute("aria-pressed", "true");
    if (themeSwitchLabel) themeSwitchLabel.textContent = "Light";
  } else {
    document.body.removeAttribute("data-theme");
    themeToggleBtn.setAttribute("aria-pressed", "false");
    if (themeSwitchLabel) themeSwitchLabel.textContent = "Dark";
  }

  localStorage.setItem("chat_theme", currentTheme);
}

async function bootstrapSession() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const data = await res.json();

    if (data.authenticated && data.username) {
      enterChatView(data.username);
      connect();
      return;
    }
  } catch {
    //if this fails just show login
  }

  enterAuthView();
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";

  tabLogin.classList.toggle("active", isLogin);
  tabSignup.classList.toggle("active", !isLogin);
  authSubmitBtn.textContent = isLogin ? "Login" : "Create Account";
  authPasswordInput.setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
  authMessage.textContent = "";
}

async function submitAuth(event) {
  event.preventDefault();

  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;

  if (!username || !password) {
    setAuthMessage("Enter both username and password.", true);
    return;
  }

  const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      setAuthMessage(data.error || "Authentication failed.", true);
      return;
    }

    setAuthMessage("");
    authPasswordInput.value = "";
    enterChatView(data.username);
    connect();
  } catch {
    setAuthMessage("Server unavailable. Try again.", true);
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include"
    });
  } catch {
    //still logout on ui side
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  authenticatedUsername = null;
  currentRoom = null;
  renderCurrentRoom();
  enterAuthView();
}

function enterAuthView() {
  authView.classList.remove("hidden");
  authView.classList.add("visible");
  chatView.classList.add("hidden");
  chatView.classList.remove("visible");
}

function enterChatView(username) {
  authenticatedUsername = username;
  activeUsername.textContent = username;
  authView.classList.add("hidden");
  authView.classList.remove("visible");
  chatView.classList.remove("hidden");
  chatView.classList.add("visible");
  addLine(`Welcome ${username}.`);
}

function connect() {
  if (!authenticatedUsername) {
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}/ws?backend=${encodeURIComponent(selectedBackend)}`);

  ws.onopen = () => {
    setConnected(true);
    renderActiveBackend();
    addLine(`Connected to ${getSelectedBackendLabel()} backend.`);
    addTrace("meta", `ws open -> backend=${selectedBackend}`);
  };

  ws.onmessage = (event) => handleIncoming(event.data);

  ws.onerror = () => {
    addLine("WebSocket error.");
    addTrace("error", "ws error");
  };

  ws.onclose = () => {
    setConnected(false);
    addLine("Disconnected.");
    addTrace("meta", "ws closed");
  };
}

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) {
    return;
  }

  sendCommand("SENDMSG", { msg: text });
  msgInput.value = "";
}

function sendCommand(arg, options = {}) {
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    addLine("Socket is not connected.");
    return;
  }

  const payload = { arg };
  if (options.room) {
    payload.room = options.room;
  }
  if (options.msg) {
    payload.msg = options.msg;
  }

  addTrace("send", JSON.stringify(payload));
  ws.send(JSON.stringify(payload));
}

function handleIncoming(raw) {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    addLine(raw);
    return;
  }

  if (typeof data.message === "string") {
    addLine(data.message);
    if (data.message.startsWith("You joined ")) {
      const room = data.message.replace("You joined ", "").trim();
      if (room) {
        currentRoom = room;
        renderCurrentRoom();
        loadDurableHistory(room);
      }
    }
  }

  if (data.__trace) {
    handleTrace(data.__trace);
    return;
  }

  if (Array.isArray(data.history)) {
    addLine("--- History ---");
    data.history.forEach((line) => addLine(line));
    addLine("---------------");
  }

  if (Array.isArray(data.rooms)) {
    renderRooms(data.rooms);
  }
}

function renderRooms(rooms) {
  roomsList.innerHTML = "";

  if (rooms.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No rooms";
    roomsList.appendChild(li);
    return;
  }

  rooms.forEach((room) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "room-chip";
    btn.textContent = room;
    btn.addEventListener("click", () => {
      roomNameInput.value = room;
      sendCommand("JOINROOM", { room });
      currentRoom = room;
      renderCurrentRoom();
    });
    li.appendChild(btn);
    roomsList.appendChild(li);
  });
}

function addLine(text) {
  const div = document.createElement("div");
  div.className = "chat-line";
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setConnected(state) {
  connected = state;
  statusText.textContent = state ? "Connected" : "Disconnected";
  statusDot.classList.toggle("online", state);
  statusDot.classList.toggle("offline", !state);
  createRoomBtn.disabled = !state;
  joinRoomBtn.disabled = !state;
  listRoomsBtn.disabled = !state;
  sendBtn.disabled = !state;
  switchBackendBtn.disabled = !authenticatedUsername;
}

function renderCurrentRoom() {
  currentRoomLabel.textContent = currentRoom || "None";
}

function setAuthMessage(text, isError = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle("error", isError);
}

async function loadDurableHistory(room) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(room)}/history?backend=${encodeURIComponent(selectedBackend)}`, {
      credentials: "include"
    });

    if (!res.ok) {
      return;
    }

    const data = await res.json();
    if (!Array.isArray(data.history) || data.history.length === 0) {
      return;
    }

    addLine("--- Durable History ---");
    data.history.forEach((line) => addLine(line));
    addLine("-----------------------");
  } catch {
    //dont break chat if history call fails
  }
}

async function loadBackends() {
  const savedBackend = localStorage.getItem("chat_backend");
  try {
    const res = await fetch("/api/backends", { credentials: "include" });
    const data = await res.json();
    if (res.ok && Array.isArray(data.backends) && data.backends.length > 0) {
      availableBackends = data.backends;
      selectedBackend =
        data.backends.find((b) => b.id === savedBackend)?.id || data.backends[0].id;
      renderBackendOptions();
      return;
    }
  } catch {
    //use defaults below
  }

  availableBackends = [
    { id: "java", label: "Java", transport: "tcp" },
    { id: "rust", label: "Rust", transport: "tcp" },
    { id: "javarmi", label: "Java RMI", transport: "tcp" },
    { id: "grpc", label: "gRPC", transport: "grpc" }
  ];
  selectedBackend = availableBackends.find((b) => b.id === savedBackend)?.id || "java";
  renderBackendOptions();
}

function renderBackendOptions() {
  backendSelect.innerHTML = "";
  availableBackends.forEach((backend) => {
    const opt = document.createElement("option");
    opt.value = backend.id;
    const transport = backend.transport ? ` (${backend.transport})` : "";
    opt.textContent = `${backend.label || backend.id}${transport}`;
    backendSelect.appendChild(opt);
  });
  backendSelect.value = selectedBackend;
  localStorage.setItem("chat_backend", selectedBackend);
  renderActiveBackend();
}

function renderActiveBackend() {
  activeBackend.textContent = getSelectedBackendLabelWithTransport();
}

function getSelectedBackendLabel() {
  const backend = availableBackends.find((b) => b.id === selectedBackend);
  return backend?.label || selectedBackend;
}

function getSelectedBackendLabelWithTransport() {
  const backend = availableBackends.find((b) => b.id === selectedBackend);
  if (!backend) {
    return selectedBackend;
  }
  return backend.transport ? `${backend.label} (${backend.transport})` : backend.label;
}

function switchBackend() {
  const next = backendSelect.value;
  if (!next || next === selectedBackend) {
    return;
  }

  selectedBackend = next;
  localStorage.setItem("chat_backend", selectedBackend);
  renderActiveBackend();
  addLine(`Switched backend to ${getSelectedBackendLabel()}.`);
  addTrace("meta", `backend switched -> ${selectedBackend}`);

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
  }

  currentRoom = null;
  renderCurrentRoom();
  connect();
}

function handleTrace(trace) {
  const ts = trace.ts ? new Date(trace.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
  const direction = trace.direction || "trace";
  const backend = trace.backend || selectedBackend;
  const transport = trace.transport || "";
  const protocol = trace.protocol || "";
  const payload = trace.payload ? JSON.stringify(trace.payload) : "";
  addTrace(direction, `[${backend}/${transport}] ${protocol} ${payload}`, ts);
}

function addTrace(level, line, ts = null) {
  const stamp = ts || new Date().toLocaleTimeString();
  interopLog.textContent += `[${stamp}] ${level.toUpperCase()} ${line}\n`;
  interopLog.scrollTop = interopLog.scrollHeight;
}
