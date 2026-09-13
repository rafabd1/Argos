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
  canvasPath: string;
}

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

  for (const node of nodes) {
    const relative = fileById.get(node.publicId)!;
    const fullPath = path.join(output, relative);
    const body = renderNote(node, edges, fileById);
    writeFileAtomic(fullPath, body);
    generatedFiles.push(toPosix(relative));
  }

  const indexRelative = "Argos Index.md";
  writeFileAtomic(path.join(output, indexRelative), renderIndex(db, nodes, fileById));
  generatedFiles.push(indexRelative);

  const canvasRelative = "Argos Knowledge Graph.canvas";
  writeFileAtomic(path.join(output, canvasRelative), `${JSON.stringify(renderCanvas(nodes, edges, fileById), null, 2)}\n`);
  generatedFiles.push(canvasRelative);

  const manifestPath = path.join(output, ".argos-export.json");
  const previous = readManifest(manifestPath);
  let filesPruned = 0;
  let modifiedFilesPreserved = 0;
  if (prune && previous) {
    const current = new Set(generatedFiles);
    for (const relative of previous.generatedFiles) {
      if (current.has(relative)) continue;
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
    : [...new Set([...(previous?.generatedFiles ?? []), ...generatedFiles])];
  const sha256ByFile: Record<string, string> = {};
  for (const relative of managedFiles) {
    const candidate = path.resolve(output, relative);
    if (isInside(output, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      sha256ByFile[relative] = sha256File(candidate);
    }
  }
  const manifest: ExportManifest = {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    generatedFiles: managedFiles.sort(),
    sha256ByFile
  };
  writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    output,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    filesWritten: generatedFiles.length + 1,
    filesPruned,
    modifiedFilesPreserved,
    manifestPath,
    canvasPath: path.join(output, canvasRelative)
  };
}

function renderNote(node: ReturnType<ArgosDb["getNode"]>, edges: EdgeView[], fileById: Map<string, string>): string {
  const aliases = node.aliases.length === 0 ? "[]" : `[${node.aliases.map((alias) => JSON.stringify(alias)).join(", ")}]`;
  const lines = [
    "---",
    `argos_id: ${node.publicId}`,
    `type: ${JSON.stringify(node.type)}`,
    `created: ${node.createdAt}`,
    `updated: ${node.updatedAt}`,
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
  const related = edges.filter((edge) => edge.fromId === node.publicId || edge.toId === node.publicId);
  if (related.length === 0) {
    lines.push("_No relations recorded._");
  } else {
    for (const edge of related) {
      if (edge.fromId === node.publicId) {
        lines.push(`- \`${edge.type}\` -> ${wikiLink(fileById.get(edge.toId)!, edge.toTitle)}`);
      } else {
        lines.push(`- <- \`${edge.type}\` - ${wikiLink(fileById.get(edge.fromId)!, edge.fromTitle)}`);
      }
    }
  }
  lines.push("<!-- argos:relations:end -->", "");
  return `${lines.filter((line, index) => !(line === "" && lines[index - 1] === "" && index > 9)).join("\n")}\n`;
}

function renderIndex(db: ArgosDb, nodes: KnowledgeNode[], fileById: Map<string, string>): string {
  const grouped = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    const list = grouped.get(node.type) ?? [];
    list.push(node);
    grouped.set(node.type, list);
  }
  const lines = [
    "---",
    "argos_generated: true",
    `updated: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${db.config.name}`,
    "",
    `${nodes.length} canonical notes. Open [[Argos Knowledge Graph]] for the generated canvas.`,
    ""
  ];
  for (const [type, values] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${displayType(type)}`, "");
    for (const node of values.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- ${wikiLink(fileById.get(node.publicId)!, node.title)} - updated ${node.ageDays} day(s) ago`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderCanvas(nodes: KnowledgeNode[], edges: EdgeView[], fileById: Map<string, string>): { nodes: unknown[]; edges: unknown[] } {
  const typeOrder = [...new Set(nodes.map((node) => node.type))].sort();
  const rowByType = new Map(typeOrder.map((type, index) => [type, index]));
  const countByType = new Map<string, number>();
  return {
    nodes: nodes.map((node) => {
      const column = countByType.get(node.type) ?? 0;
      countByType.set(node.type, column + 1);
      return {
        id: node.publicId,
        type: "file",
        file: toPosix(fileById.get(node.publicId)!),
        x: column * 380,
        y: (rowByType.get(node.type) ?? 0) * 260,
        width: 320,
        height: 180
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.publicId,
      fromNode: edge.fromId,
      fromSide: "right",
      toNode: edge.toId,
      toSide: "left",
      label: edge.type
    }))
  };
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
