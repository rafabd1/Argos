#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_process_1 = __importDefault(require("node:process"));
const db_1 = require("./db");
const obsidian_1 = require("./obsidian");
const obsidian_sync_1 = require("./obsidian-sync");
const opencode_1 = require("./opencode");
const paths_1 = require("./paths");
const vocabulary_1 = require("./vocabulary");
const version_1 = require("./version");
const rootProperty = stringProp("Absolute target workspace root. Argos stores the shared graph in <root>/.argos.");
const NODE_LIST_DEFAULT_LIMIT = 20;
const NODE_LIST_MAX_LIMIT = 100;
const NODE_LIST_MAX_PAYLOAD_BYTES = 8 * 1024;
const NODE_LIST_ALIAS_LIMIT = 5;
const tools = [
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
        handler: ({ root, kind, name }) => (0, vocabulary_1.addVocabularyType)(rootValue(root), enumValue(kind, ["node", "relation"]), stringValue(name))
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
        description: "Create one canonical note for an independently existing current target item. Never store campaign goals, work logs, task state, messages, tool issues, or other operational records as nodes. Update an existing node when its knowledge changes. Exact identities resolve to the existing node, and strong ambiguous matches require explicit distinctFrom acknowledgement.",
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
        description: "Replace, extend, or apply ordered exact edits to the current canonical Markdown note. Exact edits change small sections without resending the full body and fail atomically unless each oldText matches once. Replaced content is discarded; use replace whenever old text is no longer current. updatedAt changes only when the note changes.",
        inputSchema: schema({
            root: rootProperty,
            id: stringProp("Canonical node ID."),
            title: optionalStringProp("Replacement title. The old title becomes an alias."),
            content: optionalStringProp("Free-form Markdown content."),
            aliases: stringArrayProp("Replacement aliases when supplied."),
            mode: enumProp(["replace", "append"], "Replace or append content."),
            edits: nodeTextEditsProp("Ordered exact text edits. Each oldText must match exactly once when its edit is applied; newText may be empty.")
        }, ["root", "id"]),
        handler: ({ root, id, title, content, aliases, mode, edits }) => withDb(rootValue(root), (db) => db.updateNode(stringValue(id), {
            title: maybeString(title),
            content: maybeString(content),
            aliases: aliases === undefined ? undefined : stringArray(aliases),
            mode: mode === undefined ? undefined : enumValue(mode, ["replace", "append"]),
            edits: edits === undefined ? undefined : nodeTextEdits(edits)
        }))
    },
    {
        name: "argos_remove_node",
        title: "Remove Erroneous Node",
        description: "Permanently remove a node that should never have entered the target knowledge map, such as a campaign log or runtime record. This also removes its relations, suggestions, and retired-ID redirects. Use update for stale or corrected target knowledge; removal keeps no history and never infers intent from prose. The reason is returned for confirmation but is not stored as graph data.",
        inputSchema: schema({
            root: rootProperty,
            id: stringProp("Canonical node ID. Redirected IDs are rejected."),
            reason: stringProp("Short reason this item is not durable target knowledge.")
        }, ["root", "id", "reason"]),
        handler: ({ root, id, reason }) => withDb(rootValue(root), (db) => db.removeNode(stringValue(id), stringValue(reason)))
    },
    {
        name: "argos_merge_nodes",
        title: "Merge Duplicate Nodes",
        description: "Consolidate two reviewed duplicate identities into one canonical node. The caller supplies the final current Markdown; Argos keeps aliases, rewires graph relations and suggestions, redirects the retired ID, and discards the former bodies without inferring any conclusion from prose.",
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
        description: "Read a complete current note, its age, incoming and outgoing relations, and superseding nodes.",
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
        description: "List compact canonical notes, newest first, in an output-bounded page. Follow nextOffset while hasMore is true; use argos_get_node for a complete note.",
        inputSchema: schema({
            root: rootProperty,
            type: optionalStringProp("Optional node type."),
            limit: integerProp(`Requested page size. Defaults to ${NODE_LIST_DEFAULT_LIMIT}; output may contain fewer records when the payload budget is reached.`, 1, NODE_LIST_MAX_LIMIT),
            offset: integerProp("Pagination offset.", 0, 1_000_000)
        }, ["root"]),
        handler: ({ root, type, limit, offset }) => withDb(rootValue(root), (db) => listNodePage(db, maybeString(type), optionalNumber(limit) ?? NODE_LIST_DEFAULT_LIMIT, optionalNumber(offset) ?? 0))
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
        handler: ({ root, id, action, relationType }) => withDb(rootValue(root), (db) => db.reviewSuggestion(stringValue(id), enumValue(action, ["accept", "reject"]), maybeString(relationType)))
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
        name: "argos_export_obsidian",
        title: "Export Obsidian Vault",
        description: "Export one Markdown note per canonical node, one graph link per directed relation, a compact index, and an Obsidian Bases explorer. Pruning removes only files recorded in the prior Argos export manifest.",
        inputSchema: schema({
            root: rootProperty,
            output: optionalStringProp("Output vault path. Defaults to <root>/.argos/obsidian/<config-name>."),
            prune: booleanProp("Remove stale Argos-generated files listed in the previous manifest.")
        }, ["root"]),
        handler: ({ root, output, prune }) => withDb(rootValue(root), (db) => (0, obsidian_1.exportObsidian)(db, maybeString(output), prune === true), false)
    },
    {
        name: "argos_obsidian_sync",
        title: "Manage Automatic Obsidian Sync",
        description: "Read, refresh, configure, or stop the automatic on-use Obsidian projection. Normal Argos calls refresh it when the configured interval has elapsed.",
        inputSchema: schema({
            root: rootProperty,
            action: enumProp(["status", "enable", "refresh", "disable"], "Sync action."),
            output: optionalStringProp("Optional vault path used by enable. Omit it to retain the configured destination; fresh targets use <root>/.argos/obsidian/<config-name>."),
            intervalSeconds: integerProp("Seconds between change checks and exports.", 1, 86_400),
            prune: booleanProp("Remove unchanged stale generated files during each export.")
        }, ["root", "action"]),
        handler: ({ root, action, output, intervalSeconds, prune }) => {
            const targetRoot = rootValue(root);
            const selected = enumValue(action, ["status", "enable", "refresh", "disable"]);
            if (selected === "enable") {
                return (0, obsidian_sync_1.enableObsidianSync)(targetRoot, {
                    output: maybeString(output),
                    intervalSeconds: optionalNumber(intervalSeconds),
                    prune: optionalBoolean(prune)
                });
            }
            if (selected === "disable")
                return (0, obsidian_sync_1.disableObsidianSync)(targetRoot);
            if (selected === "refresh")
                return (0, obsidian_sync_1.refreshObsidianSync)(targetRoot);
            return (0, obsidian_sync_1.ensureObsidianSync)(targetRoot);
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
        handler: ({ root, force }) => (0, opencode_1.installOpenCodeSupport)(rootValue(root), force === true)
    },
    {
        name: "argos_opencode_doctor",
        title: "Check OpenCode Project Support",
        description: "Check the OpenCode CLI and project-local Argos MCP, instruction, command, and skill setup.",
        inputSchema: schema({ root: rootProperty }, ["root"]),
        handler: ({ root }) => (0, opencode_1.doctorOpenCodeSupport)(rootValue(root))
    }
];
let buffer = "";
node_process_1.default.stdin.setEncoding("utf8");
node_process_1.default.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1)
            break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line)
            continue;
        void handleLine(line);
    }
});
async function handleLine(line) {
    let request;
    try {
        request = JSON.parse(line);
    }
    catch {
        writeResponse(null, undefined, { code: -32700, message: "Parse error" });
        return;
    }
    if (request.id === undefined)
        return;
    try {
        if (request.method === "initialize") {
            writeResponse(request.id, {
                protocolVersion: String(request.params?.protocolVersion ?? "2025-06-18"),
                capabilities: { tools: {} },
                serverInfo: { name: "argos", version: (0, version_1.packageVersion)() }
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
            if (!definition)
                throw new Error(`Unknown Argos tool: ${name}`);
            const args = isObject(params.arguments) ? params.arguments : {};
            validateToolArguments(args, definition.inputSchema);
            const result = await definition.handler(args);
            writeResponse(request.id, toolResult(result));
            return;
        }
        writeResponse(request.id, undefined, { code: -32601, message: `Method not found: ${request.method}` });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (request.method === "tools/call") {
            writeResponse(request.id, { isError: true, content: [{ type: "text", text: message }], structuredContent: { ok: false, error: message } });
        }
        else {
            writeResponse(request.id, undefined, { code: -32603, message });
        }
    }
}
function withDb(root, action, synchronize = true) {
    const db = new db_1.ArgosDb(root);
    let result;
    try {
        result = action(db);
    }
    finally {
        db.close();
    }
    if (synchronize)
        (0, obsidian_sync_1.ensureObsidianSync)(root);
    return result;
}
function initializeWithSync(root, name) {
    const result = (0, db_1.initializeArgos)(root, name);
    (0, obsidian_sync_1.ensureObsidianSync)(root);
    return { ...result, obsidianSync: (0, obsidian_sync_1.readObsidianSyncStatus)(root) };
}
function statusWithSync(root) {
    const result = withDb(root, (db) => db.status());
    return { ...result, obsidianSync: (0, obsidian_sync_1.readObsidianSyncStatus)(root) };
}
function toolResult(value) {
    const structuredContent = isObject(value) ? value : { result: value };
    return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent
    };
}
function listNodePage(db, type, limit, offset) {
    const candidates = db.listNodes({ type, limit: limit + 1, offset });
    const requested = candidates.slice(0, limit).map(compactNodeListItem);
    const nodes = [];
    let truncatedByBudget = false;
    for (const node of requested) {
        const candidateNodes = [...nodes, node];
        const candidatePage = nodeListPageRecord(candidateNodes, limit, offset, candidates.length, false);
        if (Buffer.byteLength(JSON.stringify(candidatePage), "utf8") > NODE_LIST_MAX_PAYLOAD_BYTES) {
            truncatedByBudget = true;
            break;
        }
        nodes.push(node);
    }
    if (requested.length > 0 && nodes.length === 0) {
        throw new Error("A compact node summary exceeded the MCP list payload budget; read the node directly with argos_get_node");
    }
    return nodeListPageRecord(nodes, limit, offset, candidates.length, truncatedByBudget);
}
function nodeListPageRecord(nodes, limit, offset, candidateCount, truncatedByBudget) {
    const hasMore = candidateCount > nodes.length;
    return {
        nodes,
        returned: nodes.length,
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + nodes.length : null,
        truncatedByBudget,
        maxPayloadBytes: NODE_LIST_MAX_PAYLOAD_BYTES
    };
}
function compactNodeListItem(node) {
    return {
        ...node,
        aliases: node.aliases.slice(0, NODE_LIST_ALIAS_LIMIT),
        aliasCount: node.aliases.length,
        aliasesTruncated: node.aliases.length > NODE_LIST_ALIAS_LIMIT
    };
}
function writeResponse(id, result, error) {
    const response = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
    node_process_1.default.stdout.write(`${JSON.stringify(response)}\n`);
}
function schema(properties, required) {
    return { type: "object", properties, required, additionalProperties: false };
}
function validateToolArguments(args, inputSchema) {
    const properties = isObject(inputSchema.properties) ? inputSchema.properties : {};
    const required = Array.isArray(inputSchema.required)
        ? inputSchema.required.filter((value) => typeof value === "string")
        : [];
    const unknown = Object.keys(args).filter((name) => !(name in properties));
    if (unknown.length > 0)
        throw new Error(`Unknown tool argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
    const missing = required.filter((name) => args[name] === undefined);
    if (missing.length > 0)
        throw new Error(`Missing required tool argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    for (const [name, value] of Object.entries(args)) {
        const property = properties[name];
        if (!isObject(property))
            continue;
        const type = property.type;
        if (type === "string") {
            if (typeof value !== "string")
                throw new Error(`Tool argument '${name}' must be a string`);
            if (typeof property.minLength === "number" && value.length < property.minLength)
                throw new Error(`Tool argument '${name}' cannot be empty`);
            if (Array.isArray(property.enum) && !property.enum.includes(value))
                throw new Error(`Tool argument '${name}' must be one of: ${property.enum.join(", ")}`);
        }
        else if (type === "integer") {
            if (typeof value !== "number" || !Number.isInteger(value))
                throw new Error(`Tool argument '${name}' must be an integer`);
            if (typeof property.minimum === "number" && value < property.minimum)
                throw new Error(`Tool argument '${name}' must be at least ${property.minimum}`);
            if (typeof property.maximum === "number" && value > property.maximum)
                throw new Error(`Tool argument '${name}' must be at most ${property.maximum}`);
        }
        else if (type === "boolean") {
            if (typeof value !== "boolean")
                throw new Error(`Tool argument '${name}' must be a boolean`);
        }
        else if (type === "array") {
            if (!Array.isArray(value))
                throw new Error(`Tool argument '${name}' must be an array`);
            const itemSchema = isObject(property.items) ? property.items : {};
            if (itemSchema.type === "string" && value.some((item) => typeof item !== "string" || (typeof itemSchema.minLength === "number" && item.length < itemSchema.minLength))) {
                throw new Error(`Tool argument '${name}' must contain non-empty strings`);
            }
        }
    }
}
function stringProp(description) {
    return { type: "string", minLength: 1, description };
}
function optionalStringProp(description) {
    return { type: "string", description };
}
function stringArrayProp(description) {
    return { type: "array", items: { type: "string", minLength: 1 }, description };
}
function nodeTextEditsProp(description) {
    return {
        type: "array",
        minItems: 1,
        maxItems: 100,
        description,
        items: {
            type: "object",
            additionalProperties: false,
            properties: {
                oldText: { type: "string", minLength: 1, description: "Exact current text to replace." },
                newText: { type: "string", description: "Replacement text. Use an empty string to delete the matched text." }
            },
            required: ["oldText", "newText"]
        }
    };
}
function enumProp(values, description) {
    return { type: "string", enum: values, description };
}
function integerProp(description, minimum, maximum) {
    return { type: "integer", minimum, maximum, description };
}
function booleanProp(description) {
    return { type: "boolean", description };
}
function stringValue(value) {
    if (typeof value !== "string" || !value.trim())
        throw new Error("Expected a non-empty string");
    return value;
}
function maybeString(value) {
    return typeof value === "string" ? value : undefined;
}
function stringArray(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new Error("Expected an array of strings");
    return value;
}
function nodeTextEdits(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
        throw new Error("Expected 1 to 100 exact text edits");
    }
    return value.map((item, index) => {
        if (!isObject(item))
            throw new Error(`Exact text edit ${index + 1} must be an object`);
        const unknown = Object.keys(item).filter((key) => key !== "oldText" && key !== "newText");
        if (unknown.length > 0)
            throw new Error(`Unknown exact text edit field: ${unknown[0]}`);
        if (typeof item.oldText !== "string" || !item.oldText)
            throw new Error(`Exact text edit ${index + 1} requires non-empty oldText`);
        if (typeof item.newText !== "string")
            throw new Error(`Exact text edit ${index + 1} requires string newText`);
        return { oldText: item.oldText, newText: item.newText };
    });
}
function optionalNumber(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error("Expected a number");
    return value;
}
function optionalBoolean(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "boolean")
        throw new Error("Expected a boolean");
    return value;
}
function rootValue(value) {
    return (0, paths_1.resolveTargetRoot)(stringValue(value));
}
function enumValue(value, allowed) {
    const text = stringValue(value);
    if (!allowed.includes(text))
        throw new Error(`Expected one of: ${allowed.join(", ")}`);
    return text;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
