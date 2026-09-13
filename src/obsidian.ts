import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ArgosDb } from "./db";
import { defaultVaultPath, ensureDir, writeFileAtomic } from "./paths";
import { withArgosFileLock } from "./locked-sqlite";
import type { EdgeView, KnowledgeNode } from "./types";

interface ExportManifest {
  formatVersion: 2;
  generatedAt: string;
  generatedFiles: string[];
  sha256ByFile: Record<string, string>;
}

export interface ObsidianExportResult {
  output: string;
  nodeCount: number;
  edgeCount: number;
  filesWritten: number;
  filesPruned: number;
  modifiedFilesPreserved: number;
  manifestPath: string;
  indexPath: string;
  explorerPath: string;
  legacyFilesPreserved: string[];
}

const RETIRED_GENERATED_FILES = new Set(["Argos Knowledge Graph.canvas"]);
const LEGACY_EXPORT_FILES = ["Argos Knowledge Graph.canvas", "Argos Knowledge Graph.md"];

export function exportObsidian(db: ArgosDb, outputInput?: string, prune = false): ObsidianExportResult {
  const output = path.resolve(outputInput ?? defaultVaultPath(db.root));
  ensureDir(output);
  return withArgosFileLock(`${output}.argos-export-lock`, () => exportObsidianLocked(db, output, prune));
}

function exportObsidianLocked(db: ArgosDb, output: string, prune: boolean): ObsidianExportResult {
  const snapshot = db.snapshot();
  const nodes = snapshot.nodes.sort((a, b) => a.publicId.localeCompare(b.publicId));
  const edges = snapshot.edges;
  const fileById = new Map(nodes.map((node) => [node.publicId, noteRelativePath(node)]));
  const generatedFiles: string[] = [];
  const generatedAt = new Date().toISOString();
  const manifestPath = path.join(output, ".argos-export.json");
  const previous = readManifest(manifestPath);

  for (const node of nodes) {
    const relative = fileById.get(node.publicId)!;
    const fullPath = path.join(output, relative);
    const body = renderNote(node, edges, fileById, db.config.ageNoticeDays);
    writeFileAtomic(fullPath, body);
    generatedFiles.push(toPosix(relative));
  }

  const indexRelative = "Argos Index.md";
  writeFileAtomic(path.join(output, indexRelative), renderIndex(db, nodes, edges, generatedAt));
  generatedFiles.push(indexRelative);

  const explorerRelative = "Argos Explorer.base";
  writeFileAtomic(path.join(output, explorerRelative), renderExplorerBase());
  generatedFiles.push(explorerRelative);

  let filesPruned = 0;
  let modifiedFilesPreserved = 0;
  if (previous) {
    const current = new Set(generatedFiles);
    for (const relative of previous.generatedFiles) {
      if (current.has(relative)) continue;
      if (!prune && !RETIRED_GENERATED_FILES.has(relative)) continue;
      const candidate = path.resolve(output, relative);
      if (!isInside(output, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      const expectedHash = previous.sha256ByFile[relative];
      if (!expectedHash || sha256File(candidate) !== expectedHash) {
        modifiedFilesPreserved += 1;
        continue;
      }
      fs.unlinkSync(candidate);
      filesPruned += 1;
    }
  }
  const managedFiles = prune
    ? generatedFiles
    : [...new Set([
      ...(previous?.generatedFiles ?? []).filter((relative) => !RETIRED_GENERATED_FILES.has(relative)),
      ...generatedFiles
    ])];
  const sha256ByFile: Record<string, string> = {};
  for (const relative of managedFiles) {
    const candidate = path.resolve(output, relative);
    if (isInside(output, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      sha256ByFile[relative] = sha256File(candidate);
    }
  }
  const manifest: ExportManifest = {
    formatVersion: 2,
    generatedAt,
    generatedFiles: managedFiles.sort(),
    sha256ByFile
  };
  writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const legacyFilesPreserved = LEGACY_EXPORT_FILES
    .map((relative) => path.join(output, relative))
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

  return {
    output,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    filesWritten: generatedFiles.length + 1,
    filesPruned,
    modifiedFilesPreserved,
    manifestPath,
    indexPath: path.join(output, indexRelative),
    explorerPath: path.join(output, explorerRelative),
    legacyFilesPreserved
  };
}

function renderNote(
  node: KnowledgeNode,
  edges: EdgeView[],
  fileById: Map<string, string>,
  ageNoticeDays: number
): string {
  const aliases = node.aliases.length === 0 ? "[]" : `[${node.aliases.map((alias) => JSON.stringify(alias)).join(", ")}]`;
  const outgoing = edges.filter((edge) => edge.fromId === node.publicId).sort(compareEdges);
  const incoming = edges.filter((edge) => edge.toId === node.publicId).sort(compareEdges);
  const relationTypes = [...new Set([...outgoing, ...incoming].map((edge) => edge.type))].sort();
  const lines = [
    "---",
    `argos_id: ${node.publicId}`,
    "argos_generated: true",
    `type: ${JSON.stringify(node.type)}`,
    `created: ${node.createdAt}`,
    `updated: ${node.updatedAt}`,
    `argos_age_days: ${node.ageDays}`,
    `argos_stale: ${node.ageDays >= ageNoticeDays}`,
    `argos_relation_count: ${outgoing.length + incoming.length}`,
    `argos_outgoing_count: ${outgoing.length}`,
    `argos_incoming_count: ${incoming.length}`,
    `argos_relation_types: ${JSON.stringify(relationTypes)}`,
    `aliases: ${aliases}`,
    "---",
    "",
    `# ${node.title}`,
    "",
    node.content.trim(),
    "",
    "<!-- argos:relations:start -->",
    "## Relations",
    ""
  ];
  if (outgoing.length === 0 && incoming.length === 0) {
    lines.push("_No relations recorded._");
  } else {
    if (outgoing.length > 0) {
      lines.push("### Outgoing", "");
      for (const edge of outgoing) {
        lines.push(`- \`${edge.type}\` -> ${wikiLink(fileById.get(edge.toId)!, edge.toTitle)}`);
      }
    }
    if (incoming.length > 0) {
      if (outgoing.length > 0) lines.push("");
      lines.push("### Incoming", "");
      for (const edge of incoming) {
        lines.push(`- \`${edge.type}\` <- \`${edge.fromId}\` ${plainText(edge.fromTitle)}`);
      }
    }
  }
  lines.push("<!-- argos:relations:end -->", "");
  return `${lines.filter((line, index) => !(line === "" && lines[index - 1] === "" && index > 9)).join("\n")}\n`;
}

function renderIndex(db: ArgosDb, nodes: KnowledgeNode[], edges: EdgeView[], generatedAt: string): string {
  const nodeCounts = new Map<string, number>();
  const staleCounts = new Map<string, number>();
  const connectedNodeIds = new Set<string>();
  for (const node of nodes) {
    nodeCounts.set(node.type, (nodeCounts.get(node.type) ?? 0) + 1);
    if (node.ageDays >= db.config.ageNoticeDays) {
      staleCounts.set(node.type, (staleCounts.get(node.type) ?? 0) + 1);
    }
  }
  const relationCounts = new Map<string, number>();
  for (const edge of edges) {
    relationCounts.set(edge.type, (relationCounts.get(edge.type) ?? 0) + 1);
    connectedNodeIds.add(edge.fromId);
    connectedNodeIds.add(edge.toId);
  }
  const staleCount = nodes.filter((node) => node.ageDays >= db.config.ageNoticeDays).length;
  const isolatedCount = nodes.length - connectedNodeIds.size;
  const latestUpdate = nodes.reduce<string | null>(
    (latest, node) => latest === null || node.updatedAt > latest ? node.updatedAt : latest,
    null
  );
  const lines = [
    "---",
    "argos_generated: true",
    "argos_view: index",
    `updated: ${generatedAt}`,
    "---",
    "",
    `# ${db.config.name}`,
    "",
    `Projection generated ${generatedAt}. The Argos database remains canonical.`,
    "",
    "## Overview",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Canonical notes | ${nodes.length} |`,
    `| Relations | ${edges.length} |`,
    `| Node types | ${nodeCounts.size} |`,
    `| Relation types | ${relationCounts.size} |`,
    `| Older than ${db.config.ageNoticeDays} days | ${staleCount} |`,
    `| Isolated notes | ${isolatedCount} |`,
    `| Latest knowledge update | ${latestUpdate ?? "none"} |`,
    "",
    "## Explorer",
    "",
    "![[Argos Explorer.base]]",
    "",
    "## Node Types",
    "",
    "| Type | Notes | Old | Isolated |",
    "| --- | ---: | ---: | ---: |"
  ];
  for (const type of [...nodeCounts.keys()].sort()) {
    const isolatedForType = nodes.filter((node) => node.type === type && !connectedNodeIds.has(node.publicId)).length;
    lines.push(`| ${displayType(type)} | ${nodeCounts.get(type)} | ${staleCounts.get(type) ?? 0} | ${isolatedForType} |`);
  }
  lines.push(
    "",
    "## Relation Types",
    "",
    "| Relation | Count |",
    "| --- | ---: |"
  );
  for (const [type, count] of [...relationCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| \`${type}\` | ${count} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderExplorerBase(): string {
  return `filters:
  and:
    - 'file.ext == "md"'
    - argos_id
properties:
  file.name:
    displayName: Note
  argos_id:
    displayName: ID
  type:
    displayName: Type
  updated:
    displayName: Updated
  argos_age_days:
    displayName: Age (days)
  argos_stale:
    displayName: Revalidate
  argos_relation_count:
    displayName: Relations
  argos_outgoing_count:
    displayName: Outgoing
  argos_incoming_count:
    displayName: Incoming
  argos_relation_types:
    displayName: Relation types
views:
  - type: table
    name: All knowledge
    limit: 1000
    groupBy:
      property: type
      direction: ASC
    order:
      - file.name
      - argos_id
      - type
      - updated
      - argos_age_days
      - argos_relation_count
      - argos_relation_types
  - type: table
    name: Findings
    limit: 500
    filters: 'type == "finding"'
    order:
      - file.name
      - updated
      - argos_age_days
      - argos_relation_count
  - type: table
    name: Hypotheses
    limit: 500
    filters: 'type == "hypothesis"'
    order:
      - file.name
      - updated
      - argos_age_days
      - argos_relation_count
  - type: table
    name: Tests
    limit: 1000
    filters: 'type == "test"'
    order:
      - file.name
      - updated
      - argos_age_days
      - argos_relation_count
  - type: table
    name: Needs revalidation
    limit: 1000
    filters: 'argos_stale == true'
    order:
      - file.name
      - type
      - updated
      - argos_age_days
      - argos_relation_count
  - type: table
    name: Isolated
    limit: 1000
    filters: 'argos_relation_count == 0'
    order:
      - file.name
      - type
      - updated
`;
}

function compareEdges(left: EdgeView, right: EdgeView): number {
  return left.type.localeCompare(right.type)
    || left.fromId.localeCompare(right.fromId)
    || left.toId.localeCompare(right.toId);
}

function plainText(value: string): string {
  return value.replace(/[\[\]`\r\n|]/g, " ").replace(/\s+/g, " ").trim();
}

function noteRelativePath(node: KnowledgeNode): string {
  return path.join(displayType(node.type), `${node.publicId} ${safeFileName(node.title)}.md`);
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[\[\]#^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\.md)+$/gi, "")
    .trim()
    .replace(/[. ]+$/g, "");
  return (cleaned || "Untitled").slice(0, 120);
}

function displayType(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function wikiLink(relative: string, title: string): string {
  const withoutExtension = toPosix(relative).replace(/\.md$/i, "");
  return `[[${withoutExtension}|${title.replace(/[\[\]|]/g, " ")}]]`;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function readManifest(filePath: string): ExportManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      formatVersion?: number;
      generatedAt?: unknown;
      generatedFiles?: unknown;
      sha256ByFile?: unknown;
    };
    if ((parsed.formatVersion !== 1 && parsed.formatVersion !== 2) || !Array.isArray(parsed.generatedFiles)) return null;
    const generatedFiles = parsed.generatedFiles.filter((value): value is string => typeof value === "string");
    const sha256ByFile = parsed.formatVersion === 2 && parsed.sha256ByFile && typeof parsed.sha256ByFile === "object"
      ? Object.fromEntries(Object.entries(parsed.sha256ByFile).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    return {
      formatVersion: 2,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      generatedFiles,
      sha256ByFile
    };
  } catch {
    return null;
  }
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
