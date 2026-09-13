#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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
import { knowledgePath, resolveTargetRoot } from "./paths";
import { addVocabularyType, readConfig } from "./vocabulary";
import { packageVersion } from "./version";

interface ParsedArgs {
  positional: string[];
  options: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...rest] = parsed.positional;
  if (!command && parsed.options.has("version")) {
    assertKnownOptions(parsed, ["version"]);
    print({ name: "@rafabd1/argos", version: packageVersion() });
    return;
  }
  if (!command || command === "help" || parsed.options.has("help")) {
    printHelp();
    return;
  }
  if (command === "version") {
    assertKnownOptions(parsed, []);
    print({ name: "@rafabd1/argos", version: packageVersion() });
    return;
  }
  assertKnownOptions(parsed, allowedOptions(command, subcommand, rest));
  assertPositionals(command, subcommand, rest);
  const root = resolveTargetRoot(option(parsed, "root"));

  if (command === "init") {
    const result = initializeArgos(root, option(parsed, "name"));
    print({ ...result, obsidianSync: ensureObsidianSync(root) });
    return;
  }
  if (command === "status") {
    if (!fs.existsSync(knowledgePath(root))) {
      print({ initialized: false, root });
      return;
    }
    const result = withDb(root, (db) => db.status());
    print({ ...result, obsidianSync: readObsidianSyncStatus(root) });
    return;
  }
  if (command === "vocabulary") {
    if (subcommand === "list" || !subcommand) {
      print(readConfig(root));
      return;
    }
    if (subcommand === "add") {
      const kind = requiredOption(parsed, "kind");
      if (kind !== "node" && kind !== "relation") throw new Error("--kind must be node or relation");
      print(addVocabularyType(root, kind, requiredOption(parsed, "name")));
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
      chainLimit: numberOption(parsed, "chain-limit")
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
  if (command === "history") {
    const id = referenceValue(option(parsed, "id"), subcommand, "node id");
    print(withDb(root, (db) => db.history(requiredValue(id, "node id"), numberOption(parsed, "limit") ?? 50)));
    return;
  }
  if (command === "export" && subcommand === "obsidian") {
    print(withDb(root, (db) => exportObsidian(db, option(parsed, "out"), flag(parsed, "prune")), false));
    return;
  }
  if (command === "obsidian" && subcommand === "sync") {
    const action = rest[0] ?? "status";
    if (action === "enable") {
      print(enableObsidianSync(root, {
        output: option(parsed, "out"),
        intervalSeconds: numberOption(parsed, "interval-seconds"),
        prune: parsed.options.has("prune") ? flag(parsed, "prune") : undefined
      }));
      return;
    }
    if (action === "disable") {
      print(disableObsidianSync(root));
      return;
    }
    if (action === "refresh") {
      print(refreshObsidianSync(root));
      return;
    }
    if (action === "status") {
      print(ensureObsidianSync(root));
      return;
    }
    throw new Error("Usage: argos obsidian sync enable|status|refresh|disable");
  }
  if (command === "opencode") {
    const action = subcommand ?? "doctor";
    if (action === "install") {
      print(installOpenCodeSupport(root, flag(parsed, "force")));
      return;
    }
    if (action === "doctor") {
      print(doctorOpenCodeSupport(root));
      return;
    }
    throw new Error("Usage: argos opencode install|doctor");
  }
  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

async function handleNode(root: string, subcommand: string | undefined, rest: string[], parsed: ParsedArgs): Promise<void> {
  if (subcommand === "create") {
    const result = withDb(root, (db) => db.createNode({
      type: requiredOption(parsed, "type"),
      title: requiredOption(parsed, "title"),
      content: readContent(parsed) ?? "",
      aliases: listOption(parsed, "aliases"),
      distinctFrom: listOption(parsed, "distinct-from")
    }));
    print(result);
    if (result.resolutionRequired) process.exitCode = 2;
    return;
  }
  if (subcommand === "update") {
    const id = referenceValue(option(parsed, "id"), rest[0], "node id");
    const modeValue = option(parsed, "mode");
    if (modeValue && modeValue !== "replace" && modeValue !== "append") throw new Error("--mode must be replace or append");
    print(withDb(root, (db) => db.updateNode(requiredValue(id, "node id"), {
      title: option(parsed, "title"),
      content: readContent(parsed),
      aliases: parsed.options.has("aliases") ? listOption(parsed, "aliases") : undefined,
      mode: modeValue as "replace" | "append" | undefined
    })));
    return;
  }
  if (subcommand === "merge") {
    const content = readContent(parsed);
    if (content === undefined) throw new Error("Node merge requires --content or --content-file with the reviewed consolidated note");
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
    print(withDb(root, (db) => db.resolveIdentity(
      requiredOption(parsed, "type"),
      requiredOption(parsed, "title"),
      listOption(parsed, "aliases"),
      numberOption(parsed, "limit") ?? 10,
      readContent(parsed) ?? ""
    )));
    return;
  }
  throw new Error("Usage: argos node create|update|merge|get|list|resolve");
}

function handleLink(root: string, subcommand: string | undefined, rest: string[], parsed: ParsedArgs): void {
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
    if (!(["pending", "accepted", "rejected"] as string[]).includes(status)) throw new Error("--status must be pending, accepted, or rejected");
    print(withDb(root, (db) => db.listSuggestions(status as "pending" | "accepted" | "rejected", numberOption(parsed, "limit") ?? 50)));
    return;
  }
  if (subcommand === "accept" || subcommand === "reject") {
    const id = referenceValue(option(parsed, "id"), rest[0], "suggestion id");
    print(withDb(root, (db) => db.reviewSuggestion(requiredValue(id, "suggestion id"), subcommand, option(parsed, "type"))));
    return;
  }
  throw new Error("Usage: argos link add|remove|suggest|list|accept|reject");
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

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();
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
    } else {
      options.set(key, true);
    }
  }
  return { positional, options };
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  return requiredValue(option(parsed, name), `--${name}`);
}

function requiredValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function referenceValue(optionValue: string | undefined, positionalValue: string | undefined, label: string): string | undefined {
  if (optionValue !== undefined && positionalValue !== undefined) {
    throw new Error(`Provide ${label} either as an option or a positional value, not both`);
  }
  return optionValue ?? positionalValue;
}

function numberOption(parsed: ParsedArgs, name: string): number | undefined {
  const value = option(parsed, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`--${name} must be an integer`);
  return number;
}

function listOption(parsed: ParsedArgs, name: string): string[] {
  const value = option(parsed, name);
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function flag(parsed: ParsedArgs, name: string): boolean {
  const value = parsed.options.get(name);
  if (value === undefined) return false;
  if (value === true || value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`--${name} must be true or false`);
}

function assertKnownOptions(parsed: ParsedArgs, allowed: string[]): void {
  const accepted = new Set(["root", ...allowed]);
  const unknown = [...parsed.options.keys()].filter((name) => !accepted.has(name));
  if (unknown.length > 0) throw new Error(`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `--${name}`).join(", ")}`);
}

function allowedOptions(command: string, subcommand: string | undefined, rest: string[]): string[] {
  if (command === "init") return ["name"];
  if (command === "status") return [];
  if (command === "vocabulary") return subcommand === "add" ? ["kind", "name"] : [];
  if (command === "node") {
    if (subcommand === "create") return ["type", "title", "content", "content-file", "aliases", "distinct-from"];
    if (subcommand === "update") return ["id", "title", "content", "content-file", "aliases", "mode"];
    if (subcommand === "merge") return ["source", "into", "title", "content", "content-file", "aliases"];
    if (subcommand === "get") return ["id", "relation-limit"];
    if (subcommand === "list") return ["type", "limit", "offset"];
    if (subcommand === "resolve") return ["type", "title", "aliases", "limit", "content", "content-file"];
  }
  if (command === "link") {
    if (subcommand === "add") return ["from", "type", "to"];
    if (subcommand === "remove") return ["id"];
    if (subcommand === "suggest") return ["id", "limit"];
    if (subcommand === "list") return ["status", "limit"];
    if (subcommand === "accept") return ["id", "type"];
    if (subcommand === "reject") return ["id"];
  }
  if (command === "search") return ["query", "type", "limit", "depth"];
  if (command === "inspect") return ["id", "depth", "map-limit", "relation-limit", "max-hops", "chain-limit"];
  if (command === "map") return ["id", "depth", "limit"];
  if (command === "chains") return ["from", "id", "max-hops", "limit"];
  if (command === "gaps") return ["id", "age-days"];
  if (command === "stale") return ["age-days", "limit"];
  if (command === "history") return ["id", "limit"];
  if (command === "export" && subcommand === "obsidian") return ["out", "prune"];
  if (command === "obsidian" && subcommand === "sync") {
    return rest[0] === "enable" ? ["out", "interval-seconds", "prune"] : [];
  }
  if (command === "opencode") return subcommand === "install" ? ["force"] : [];
  return [];
}

function assertPositionals(command: string, subcommand: string | undefined, rest: string[]): void {
  if (command === "search") return;
  if (command === "node") {
    const maximum = subcommand === "update" || subcommand === "get" ? 1 : 0;
    if (rest.length > maximum) throw new Error(`Unexpected positional argument: ${rest[maximum]}`);
    return;
  }
  if (command === "link") {
    const maximum = ["remove", "suggest", "accept", "reject"].includes(subcommand ?? "") ? 1 : 0;
    if (rest.length > maximum) throw new Error(`Unexpected positional argument: ${rest[maximum]}`);
    return;
  }
  if (["inspect", "map", "chains", "gaps", "history"].includes(command)) {
    if (rest.length > 0) throw new Error(`Unexpected positional argument: ${rest[0]}`);
    return;
  }
  if (command === "obsidian" && subcommand === "sync") {
    if (rest.length > 1) throw new Error(`Unexpected positional argument: ${rest[1]}`);
    return;
  }
  const extras = [subcommand, ...rest].filter((value): value is string => Boolean(value));
  const consumedSubcommand = command === "vocabulary" || command === "export" || command === "opencode";
  const unconsumed = consumedSubcommand ? extras.slice(1) : extras;
  if (unconsumed.length > 0) throw new Error(`Unexpected positional argument: ${unconsumed[0]}`);
}

function readContent(parsed: ParsedArgs): string | undefined {
  const direct = option(parsed, "content");
  const file = option(parsed, "content-file");
  if (direct !== undefined && file !== undefined) throw new Error("Use either --content or --content-file");
  if (direct !== undefined) return direct;
  if (file === "-") return fs.readFileSync(0, "utf8");
  if (file !== undefined) return fs.readFileSync(path.resolve(file), "utf8");
  return undefined;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`Argos graph-native security knowledge base

Usage:
  argos init [--root <path>] [--name <name>]
  argos status [--root <path>]
  argos vocabulary list [--root <path>]
  argos vocabulary add --kind node|relation --name <type>

  argos node create --type <type> --title <title> [--content <markdown> | --content-file <path|->]
                    [--aliases <a,b>] [--distinct-from <N...>]
  argos node update --id <N...> [--title <title>] [--content <markdown> | --content-file <path|->]
                    [--aliases <a,b>] [--mode replace|append]
  argos node merge --source <N...> --into <N...> --content-file <reviewed-markdown>
                   [--title <title>] [--aliases <a,b>]
  argos node get --id <N...> [--relation-limit <n>]
  argos node list [--type <type>] [--limit <n>] [--offset <n>]
  argos node resolve --type <type> --title <title> [--aliases <a,b>] [--content <markdown> | --content-file <path|->]

  argos link add --from <N...> --type <relation> --to <N...>
  argos link remove --id <E...>
  argos link suggest --id <N...> [--limit <n>]
  argos link list [--status pending|accepted|rejected]
  argos link accept|reject --id <L...> [--type <relation>]

  argos search <query> [--type <type>] [--depth <0-3>] [--limit <n>]
  argos inspect <N...> [--depth <0-5>] [--map-limit <n>] [--relation-limit <n>] [--max-hops <1-7>] [--chain-limit <n>]
  argos map <N...> [--depth <0-5>] [--limit <n>]
  argos chains --from <N...> [--max-hops <1-7>] [--limit <n>]
  argos gaps [--id <N...>] [--age-days <n>]
  argos stale [--age-days <n>] [--limit <n>]
  argos history <N...> [--limit <n>]
  argos export obsidian [--out <path>] [--prune]
  argos obsidian sync enable [--out <path>] [--interval-seconds <n>] [--prune true|false]
  argos obsidian sync status|refresh|disable
  argos opencode install [--force]
  argos opencode doctor

  All commands accept --root. Node content is free-form Markdown. Structural
changes require explicit node and relation operations; Argos never infers them
from prose. Obsidian sync checks for pending graph changes after normal workspace
operations and can be disabled persistently with argos obsidian sync disable.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
