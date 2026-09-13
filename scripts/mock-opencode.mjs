#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];

if (args.includes("--version") || command === "version") {
  process.stdout.write("1.17.20-mock\n");
  process.exit(0);
}

if (command === "serve") {
  const port = Number(option("--port") ?? 4096);
  const statePath = process.env.ARGOS_MOCK_STATE ?? path.resolve("mock-opencode-state.json");
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const state = readState(statePath);
    if (request.method === "GET" && url.pathname === "/global/health") return json(response, 200, { healthy: true, version: "1.17.20-mock" });
    if (request.method === "GET" && url.pathname === "/session") return json(response, 200, Object.values(state.sessions).map((session) => session.info));
    if (request.method === "GET" && url.pathname === "/session/status") {
      return json(response, 200, Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [id, { type: session.status }])));
    }
    if (request.method === "POST" && url.pathname === "/mock/run") {
      const body = await requestBody(request);
      const id = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `ses_mock_${String(state.nextId++).padStart(4, "0")}`;
      const now = Date.now();
      const session = state.sessions[id] ?? {
        info: { id, title: String(body.title ?? "Argos mock"), directory: String(body.directory ?? ""), time: { created: now, updated: now } },
        status: "idle",
        messages: []
      };
      session.status = "busy";
      session.lastPrompt = body;
      session.info.time.updated = now;
      session.messages.push(message("user", String(body.prompt ?? "Continue"), now));
      state.sessions[id] = session;
      writeState(statePath, state);
      setTimeout(() => {
        const latest = readState(statePath);
        const current = latest.sessions[id];
        if (!current) return;
        current.messages.push({
          info: { id: `msg_${Date.now()}`, role: "assistant", time: { created: Date.now() } },
          parts: [
            { type: "tool", tool: "read", state: { output: "excluded tool output" } },
            { type: "text", text: `Mock co-agent ${id} completed the current step.` }
          ]
        });
        current.status = "idle";
        current.info.time.updated = Date.now();
        writeState(statePath, latest);
      }, 180);
      return json(response, 200, { id });
    }
    const messageMatch = url.pathname.match(/^\/session\/(ses_[^/]+)\/message$/);
    if (request.method === "GET" && messageMatch) {
      const session = state.sessions[messageMatch[1]];
      return session ? json(response, 200, session.messages) : json(response, 404, { error: "not found" });
    }
    const promptMatch = url.pathname.match(/^\/session\/(ses_[^/]+)\/prompt_async$/);
    if (request.method === "POST" && promptMatch) {
      const session = state.sessions[promptMatch[1]];
      if (!session) return json(response, 404, { error: "not found" });
      const body = await requestBody(request);
      const text = Array.isArray(body.parts)
        ? body.parts.filter((part) => part && part.type === "text").map((part) => String(part.text ?? "")).join("\n")
        : "";
      session.messages.push(message("user", text, Date.now()));
      session.status = "busy";
      session.info.time.updated = Date.now();
      writeState(statePath, state);
      setTimeout(() => {
        const latest = readState(statePath);
        const current = latest.sessions[promptMatch[1]];
        if (!current) return;
        current.messages.push(message("assistant", `Acknowledged direct message: ${text.slice(0, 180)}`, Date.now()));
        current.status = "idle";
        current.info.time.updated = Date.now();
        writeState(statePath, latest);
      }, 350);
      response.writeHead(204);
      response.end();
      return;
    }
    const abortMatch = url.pathname.match(/^\/session\/(ses_[^/]+)\/abort$/);
    if (request.method === "POST" && abortMatch) {
      const session = state.sessions[abortMatch[1]];
      if (session) session.status = "idle";
      writeState(statePath, state);
      return json(response, 200, true);
    }
    return json(response, 404, { error: "unknown route" });
  });
  server.listen(port, "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  await new Promise(() => {});
}

if (command === "run") {
  const attach = option("--attach");
  if (!attach) throw new Error("mock run requires --attach");
  const directory = option("--dir") ?? process.cwd();
  const title = option("--title") ?? "Argos mock";
  const sessionId = option("--session");
  const prompt = args.at(-1) ?? "Continue";
  const agent = option("--agent") ?? null;
  const variant = option("--variant") ?? null;
  const response = await fetch(`${attach.replace(/\/$/, "")}/mock/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory, title, sessionId, prompt, agent, variant, autoApprove: args.includes("--auto") })
  });
  if (!response.ok) throw new Error(`mock run registration failed: ${response.status}`);
  const result = await response.json();
  process.stdout.write(`${JSON.stringify({ type: "step_start", sessionID: result.id })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 260));
  process.stdout.write(`${JSON.stringify({ type: "text", sessionID: result.id, part: { type: "text", text: "Mock run completed" } })}\n`);
  process.exit(0);
}

if (command === "export") {
  const statePath = process.env.ARGOS_MOCK_STATE ?? path.resolve("mock-opencode-state.json");
  const state = readState(statePath);
  const session = state.sessions[args[1]];
  if (!session) process.exit(1);
  process.stdout.write(`${JSON.stringify({ info: session.info, messages: session.messages })}\n`);
  process.exit(0);
}

throw new Error(`Unknown mock OpenCode command: ${command ?? "none"}`);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { nextId: 1, sessions: {} };
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.copyFileSync(temporary, file);
    fs.rmSync(temporary, { force: true });
  }
}

function message(role, text, created) {
  return {
    info: { id: `msg_${created}_${Math.random().toString(36).slice(2, 7)}`, role, time: { created } },
    parts: [{ type: "text", text }]
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}
