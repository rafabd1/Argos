#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ArgosDb, initializeArgos } from "./db";
import {
  acceptCouncil,
  advanceCouncil,
  beginCouncil,
  broadcastChimera,
  closeCouncil,
  configureChimera,
  councilStatus,
  doctorChimera,
  inviteCouncil,
  killChimera,
  listChimera,
  listCouncils,
  pollChimera,
  readChimeraConfig,
  runChimera,
  runChimeraWorker,
  sendChimera,
  startChimera,
  submitCouncilTurn,
  workflowSnapshot
} from "./chimera";
import { exportObsidian } from "./obsidian";
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
    print(initializeArgos(root, option(parsed, "name")));
    return;
  }
  if (command === "status") {
    if (!fs.existsSync(knowledgePath(root))) {
      print({ initialized: false, root });
      return;
    }
    print(withDb(root, (db) => db.status()));
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
    print(withDb(root, (db) => exportObsidian(db, option(parsed, "out"), flag(parsed, "prune"))));
    return;
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
  if (command === "chimera") {
    await handleChimera(root, subcommand, rest, parsed);
    return;
  }
  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

async function handleChimera(root: string, subcommand: string | undefined, rest: string[], parsed: ParsedArgs): Promise<void> {
  if (subcommand === "config") {
    const action = rest[0] ?? "show";
    if (action === "show") {
      print(readChimeraConfig());
      return;
    }
    if (action === "init" || action === "set") {
      const current = readChimeraConfig();
      print(configureChimera({
        enabled: parsed.options.has("enabled") ? flag(parsed, "enabled") : true,
        opencodeCommand: option(parsed, "opencode-command") ?? current.opencodeCommand,
        defaultModel: parsed.options.has("model") ? option(parsed, "model") ?? null : current.defaultModel,
        defaultVariant: parsed.options.has("variant") ? option(parsed, "variant") ?? null : current.defaultVariant,
        defaultAgent: option(parsed, "agent") ?? current.defaultAgent,
        maxAgents: numberOption(parsed, "max-agents") ?? current.maxAgents,
        defaultNetwork: parsed.options.has("network") ? flag(parsed, "network") : current.defaultNetwork,
        autoApprove: parsed.options.has("auto-approve") ? flag(parsed, "auto-approve") : current.autoApprove,
        serverUrl: current.serverUrl,
        serverPid: current.serverPid
      }));
      return;
    }
    throw new Error("Usage: argos chimera config show|init|set");
  }
  if (subcommand === "doctor") {
    print(await doctorChimera(root));
    return;
  }
  if (subcommand === "start") {
    const access = option(parsed, "access") ?? "explorer";
    if (access !== "explorer" && access !== "editor") throw new Error("--access must be explorer or editor");
    print(await startChimera(root, {
      role: option(parsed, "role"),
      goal: requiredOption(parsed, "goal"),
      nodeIds: listOption(parsed, "nodes"),
      accessMode: access,
      accessNotes: option(parsed, "access-notes"),
      model: option(parsed, "model"),
      variant: option(parsed, "variant"),
      networkAllowed: parsed.options.has("network") ? flag(parsed, "network") : undefined,
      autoApprove: parsed.options.has("auto-approve") ? flag(parsed, "auto-approve") : undefined
    }));
    return;
  }
  if (subcommand === "run") {
    print(await runChimera(root, requiredOption(parsed, "id"), option(parsed, "message")));
    return;
  }
  if (subcommand === "_worker") {
    await runChimeraWorker(root, requiredOption(parsed, "id"));
    return;
  }
  if (subcommand === "list") {
    print(await listChimera(root, { active: flag(parsed, "active"), limit: numberOption(parsed, "limit") }));
    return;
  }
  if (subcommand === "send") {
    print(await sendChimera(root, {
      to: requiredOption(parsed, "to"),
      from: option(parsed, "from"),
      body: requiredOption(parsed, "body"),
      priority: flag(parsed, "priority"),
      kind: messageKind(option(parsed, "kind"))
    }));
    return;
  }
  if (subcommand === "broadcast") {
    print(await broadcastChimera(root, {
      from: option(parsed, "from"),
      body: requiredOption(parsed, "body"),
      priority: flag(parsed, "priority")
    }));
    return;
  }
  if (subcommand === "poll") {
    print(await pollChimera(root, {
      identity: option(parsed, "identity"),
      unread: !flag(parsed, "all"),
      peek: flag(parsed, "peek"),
      limit: numberOption(parsed, "limit")
    }));
    return;
  }
  if (subcommand === "kill") {
    print(await killChimera(root, requiredOption(parsed, "id"), option(parsed, "reason")));
    return;
  }
  if (subcommand === "workflow-snapshot") {
    print(await workflowSnapshot(root, requiredOption(parsed, "id"), {
      limit: numberOption(parsed, "limit"),
      maxMessageChars: numberOption(parsed, "max-message-chars")
    }));
    return;
  }
  if (subcommand === "council") {
    const action = rest[0];
    if (action === "invite") {
      print(await inviteCouncil(root, {
        topic: requiredOption(parsed, "topic"),
        participantIds: listOption(parsed, "participants"),
        maxRounds: numberOption(parsed, "max-rounds")
      }));
      return;
    }
    if (action === "accept") {
      print(await acceptCouncil(root, requiredOption(parsed, "id"), option(parsed, "participant")));
      return;
    }
    if (action === "begin") {
      print(await beginCouncil(root, requiredOption(parsed, "id"), requiredOption(parsed, "body")));
      return;
    }
    if (action === "turn") {
      print(await submitCouncilTurn(root, requiredOption(parsed, "id"), requiredOption(parsed, "body"), option(parsed, "speaker")));
      return;
    }
    if (action === "advance") {
      print(await advanceCouncil(root, requiredOption(parsed, "id"), requiredOption(parsed, "body"), flag(parsed, "extend")));
      return;
    }
    if (action === "close") {
      print(await closeCouncil(root, requiredOption(parsed, "id"), requiredOption(parsed, "body")));
      return;
    }
    if (action === "status") {
      print(councilStatus(root, requiredOption(parsed, "id")));
      return;
    }
    if (action === "list") {
      print(listCouncils(root, numberOption(parsed, "limit")));
      return;
    }
    throw new Error("Usage: argos chimera council invite|accept|begin|turn|advance|close|status|list");
  }
  throw new Error("Usage: argos chimera config|doctor|start|run|list|send|broadcast|poll|kill|workflow-snapshot|council");
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

function withDb<T>(root: string, action: (db: ArgosDb) => T): T {
  const db = new ArgosDb(root);
  try {
    return action(db);
  } finally {
    db.close();
  }
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
  if (command === "opencode") return subcommand === "install" ? ["force"] : [];
  if (command === "chimera") {
    if (subcommand === "config") {
      const action = rest[0] ?? "show";
      return action === "show" ? [] : ["enabled", "opencode-command", "model", "variant", "agent", "max-agents", "network", "auto-approve"];
    }
    if (subcommand === "doctor") return [];
    if (subcommand === "start") return ["role", "goal", "nodes", "access", "access-notes", "model", "variant", "network", "auto-approve"];
    if (subcommand === "run") return ["id", "message"];
    if (subcommand === "_worker") return ["id"];
    if (subcommand === "list") return ["active", "limit"];
    if (subcommand === "send") return ["to", "from", "body", "priority", "kind"];
    if (subcommand === "broadcast") return ["from", "body", "priority"];
    if (subcommand === "poll") return ["identity", "all", "peek", "limit"];
    if (subcommand === "kill") return ["id", "reason"];
    if (subcommand === "workflow-snapshot") return ["id", "limit", "max-message-chars"];
    if (subcommand === "council") {
      const action = rest[0];
      if (action === "invite") return ["topic", "participants", "max-rounds"];
      if (action === "accept") return ["id", "participant"];
      if (action === "begin" || action === "close") return ["id", "body"];
      if (action === "turn") return ["id", "body", "speaker"];
      if (action === "advance") return ["id", "body", "extend"];
      if (action === "status") return ["id"];
      if (action === "list") return ["limit"];
    }
  }
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
  if (command === "chimera") {
    const maximum = subcommand === "config" || subcommand === "council" ? 1 : 0;
    if (rest.length > maximum) throw new Error(`Unexpected positional argument: ${rest[maximum]}`);
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

function messageKind(value: string | undefined): "message" | "snapshot" | "council" | "system" | undefined {
  if (value === undefined) return undefined;
  if (value === "message" || value === "snapshot" || value === "council" || value === "system") return value;
  throw new Error("--kind must be message, snapshot, council, or system");
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
  argos opencode install [--force]
  argos opencode doctor

  argos chimera config init [--opencode-command <command>] [--model <provider/model>]
                             [--variant <name>] [--max-agents <n>] [--network]
  argos chimera doctor
  argos chimera start --goal <text> [--role generalist|<skill>] [--nodes <N...,...>]
                       [--access explorer|editor] [--access-notes <rules>]
                       [--network true|false] [--auto-approve true|false]
  argos chimera run --id <CH...> [--message <recovery instruction>]
  argos chimera list [--active] [--limit <n>]
  argos chimera send --to coordinator|<CH...> --body <text> [--priority]
  argos chimera broadcast --body <text> [--priority]
  argos chimera poll [--identity coordinator|<CH...>] [--all] [--peek]
  argos chimera kill --id <CH...> [--reason <text>]
  argos chimera workflow-snapshot --id <CH...> [--limit <n>] [--max-message-chars <n>]
  argos chimera council invite --topic <text> [--participants <CH...,...>] [--max-rounds 2]
  argos chimera council accept|begin|turn|advance|close|status|list ...

All commands accept --root. Node content is free-form Markdown. Structural
changes require explicit node and relation operations; Argos never infers them
from prose.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
