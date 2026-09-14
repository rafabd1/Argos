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
const env = {
  ...process.env,
  ARGOS_DISABLE_OBSIDIAN_SYNC: "1",
  OPENCODE_COMMAND: process.execPath
};
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
  assert(listed.tools.length >= 24, `Expected complete MCP surface, got ${listed.tools.length}`);
  assert(listed.tools.some((tool) => tool.name === "argos_inspect_node"));
  assert(listed.tools.some((tool) => tool.name === "argos_remove_node"));
  assert.equal(listed.tools.some((tool) => tool.name === "argos_node_history"), false);
  assert(listed.tools.some((tool) => tool.name === "argos_opencode_install"));
  assert(listed.tools.some((tool) => tool.name === "argos_obsidian_sync"));
  assert.equal(listed.tools.some((tool) => tool.name.startsWith("argos_chimera_")), false);
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown top-level fields`);
  }
  const createTool = listed.tools.find((tool) => tool.name === "argos_create_node");
  assert.equal(createTool.inputSchema.properties.initialRelation.additionalProperties, false);

  const init = await call("argos_init", { root: target, name: "MCP target" });
  assert.equal(init.structuredContent.initialized, true);
  assert.equal(init.structuredContent.obsidianSync.environmentDisabled, true);
  assert.equal(init.structuredContent.obsidianSync.mode, "on_use");
  const syncStatus = await call("argos_obsidian_sync", { root: target, action: "status" });
  assert.equal(syncStatus.structuredContent.mode, "on_use");
  assert.equal(syncStatus.structuredContent.environmentDisabled, true);
  const targetNode = await call("argos_create_node", { root: target, type: "target", title: "MCP target", content: "MCP graph root.", aliases: [], distinctFrom: [] });
  const targetId = targetNode.structuredContent.node.publicId;
  const rejectedOrphan = await call("argos_create_node", { root: target, type: "component", title: "Detached MCP component", content: "Must roll back.", aliases: [], distinctFrom: [] });
  assert.equal(rejectedOrphan.isError, true);
  assert(rejectedOrphan.structuredContent.error.includes("requires an initialRelation"));
  const rejectedGenericRelation = await call("argos_create_node", {
    root: target,
    type: "component",
    title: "Generic MCP component",
    initialRelation: { nodeId: targetId, type: "related_to", direction: "incoming" }
  });
  assert.equal(rejectedGenericRelation.isError, true);
  assert(rejectedGenericRelation.structuredContent.error.includes("related_to cannot be used"));
  const afterRejectedNodes = await call("argos_status", { root: target });
  assert.equal(afterRejectedNodes.structuredContent.counts.nodes, 1);
  assert.equal(afterRejectedNodes.structuredContent.counts.isolatedNodes, 0);
  assert.equal(afterRejectedNodes.structuredContent.counts.broadRootLinks, 0);
  const component = await call("argos_create_node", {
    root: target,
    type: "component",
    title: "MCP component",
    content: "Owns the test route.",
    aliases: ["McpComponent"],
    distinctFrom: [],
    initialRelation: { nodeId: targetId, type: "contains", direction: "incoming" }
  });
  const componentId = component.structuredContent.node.publicId;
  assert.equal(component.structuredContent.initialRelation.fromId, targetId);
  assert.equal(component.structuredContent.initialRelation.toId, componentId);
  const sink = await call("argos_create_node", {
    root: target,
    type: "sink",
    title: "MCP sink",
    content: "Writes a target object.",
    aliases: [],
    distinctFrom: [],
    initialRelation: { nodeId: componentId, type: "writes", direction: "incoming" }
  });
  assert.equal(component.structuredContent.created, true);
  assert.equal(sink.structuredContent.created, true);
  const sinkId = sink.structuredContent.node.publicId;
  const rejectedFlatLink = await call("argos_add_link", { root: target, fromId: targetId, type: "contains", toId: sinkId });
  assert.equal(rejectedFlatLink.isError, true);
  assert(rejectedFlatLink.structuredContent.error.includes("specific node"));
  const emptyUpdate = await call("argos_update_node", { root: target, id: componentId });
  assert.equal(emptyUpdate.isError, true);
  assert(emptyUpdate.structuredContent.error.includes("requires a title, content, aliases, or exact text edits"));
  const unchangedAt = component.structuredContent.node.updatedAt;
  const unchangedUpdate = await call("argos_update_node", {
    root: target,
    id: componentId,
    content: component.structuredContent.node.content
  });
  assert.equal(unchangedUpdate.structuredContent.updatedAt, unchangedAt);
  const exactEdit = await call("argos_update_node", {
    root: target,
    id: componentId,
    edits: [{ oldText: "Owns the test route.", newText: "Owns the tested route." }]
  });
  assert.equal(exactEdit.structuredContent.content, "Owns the tested route.");
  const beforeFailedEdit = exactEdit.structuredContent;
  const failedEdit = await call("argos_update_node", {
    root: target,
    id: componentId,
    edits: [
      { oldText: "Owns", newText: "Controls" },
      { oldText: "missing text", newText: "must fail" }
    ]
  });
  assert.equal(failedEdit.isError, true);
  assert(failedEdit.structuredContent.error.includes("expected one oldText match but found 0"));
  const afterFailedEdit = await call("argos_get_node", { root: target, id: componentId });
  assert.equal(afterFailedEdit.structuredContent.node.content, beforeFailedEdit.content);
  assert.equal(afterFailedEdit.structuredContent.node.updatedAt, beforeFailedEdit.updatedAt);
  const duplicate = await call("argos_create_node", { root: target, type: "component", title: "MCP component", content: "ignored", aliases: [], distinctFrom: [] });
  assert.equal(duplicate.structuredContent.created, false);
  assert.equal(duplicate.structuredContent.canonical.publicId, componentId);
  const mergeSource = await call("argos_create_node", { root: target, type: "component", title: "MCP duplicate source", content: "Old identity.", aliases: [], initialRelation: { nodeId: targetId, type: "contains", direction: "incoming" } });
  const mergeDestination = await call("argos_create_node", { root: target, type: "component", title: "MCP duplicate destination", content: "Canonical identity.", aliases: [], initialRelation: { nodeId: targetId, type: "contains", direction: "incoming" } });
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
  const removable = await call("argos_create_node", { root: target, type: "artifact", title: "Temporary runtime log", content: "Operational state that does not belong in target knowledge.", aliases: [], distinctFrom: [], initialRelation: { nodeId: componentId, type: "supports", direction: "outgoing" } });
  const removableId = removable.structuredContent.node.publicId;
  await call("argos_add_link", { root: target, fromId: removableId, type: "supports", toId: componentId });
  const removed = await call("argos_remove_node", { root: target, id: removableId, reason: "Operational test record" });
  assert.equal(removed.structuredContent.removed.publicId, removableId);
  assert.equal(removed.structuredContent.removedEdges, 1);
  const removedRead = await call("argos_get_node", { root: target, id: removableId });
  assert.equal(removedRead.isError, true);
  const map = await call("argos_map", { root: target, id: componentId, depth: 2, limit: 1 });
  assert.equal(map.structuredContent.root.publicId, componentId);
  assert.equal(map.structuredContent.nodes.length, 1);
  assert.equal(map.structuredContent.truncated, true);
  assert(map.structuredContent.frontierNodeIds.includes(sinkId));
  const inspection = await call("argos_inspect_node", { root: target, id: sinkId, depth: 2, maxHops: 4, chainLimit: 5 });
  assert.equal(inspection.structuredContent.context.node.publicId, sinkId);
  assert(Array.isArray(inspection.structuredContent.gaps));
  assert.equal(inspection.structuredContent.chainMode, "directed_technical");
  assert.deepEqual(inspection.structuredContent.chains, inspection.structuredContent.technicalChains);
  const search = await call("argos_search", { root: target, query: "target object", depth: 1, limit: 10 });
  assert(search.structuredContent.result.some((hit) => hit.node.publicId === sinkId));
  for (let index = 0; index < 24; index += 1) {
    await call("argos_create_node", {
      root: target,
      type: "sink",
      title: `MCP paged sink ${String(index).padStart(2, "0")}`,
      content: `Compact page entry ${index}. ${"bounded context ".repeat(30)}`,
      aliases: [],
      distinctFrom: [],
      initialRelation: { nodeId: componentId, type: "writes", direction: "incoming" }
    });
  }
  const longAliases = Array.from({ length: 100 }, (_, index) => `alias-${String(index).padStart(3, "0")}-${"x".repeat(180)}`);
  await call("argos_create_node", {
    root: target,
    type: "sink",
    title: "MCP payload budget sink",
    content: "Exercises bounded list output. ".repeat(80),
    aliases: longAliases,
    distinctFrom: [],
    initialRelation: { nodeId: componentId, type: "writes", direction: "incoming" }
  });
  const nodePage = await call("argos_list_nodes", { root: target, type: "sink" });
  assert.equal(nodePage.structuredContent.limit, 20);
  assert(nodePage.structuredContent.returned > 0);
  assert(nodePage.structuredContent.returned <= 20);
  assert.equal(nodePage.structuredContent.hasMore, true);
  assert.equal(nodePage.structuredContent.nextOffset, nodePage.structuredContent.returned);
  assert.equal(nodePage.structuredContent.truncatedByBudget, true);
  assert.equal(nodePage.structuredContent.maxPayloadBytes, 8 * 1024);
  assert(Buffer.byteLength(nodePage.content[0].text, "utf8") <= nodePage.structuredContent.maxPayloadBytes);
  assert.equal(nodePage.content[0].text.includes("\n"), false);
  assert.deepEqual(JSON.parse(nodePage.content[0].text), nodePage.structuredContent);
  const oversizedList = await call("argos_list_nodes", { root: target, limit: 101 });
  assert.equal(oversizedList.isError, true);
  assert(oversizedList.structuredContent.error.includes("limit"));
  const allSinkIds = new Set();
  let nextOffset = 0;
  do {
    const page = await call("argos_list_nodes", { root: target, type: "sink", limit: 20, offset: nextOffset });
    for (const node of page.structuredContent.nodes) allSinkIds.add(node.publicId);
    if (!page.structuredContent.hasMore) break;
    assert(page.structuredContent.nextOffset > nextOffset);
    nextOffset = page.structuredContent.nextOffset;
  } while (true);
  assert.equal(allSinkIds.size, 26);
  const aliasedSummary = nodePage.structuredContent.nodes.find((node) => node.title === "MCP payload budget sink");
  assert(aliasedSummary);
  assert.equal(aliasedSummary.aliasCount, 100);
  assert.equal(aliasedSummary.aliases.length, 5);
  assert.equal(aliasedSummary.aliasesTruncated, true);
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
