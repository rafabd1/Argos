import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  removed: string[];
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

const SKILL_ALIASES = [["argos", "argos"]] as const;

const RETIRED_SKILLS: Record<string, Record<string, string>> = {
  "argos-adaptive-fuzzing": {
    "SKILL.md": "ed98f36156c80a7d5249f6266e7cb83e63ceed415509e7632088dd08fa0334c8"
  },
  "argos-chain-discovery": {
    "SKILL.md": "33cff803b6d84fff68f7467011b9fed511a48eaf8681105ce396d98470c82a75"
  },
  "argos-codebase-mapping": {
    "SKILL.md": "283c29dcb0dbb26a764df91b774e840120fe4e142762867fbe810ed72105a258"
  },
  "argos-evidence-testing": {
    "SKILL.md": "a8523b4bdc9990421e5bba177e870b249b6d67a19ed9b47bc9f38b3670d47736"
  },
  "argos-exploit-validation": {
    "SKILL.md": "5c3cb33783bbd2efc245b176a4276963305b7ff3d2390727eb771bf7b7c2d5f9"
  },
  "argos-external-intel": {
    "SKILL.md": "66be3d8dc85e70abf0c03f201376f84bca966d0bbaad21cf900bc56d1bc13d64"
  },
  "argos-finding-report": {
    "SKILL.md": "3d0b27171b4b0d5d2bb46747850aa359548ecc4cb0d9f4e2cd763009ae7fde45",
    "references/report-template.md": "afaab5e2d047b35bcbb3bcdd549bf3798468b131aa72c1db80518b5ae6812b09"
  }
};

const PREVIOUS_MANAGED_HASHES = new Set([
  "b1097c93ea26377308740f38c8e6f3260f4931f5166de2ef0938dee22e6389f8",
  "a11edb29747179efb1b160daee7cd168b0578e75b11b8a124ea395d2544a7a8c",
  "8064d90c24cbaeeecde3aab0d6f8a7671a35c690ac0467fbd0e9dc8b0299f4c2",
  "174ae718570dc1c56f5305a3bada3dfaa593ec82cb264f51d349d665bc106d16",
  "1d9ad2b44cd7ae7ea225a8da18d526ca926d553f4d300fd133cc1177176ff933"
]);

export function installOpenCodeSupport(root: string, force = false): OpenCodeInstallResult {
  const targetRoot = path.resolve(root);
  const result: OpenCodeInstallResult = {
    root: targetRoot,
    configPath: path.join(targetRoot, "opencode.json"),
    created: [],
    updated: [],
    removed: [],
    skipped: [],
    advisories: []
  };
  ensureDir(targetRoot);
  installConfig(targetRoot, result);
  installInstructions(targetRoot, result, force);
  installCommand(targetRoot, result, force);
  removeRetiredSkills(targetRoot, result, force);
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
  for (const retired of Object.keys(RETIRED_SKILLS)) {
    if (skills.includes(retired)) advisories.push(`Retired OpenCode skill is still installed: ${retired}. Run \`argos opencode install --root <path>\` to remove an unchanged managed copy, or remove a customized copy after review.`);
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

Use the \`argos\` skill for the knowledge graph. It defines canonical identity, hierarchy, relations, bounded retrieval, updates, and export. Use the local \`argos\` MCP server for the shared graph and use the CLI only when the MCP operation is unavailable.

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

function removeRetiredSkills(root: string, result: OpenCodeInstallResult, force: boolean): void {
  const skillsRoot = path.join(root, ".opencode", "skills");
  for (const [name, expected] of Object.entries(RETIRED_SKILLS)) {
    const dir = path.join(skillsRoot, name);
    if (!fs.existsSync(dir)) continue;
    if (!force && !matchesManagedTree(dir, expected)) {
      result.skipped.push(dir);
      result.advisories.push(`Preserved customized retired OpenCode skill: ${dir}. Review it, then remove it or rerun with --force.`);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    result.removed.push(dir);
  }
}

function matchesManagedTree(root: string, expected: Record<string, string>): boolean {
  const files = walkFiles(root).map((file) => path.relative(root, file).replaceAll("\\", "/")).sort();
  const expectedFiles = Object.keys(expected).sort();
  if (files.length !== expectedFiles.length || files.some((file, index) => file !== expectedFiles[index])) return false;
  return files.every((relative) => normalizedHash(path.join(root, relative)) === expected[relative]);
}

function normalizedHash(file: string): string {
  const content = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n").replace(/[\r\n]+$/u, "") + "\n";
  return createHash("sha256").update(content, "utf8").digest("hex");
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
    if (!force && !PREVIOUS_MANAGED_HASHES.has(normalizedHash(file))) {
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
