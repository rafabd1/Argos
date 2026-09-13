import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeFileAtomic } from "./paths";
import { resolveCommandFile } from "./process";

type JsonObject = Record<string, unknown>;

export interface OpenCodeInstallResult {
  root: string;
  configPath: string;
  created: string[];
  updated: string[];
  skipped: string[];
  advisories: string[];
}

export interface OpenCodeDoctorResult {
  root: string;
  opencode: { found: boolean; version?: string; error?: string };
  config: {
    path: string;
    exists: boolean;
    validJson: boolean;
    hasArgosMcp: boolean;
    hasArgosInstructions: boolean;
  };
  assets: { commands: string[]; skills: string[] };
  ok: boolean;
  advisories: string[];
}

const SKILL_ALIASES = [
  ["argos", "argos"],
  ["codebase-mapping", "argos-codebase-mapping"],
  ["chain-discovery", "argos-chain-discovery"],
  ["evidence-testing", "argos-evidence-testing"],
  ["adaptive-fuzzing", "argos-adaptive-fuzzing"],
  ["exploit-validation", "argos-exploit-validation"],
  ["external-intel", "argos-external-intel"],
  ["finding-report", "argos-finding-report"]
] as const;

export function installOpenCodeSupport(root: string, force = false): OpenCodeInstallResult {
  const targetRoot = path.resolve(root);
  const result: OpenCodeInstallResult = {
    root: targetRoot,
    configPath: path.join(targetRoot, "opencode.json"),
    created: [],
    updated: [],
    skipped: [],
    advisories: []
  };
  ensureDir(targetRoot);
  installConfig(targetRoot, result);
  installInstructions(targetRoot, result, force);
  installCommand(targetRoot, result, force);
  installSkills(targetRoot, result, force);
  return result;
}

export function doctorOpenCodeSupport(root: string): OpenCodeDoctorResult {
  const targetRoot = path.resolve(root);
  const configPath = path.join(targetRoot, "opencode.json");
  const parsed = readJsonObject(configPath);
  const opencode = detectOpenCode();
  const commands = listFiles(path.join(targetRoot, ".opencode", "commands"), ".md");
  const skills = listSkills(path.join(targetRoot, ".opencode", "skills"));
  const advisories: string[] = [];
  if (!opencode.found) advisories.push("OpenCode CLI was not found on PATH.");
  if (!fs.existsSync(configPath)) advisories.push("opencode.json is missing. Run `argos opencode install --root <path>`.");
  if (fs.existsSync(configPath) && !parsed.ok) advisories.push("opencode.json is not strict JSON. Add Argos manually if the file uses JSONC comments.");
  if (parsed.ok && !hasArgosMcp(parsed.value)) advisories.push("opencode.json does not enable the Argos MCP server.");
  if (parsed.ok && !hasArgosInstructions(parsed.value)) advisories.push("opencode.json does not load the Argos project instructions.");
  for (const [, target] of SKILL_ALIASES) {
    if (!skills.includes(target)) advisories.push(`Missing OpenCode skill: ${target}`);
  }
  if (!commands.includes("argos")) advisories.push("Missing OpenCode command: /argos");
  const config = {
    path: configPath,
    exists: fs.existsSync(configPath),
    validJson: parsed.ok,
    hasArgosMcp: parsed.ok && hasArgosMcp(parsed.value),
    hasArgosInstructions: parsed.ok && hasArgosInstructions(parsed.value)
  };
  return {
    root: targetRoot,
    opencode,
    config,
    assets: { commands, skills },
    ok: opencode.found && config.exists && config.validJson && config.hasArgosMcp && config.hasArgosInstructions && advisories.length === 0,
    advisories
  };
}

function installConfig(root: string, result: OpenCodeInstallResult): void {
  const file = path.join(root, "opencode.json");
  const parsed = readJsonObject(file);
  if (!parsed.ok) {
    result.skipped.push(file);
    result.advisories.push("Skipped opencode.json because it is not strict JSON. Preserve its comments and add the Argos MCP and instruction entries manually.");
    return;
  }
  const config = parsed.value ?? {};
  if (typeof config.$schema !== "string") config.$schema = "https://opencode.ai/config.json";
  config.mcp = isObject(config.mcp) ? config.mcp : {};
  (config.mcp as JsonObject).argos = {
    type: "local",
    command: ["argos-mcp"],
    enabled: true,
    timeout: 15000
  };
  const instructions = Array.isArray(config.instructions)
    ? config.instructions.filter((item): item is string => typeof item === "string")
    : [];
  if (!instructions.includes(".opencode/instructions/argos.md")) instructions.push(".opencode/instructions/argos.md");
  config.instructions = instructions;
  config.permission = isObject(config.permission) ? config.permission : {};
  (config.permission as JsonObject).skill = isObject((config.permission as JsonObject).skill)
    ? (config.permission as JsonObject).skill
    : {};
  ((config.permission as JsonObject).skill as JsonObject)["argos*"] = "allow";
  writeConfig(file, `${JSON.stringify(config, null, 2)}\n`, result);
}

function installInstructions(root: string, result: OpenCodeInstallResult, force: boolean): void {
  const content = `# Argos OpenCode Runtime

Use the \`argos\` skill for connected security research. Load a specialist \`argos-*\` skill only when its method fits the current work. Use the local \`argos\` MCP server for the shared knowledge graph and use the CLI only when the MCP operation is unavailable.

Keep every call rooted at the target workspace. Resolve canonical identity before creating a node, inspect a bounded linked map before deep work, and treat relation suggestions and knowledge gaps as leads that require evidence.
`;
  writeManaged(path.join(root, ".opencode", "instructions", "argos.md"), content, result, force);
}

function installCommand(root: string, result: OpenCodeInstallResult, force: boolean): void {
  const source = path.join(pluginRoot(), "commands", "argos.md");
  const content = fs.readFileSync(source, "utf8");
  writeManaged(path.join(root, ".opencode", "commands", "argos.md"), content, result, force);
}

function installSkills(root: string, result: OpenCodeInstallResult, force: boolean): void {
  const sourceRoot = path.join(pluginRoot(), "skills");
  for (const [sourceName, targetName] of SKILL_ALIASES) {
    const sourceDir = path.join(sourceRoot, sourceName);
    if (!fs.existsSync(path.join(sourceDir, "SKILL.md"))) {
      result.advisories.push(`Packaged Argos skill is missing: ${sourceName}`);
      continue;
    }
    for (const source of walkFiles(sourceDir)) {
      const relative = path.relative(sourceDir, source);
      let content = fs.readFileSync(source, "utf8");
      if (relative.toLowerCase() === "skill.md") content = rewriteSkillName(content, targetName);
      writeManaged(path.join(root, ".opencode", "skills", targetName, relative), content, result, force);
    }
  }
}

function rewriteSkillName(content: string, name: string): string {
  return content.replace(/^(---\r?\n[\s\S]*?\r?\nname:)\s*[^\r\n]+/m, `$1 ${name}`);
}

function writeConfig(file: string, content: string, result: OpenCodeInstallResult): void {
  const existed = fs.existsSync(file);
  if (existed && fs.readFileSync(file, "utf8") === content) {
    result.skipped.push(file);
    return;
  }
  writeFileAtomic(file, content);
  (existed ? result.updated : result.created).push(file);
}

function writeManaged(file: string, content: string, result: OpenCodeInstallResult, force: boolean): void {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === content) {
      result.skipped.push(file);
      return;
    }
    if (!force) {
      result.skipped.push(file);
      result.advisories.push(`Skipped modified file: ${file}. Use --force to replace managed OpenCode assets.`);
      return;
    }
  }
  const existed = fs.existsSync(file);
  writeFileAtomic(file, content);
  (existed ? result.updated : result.created).push(file);
}

function readJsonObject(file: string): { ok: true; value: JsonObject | null } | { ok: false; value: null } {
  if (!fs.existsSync(file)) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return isObject(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function hasArgosMcp(config: JsonObject | null): boolean {
  if (!config || !isObject(config.mcp)) return false;
  const entry = config.mcp.argos;
  return isObject(entry) && entry.type === "local" && Array.isArray(entry.command) && entry.command.includes("argos-mcp") && entry.enabled !== false;
}

function hasArgosInstructions(config: JsonObject | null): boolean {
  return Boolean(config && Array.isArray(config.instructions) && config.instructions.includes(".opencode/instructions/argos.md"));
}

function detectOpenCode(): OpenCodeDoctorResult["opencode"] {
  const command = process.env.OPENCODE_COMMAND?.trim() || "opencode";
  const result = spawnSync(resolveCommandFile(command), ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const version = String(result.stdout ?? "").trim();
  return result.status === 0 && version
    ? { found: true, version }
    : { found: false, error: String(result.stderr || result.error?.message || "OpenCode command failed").trim() };
}

function walkFiles(root: string): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function listFiles(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name.slice(0, -suffix.length))
    .sort();
}

function listSkills(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function pluginRoot(): string {
  const candidates = [
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", "plugins", "argos")
  ];
  const match = candidates.find((candidate) => fs.existsSync(path.join(candidate, "skills", "argos", "SKILL.md")));
  if (!match) throw new Error("Argos plugin assets were not found beside the runtime");
  return match;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
