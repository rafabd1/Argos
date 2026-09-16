#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const db_1 = require("./db");
const obsidian_1 = require("./obsidian");
const obsidian_sync_1 = require("./obsidian-sync");
const opencode_1 = require("./opencode");
const paths_1 = require("./paths");
const vocabulary_1 = require("./vocabulary");
const version_1 = require("./version");
async function main() {
    const parsed = parseArgs(node_process_1.default.argv.slice(2));
    const [command, subcommand, ...rest] = parsed.positional;
    if (!command && parsed.options.has("version")) {
        assertKnownOptions(parsed, ["version"]);
        print({ name: "@rafabd1/argos", version: (0, version_1.packageVersion)() });
        return;
    }
    if (!command || command === "help" || parsed.options.has("help")) {
        printHelp();
        return;
    }
    if (command === "version") {
        assertKnownOptions(parsed, []);
        print({ name: "@rafabd1/argos", version: (0, version_1.packageVersion)() });
        return;
    }
    assertKnownOptions(parsed, allowedOptions(command, subcommand, rest));
    assertPositionals(command, subcommand, rest);
    const root = (0, paths_1.resolveTargetRoot)(option(parsed, "root"));
    if (command === "init") {
        const result = (0, db_1.initializeArgos)(root, option(parsed, "name"));
        print({ ...result, obsidianSync: (0, obsidian_sync_1.ensureObsidianSync)(root) });
        return;
    }
    if (command === "status") {
        if (!node_fs_1.default.existsSync((0, paths_1.knowledgePath)(root))) {
            print({ initialized: false, root });
            return;
        }
        const result = withDb(root, (db) => db.status());
        print({ ...result, obsidianSync: (0, obsidian_sync_1.readObsidianSyncStatus)(root) });
        return;
    }
    if (command === "vocabulary") {
        if (subcommand === "list" || !subcommand) {
            print((0, vocabulary_1.readConfig)(root));
            return;
        }
        if (subcommand === "add") {
            const kind = requiredOption(parsed, "kind");
            if (kind !== "node" && kind !== "relation")
                throw new Error("--kind must be node or relation");
            print((0, vocabulary_1.addVocabularyType)(root, kind, requiredOption(parsed, "name")));
            return;
        }
        throw new Error("Usage: argos vocabulary list|add");
    }
    if (command === "node") {
        await handleNode(root, subcommand, rest, parsed);
        return;
    }
    if (command === "link") {
        handleLink(root, subcommand, rest, parsed);
        return;
    }
    if (command === "search") {
        if (parsed.options.has("query") && [subcommand, ...rest].some(Boolean)) {
            throw new Error("Use either --query or a positional search query, not both");
        }
        const query = option(parsed, "query") ?? [subcommand, ...rest].filter(Boolean).join(" ");
        print(withDb(root, (db) => db.search(requiredValue(query, "search query"), {
            type: option(parsed, "type"),
            limit: numberOption(parsed, "limit"),
            depth: numberOption(parsed, "depth")
        })));
        return;
    }
    if (command === "inspect") {
        const id = referenceValue(option(parsed, "id"), subcommand, "node id");
        print(withDb(root, (db) => db.inspect(requiredValue(id, "node id"), {
            depth: numberOption(parsed, "depth"),
            mapLimit: numberOption(parsed, "map-limit"),
            relationLimit: numberOption(parsed, "relation-limit"),
            maxHops: numberOption(parsed, "max-hops"),
            chainLimit: numberOption(parsed, "chain-limit"),
            maxPayloadBytes: numberOption(parsed, "max-payload-bytes")
        })));
        return;
    }
    if (command === "map") {
        const id = referenceValue(option(parsed, "id"), subcommand, "node id");
        print(withDb(root, (db) => db.map(requiredValue(id, "node id"), numberOption(parsed, "depth") ?? 2, numberOption(parsed, "limit") ?? 80)));
        return;
    }
    if (command === "chains") {
        const explicit = referenceValue(option(parsed, "from"), option(parsed, "id"), "source node id");
        const id = referenceValue(explicit, subcommand, "source node id");
        print(withDb(root, (db) => db.discoverChains(requiredValue(id, "source node id"), numberOption(parsed, "max-hops") ?? 5, numberOption(parsed, "limit") ?? 20)));
        return;
    }
    if (command === "gaps") {
        const id = referenceValue(option(parsed, "id"), subcommand, "node id");
        print(withDb(root, (db) => db.gaps(id, numberOption(parsed, "age-days"))));
        return;
    }
    if (command === "stale") {
        print(withDb(root, (db) => db.stale(numberOption(parsed, "age-days"), numberOption(parsed, "limit") ?? 100)));
        return;
    }
    if (command === "export" && subcommand === "obsidian") {
        print(withDb(root, (db) => (0, obsidian_1.exportObsidian)(db, option(parsed, "out"), flag(parsed, "prune")), false));
        return;
    }
    if (command === "obsidian" && subcommand === "sync") {
        const action = rest[0] ?? "status";
        if (action === "enable") {
            print((0, obsidian_sync_1.enableObsidianSync)(root, {
                output: option(parsed, "out"),
                intervalSeconds: numberOption(parsed, "interval-seconds"),
                prune: parsed.options.has("prune") ? flag(parsed, "prune") : undefined
            }));
            return;
        }
        if (action === "disable") {
            print((0, obsidian_sync_1.disableObsidianSync)(root));
            return;
        }
        if (action === "refresh") {
            print((0, obsidian_sync_1.refreshObsidianSync)(root));
            return;
        }
        if (action === "status") {
            print((0, obsidian_sync_1.ensureObsidianSync)(root));
            return;
        }
        throw new Error("Usage: argos obsidian sync enable|status|refresh|disable");
    }
    if (command === "opencode") {
        const action = subcommand ?? "doctor";
        if (action === "install") {
            print((0, opencode_1.installOpenCodeSupport)(root, flag(parsed, "force")));
            return;
        }
        if (action === "doctor") {
            print((0, opencode_1.doctorOpenCodeSupport)(root));
            return;
        }
        throw new Error("Usage: argos opencode install|doctor");
    }
    throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}
async function handleNode(root, subcommand, rest, parsed) {
    if (subcommand === "create") {
        const result = withDb(root, (db) => db.createNode({
            type: requiredOption(parsed, "type"),
            title: requiredOption(parsed, "title"),
            content: readContent(parsed) ?? "",
            aliases: listOption(parsed, "aliases"),
            distinctFrom: listOption(parsed, "distinct-from"),
            initialRelation: readInitialRelation(parsed)
        }));
        print(result);
        if (result.resolutionRequired)
            node_process_1.default.exitCode = 2;
        return;
    }
    if (subcommand === "update") {
        const id = referenceValue(option(parsed, "id"), rest[0], "node id");
        const modeValue = option(parsed, "mode");
        if (modeValue && modeValue !== "replace" && modeValue !== "append")
            throw new Error("--mode must be replace or append");
        const edits = readEdits(parsed);
        print(withDb(root, (db) => db.updateNode(requiredValue(id, "node id"), {
            title: option(parsed, "title"),
            content: readContent(parsed),
            aliases: parsed.options.has("aliases") ? listOption(parsed, "aliases") : undefined,
            mode: modeValue,
            edits
        })));
        return;
    }
    if (subcommand === "remove") {
        const id = referenceValue(option(parsed, "id"), rest[0], "node id");
        print(withDb(root, (db) => db.removeNode(requiredValue(id, "node id"), requiredOption(parsed, "reason"))));
        return;
    }
    if (subcommand === "merge") {
        const content = readContent(parsed);
        if (content === undefined)
            throw new Error("Node merge requires --content or --content-file with the reviewed consolidated note");
        print(withDb(root, (db) => db.mergeNodes({
            source: requiredOption(parsed, "source"),
            into: requiredOption(parsed, "into"),
            content,
            title: option(parsed, "title"),
            aliases: listOption(parsed, "aliases")
        })));
        return;
    }
    if (subcommand === "get") {
        const id = referenceValue(option(parsed, "id"), rest[0], "node id");
        print(withDb(root, (db) => db.getContext(requiredValue(id, "node id"), numberOption(parsed, "relation-limit") ?? 200)));
        return;
    }
    if (subcommand === "list") {
        print(withDb(root, (db) => db.listNodes({
            type: option(parsed, "type"),
            limit: numberOption(parsed, "limit"),
            offset: numberOption(parsed, "offset")
        })));
        return;
    }
    if (subcommand === "resolve") {
        print(withDb(root, (db) => db.resolveIdentity(requiredOption(parsed, "type"), requiredOption(parsed, "title"), listOption(parsed, "aliases"), numberOption(parsed, "limit") ?? 10, readContent(parsed) ?? "")));
        return;
    }
    throw new Error("Usage: argos node create|update|remove|merge|get|list|resolve");
}
function handleLink(root, subcommand, rest, parsed) {
    if (subcommand === "add") {
        print(withDb(root, (db) => db.addEdge(requiredOption(parsed, "from"), requiredOption(parsed, "type"), requiredOption(parsed, "to"))));
        return;
    }
    if (subcommand === "remove") {
        const id = referenceValue(option(parsed, "id"), rest[0], "edge id");
        print(withDb(root, (db) => db.removeEdge(requiredValue(id, "edge id"))));
        return;
    }
    if (subcommand === "suggest") {
        const id = referenceValue(option(parsed, "id"), rest[0], "node id");
        print(withDb(root, (db) => db.suggestLinks(requiredValue(id, "node id"), numberOption(parsed, "limit") ?? 10)));
        return;
    }
    if (subcommand === "list") {
        const status = option(parsed, "status") ?? "pending";
        if (!["pending", "accepted", "rejected"].includes(status))
            throw new Error("--status must be pending, accepted, or rejected");
        print(withDb(root, (db) => db.listSuggestions(status, numberOption(parsed, "limit") ?? 50)));
        return;
    }
    if (subcommand === "accept" || subcommand === "reject") {
        const id = referenceValue(option(parsed, "id"), rest[0], "suggestion id");
        print(withDb(root, (db) => db.reviewSuggestion(requiredValue(id, "suggestion id"), subcommand, option(parsed, "type"))));
        return;
    }
    throw new Error("Usage: argos link add|remove|suggest|list|accept|reject");
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
function parseArgs(args) {
    const positional = [];
    const options = new Map();
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const equals = arg.indexOf("=");
        if (equals !== -1) {
            options.set(arg.slice(2, equals), arg.slice(equals + 1));
            continue;
        }
        const key = arg.slice(2);
        const next = args[index + 1];
        if (next !== undefined && !next.startsWith("--")) {
            options.set(key, next);
            index += 1;
        }
        else {
            options.set(key, true);
        }
    }
    return { positional, options };
}
function option(parsed, name) {
    const value = parsed.options.get(name);
    return typeof value === "string" ? value : undefined;
}
function requiredOption(parsed, name) {
    return requiredValue(option(parsed, name), `--${name}`);
}
function requiredValue(value, label) {
    if (!value)
        throw new Error(`Missing ${label}`);
    return value;
}
function referenceValue(optionValue, positionalValue, label) {
    if (optionValue !== undefined && positionalValue !== undefined) {
        throw new Error(`Provide ${label} either as an option or a positional value, not both`);
    }
    return optionValue ?? positionalValue;
}
function numberOption(parsed, name) {
    const value = option(parsed, name);
    if (value === undefined)
        return undefined;
    const number = Number(value);
    if (!Number.isInteger(number))
        throw new Error(`--${name} must be an integer`);
    return number;
}
function listOption(parsed, name) {
    const value = option(parsed, name);
    if (!value)
        return [];
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function flag(parsed, name) {
    const value = parsed.options.get(name);
    if (value === undefined)
        return false;
    if (value === true || value === "true" || value === "1")
        return true;
    if (value === "false" || value === "0")
        return false;
    throw new Error(`--${name} must be true or false`);
}
function assertKnownOptions(parsed, allowed) {
    const accepted = new Set(["root", ...allowed]);
    const unknown = [...parsed.options.keys()].filter((name) => !accepted.has(name));
    if (unknown.length > 0)
        throw new Error(`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `--${name}`).join(", ")}`);
}
function allowedOptions(command, subcommand, rest) {
    if (command === "init")
        return ["name"];
    if (command === "status")
        return [];
    if (command === "vocabulary")
        return subcommand === "add" ? ["kind", "name"] : [];
    if (command === "node") {
        if (subcommand === "create")
            return ["type", "title", "content", "content-file", "aliases", "distinct-from", "link-to", "relation", "direction"];
        if (subcommand === "update")
            return ["id", "title", "content", "content-file", "aliases", "mode", "old-text", "new-text", "edits-file"];
        if (subcommand === "remove")
            return ["id", "reason"];
        if (subcommand === "merge")
            return ["source", "into", "title", "content", "content-file", "aliases"];
        if (subcommand === "get")
            return ["id", "relation-limit"];
        if (subcommand === "list")
            return ["type", "limit", "offset"];
        if (subcommand === "resolve")
            return ["type", "title", "aliases", "limit", "content", "content-file"];
    }
    if (command === "link") {
        if (subcommand === "add")
            return ["from", "type", "to"];
        if (subcommand === "remove")
            return ["id"];
        if (subcommand === "suggest")
            return ["id", "limit"];
        if (subcommand === "list")
            return ["status", "limit"];
        if (subcommand === "accept")
            return ["id", "type"];
        if (subcommand === "reject")
            return ["id"];
    }
    if (command === "search")
        return ["query", "type", "limit", "depth"];
    if (command === "inspect")
        return ["id", "depth", "map-limit", "relation-limit", "max-hops", "chain-limit", "max-payload-bytes"];
    if (command === "map")
        return ["id", "depth", "limit"];
    if (command === "chains")
        return ["from", "id", "max-hops", "limit"];
    if (command === "gaps")
        return ["id", "age-days"];
    if (command === "stale")
        return ["age-days", "limit"];
    if (command === "export" && subcommand === "obsidian")
        return ["out", "prune"];
    if (command === "obsidian" && subcommand === "sync") {
        return rest[0] === "enable" ? ["out", "interval-seconds", "prune"] : [];
    }
    if (command === "opencode")
        return subcommand === "install" ? ["force"] : [];
    return [];
}
function assertPositionals(command, subcommand, rest) {
    if (command === "search")
        return;
    if (command === "node") {
        const maximum = subcommand === "update" || subcommand === "remove" || subcommand === "get" ? 1 : 0;
        if (rest.length > maximum)
            throw new Error(`Unexpected positional argument: ${rest[maximum]}`);
        return;
    }
    if (command === "link") {
        const maximum = ["remove", "suggest", "accept", "reject"].includes(subcommand ?? "") ? 1 : 0;
        if (rest.length > maximum)
            throw new Error(`Unexpected positional argument: ${rest[maximum]}`);
        return;
    }
    if (["inspect", "map", "chains", "gaps"].includes(command)) {
        if (rest.length > 0)
            throw new Error(`Unexpected positional argument: ${rest[0]}`);
        return;
    }
    if (command === "obsidian" && subcommand === "sync") {
        if (rest.length > 1)
            throw new Error(`Unexpected positional argument: ${rest[1]}`);
        return;
    }
    const extras = [subcommand, ...rest].filter((value) => Boolean(value));
    const consumedSubcommand = command === "vocabulary" || command === "export" || command === "opencode";
    const unconsumed = consumedSubcommand ? extras.slice(1) : extras;
    if (unconsumed.length > 0)
        throw new Error(`Unexpected positional argument: ${unconsumed[0]}`);
}
function readContent(parsed) {
    const direct = option(parsed, "content");
    const file = option(parsed, "content-file");
    if (direct !== undefined && file !== undefined)
        throw new Error("Use either --content or --content-file");
    if (direct !== undefined)
        return direct;
    if (file === "-")
        return node_fs_1.default.readFileSync(0, "utf8");
    if (file !== undefined)
        return node_fs_1.default.readFileSync(node_path_1.default.resolve(file), "utf8");
    return undefined;
}
function readInitialRelation(parsed) {
    const nodeId = option(parsed, "link-to");
    const type = option(parsed, "relation");
    const direction = option(parsed, "direction");
    const supplied = [nodeId, type, direction].filter((value) => value !== undefined).length;
    if (supplied === 0)
        return undefined;
    if (supplied !== 3)
        throw new Error("Use --link-to, --relation, and --direction together");
    if (direction !== "outgoing" && direction !== "incoming")
        throw new Error("--direction must be outgoing or incoming");
    return { nodeId: nodeId, type: type, direction };
}
function readEdits(parsed) {
    const hasFile = parsed.options.has("edits-file");
    const file = option(parsed, "edits-file");
    const hasOldText = parsed.options.has("old-text");
    const hasNewText = parsed.options.has("new-text");
    const hasDirectEdit = hasOldText || hasNewText;
    if (hasFile && file === undefined)
        throw new Error("Missing --edits-file value");
    if (hasFile && !file)
        throw new Error("--edits-file cannot be empty");
    if (hasFile && hasDirectEdit)
        throw new Error("Use either --edits-file or --old-text/--new-text");
    if ((hasFile || hasDirectEdit) && (parsed.options.has("content") || parsed.options.has("content-file"))) {
        throw new Error("Use either exact text edits or --content/--content-file");
    }
    if (hasDirectEdit) {
        if (!hasOldText || !hasNewText)
            throw new Error("Use --old-text and --new-text together");
        if (parsed.options.get("old-text") === true)
            throw new Error("Missing --old-text value");
        if (parsed.options.get("new-text") === true)
            throw new Error("Missing --new-text value; use --new-text= to delete the matched text");
        return [{ oldText: option(parsed, "old-text") ?? "", newText: option(parsed, "new-text") ?? "" }];
    }
    if (!hasFile)
        return undefined;
    const raw = file === "-" ? node_fs_1.default.readFileSync(0, "utf8") : node_fs_1.default.readFileSync(node_path_1.default.resolve(file), "utf8");
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        throw new Error("--edits-file must contain valid JSON");
    }
    if (!Array.isArray(value))
        throw new Error("--edits-file must contain a JSON array");
    return value;
}
function print(value) {
    node_process_1.default.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function printHelp() {
    node_process_1.default.stdout.write(`Argos graph-native security knowledge base

Usage:
  argos init [--root <path>] [--name <name>]
  argos status [--root <path>]
  argos vocabulary list [--root <path>]
  argos vocabulary add --kind node|relation --name <type>

  argos node create --type <type> --title <title> [--content <markdown> | --content-file <path|->]
                    [--aliases <a,b>] [--distinct-from <N...>]
                    --link-to <N...> --relation <type> --direction outgoing|incoming
  argos node update --id <N...> [--title <title>] [--content <markdown> | --content-file <path|->]
                    [--aliases <a,b>] [--mode replace|append]
                    [--old-text <exact>] [--new-text <replacement>] [--edits-file <path|->]
  argos node remove --id <N...> --reason <reason>
  argos node merge --source <N...> --into <N...> --content-file <reviewed-markdown>
                   [--title <title>] [--aliases <a,b>]
  argos node get --id <N...> [--relation-limit <n>]
  argos node list [--type <type>] [--limit <n>] [--offset <n>]
  argos node resolve --type <type> --title <title> [--aliases <a,b>] [--content <markdown> | --content-file <path|->]

  argos link add --from <N...> --type <relation> --to <N...>
  argos link remove --id <E...>
  argos link suggest --id <N...> [--limit <n>]
  argos link list [--status pending|accepted|rejected]
  argos link accept --id <L...> --type <relation>
  argos link reject --id <L...>

  argos search <query> [--type <type>] [--depth <0-3>] [--limit <n>]
  argos inspect <N...> [--depth <0-5>] [--map-limit <n>] [--relation-limit <n>] [--max-hops <1-7>] [--chain-limit <n>] [--max-payload-bytes <8192-131072>]
  argos map <N...> [--depth <0-5>] [--limit <n>]
  argos chains --from <N...> [--max-hops <1-7>] [--limit <n>]
  argos gaps [--id <N...>] [--age-days <n>]
  argos stale [--age-days <n>] [--limit <n>]
  argos export obsidian [--out <path>] [--prune]
  argos obsidian sync enable [--out <path>] [--interval-seconds <n>] [--prune true|false]
  argos obsidian sync status|refresh|disable
  argos opencode install [--force]
  argos opencode doctor

  All commands accept --root. Store durable target knowledge only, never campaign
  logs, task state, messages, or tool/runtime issues. Node content is free-form
  Markdown. Structural changes require explicit node and relation operations;
  Argos never infers them from prose. Obsidian sync checks for pending graph
  changes after normal workspace operations and can be disabled persistently
  with argos obsidian sync disable. Fresh targets use
  <root>/.argos/obsidian/<config-name> as the default vault.
`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    node_process_1.default.stderr.write(`${message}\n`);
    node_process_1.default.exitCode = 1;
});
