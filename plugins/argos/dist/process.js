"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCommandFile = resolveCommandFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
function resolveCommandFile(command) {
    if (node_process_1.default.platform !== "win32")
        return command;
    const candidates = commandCandidates(command);
    for (const candidate of candidates) {
        if (!node_fs_1.default.existsSync(candidate) || !node_fs_1.default.statSync(candidate).isFile())
            continue;
        const extension = node_path_1.default.extname(candidate).toLowerCase();
        if (extension === ".exe" || extension === ".com")
            return candidate;
        if (extension === ".cmd" || extension === ".bat" || extension === ".ps1") {
            const target = resolveShimExecutable(candidate);
            if (target)
                return target;
        }
    }
    return command;
}
function commandCandidates(command) {
    const hasDirectory = node_path_1.default.isAbsolute(command) || command.includes("/") || command.includes("\\");
    const roots = hasDirectory
        ? [node_path_1.default.resolve(command)]
        : String(node_process_1.default.env.PATH ?? "")
            .split(node_path_1.default.delimiter)
            .map((entry) => entry.trim().replace(/^"|"$/g, ""))
            .filter(Boolean)
            .map((entry) => node_path_1.default.join(entry, command));
    const extensions = node_path_1.default.extname(command) ? [""] : [".exe", ".com", ".cmd", ".bat", ".ps1", ""];
    return [...new Set(roots.flatMap((root) => extensions.map((extension) => `${root}${extension}`)))];
}
function resolveShimExecutable(shimPath) {
    let source;
    try {
        source = node_fs_1.default.readFileSync(shimPath, "utf8");
    }
    catch {
        return null;
    }
    const base = node_path_1.default.dirname(shimPath);
    const adjacentOpenCode = node_path_1.default.join(base, "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (node_fs_1.default.existsSync(adjacentOpenCode))
        return adjacentOpenCode;
    for (const match of source.matchAll(/["']([^"'\r\n]*\.exe)["']/gi)) {
        const expanded = match[1]
            .replace(/^%~?dp0%?[\\/]?/i, "")
            .replace(/^\$basedir[\\/]?/i, "")
            .replace(/\//g, node_path_1.default.sep);
        const target = node_path_1.default.resolve(base, expanded);
        if (node_fs_1.default.existsSync(target))
            return target;
    }
    return null;
}
