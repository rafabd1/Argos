"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportObsidian = exportObsidian;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const locked_sqlite_1 = require("./locked-sqlite");
const RETIRED_GENERATED_FILES = new Set(["Argos Knowledge Graph.canvas"]);
const LEGACY_EXPORT_FILES = ["Argos Knowledge Graph.canvas", "Argos Knowledge Graph.md"];
const PRIMARY_NODE_COLOR_GROUPS = [
    { query: "[type:component]", color: { a: 1, rgb: 0x2869ff } },
    { query: "[type:boundary]", color: { a: 1, rgb: 0xfbef00 } },
    { query: "[type:principal]", color: { a: 1, rgb: 0x9e41ff } },
    { query: "[type:sink]", color: { a: 1, rgb: 0xc21800 } },
    { query: "[type:test]", color: { a: 1, rgb: 0x61ebff } },
    { query: "[type:hypothesis]", color: { a: 1, rgb: 0xf339ff } },
    { query: "[type:finding]", color: { a: 1, rgb: 0xffffff } },
    { query: "[type:guarantee]", color: { a: 1, rgb: 0x1cae9e } }
];
function exportObsidian(db, outputInput, prune = false) {
    const output = node_path_1.default.resolve(outputInput ?? (0, paths_1.defaultVaultPath)(db.root, db.config.name));
    (0, paths_1.ensureDir)(output);
    return (0, locked_sqlite_1.withArgosFileLock)(`${output}.argos-export-lock`, () => exportObsidianLocked(db, output, prune));
}
function exportObsidianLocked(db, output, prune) {
    const snapshot = db.snapshot();
    const nodes = snapshot.nodes.sort((a, b) => a.publicId.localeCompare(b.publicId));
    const edges = snapshot.edges;
    const fileById = new Map(nodes.map((node) => [node.publicId, noteRelativePath(node)]));
    const generatedFiles = [];
    const generatedAt = new Date().toISOString();
    const manifestPath = node_path_1.default.join(output, ".argos-export.json");
    const previous = readManifest(manifestPath);
    for (const node of nodes) {
        const relative = fileById.get(node.publicId);
        const fullPath = node_path_1.default.join(output, relative);
        const body = renderNote(node, edges, fileById, db.config.ageNoticeDays);
        (0, paths_1.writeFileAtomic)(fullPath, body);
        generatedFiles.push(toPosix(relative));
    }
    const indexRelative = "Argos Index.md";
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(output, indexRelative), renderIndex(db, nodes, edges, generatedAt));
    generatedFiles.push(indexRelative);
    const explorerRelative = "Argos Explorer.base";
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(output, explorerRelative), renderExplorerBase());
    generatedFiles.push(explorerRelative);
    const graphConfig = ensurePrimaryGraphColors(output);
    let filesPruned = 0;
    let modifiedFilesPreserved = 0;
    if (previous) {
        const current = new Set(generatedFiles);
        for (const relative of previous.generatedFiles) {
            if (current.has(relative))
                continue;
            if (!prune && !RETIRED_GENERATED_FILES.has(relative))
                continue;
            const candidate = node_path_1.default.resolve(output, relative);
            if (!isInside(output, candidate) || !node_fs_1.default.existsSync(candidate) || !node_fs_1.default.statSync(candidate).isFile())
                continue;
            const expectedHash = previous.sha256ByFile[relative];
            if (!expectedHash || sha256File(candidate) !== expectedHash) {
                modifiedFilesPreserved += 1;
                continue;
            }
            node_fs_1.default.unlinkSync(candidate);
            filesPruned += 1;
        }
    }
    const managedFiles = prune
        ? generatedFiles
        : [...new Set([
                ...(previous?.generatedFiles ?? []).filter((relative) => !RETIRED_GENERATED_FILES.has(relative)),
                ...generatedFiles
            ])];
    const sha256ByFile = {};
    for (const relative of managedFiles) {
        const candidate = node_path_1.default.resolve(output, relative);
        if (isInside(output, candidate) && node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile()) {
            sha256ByFile[relative] = sha256File(candidate);
        }
    }
    const manifest = {
        formatVersion: 2,
        generatedAt,
        generatedFiles: managedFiles.sort(),
        sha256ByFile
    };
    (0, paths_1.writeFileAtomic)(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const legacyFilesPreserved = LEGACY_EXPORT_FILES
        .map((relative) => node_path_1.default.join(output, relative))
        .filter((candidate) => node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile());
    return {
        output,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        filesWritten: generatedFiles.length + 1 + (graphConfig.updated ? 1 : 0),
        filesPruned,
        modifiedFilesPreserved,
        manifestPath,
        indexPath: node_path_1.default.join(output, indexRelative),
        explorerPath: node_path_1.default.join(output, explorerRelative),
        graphConfigPath: graphConfig.path,
        graphColorGroupsAdded: graphConfig.groupsAdded,
        graphConfigWarning: graphConfig.warning,
        legacyFilesPreserved
    };
}
function ensurePrimaryGraphColors(output) {
    const graphConfigPath = node_path_1.default.join(output, ".obsidian", "graph.json");
    let config = {};
    if (node_fs_1.default.existsSync(graphConfigPath)) {
        let parsed;
        try {
            parsed = JSON.parse(node_fs_1.default.readFileSync(graphConfigPath, "utf8").replace(/^\uFEFF/, ""));
        }
        catch {
            return {
                path: graphConfigPath,
                groupsAdded: 0,
                updated: false,
                warning: "Obsidian graph settings were preserved because graph.json is not valid JSON."
            };
        }
        if (!isJsonObject(parsed)) {
            return {
                path: graphConfigPath,
                groupsAdded: 0,
                updated: false,
                warning: "Obsidian graph settings were preserved because graph.json is not a JSON object."
            };
        }
        config = parsed;
    }
    if (config.colorGroups !== undefined && !Array.isArray(config.colorGroups)) {
        return {
            path: graphConfigPath,
            groupsAdded: 0,
            updated: false,
            warning: "Obsidian graph settings were preserved because colorGroups is not an array."
        };
    }
    const existingGroups = (config.colorGroups ?? []);
    const existingQueries = new Set(existingGroups.flatMap((group) => {
        if (!isJsonObject(group) || typeof group.query !== "string")
            return [];
        return [normalizeGraphQuery(group.query)];
    }));
    const missingGroups = PRIMARY_NODE_COLOR_GROUPS.filter((group) => !existingQueries.has(normalizeGraphQuery(group.query)));
    if (missingGroups.length === 0) {
        return {
            path: graphConfigPath,
            groupsAdded: 0,
            updated: false,
            warning: null
        };
    }
    const nextConfig = {
        ...config,
        colorGroups: [
            ...existingGroups,
            ...missingGroups.map((group) => ({ query: group.query, color: { ...group.color } }))
        ]
    };
    if (!("collapse-color-groups" in nextConfig)) {
        nextConfig["collapse-color-groups"] = false;
    }
    (0, paths_1.writeFileAtomic)(graphConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
    return {
        path: graphConfigPath,
        groupsAdded: missingGroups.length,
        updated: true,
        warning: null
    };
}
function normalizeGraphQuery(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function renderNote(node, edges, fileById, ageNoticeDays) {
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
        escapeObsidianWikiSyntax(node.content.trim()),
        "",
        "<!-- argos:relations:start -->",
        "## Relations",
        ""
    ];
    if (outgoing.length === 0 && incoming.length === 0) {
        lines.push("_No relations recorded._");
    }
    else {
        if (outgoing.length > 0) {
            lines.push("### Outgoing", "");
            for (const edge of outgoing) {
                lines.push(`- \`${edge.type}\` -> ${wikiLink(fileById.get(edge.toId), edge.toTitle)}`);
            }
        }
        if (incoming.length > 0) {
            if (outgoing.length > 0)
                lines.push("");
            lines.push("### Incoming", "");
            for (const edge of incoming) {
                lines.push(`- \`${edge.type}\` <- \`${edge.fromId}\` ${plainText(edge.fromTitle)}`);
            }
        }
    }
    lines.push("<!-- argos:relations:end -->", "");
    return `${lines.filter((line, index) => !(line === "" && lines[index - 1] === "" && index > 9)).join("\n")}\n`;
}
function escapeObsidianWikiSyntax(value) {
    return value.replace(/\[\[/g, "\\[\\[");
}
function renderIndex(db, nodes, edges, generatedAt) {
    const nodeCounts = new Map();
    const staleCounts = new Map();
    const connectedNodeIds = new Set();
    for (const node of nodes) {
        nodeCounts.set(node.type, (nodeCounts.get(node.type) ?? 0) + 1);
        if (node.ageDays >= db.config.ageNoticeDays) {
            staleCounts.set(node.type, (staleCounts.get(node.type) ?? 0) + 1);
        }
    }
    const relationCounts = new Map();
    for (const edge of edges) {
        relationCounts.set(edge.type, (relationCounts.get(edge.type) ?? 0) + 1);
        connectedNodeIds.add(edge.fromId);
        connectedNodeIds.add(edge.toId);
    }
    const staleCount = nodes.filter((node) => node.ageDays >= db.config.ageNoticeDays).length;
    const isolatedCount = nodes.length - connectedNodeIds.size;
    const latestUpdate = nodes.reduce((latest, node) => latest === null || node.updatedAt > latest ? node.updatedAt : latest, null);
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
    lines.push("", "## Relation Types", "", "| Relation | Count |", "| --- | ---: |");
    for (const [type, count] of [...relationCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`| \`${type}\` | ${count} |`);
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
}
function renderExplorerBase() {
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
function compareEdges(left, right) {
    return left.type.localeCompare(right.type)
        || left.fromId.localeCompare(right.fromId)
        || left.toId.localeCompare(right.toId);
}
function plainText(value) {
    return value.replace(/[\[\]`\r\n|]/g, " ").replace(/\s+/g, " ").trim();
}
function noteRelativePath(node) {
    return node_path_1.default.join(displayType(node.type), `${node.publicId} ${safeFileName(node.title)}.md`);
}
function safeFileName(value) {
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
function displayType(value) {
    return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function wikiLink(relative, title) {
    const withoutExtension = toPosix(relative).replace(/\.md$/i, "");
    return `[[${withoutExtension}|${title.replace(/[\[\]|]/g, " ")}]]`;
}
function toPosix(value) {
    return value.replace(/\\/g, "/");
}
function readManifest(filePath) {
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(filePath, "utf8"));
        if ((parsed.formatVersion !== 1 && parsed.formatVersion !== 2) || !Array.isArray(parsed.generatedFiles))
            return null;
        const generatedFiles = parsed.generatedFiles.filter((value) => typeof value === "string");
        const sha256ByFile = parsed.formatVersion === 2 && parsed.sha256ByFile && typeof parsed.sha256ByFile === "object"
            ? Object.fromEntries(Object.entries(parsed.sha256ByFile).filter((entry) => typeof entry[1] === "string"))
            : {};
        return {
            formatVersion: 2,
            generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
            generatedFiles,
            sha256ByFile
        };
    }
    catch {
        return null;
    }
}
function sha256File(filePath) {
    return node_crypto_1.default.createHash("sha256").update(node_fs_1.default.readFileSync(filePath)).digest("hex");
}
function isInside(root, candidate) {
    const relative = node_path_1.default.relative(root, candidate);
    return relative !== "" && !relative.startsWith("..") && !node_path_1.default.isAbsolute(relative);
}
