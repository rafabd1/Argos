"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTargetRoot = resolveTargetRoot;
exports.argosDir = argosDir;
exports.knowledgePath = knowledgePath;
exports.configPath = configPath;
exports.defaultVaultPath = defaultVaultPath;
exports.obsidianSyncStatePath = obsidianSyncStatePath;
exports.chimeraDir = chimeraDir;
exports.chimeraDbPath = chimeraDbPath;
exports.chimeraSessionsDir = chimeraSessionsDir;
exports.globalArgosDir = globalArgosDir;
exports.globalChimeraConfigPath = globalChimeraConfigPath;
exports.ensureDir = ensureDir;
exports.writeFileAtomic = writeFileAtomic;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function resolveTargetRoot(input) {
    return node_path_1.default.resolve(input ?? process.cwd());
}
function argosDir(root) {
    return node_path_1.default.join(root, ".argos");
}
function knowledgePath(root) {
    return node_path_1.default.join(argosDir(root), "knowledge.sqlite");
}
function configPath(root) {
    return node_path_1.default.join(argosDir(root), "config.json");
}
function defaultVaultPath(root) {
    return node_path_1.default.join(argosDir(root), "obsidian");
}
function obsidianSyncStatePath(root) {
    return node_path_1.default.join(argosDir(root), "obsidian-sync.json");
}
function chimeraDir(root) {
    return node_path_1.default.join(argosDir(root), "chimera");
}
function chimeraDbPath(root) {
    return node_path_1.default.join(chimeraDir(root), "runtime.sqlite");
}
function chimeraSessionsDir(root) {
    return node_path_1.default.join(chimeraDir(root), "sessions");
}
function globalArgosDir() {
    return process.env.ARGOS_HOME
        ? node_path_1.default.resolve(process.env.ARGOS_HOME)
        : node_path_1.default.join(node_os_1.default.homedir(), ".argos");
}
function globalChimeraConfigPath() {
    return node_path_1.default.join(globalArgosDir(), "chimera", "config.json");
}
function ensureDir(dir) {
    node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function writeFileAtomic(filePath, content) {
    ensureDir(node_path_1.default.dirname(filePath));
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    node_fs_1.default.writeFileSync(temporary, content, "utf8");
    try {
        node_fs_1.default.renameSync(temporary, filePath);
    }
    catch (error) {
        if (process.platform !== "win32" || !node_fs_1.default.existsSync(filePath))
            throw error;
        node_fs_1.default.copyFileSync(temporary, filePath);
        node_fs_1.default.unlinkSync(temporary);
    }
}
