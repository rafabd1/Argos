"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageVersion = packageVersion;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function packageVersion(runtimeDir = __dirname) {
    const candidates = [
        node_path_1.default.resolve(runtimeDir, "..", "package.json"),
        node_path_1.default.resolve(runtimeDir, "..", ".codex-plugin", "plugin.json"),
        node_path_1.default.resolve(runtimeDir, "..", ".claude-plugin", "plugin.json"),
        node_path_1.default.resolve(runtimeDir, "..", "..", "..", "package.json")
    ];
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(node_fs_1.default.readFileSync(candidate, "utf8"));
            if (typeof value.version === "string" && value.version.trim())
                return value.version.trim();
        }
        catch { }
    }
    return "0.0.0";
}
