#!/usr/bin/env node
import process from "node:process";
import { ArgosDb, initializeArgos } from "./db";
import { exportObsidian } from "./obsidian";
import {
  disableObsidianSync,
  enableObsidianSync,
  ensureObsidianSync,
  readObsidianSyncStatus,
  refreshObsidianSync,
} from "./obsidian-sync";
import { doctorOpenCodeSupport, installOpenCodeSupport } from "./opencode";
import { resolveTargetRoot } from "./paths";
import { addVocabularyType } from "./vocabulary";
import { packageVersion } from "./version";

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonObject;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  handler(args: JsonObject): unknown;
}

const rootProperty = stringProp("Absolute target workspace root. Argos stores the shared graph in <root>/.argos.");

const tools: ToolDefinition[] = [
  {
    name: "argos_init",
    title: "Initialize Argos",
    description: "Initialize a graph-native knowledge base at the target workspace root.",
    inputSchema: schema({ root: rootProperty, name: optionalStringProp("Human-readable target name.") }, ["root"]),
    handler: ({ root, name }) => initializeWithSync(rootValue(root), maybeString(name))
  },
  {
    name: "argos_status",
    title: "Read Argos Status",
    description: "Return knowledge graph counts, schema version, and node-type distribution.",
    inputSchema: schema({ root: rootProperty }, ["root"]),
    handler: ({ root }) => statusWithSync(rootValue(root))
  },
  {
    name: "argos_vocabulary_add",
    title: "Extend Argos Vocabulary",
    description: "Add a node or relation type. Types structure the graph but never constrain Markdown note bodies.",
    inputSchema: schema({
      root: rootProperty,
      kind: enumProp(["node", "relation"], "Vocabulary class."),
      name: stringProp("New lowercase type name.")
    }, ["root", "kind", "name"]),
    handler: ({ root, kind, name }) => addVocabularyType(rootValue(root), enumValue(kind, ["node", "relation"]), stringValue(name))
  },
  {
    name: "argos_resolve_node",
    title: "Resolve Canonical Node",
    description: "Find the canonical node for an item before creating another note. Returns title, alias, symbol, and content candidates.",
    inputSchema: schema({
      root: rootProperty,
      type: stringProp("Node type."),
      title: stringProp("Proposed canonical title."),
      aliases: stringArrayProp("Known alternate names, symbols, or paths."),
      content: optionalStringProp("Optional proposed Markdown used only to find stronger identity candidates."),
      limit: integerProp("Maximum candidates.", 1, 100)
    }, ["root", "type", "title"]),
    handler: ({ root, type, title, aliases, content, limit }) => withDb(rootValue(root), (db) => db.resolveIdentity(stringValue(type), stringValue(title), stringArray(aliases), optionalNumber(limit) ?? 10, maybeString(content) ?? ""))
  },
  {
    name: "argos_create_node",
    title: "Create Canonical Node",
    description: "Create one canonical note for an independently existing current item. Update an existing node when knowledge, version, payload, or proof changes; internal revisions preserve history. Exact identities resolve to the existing node, and strong ambiguous matches require explicit distinctFrom acknowledgement.",
    inputSchema: schema({
      root: rootProperty,
      type: stringProp("Node type."),
      title: stringProp("Current canonical item title."),
      content: optionalStringProp("Free-form Markdown knowledge."),
      aliases: stringArrayProp("Alternate names, code symbols, or paths."),
      distinctFrom: stringArrayProp("Candidate node IDs checked and confirmed to represent independently existing current items.")
    }, ["root", "type", "title"]),
    handler: ({ root, type, title, content, aliases, distinctFrom }) => withDb(rootValue(root), (db) => db.createNode({
      type: stringValue(type),
      title: stringValue(title),
      content: maybeString(content),
      aliases: stringArray(aliases),
      distinctFrom: stringArray(distinctFrom)
    }))
  },
  {
    name: "argos_update_node",
    title: "Update Canonical Node",
    description: "Bring the canonical Markdown note up to date. Use this when the same item's interpretation, version, payload, or proof changes. Argos preserves prior content in internal history and refreshes updatedAt only when the note changes.",
    inputSchema: schema({
      root: rootProperty,
      id: stringProp("Canonical node ID."),
      title: optionalStringProp("Replacement title. The old title becomes an alias."),
      content: optionalStringProp("Free-form Markdown content."),
      aliases: stringArrayProp("Replacement aliases when supplied."),
      mode: enumProp(["replace", "append"], "Replace or append content.")
    }, ["root", "id"]),
    handler: ({ root, id, title, content, aliases, mode }) => withDb(rootValue(root), (db) => db.updateNode(stringValue(id), {
      title: maybeString(title),
      content: maybeString(content),
      aliases: aliases === undefined ? undefined : stringArray(aliases),
      mode: mode === undefined ? undefined : enumValue(mode, ["replace", "append"])
    }))
  },
  {
    name: "argos_merge_nodes",
    title: "Merge Duplicate Nodes",
    description: "Consolidate two reviewed duplicate identities into one canonical node. The caller supplies the final Markdown; Argos preserves aliases and history, rewires graph relations and suggestions, and redirects the retired ID without inferring any conclusion from prose.",
    inputSchema: schema({
      root: rootProperty,
      sourceId: stringProp("Duplicate node to retire."),
      intoId: stringProp("Canonical destination node to retain."),
      content: stringProp("Reviewed consolidated Markdown body for the canonical node."),
      title: optionalStringProp("Optional replacement canonical title."),
      aliases: stringArrayProp("Additional reviewed aliases.")
    }, ["root", "sourceId", "intoId", "content"]),
    handler: ({ root, sourceId, intoId, content, title, aliases }) => withDb(rootValue(root), (db) => db.mergeNodes({
      source: stringValue(sourceId),
      into: stringValue(intoId),
      content: stringValue(content),
      title: maybeString(title),
      aliases: stringArray(aliases)
    }))
  },
  {
    name: "argos_get_node",
    title: "Read Canonical Node",
    description: "Read a complete note, its age, incoming and outgoing relations, superseding nodes, and revision count.",
    inputSchema: schema({
      root: rootProperty,
      id: stringProp("Node ID."),
      relationLimit: integerProp("Maximum incoming and outgoing relations returned per direction.", 1, 1000)
    }, ["root", "id"]),
    handler: ({ root, id, relationLimit }) => withDb(rootValue(root), (db) => db.getContext(stringValue(id), optionalNumber(relationLimit) ?? 200))
  },
  {
    name: "argos_list_nodes",
    title: "List Argos Nodes",
    description: "List compact canonical notes, newest first.",
    inputSchema: schema({
      root: rootProperty,
      type: optionalStringProp("Optional node type."),
      limit: integerProp("Page size.", 1, 500),
      offset: integerProp("Pagination offset.", 0, 1_000_000)
    }, ["root"]),
    handler: ({ root, type, limit, offset }) => withDb(rootValue(root), (db) => db.listNodes({ type: maybeString(type), limit: optionalNumber(limit), offset: optionalNumber(offset) }))
  },
  {
    name: "argos_inspect_node",
    title: "Inspect Node And Its Research Context",
    description: "Return one canonical note with a bounded graph, objective coverage gaps, directed technical sink paths, separate context relations, and pending relation suggestions.",
    inputSchema: schema({
      root: rootProperty,
      id: stringProp("Canonical node ID."),
      depth: integerProp("Graph neighborhood depth.", 0, 5),
      mapLimit: integerProp("Maximum compact nodes in the returned map.", 1, 500),
      relationLimit: integerProp("Maximum direct relations returned per direction.", 1, 1000),
      maxHops: integerProp("Maximum sink-path length.", 1, 7),
      chainLimit: integerProp("Maximum nearby sink paths.", 1, 100)
    }, ["root", "id"]),
    handler: ({ root, id, depth, mapLimit, relationLimit, maxHops, chainLimit }) => withDb(rootValue(root), (db) => db.inspect(stringValue(id), {
      depth: optionalNumber(depth),
      mapLimit: optionalNumber(mapLimit),
      relationLimit: optionalNumber(relationLimit),
      maxHops: optionalNumber(maxHops),
      chainLimit: optionalNumber(chainLimit)
    }))
  },
  {
    name: "argos_add_link",
    title: "Add Graph Relation",
    description: "Add an explicit typed relation between two canonical nodes. Duplicate relations return the existing edge.",
    inputSchema: schema({
      root: rootProperty,
      fromId: stringProp("Source node ID."),
      type: stringProp("Relation type."),
      toId: stringProp("Target node ID.")
    }, ["root", "fromId", "type", "toId"]),
    handler: ({ root, fromId, type, toId }) => withDb(rootValue(root), (db) => db.addEdge(stringValue(fromId), stringValue(type), stringValue(toId)))
  },
  {
    name: "argos_remove_link",
    title: "Remove Graph Relation",
    description: "Remove one explicit relation by edge ID. No note content is changed.",
    inputSchema: schema({ root: rootProperty, id: stringProp("Edge ID.") }, ["root", "id"]),
    handler: ({ root, id }) => withDb(rootValue(root), (db) => db.removeEdge(stringValue(id)))
  },
  {
    name: "argos_suggest_links",
    title: "Suggest Missing Relations",
    description: "Find unlinked notes with shared symbols, concepts, neighbors, or sink composition potential. Suggestions remain separate from the canonical graph until reviewed.",
    inputSchema: schema({ root: rootProperty, id: stringProp("Source node ID."), limit: integerProp("Maximum suggestions.", 1, 50) }, ["root", "id"]),
    handler: ({ root, id, limit }) => withDb(rootValue(root), (db) => db.suggestLinks(stringValue(id), optionalNumber(limit) ?? 10))
  },
  {
    name: "argos_review_link_suggestion",
    title: "Review Link Suggestion",
    description: "Accept or reject a relation suggestion. Acceptance creates one explicit edge; callers may choose a more precise relation type.",
    inputSchema: schema({
      root: rootProperty,
      id: stringProp("Suggestion ID."),
      action: enumProp(["accept", "reject"], "Review action."),
      relationType: optionalStringProp("Explicit relation type to use when accepting.")
    }, ["root", "id", "action"]),
    handler: ({ root, id, action, relationType }) => withDb(rootValue(root), (db) => db.reviewSuggestion(
      stringValue(id),
      enumValue(action, ["accept", "reject"]),
      maybeString(relationType)
    ))
  },
  {
    name: "argos_search",
    title: "Search Argos Knowledge",
    description: "Search free-form notes by text, aliases, and code identifiers, then expand through nearby graph relations. Results include note age and match reasons.",
    inputSchema: schema({
      root: rootProperty,
      query: stringProp("Natural-language query, symbol, path, or concept."),
      type: optionalStringProp("Optional node type filter."),
      depth: integerProp("Graph expansion depth after textual retrieval.", 0, 3),
      limit: integerProp("Maximum results.", 1, 100)
    }, ["root", "query"]),
    handler: ({ root, query, type, depth, limit }) => withDb(rootValue(root), (db) => db.search(stringValue(query), {
      type: maybeString(type),
      depth: optionalNumber(depth),
      limit: optionalNumber(limit)
    }))
  },
  {
    name: "argos_map",
    title: "Map Node Neighborhood",
    description: "Return a bounded graph around one canonical node with compact notes, typed edges, and ages.",
    inputSchema: schema({
      root: rootProperty,
      id: stringProp("Root node ID."),
      depth: integerProp("Traversal depth.", 0, 5),
      limit: integerProp("Maximum compact nodes in the returned map.", 1, 500)
    }, ["root", "id"]),
    handler: ({ root, id, depth, limit }) => withDb(rootValue(root), (db) => db.map(stringValue(id), optionalNumber(depth) ?? 2, optionalNumber(limit) ?? 80))
  },
  {
    name: "argos_find_chains",
    title: "Find Sink Paths",
    description: "Find bounded directed paths to sinks through technical relations. Context, evidence, ownership, and provenance links never bridge a chain; Argos does not infer exploitability.",
    inputSchema: schema({
      root: rootProperty,
      fromId: stringProp("Starting node, usually a sink."),
      maxHops: integerProp("Maximum path length.", 1, 7),
      limit: integerProp("Maximum paths.", 1, 100)
    }, ["root", "fromId"]),
    handler: ({ root, fromId, maxHops, limit }) => withDb(rootValue(root), (db) => db.discoverChains(stringValue(fromId), optionalNumber(maxHops) ?? 5, optionalNumber(limit) ?? 20))
  },
  {
    name: "argos_find_gaps",
    title: "Find Knowledge Gaps",
    description: "Surface structural conditions such as partial premise or sink coverage, missing technical, authority, or state context, later premise changes, intel-only conclusions, old notes, and pending links. These are inspection prompts, not verdicts.",
    inputSchema: schema({ root: rootProperty, id: optionalStringProp("Optional node ID. Omit to inspect sinks and hypotheses."), ageDays: integerProp("Age notice threshold.", 1, 100_000) }, ["root"]),
    handler: ({ root, id, ageDays }) => withDb(rootValue(root), (db) => db.gaps(maybeString(id), optionalNumber(ageDays)))
  },
  {
    name: "argos_list_old_knowledge",
    title: "List Old Knowledge",
    description: "List notes older than a threshold. Age invites revalidation and never proves that a note is wrong.",
    inputSchema: schema({ root: rootProperty, ageDays: integerProp("Minimum age in days.", 1, 100_000), limit: integerProp("Maximum results.", 1, 1000) }, ["root"]),
    handler: ({ root, ageDays, limit }) => withDb(rootValue(root), (db) => db.stale(optionalNumber(ageDays), optionalNumber(limit) ?? 100))
  },
  {
    name: "argos_node_history",
    title: "Read Node History",
    description: "Read prior internal revisions of one canonical note without creating duplicate graph nodes.",
    inputSchema: schema({ root: rootProperty, id: stringProp("Node ID."), limit: integerProp("Maximum revisions.", 1, 500) }, ["root", "id"]),
    handler: ({ root, id, limit }) => withDb(rootValue(root), (db) => db.history(stringValue(id), optionalNumber(limit) ?? 50))
  },
  {
    name: "argos_export_obsidian",
    title: "Export Obsidian Vault",
    description: "Export one Markdown note per canonical node, one graph link per directed relation, a compact index, and an Obsidian Bases explorer. Pruning removes only files recorded in the prior Argos export manifest.",
    inputSchema: schema({
      root: rootProperty,
      output: optionalStringProp("Output vault path. Defaults to <root>/.argos/obsidian."),
      prune: booleanProp("Remove stale Argos-generated files listed in the previous manifest.")
    }, ["root"]),
    handler: ({ root, output, prune }) => withDb(rootValue(root), (db) => exportObsidian(db, maybeString(output), prune === true), false)
  },
  {
    name: "argos_obsidian_sync",
    title: "Manage Automatic Obsidian Sync",
    description: "Read, refresh, configure, or stop the automatic on-use Obsidian projection. Normal Argos calls refresh it when the configured interval has elapsed.",
    inputSchema: schema({
      root: rootProperty,
      action: enumProp(["status", "enable", "refresh", "disable"], "Sync action."),
      output: optionalStringProp("Optional vault path used by enable."),
      intervalSeconds: integerProp("Seconds between change checks and exports.", 1, 86_400),
      prune: booleanProp("Remove unchanged stale generated files during each export.")
    }, ["root", "action"]),
    handler: ({ root, action, output, intervalSeconds, prune }) => {
      const targetRoot = rootValue(root);
      const selected = enumValue(action, ["status", "enable", "refresh", "disable"]);
      if (selected === "enable") {
        return enableObsidianSync(targetRoot, {
          output: maybeString(output),
          intervalSeconds: optionalNumber(intervalSeconds),
          prune: optionalBoolean(prune)
        });
      }
      if (selected === "disable") return disableObsidianSync(targetRoot);
      if (selected === "refresh") return refreshObsidianSync(targetRoot);
      return ensureObsidianSync(targetRoot);
    }
  },
  {
    name: "argos_opencode_install",
    title: "Install OpenCode Project Support",
    description: "Install project-local Argos instructions, skills, command, and MCP wiring while preserving unrelated OpenCode configuration.",
    inputSchema: schema({
      root: rootProperty,
      force: booleanProp("Replace modified Argos-managed instruction, command, and skill files.")
    }, ["root"]),
    handler: ({ root, force }) => installOpenCodeSupport(rootValue(root), force === true)
  },
  {
    name: "argos_opencode_doctor",
    title: "Check OpenCode Project Support",
    description: "Check the OpenCode CLI and project-local Argos MCP, instruction, command, and skill setup.",
    inputSchema: schema({ root: rootProperty }, ["root"]),
    handler: ({ root }) => doctorOpenCodeSupport(rootValue(root))
  }
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    void handleLine(line);
  }
});

async function handleLine(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse(null, undefined, { code: -32700, message: "Parse error" });
    return;
  }
  if (request.id === undefined) return;
  try {
    if (request.method === "initialize") {
      writeResponse(request.id, {
        protocolVersion: String((request.params as JsonObject | undefined)?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: {} },
        serverInfo: { name: "argos", version: packageVersion() }
      });
      return;
    }
    if (request.method === "ping") {
      writeResponse(request.id, {});
      return;
    }
    if (request.method === "tools/list") {
      writeResponse(request.id, { tools: tools.map(({ handler: _handler, ...definition }) => definition) });
      return;
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = stringValue(params.name);
      const definition = tools.find((tool) => tool.name === name);
      if (!definition) throw new Error(`Unknown Argos tool: ${name}`);
      const args = isObject(params.arguments) ? params.arguments : {};
      validateToolArguments(args, definition.inputSchema);
      const result = await definition.handler(args);
      writeResponse(request.id, toolResult(result));
      return;
    }
    writeResponse(request.id, undefined, { code: -32601, message: `Method not found: ${request.method}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method === "tools/call") {
      writeResponse(request.id, { isError: true, content: [{ type: "text", text: message }], structuredContent: { ok: false, error: message } });
    } else {
      writeResponse(request.id, undefined, { code: -32603, message });
    }
  }
}

function withDb<T>(root: string, action: (db: ArgosDb) => T, synchronize = true): T {
  const db = new ArgosDb(root);
  let result: T;
  try {
    result = action(db);
  } finally {
    db.close();
  }
  if (synchronize) ensureObsidianSync(root);
  return result;
}

function initializeWithSync(root: string, name?: string): unknown {
  const result = initializeArgos(root, name);
  ensureObsidianSync(root);
  return { ...result, obsidianSync: readObsidianSyncStatus(root) };
}

function statusWithSync(root: string): unknown {
  const result = withDb(root, (db) => db.status());
  return { ...result, obsidianSync: readObsidianSyncStatus(root) };
}

function toolResult(value: unknown): JsonObject {
  const structuredContent = isObject(value) ? value : { result: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

function writeResponse(id: JsonRpcId, result?: unknown, error?: { code: number; message: string }): void {
  const response = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function schema(properties: JsonObject, required: string[]): JsonObject {
  return { type: "object", properties, required, additionalProperties: false };
}

function validateToolArguments(args: JsonObject, inputSchema: JsonObject): void {
  const properties = isObject(inputSchema.properties) ? inputSchema.properties : {};
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];
  const unknown = Object.keys(args).filter((name) => !(name in properties));
  if (unknown.length > 0) throw new Error(`Unknown tool argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  const missing = required.filter((name) => args[name] === undefined);
  if (missing.length > 0) throw new Error(`Missing required tool argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  for (const [name, value] of Object.entries(args)) {
    const property = properties[name];
    if (!isObject(property)) continue;
    const type = property.type;
    if (type === "string") {
      if (typeof value !== "string") throw new Error(`Tool argument '${name}' must be a string`);
      if (typeof property.minLength === "number" && value.length < property.minLength) throw new Error(`Tool argument '${name}' cannot be empty`);
      if (Array.isArray(property.enum) && !property.enum.includes(value)) throw new Error(`Tool argument '${name}' must be one of: ${property.enum.join(", ")}`);
    } else if (type === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`Tool argument '${name}' must be an integer`);
      if (typeof property.minimum === "number" && value < property.minimum) throw new Error(`Tool argument '${name}' must be at least ${property.minimum}`);
      if (typeof property.maximum === "number" && value > property.maximum) throw new Error(`Tool argument '${name}' must be at most ${property.maximum}`);
    } else if (type === "boolean") {
      if (typeof value !== "boolean") throw new Error(`Tool argument '${name}' must be a boolean`);
    } else if (type === "array") {
      if (!Array.isArray(value)) throw new Error(`Tool argument '${name}' must be an array`);
      const itemSchema = isObject(property.items) ? property.items : {};
      if (itemSchema.type === "string" && value.some((item) => typeof item !== "string" || (typeof itemSchema.minLength === "number" && item.length < itemSchema.minLength))) {
        throw new Error(`Tool argument '${name}' must contain non-empty strings`);
      }
    }
  }
}

function stringProp(description: string): JsonObject {
  return { type: "string", minLength: 1, description };
}

function optionalStringProp(description: string): JsonObject {
  return { type: "string", description };
}

function stringArrayProp(description: string): JsonObject {
  return { type: "array", items: { type: "string", minLength: 1 }, description };
}

function enumProp(values: readonly string[], description: string): JsonObject {
  return { type: "string", enum: values, description };
}

function integerProp(description: string, minimum: number, maximum: number): JsonObject {
  return { type: "integer", minimum, maximum, description };
}

function booleanProp(description: string): JsonObject {
  return { type: "boolean", description };
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected a non-empty string");
  return value;
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Expected an array of strings");
  return value as string[];
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a number");
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("Expected a boolean");
  return value;
}

function rootValue(value: unknown): string {
  return resolveTargetRoot(stringValue(value));
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  const text = stringValue(value);
  if (!allowed.includes(text)) throw new Error(`Expected one of: ${allowed.join(", ")}`);
  return text as T[number];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
