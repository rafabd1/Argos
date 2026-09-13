import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const packageJson = readJson("package.json");
const codex = readJson("plugins/argos/.codex-plugin/plugin.json");
const claude = readJson("plugins/argos/.claude-plugin/plugin.json");
const agentsMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");

assert.equal(packageJson.name, "@rafabd1/argos");
assert.equal(packageJson.repository.url, "git+https://github.com/rafabd1/Argos.git");
assert.equal(codex.version, packageJson.version);
assert.equal(claude.version, packageJson.version);
assert.equal(claudeMarketplace.version, packageJson.version);
assert.equal(claudeMarketplace.plugins[0].version, packageJson.version);
assert.equal(codex.repository, "https://github.com/rafabd1/Argos");
assert.equal(claude.repository, "https://github.com/rafabd1/Argos");
assert.equal(agentsMarketplace.plugins[0].source.path, "./plugins/argos");
assert.equal(codex.mcpServers.argos.command, "argos-mcp");

for (const relative of [
  "dist/cli.js",
  "dist/mcp.js",
  "plugins/argos/dist/cli.js",
  "plugins/argos/dist/mcp.js",
  "plugins/argos/.mcp.json",
  "plugins/argos/scripts/argos-mcp.cjs",
  "plugins/argos/commands/argos.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/INSTALLATION.md",
  "docs/RUNTIME.md"
]) {
  assert(fs.existsSync(path.join(root, relative)), `Missing packaged file: ${relative}`);
}

const skillsRoot = path.join(root, "plugins", "argos", "skills");
const skills = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
const requiredSkills = ["argos", "codebase-mapping", "chain-discovery", "evidence-testing", "adaptive-fuzzing", "exploit-validation", "external-intel", "finding-report"];
assert.deepEqual(skills.map((entry) => entry.name).sort(), requiredSkills.sort());
for (const entry of skills) {
  const file = path.join(skillsRoot, entry.name, "SKILL.md");
  assert(fs.existsSync(file), `Missing SKILL.md for ${entry.name}`);
  const text = fs.readFileSync(file, "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(frontmatter, `Missing frontmatter for ${entry.name}`);
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  assert.equal(name, entry.name, `Skill name mismatch for ${entry.name}`);
  assert(!/\[TODO\]|TODO:\s*$|replace me/i.test(text), `Unfinished placeholder in ${entry.name}`);
}

const bundledCli = spawnSync(process.execPath, [path.join(root, "plugins", "argos", "dist", "cli.js"), "--version"], {
  encoding: "utf8",
  timeout: 5_000,
  windowsHide: true
});
assert.equal(bundledCli.status, 0, bundledCli.stderr);
assert.equal(JSON.parse(bundledCli.stdout).version, packageJson.version);

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-test", version: "1" } }
});
const bundledMcp = spawnSync(process.execPath, [path.join(root, "plugins", "argos", "scripts", "argos-mcp.cjs")], {
  input: `${initialize}\n`,
  encoding: "utf8",
  timeout: 5_000,
  windowsHide: true
});
assert.equal(bundledMcp.status, 0, bundledMcp.stderr);
assert.equal(JSON.parse(bundledMcp.stdout.trim()).result.serverInfo.version, packageJson.version);

const releaseTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "argos-release-test-"));
try {
  const releaseNotes = path.join(releaseTestDir, "CHANGELOG.md");
  const generated = spawnSync(process.execPath, [
    path.join(root, "scripts", "generate-changelog.mjs"),
    "--version",
    `v${packageJson.version}`,
    "--out",
    releaseNotes
  ], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  assert(fs.readFileSync(releaseNotes, "utf8").startsWith(`## [${packageJson.version}]`));
} finally {
  fs.rmSync(releaseTestDir, { recursive: true, force: true });
}

process.stdout.write("Argos package validation passed.\n");
