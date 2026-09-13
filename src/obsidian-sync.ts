import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ArgosDb } from "./db";
import { withArgosFileLock } from "./locked-sqlite";
import { exportObsidian, type ObsidianExportResult } from "./obsidian";
import { defaultVaultPath, knowledgePath, obsidianSyncStatePath, writeFileAtomic } from "./paths";
import { readConfig } from "./vocabulary";

interface StoredObsidianSyncState {
  formatVersion: 1;
  enabled: boolean;
  output: string;
  intervalSeconds: number;
  prune: boolean;
  attemptToken: string | null;
  lastAttemptAt: string | null;
  lastExportAt: string | null;
  lastResult: ObsidianExportResult | null;
  lastError: string | null;
}

export interface ObsidianSyncStatus {
  automatic: true;
  mode: "on_use";
  environmentDisabled: boolean;
  enabled: boolean;
  root: string;
  output: string;
  intervalSeconds: number;
  prune: boolean;
  due: boolean;
  nextEligibleAt: string | null;
  lastAttemptAt: string | null;
  lastExportAt: string | null;
  lastResult: ObsidianExportResult | null;
  lastError: string | null;
}

export interface ObsidianSyncOptions {
  output?: string;
  intervalSeconds?: number;
  prune?: boolean;
}

interface ClaimedExport {
  token: string;
  output: string;
  prune: boolean;
}

const DEFAULT_INTERVAL_SECONDS = 30;

export function ensureObsidianSync(rootInput: string): ObsidianSyncStatus {
  const root = path.resolve(rootInput);
  if (syncDisabledByEnvironment()) return readObsidianSyncStatus(root);
  try {
    return syncObsidian(root, {}, false, false);
  } catch (error) {
    return transientErrorStatus(root, error);
  }
}

export function enableObsidianSync(
  rootInput: string,
  options: ObsidianSyncOptions = {}
): ObsidianSyncStatus {
  return syncObsidian(path.resolve(rootInput), options, true, true);
}

export function refreshObsidianSync(rootInput: string): ObsidianSyncStatus {
  return syncObsidian(path.resolve(rootInput), {}, true, false);
}

export function disableObsidianSync(rootInput: string): ObsidianSyncStatus {
  const root = path.resolve(rootInput);
  const statePath = obsidianSyncStatePath(root);
  withArgosFileLock(`${statePath}.lock`, () => {
    const state = readStoredState(root);
    writeStoredState(root, { ...state, enabled: false, attemptToken: null });
  });
  return readObsidianSyncStatus(root);
}

export function readObsidianSyncStatus(rootInput: string): ObsidianSyncStatus {
  const root = path.resolve(rootInput);
  return publicState(root, readStoredState(root));
}

function syncObsidian(
  root: string,
  options: ObsidianSyncOptions,
  force: boolean,
  enable: boolean
): ObsidianSyncStatus {
  if (!fs.existsSync(knowledgePath(root))) throw new Error(`Argos is not initialized at ${root}`);
  const statePath = obsidianSyncStatePath(root);
  let claim: ClaimedExport | null = null;

  withArgosFileLock(`${statePath}.lock`, () => {
    const current = readStoredState(root);
    const configured: StoredObsidianSyncState = {
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
      if (configurationChanged) writeStoredState(root, configured);
      return;
    }

    const token = crypto.randomUUID();
    writeStoredState(root, {
      ...configured,
      attemptToken: token,
      lastAttemptAt: new Date().toISOString(),
      lastError: null
    });
    claim = { token, output, prune: configured.prune };
  });

  if (claim !== null) completeClaimedExport(root, claim);
  return readObsidianSyncStatus(root);
}

function completeClaimedExport(root: string, claim: ClaimedExport): void {
  let result: ObsidianExportResult | null = null;
  let failure: string | null = null;
  try {
    const db = new ArgosDb(root);
    try {
      result = exportObsidian(db, claim.output, claim.prune);
    } finally {
      db.close();
    }
  } catch (error) {
    failure = errorMessage(error);
  }

  const statePath = obsidianSyncStatePath(root);
  withArgosFileLock(`${statePath}.lock`, () => {
    const current = readStoredState(root);
    if (current.attemptToken !== claim.token) return;
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

function readStoredState(root: string): StoredObsidianSyncState {
  const fallback = defaultState(root);
  try {
    const parsed = JSON.parse(fs.readFileSync(obsidianSyncStatePath(root), "utf8")) as Partial<StoredObsidianSyncState> & { root?: unknown };
    if (parsed.formatVersion !== 1) return fallback;
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
  } catch {
    return fallback;
  }
}

function defaultState(root: string): StoredObsidianSyncState {
  return {
    formatVersion: 1,
    enabled: true,
    output: defaultOutputForStorage(root),
    intervalSeconds: boundedInterval(Number(process.env.ARGOS_OBSIDIAN_SYNC_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS)),
    prune: true,
    attemptToken: null,
    lastAttemptAt: null,
    lastExportAt: null,
    lastResult: null,
    lastError: null
  };
}

function writeStoredState(root: string, state: StoredObsidianSyncState): void {
  writeFileAtomic(obsidianSyncStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

function publicState(root: string, state: StoredObsidianSyncState): ObsidianSyncStatus {
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

function transientErrorStatus(root: string, error: unknown): ObsidianSyncStatus {
  return { ...publicState(root, readStoredState(root)), lastError: errorMessage(error) };
}

function normalizeStoredOutput(root: string, value: unknown, formerRoot: unknown): string {
  if (typeof value !== "string" || !value.trim()) return defaultOutputForStorage(root);
  if (!path.isAbsolute(value)) return toPortablePath(portableRelativePath(value));
  const base = typeof formerRoot === "string" && formerRoot.trim() ? path.resolve(formerRoot) : root;
  return isInside(base, value) ? toPortablePath(path.relative(base, path.resolve(value)) || ".") : path.resolve(value);
}

function defaultOutputForStorage(root: string): string {
  const name = readConfig(root).name;
  return toPortablePath(path.relative(root, defaultVaultPath(root, name)));
}

function outputForStorage(root: string, value: string): string {
  const resolved = path.resolve(root, value);
  return isInside(root, resolved) ? toPortablePath(path.relative(root, resolved) || ".") : resolved;
}

function outputForUse(root: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, portableRelativePath(value));
}

function nextEligibleAt(state: StoredObsidianSyncState): string | null {
  const timestamps = [
    state.lastAttemptAt === null ? null : Date.parse(state.lastAttemptAt) + state.intervalSeconds * 1000,
    state.lastExportAt === null ? null : Date.parse(state.lastExportAt) + state.intervalSeconds * 1000,
    state.attemptToken === null || state.lastAttemptAt === null
      ? null
      : Date.parse(state.lastAttemptAt) + attemptStaleMs(state.intervalSeconds)
  ].filter((value): value is number => value !== null);
  if (timestamps.length === 0) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function attemptStaleMs(intervalSeconds: number): number {
  return Math.max(300_000, intervalSeconds * 2_000);
}

function boundedInterval(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_INTERVAL_SECONDS;
  return Math.max(1, Math.min(86_400, Math.trunc(number)));
}

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function isExportResult(value: unknown): value is ObsidianExportResult {
  return typeof value === "object" && value !== null
    && "output" in value && typeof value.output === "string"
    && "nodeCount" in value && typeof value.nodeCount === "number";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function portableRelativePath(value: string): string {
  return path.normalize(value.replace(/[\\/]+/g, path.sep));
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function syncDisabledByEnvironment(): boolean {
  return /^(?:1|true|yes)$/i.test(process.env.ARGOS_DISABLE_OBSIDIAN_SYNC ?? "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
