"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureObsidianSync = ensureObsidianSync;
exports.enableObsidianSync = enableObsidianSync;
exports.refreshObsidianSync = refreshObsidianSync;
exports.disableObsidianSync = disableObsidianSync;
exports.readObsidianSyncStatus = readObsidianSyncStatus;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("./db");
const locked_sqlite_1 = require("./locked-sqlite");
const obsidian_1 = require("./obsidian");
const paths_1 = require("./paths");
const DEFAULT_INTERVAL_SECONDS = 30;
function ensureObsidianSync(rootInput) {
    const root = node_path_1.default.resolve(rootInput);
    if (syncDisabledByEnvironment())
        return readObsidianSyncStatus(root);
    try {
        return syncObsidian(root, {}, false, false);
    }
    catch (error) {
        return transientErrorStatus(root, error);
    }
}
function enableObsidianSync(rootInput, options = {}) {
    return syncObsidian(node_path_1.default.resolve(rootInput), options, true, true);
}
function refreshObsidianSync(rootInput) {
    return syncObsidian(node_path_1.default.resolve(rootInput), {}, true, false);
}
function disableObsidianSync(rootInput) {
    const root = node_path_1.default.resolve(rootInput);
    const statePath = (0, paths_1.obsidianSyncStatePath)(root);
    (0, locked_sqlite_1.withArgosFileLock)(`${statePath}.lock`, () => {
        const state = readStoredState(root);
        writeStoredState(root, { ...state, enabled: false, attemptToken: null });
    });
    return readObsidianSyncStatus(root);
}
function readObsidianSyncStatus(rootInput) {
    const root = node_path_1.default.resolve(rootInput);
    return publicState(root, readStoredState(root));
}
function syncObsidian(root, options, force, enable) {
    if (!node_fs_1.default.existsSync((0, paths_1.knowledgePath)(root)))
        throw new Error(`Argos is not initialized at ${root}`);
    const statePath = (0, paths_1.obsidianSyncStatePath)(root);
    let claim = null;
    (0, locked_sqlite_1.withArgosFileLock)(`${statePath}.lock`, () => {
        const current = readStoredState(root);
        const configured = {
            ...current,
            enabled: enable ? true : current.enabled,
            output: options.output === undefined ? current.output : outputForStorage(root, options.output),
            intervalSeconds: boundedInterval(options.intervalSeconds ?? current.intervalSeconds),
            prune: options.prune ?? current.prune
        };
        const configurationChanged = configured.enabled !== current.enabled
            || configured.output !== current.output
            || configured.intervalSeconds !== current.intervalSeconds
            || configured.prune !== current.prune;
        const output = outputForUse(root, configured.output);
        const now = Date.now();
        const intervalElapsed = configured.lastExportAt === null
            || now - Date.parse(configured.lastExportAt) >= configured.intervalSeconds * 1000;
        const retryElapsed = configured.lastAttemptAt === null
            || now - Date.parse(configured.lastAttemptAt) >= configured.intervalSeconds * 1000;
        const activeAttempt = configured.attemptToken !== null
            && configured.lastAttemptAt !== null
            && now - Date.parse(configured.lastAttemptAt) < attemptStaleMs(configured.intervalSeconds);
        const locationChanged = configured.lastResult !== null && !samePath(configured.lastResult.output, output);
        const shouldExport = !syncDisabledByEnvironment()
            && (force || (configured.enabled && (locationChanged || (intervalElapsed && retryElapsed && !activeAttempt))));
        if (!shouldExport) {
            if (configurationChanged)
                writeStoredState(root, configured);
            return;
        }
        const token = node_crypto_1.default.randomUUID();
        writeStoredState(root, {
            ...configured,
            attemptToken: token,
            lastAttemptAt: new Date().toISOString(),
            lastError: null
        });
        claim = { token, output, prune: configured.prune };
    });
    if (claim !== null)
        completeClaimedExport(root, claim);
    return readObsidianSyncStatus(root);
}
function completeClaimedExport(root, claim) {
    let result = null;
    let failure = null;
    try {
        const db = new db_1.ArgosDb(root);
        try {
            result = (0, obsidian_1.exportObsidian)(db, claim.output, claim.prune);
        }
        finally {
            db.close();
        }
    }
    catch (error) {
        failure = errorMessage(error);
    }
    const statePath = (0, paths_1.obsidianSyncStatePath)(root);
    (0, locked_sqlite_1.withArgosFileLock)(`${statePath}.lock`, () => {
        const current = readStoredState(root);
        if (current.attemptToken !== claim.token)
            return;
        const completedAt = new Date().toISOString();
        writeStoredState(root, {
            ...current,
            attemptToken: null,
            lastExportAt: result === null ? current.lastExportAt : completedAt,
            lastResult: result ?? current.lastResult,
            lastError: failure
        });
    });
}
function readStoredState(root) {
    const fallback = defaultState();
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync((0, paths_1.obsidianSyncStatePath)(root), "utf8"));
        if (parsed.formatVersion !== 1)
            return fallback;
        return {
            formatVersion: 1,
            enabled: parsed.enabled !== false,
            output: normalizeStoredOutput(root, parsed.output, parsed.root),
            intervalSeconds: boundedInterval(parsed.intervalSeconds),
            prune: parsed.prune !== false,
            attemptToken: typeof parsed.attemptToken === "string" && parsed.attemptToken ? parsed.attemptToken : null,
            lastAttemptAt: validTimestamp(parsed.lastAttemptAt),
            lastExportAt: validTimestamp(parsed.lastExportAt),
            lastResult: isExportResult(parsed.lastResult) ? parsed.lastResult : null,
            lastError: typeof parsed.lastError === "string" ? parsed.lastError : null
        };
    }
    catch {
        return fallback;
    }
}
function defaultState() {
    return {
        formatVersion: 1,
        enabled: true,
        output: ".argos/obsidian",
        intervalSeconds: boundedInterval(Number(process.env.ARGOS_OBSIDIAN_SYNC_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS)),
        prune: true,
        attemptToken: null,
        lastAttemptAt: null,
        lastExportAt: null,
        lastResult: null,
        lastError: null
    };
}
function writeStoredState(root, state) {
    (0, paths_1.writeFileAtomic)((0, paths_1.obsidianSyncStatePath)(root), `${JSON.stringify(state, null, 2)}\n`);
}
function publicState(root, state) {
    const output = outputForUse(root, state.output);
    const locationChanged = state.lastResult !== null && !samePath(state.lastResult.output, output);
    const now = Date.now();
    const intervalElapsed = state.lastExportAt === null
        || now - Date.parse(state.lastExportAt) >= state.intervalSeconds * 1000;
    const retryElapsed = state.lastAttemptAt === null
        || now - Date.parse(state.lastAttemptAt) >= state.intervalSeconds * 1000;
    const activeAttempt = state.attemptToken !== null
        && state.lastAttemptAt !== null
        && now - Date.parse(state.lastAttemptAt) < attemptStaleMs(state.intervalSeconds);
    const due = state.enabled && (locationChanged || (intervalElapsed && retryElapsed && !activeAttempt));
    return {
        automatic: true,
        mode: "on_use",
        environmentDisabled: syncDisabledByEnvironment(),
        enabled: state.enabled,
        root,
        output,
        intervalSeconds: state.intervalSeconds,
        prune: state.prune,
        due,
        nextEligibleAt: !state.enabled ? null : due ? new Date().toISOString() : nextEligibleAt(state),
        lastAttemptAt: state.lastAttemptAt,
        lastExportAt: state.lastExportAt,
        lastResult: state.lastResult,
        lastError: state.lastError
    };
}
function transientErrorStatus(root, error) {
    return { ...publicState(root, readStoredState(root)), lastError: errorMessage(error) };
}
function normalizeStoredOutput(root, value, formerRoot) {
    if (typeof value !== "string" || !value.trim())
        return defaultState().output;
    if (!node_path_1.default.isAbsolute(value))
        return toPortablePath(portableRelativePath(value));
    const base = typeof formerRoot === "string" && formerRoot.trim() ? node_path_1.default.resolve(formerRoot) : root;
    return isInside(base, value) ? toPortablePath(node_path_1.default.relative(base, node_path_1.default.resolve(value)) || ".") : node_path_1.default.resolve(value);
}
function outputForStorage(root, value) {
    const resolved = node_path_1.default.resolve(root, value);
    return isInside(root, resolved) ? toPortablePath(node_path_1.default.relative(root, resolved) || ".") : resolved;
}
function outputForUse(root, value) {
    return node_path_1.default.isAbsolute(value) ? node_path_1.default.resolve(value) : node_path_1.default.resolve(root, portableRelativePath(value));
}
function nextEligibleAt(state) {
    const timestamps = [
        state.lastAttemptAt === null ? null : Date.parse(state.lastAttemptAt) + state.intervalSeconds * 1000,
        state.lastExportAt === null ? null : Date.parse(state.lastExportAt) + state.intervalSeconds * 1000,
        state.attemptToken === null || state.lastAttemptAt === null
            ? null
            : Date.parse(state.lastAttemptAt) + attemptStaleMs(state.intervalSeconds)
    ].filter((value) => value !== null);
    if (timestamps.length === 0)
        return new Date().toISOString();
    return new Date(Math.max(...timestamps)).toISOString();
}
function attemptStaleMs(intervalSeconds) {
    return Math.max(300_000, intervalSeconds * 2_000);
}
function boundedInterval(value) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number))
        return DEFAULT_INTERVAL_SECONDS;
    return Math.max(1, Math.min(86_400, Math.trunc(number)));
}
function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
function isExportResult(value) {
    return typeof value === "object" && value !== null
        && "output" in value && typeof value.output === "string"
        && "nodeCount" in value && typeof value.nodeCount === "number";
}
function isInside(root, candidate) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(root), node_path_1.default.resolve(candidate));
    return relative === "" || (!relative.startsWith(`..${node_path_1.default.sep}`) && relative !== ".." && !node_path_1.default.isAbsolute(relative));
}
function samePath(left, right) {
    const leftPath = node_path_1.default.resolve(left);
    const rightPath = node_path_1.default.resolve(right);
    return process.platform === "win32"
        ? leftPath.toLowerCase() === rightPath.toLowerCase()
        : leftPath === rightPath;
}
function portableRelativePath(value) {
    return node_path_1.default.normalize(value.replace(/[\\/]+/g, node_path_1.default.sep));
}
function toPortablePath(value) {
    return value.split(node_path_1.default.sep).join("/");
}
function syncDisabledByEnvironment() {
    return /^(?:1|true|yes)$/i.test(process.env.ARGOS_DISABLE_OBSIDIAN_SYNC ?? "");
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
