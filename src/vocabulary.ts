import fs from "node:fs";
import { configPath, ensureDir, argosDir, writeFileAtomic } from "./paths";
import { withArgosFileLock } from "./locked-sqlite";
import type { ArgosConfig } from "./types";

export const DEFAULT_NODE_TYPES = [
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
] as const;

export const DEFAULT_RELATION_TYPES = [
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
] as const;

export function createDefaultConfig(name: string): ArgosConfig {
  return {
    formatVersion: 1,
    name,
    nodeTypes: [...DEFAULT_NODE_TYPES],
    relationTypes: [...DEFAULT_RELATION_TYPES],
    ageNoticeDays: 90
  };
}

export function initializeConfig(root: string, name: string): ArgosConfig {
  ensureDir(argosDir(root));
  const file = configPath(root);
  return withArgosFileLock(`${file}.argos-lock`, () => {
    if (fs.existsSync(file)) return readConfigFile(file);
    const config = createDefaultConfig(name);
    writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  });
}

export function readConfig(root: string): ArgosConfig {
  const file = configPath(root);
  return withArgosFileLock(`${file}.argos-lock`, () => readConfigFile(file));
}

function readConfigFile(file: string): ArgosConfig {
  if (!fs.existsSync(file)) throw new Error(`Argos is not initialized; missing ${file}`);
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ArgosConfig>;
  if (value.formatVersion !== 1 || typeof value.name !== "string") {
    throw new Error(`Unsupported or invalid Argos config: ${file}`);
  }
  return {
    formatVersion: 1,
    name: value.name,
    nodeTypes: normalizeVocabulary(value.nodeTypes, DEFAULT_NODE_TYPES),
    relationTypes: normalizeVocabulary(value.relationTypes, DEFAULT_RELATION_TYPES),
    ageNoticeDays: positiveInteger(value.ageNoticeDays, 90)
  };
}

export function addVocabularyType(root: string, kind: "node" | "relation", value: string): ArgosConfig {
  const file = configPath(root);
  return withArgosFileLock(`${file}.argos-lock`, () => {
    const config = readConfigFile(file);
    const normalized = normalizeTypeName(value);
    const list = kind === "node" ? config.nodeTypes : config.relationTypes;
    if (!list.includes(normalized)) list.push(normalized);
    list.sort();
    writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  });
}

export function assertNodeType(config: ArgosConfig, value: string): string {
  const normalized = normalizeTypeName(value);
  if (!config.nodeTypes.includes(normalized)) {
    throw new Error(`Unknown node type '${value}'. Available: ${config.nodeTypes.join(", ")}`);
  }
  return normalized;
}

export function assertRelationType(config: ArgosConfig, value: string): string {
  const normalized = normalizeTypeName(value);
  if (!config.relationTypes.includes(normalized)) {
    throw new Error(`Unknown relation type '${value}'. Available: ${config.relationTypes.join(", ")}`);
  }
  return normalized;
}

export function normalizeTypeName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
    throw new Error(`Invalid type '${value}'. Use lowercase words, digits, and underscores.`);
  }
  return normalized;
}

function normalizeVocabulary(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map(normalizeTypeName);
  return [...new Set([...fallback, ...normalized])];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
