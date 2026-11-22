"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installOpenCodeSupport = installOpenCodeSupport;
exports.doctorOpenCodeSupport = doctorOpenCodeSupport;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const process_1 = require("./process");
const SKILL_ALIASES = [["argos", "argos"]];
const RETIRED_SKILLS = {
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
function installOpenCodeSupport(root, force = false) {
    const targetRoot = node_path_1.default.resolve(root);
    const result = {
        root: targetRoot,
        configPath: node_path_1.default.join(targetRoot, "opencode.json"),
        created: [],
        updated: [],
        removed: [],
        skipped: [],
        advisories: []
    };
    (0, paths_1.ensureDir)(targetRoot);
    installConfig(targetRoot, result);
    installInstructions(targetRoot, result, force);
    installCommand(targetRoot, result, force);
    removeRetiredSkills(targetRoot, result, force);
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
    for (const retired of Object.keys(RETIRED_SKILLS)) {
        if (skills.includes(retired))
            advisories.push(`Retired OpenCode skill is still installed: ${retired}. Run \`argos opencode install --root <path>\` to remove an unchanged managed copy, or remove a customized copy after review.`);
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

Use the \`argos\` skill for the knowledge graph. It defines canonical identity, hierarchy, relations, bounded retrieval, updates, and export. Use the local \`argos\` MCP server for the shared graph and use the CLI only when the MCP operation is unavailable.

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
function removeRetiredSkills(root, result, force) {
    const skillsRoot = node_path_1.default.join(root, ".opencode", "skills");
    for (const [name, expected] of Object.entries(RETIRED_SKILLS)) {
        const dir = node_path_1.default.join(skillsRoot, name);
        if (!node_fs_1.default.existsSync(dir))
            continue;
        if (!force && !matchesManagedTree(dir, expected)) {
            result.skipped.push(dir);
            result.advisories.push(`Preserved customized retired OpenCode skill: ${dir}. Review it, then remove it or rerun with --force.`);
            continue;
        }
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        result.removed.push(dir);
    }
}
function matchesManagedTree(root, expected) {
    const files = walkFiles(root).map((file) => node_path_1.default.relative(root, file).replaceAll("\\", "/")).sort();
    const expectedFiles = Object.keys(expected).sort();
    if (files.length !== expectedFiles.length || files.some((file, index) => file !== expectedFiles[index]))
        return false;
    return files.every((relative) => normalizedHash(node_path_1.default.join(root, relative)) === expected[relative]);
}
function normalizedHash(file) {
    const content = node_fs_1.default.readFileSync(file, "utf8").replaceAll("\r\n", "\n").replace(/[\r\n]+$/u, "") + "\n";
    return (0, node_crypto_1.createHash)("sha256").update(content, "utf8").digest("hex");
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
        if (!force && !PREVIOUS_MANAGED_HASHES.has(normalizedHash(file))) {
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
