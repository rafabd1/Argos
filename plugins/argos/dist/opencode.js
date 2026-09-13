"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installOpenCodeSupport = installOpenCodeSupport;
exports.doctorOpenCodeSupport = doctorOpenCodeSupport;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const process_1 = require("./process");
const SKILL_ALIASES = [
    ["argos", "argos"],
    ["codebase-mapping", "argos-codebase-mapping"],
    ["chain-discovery", "argos-chain-discovery"],
    ["evidence-testing", "argos-evidence-testing"],
    ["adaptive-fuzzing", "argos-adaptive-fuzzing"],
    ["exploit-validation", "argos-exploit-validation"],
    ["external-intel", "argos-external-intel"],
    ["finding-report", "argos-finding-report"]
];
function installOpenCodeSupport(root, force = false) {
    const targetRoot = node_path_1.default.resolve(root);
    const result = {
        root: targetRoot,
        configPath: node_path_1.default.join(targetRoot, "opencode.json"),
        created: [],
        updated: [],
        skipped: [],
        advisories: []
    };
    (0, paths_1.ensureDir)(targetRoot);
    installConfig(targetRoot, result);
    installInstructions(targetRoot, result, force);
    installCommand(targetRoot, result, force);
    installSkills(targetRoot, result, force);
    return result;
}
function doctorOpenCodeSupport(root) {
    const targetRoot = node_path_1.default.resolve(root);
    const configPath = node_path_1.default.join(targetRoot, "opencode.json");
    const parsed = readJsonObject(configPath);
    const opencode = detectOpenCode();
    const commands = listFiles(node_path_1.default.join(targetRoot, ".opencode", "commands"), ".md");
    const skills = listSkills(node_path_1.default.join(targetRoot, ".opencode", "skills"));
    const advisories = [];
    if (!opencode.found)
        advisories.push("OpenCode CLI was not found on PATH.");
    if (!node_fs_1.default.existsSync(configPath))
        advisories.push("opencode.json is missing. Run `argos opencode install --root <path>`.");
    if (node_fs_1.default.existsSync(configPath) && !parsed.ok)
        advisories.push("opencode.json is not strict JSON. Add Argos manually if the file uses JSONC comments.");
    if (parsed.ok && !hasArgosMcp(parsed.value))
        advisories.push("opencode.json does not enable the Argos MCP server.");
    if (parsed.ok && !hasArgosInstructions(parsed.value))
        advisories.push("opencode.json does not load the Argos project instructions.");
    for (const [, target] of SKILL_ALIASES) {
        if (!skills.includes(target))
            advisories.push(`Missing OpenCode skill: ${target}`);
    }
    if (!commands.includes("argos"))
        advisories.push("Missing OpenCode command: /argos");
    const config = {
        path: configPath,
        exists: node_fs_1.default.existsSync(configPath),
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
function installConfig(root, result) {
    const file = node_path_1.default.join(root, "opencode.json");
    const parsed = readJsonObject(file);
    if (!parsed.ok) {
        result.skipped.push(file);
        result.advisories.push("Skipped opencode.json because it is not strict JSON. Preserve its comments and add the Argos MCP and instruction entries manually.");
        return;
    }
    const config = parsed.value ?? {};
    if (typeof config.$schema !== "string")
        config.$schema = "https://opencode.ai/config.json";
    config.mcp = isObject(config.mcp) ? config.mcp : {};
    config.mcp.argos = {
        type: "local",
        command: ["argos-mcp"],
        enabled: true,
        timeout: 15000
    };
    const instructions = Array.isArray(config.instructions)
        ? config.instructions.filter((item) => typeof item === "string")
        : [];
    if (!instructions.includes(".opencode/instructions/argos.md"))
        instructions.push(".opencode/instructions/argos.md");
    config.instructions = instructions;
    config.permission = isObject(config.permission) ? config.permission : {};
    config.permission.skill = isObject(config.permission.skill)
        ? config.permission.skill
        : {};
    config.permission.skill["argos*"] = "allow";
    writeConfig(file, `${JSON.stringify(config, null, 2)}\n`, result);
}
function installInstructions(root, result, force) {
    const content = `# Argos OpenCode Runtime

Use the \`argos\` skill for connected security research. Load a specialist \`argos-*\` skill only when its method fits the current work. Use the local \`argos\` MCP server for the shared knowledge graph and use the CLI only when the MCP operation is unavailable.

Keep every call rooted at the target workspace. Resolve canonical identity before creating a node, inspect a bounded linked map before deep work, and treat relation suggestions and knowledge gaps as leads that require evidence.
`;
    writeManaged(node_path_1.default.join(root, ".opencode", "instructions", "argos.md"), content, result, force);
}
function installCommand(root, result, force) {
    const source = node_path_1.default.join(pluginRoot(), "commands", "argos.md");
    const content = node_fs_1.default.readFileSync(source, "utf8");
    writeManaged(node_path_1.default.join(root, ".opencode", "commands", "argos.md"), content, result, force);
}
function installSkills(root, result, force) {
    const sourceRoot = node_path_1.default.join(pluginRoot(), "skills");
    for (const [sourceName, targetName] of SKILL_ALIASES) {
        const sourceDir = node_path_1.default.join(sourceRoot, sourceName);
        if (!node_fs_1.default.existsSync(node_path_1.default.join(sourceDir, "SKILL.md"))) {
            result.advisories.push(`Packaged Argos skill is missing: ${sourceName}`);
            continue;
        }
        for (const source of walkFiles(sourceDir)) {
            const relative = node_path_1.default.relative(sourceDir, source);
            let content = node_fs_1.default.readFileSync(source, "utf8");
            if (relative.toLowerCase() === "skill.md")
                content = rewriteSkillName(content, targetName);
            writeManaged(node_path_1.default.join(root, ".opencode", "skills", targetName, relative), content, result, force);
        }
    }
}
function rewriteSkillName(content, name) {
    return content.replace(/^(---\r?\n[\s\S]*?\r?\nname:)\s*[^\r\n]+/m, `$1 ${name}`);
}
function writeConfig(file, content, result) {
    const existed = node_fs_1.default.existsSync(file);
    if (existed && node_fs_1.default.readFileSync(file, "utf8") === content) {
        result.skipped.push(file);
        return;
    }
    (0, paths_1.writeFileAtomic)(file, content);
    (existed ? result.updated : result.created).push(file);
}
function writeManaged(file, content, result, force) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(file));
    if (node_fs_1.default.existsSync(file)) {
        if (node_fs_1.default.readFileSync(file, "utf8") === content) {
            result.skipped.push(file);
            return;
        }
        if (!force) {
            result.skipped.push(file);
            result.advisories.push(`Skipped modified file: ${file}. Use --force to replace managed OpenCode assets.`);
            return;
        }
    }
    const existed = node_fs_1.default.existsSync(file);
    (0, paths_1.writeFileAtomic)(file, content);
    (existed ? result.updated : result.created).push(file);
}
function readJsonObject(file) {
    if (!node_fs_1.default.existsSync(file))
        return { ok: true, value: null };
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return isObject(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
    }
    catch {
        return { ok: false, value: null };
    }
}
function hasArgosMcp(config) {
    if (!config || !isObject(config.mcp))
        return false;
    const entry = config.mcp.argos;
    return isObject(entry) && entry.type === "local" && Array.isArray(entry.command) && entry.command.includes("argos-mcp") && entry.enabled !== false;
}
function hasArgosInstructions(config) {
    return Boolean(config && Array.isArray(config.instructions) && config.instructions.includes(".opencode/instructions/argos.md"));
}
function detectOpenCode() {
    const command = process.env.OPENCODE_COMMAND?.trim() || "opencode";
    const result = (0, node_child_process_1.spawnSync)((0, process_1.resolveCommandFile)(command), ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });
    const version = String(result.stdout ?? "").trim();
    return result.status === 0 && version
        ? { found: true, version }
        : { found: false, error: String(result.stderr || result.error?.message || "OpenCode command failed").trim() };
}
function walkFiles(root) {
    const output = [];
    for (const entry of node_fs_1.default.readdirSync(root, { withFileTypes: true })) {
        const full = node_path_1.default.join(root, entry.name);
        if (entry.isDirectory())
            output.push(...walkFiles(full));
        else if (entry.isFile())
            output.push(full);
    }
    return output;
}
function listFiles(dir, suffix) {
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
        .map((entry) => entry.name.slice(0, -suffix.length))
        .sort();
}
function listSkills(dir) {
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && node_fs_1.default.existsSync(node_path_1.default.join(dir, entry.name, "SKILL.md")))
        .map((entry) => entry.name)
        .sort();
}
function pluginRoot() {
    const candidates = [
        node_path_1.default.resolve(__dirname, ".."),
        node_path_1.default.resolve(__dirname, "..", "plugins", "argos")
    ];
    const match = candidates.find((candidate) => node_fs_1.default.existsSync(node_path_1.default.join(candidate, "skills", "argos", "SKILL.md")));
    if (!match)
        throw new Error("Argos plugin assets were not found beside the runtime");
    return match;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
