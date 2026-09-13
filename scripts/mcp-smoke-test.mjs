import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repo, "dist", "mcp.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "argos-mcp-smoke-"));
const target = path.join(temp, "target");
const env = { ...process.env, ARGOS_HOME: path.join(temp, "home"), OPENCODE_COMMAND: process.execPath };
fs.mkdirSync(target, { recursive: true });
const child = spawn(process.execPath, [serverPath], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let stderr = "";
let nextId = 1;

lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
child.stderr.on("data", (chunk) => stderr += chunk);

try {
  const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  assert.equal(initialized.serverInfo.name, "argos");
  const listed = await request("tools/list", {});
  assert(listed.tools.length >= 30, `Expected complete MCP surface, got ${listed.tools.length}`);
  assert(listed.tools.some((tool) => tool.name === "argos_inspect_node"));
  assert(listed.tools.some((tool) => tool.name === "argos_opencode_install"));
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown top-level fields`);
  }

  const init = await call("argos_init", { root: target, name: "MCP target" });
  assert.equal(init.structuredContent.initialized, true);
  const component = await call("argos_create_node", { root: target, type: "component", title: "MCP component", content: "Owns the test route.", aliases: ["McpComponent"], distinctFrom: [] });
  const sink = await call("argos_create_node", { root: target, type: "sink", title: "MCP sink", content: "Writes a target object.", aliases: [], distinctFrom: [] });
  assert.equal(component.structuredContent.created, true);
  assert.equal(sink.structuredContent.created, true);
  const componentId = component.structuredContent.node.publicId;
  const sinkId = sink.structuredContent.node.publicId;
  const emptyUpdate = await call("argos_update_node", { root: target, id: componentId });
  assert.equal(emptyUpdate.isError, true);
  assert(emptyUpdate.structuredContent.error.includes("requires a title, content, or aliases change"));
  const unchangedAt = component.structuredContent.node.updatedAt;
  const unchangedUpdate = await call("argos_update_node", {
    root: target,
    id: componentId,
    content: component.structuredContent.node.content
  });
  assert.equal(unchangedUpdate.structuredContent.updatedAt, unchangedAt);
  const duplicate = await call("argos_create_node", { root: target, type: "component", title: "MCP component", content: "ignored", aliases: [], distinctFrom: [] });
  assert.equal(duplicate.structuredContent.created, false);
  assert.equal(duplicate.structuredContent.canonical.publicId, componentId);
  const mergeSource = await call("argos_create_node", { root: target, type: "component", title: "MCP duplicate source", content: "Old identity.", aliases: [] });
  const mergeDestination = await call("argos_create_node", { root: target, type: "component", title: "MCP duplicate destination", content: "Canonical identity.", aliases: [] });
  const merge = await call("argos_merge_nodes", {
    root: target,
    sourceId: mergeSource.structuredContent.node.publicId,
    intoId: mergeDestination.structuredContent.node.publicId,
    content: "Reviewed canonical MCP note.",
    aliases: []
  });
  assert.equal(merge.structuredContent.canonical.publicId, mergeDestination.structuredContent.node.publicId);
  const redirected = await call("argos_get_node", { root: target, id: mergeSource.structuredContent.node.publicId });
  assert.equal(redirected.structuredContent.resolvedFrom, mergeSource.structuredContent.node.publicId);
  const unknownArgument = await call("argos_create_node", { root: target, type: "note", title: "Must fail", conent: "typo" });
  assert.equal(unknownArgument.isError, true);
  assert(unknownArgument.structuredContent.error.includes("Unknown tool argument: conent"));
  const wrongType = await call("argos_map", { root: target, id: componentId, depth: "2" });
  assert.equal(wrongType.isError, true);
  assert(wrongType.structuredContent.error.includes("depth"));
  await call("argos_add_link", { root: target, fromId: componentId, type: "writes", toId: sinkId });
  const map = await call("argos_map", { root: target, id: componentId, depth: 2, limit: 1 });
  assert.equal(map.structuredContent.root.publicId, componentId);
  assert.equal(map.structuredContent.nodes.length, 1);
  assert.equal(map.structuredContent.truncated, true);
  assert(map.structuredContent.frontierNodeIds.includes(sinkId));
  const inspection = await call("argos_inspect_node", { root: target, id: sinkId, depth: 2, maxHops: 4, chainLimit: 5 });
  assert.equal(inspection.structuredContent.context.node.publicId, sinkId);
  assert(Array.isArray(inspection.structuredContent.gaps));
  const search = await call("argos_search", { root: target, query: "target object", depth: 1, limit: 10 });
  assert(search.structuredContent.result.some((hit) => hit.node.publicId === sinkId));
  const config = await call("argos_chimera_config", { action: "show" });
  assert.equal(config.structuredContent.maxAgents, 5);
  const bad = await call("argos_get_node", { root: target, id: "N999999" });
  assert.equal(bad.isError, true);

  process.stdout.write("Argos MCP smoke test passed.\n");
} finally {
  lines.close();
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  if (stderr.trim()) process.stderr.write(stderr);
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("argos-mcp-smoke-")) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args) {
  return request("tools/call", { name, arguments: args });
}
