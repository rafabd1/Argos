"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RELATION_TYPES = exports.DEFAULT_NODE_TYPES = void 0;
exports.createDefaultConfig = createDefaultConfig;
exports.initializeConfig = initializeConfig;
exports.readConfig = readConfig;
exports.addVocabularyType = addVocabularyType;
exports.assertNodeType = assertNodeType;
exports.assertRelationType = assertRelationType;
exports.normalizeTypeName = normalizeTypeName;
const node_fs_1 = __importDefault(require("node:fs"));
const paths_1 = require("./paths");
const locked_sqlite_1 = require("./locked-sqlite");
exports.DEFAULT_NODE_TYPES = [
    "target",
    "component",
    "sink",
    "behavior",
    "data",
    "state",
    "principal",
    "boundary",
    "guarantee",
    "dependency",
    "hypothesis",
    "test",
    "finding",
    "intel",
    "artifact",
    "note"
];
exports.DEFAULT_RELATION_TYPES = [
    "contains",
    "exposes",
    "calls",
    "flows_to",
    "transforms",
    "reads",
    "writes",
    "produces",
    "consumes",
    "depends_on",
    "influences",
    "crosses",
    "runs_as",
    "guards",
    "tests",
    "supports",
    "refutes",
    "affects",
    "derived_from",
    "supersedes",
    "related_to"
];
function createDefaultConfig(name) {
    return {
        formatVersion: 1,
        name,
        nodeTypes: [...exports.DEFAULT_NODE_TYPES],
        relationTypes: [...exports.DEFAULT_RELATION_TYPES],
        ageNoticeDays: 90
    };
}
function initializeConfig(root, name) {
    (0, paths_1.ensureDir)((0, paths_1.argosDir)(root));
    const file = (0, paths_1.configPath)(root);
    return (0, locked_sqlite_1.withArgosFileLock)(`${file}.argos-lock`, () => {
        if (node_fs_1.default.existsSync(file))
            return readConfigFile(file);
        const config = createDefaultConfig(name);
        (0, paths_1.writeFileAtomic)(file, `${JSON.stringify(config, null, 2)}\n`);
        return config;
    });
}
function readConfig(root) {
    const file = (0, paths_1.configPath)(root);
    return (0, locked_sqlite_1.withArgosFileLock)(`${file}.argos-lock`, () => readConfigFile(file));
}
function readConfigFile(file) {
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`Argos is not initialized; missing ${file}`);
    const value = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    if (value.formatVersion !== 1 || typeof value.name !== "string") {
        throw new Error(`Unsupported or invalid Argos config: ${file}`);
    }
    return {
        formatVersion: 1,
        name: value.name,
        nodeTypes: normalizeVocabulary(value.nodeTypes, exports.DEFAULT_NODE_TYPES),
        relationTypes: normalizeVocabulary(value.relationTypes, exports.DEFAULT_RELATION_TYPES),
        ageNoticeDays: positiveInteger(value.ageNoticeDays, 90)
    };
}
function addVocabularyType(root, kind, value) {
    const file = (0, paths_1.configPath)(root);
    return (0, locked_sqlite_1.withArgosFileLock)(`${file}.argos-lock`, () => {
        const config = readConfigFile(file);
        const normalized = normalizeTypeName(value);
        const list = kind === "node" ? config.nodeTypes : config.relationTypes;
        if (!list.includes(normalized))
            list.push(normalized);
        list.sort();
        (0, paths_1.writeFileAtomic)(file, `${JSON.stringify(config, null, 2)}\n`);
        return config;
    });
}
function assertNodeType(config, value) {
    const normalized = normalizeTypeName(value);
    if (!config.nodeTypes.includes(normalized)) {
        throw new Error(`Unknown node type '${value}'. Available: ${config.nodeTypes.join(", ")}`);
    }
    return normalized;
}
function assertRelationType(config, value) {
    const normalized = normalizeTypeName(value);
    if (!config.relationTypes.includes(normalized)) {
        throw new Error(`Unknown relation type '${value}'. Available: ${config.relationTypes.join(", ")}`);
    }
    return normalized;
}
function normalizeTypeName(value) {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
        throw new Error(`Invalid type '${value}'. Use lowercase words, digits, and underscores.`);
    }
    return normalized;
}
function normalizeVocabulary(value, fallback) {
    if (!Array.isArray(value))
        return [...fallback];
    const normalized = value
        .filter((item) => typeof item === "string")
        .map(normalizeTypeName);
    return [...new Set([...fallback, ...normalized])];
}
function positiveInteger(value, fallback) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
