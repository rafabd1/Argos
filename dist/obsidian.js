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
function exportObsidian(db, outputInput, prune = false) {
    const output = node_path_1.default.resolve(outputInput ?? (0, paths_1.defaultVaultPath)(db.root));
    (0, paths_1.ensureDir)(output);
    return (0, locked_sqlite_1.withArgosFileLock)(`${output}.argos-export-lock`, () => exportObsidianLocked(db, output, prune));
}
function exportObsidianLocked(db, output, prune) {
    const snapshot = db.snapshot();
    const nodes = snapshot.nodes.sort((a, b) => a.publicId.localeCompare(b.publicId));
    const edges = snapshot.edges;
    const fileById = new Map(nodes.map((node) => [node.publicId, noteRelativePath(node)]));
    const generatedFiles = [];
    for (const node of nodes) {
        const relative = fileById.get(node.publicId);
        const fullPath = node_path_1.default.join(output, relative);
        const body = renderNote(node, edges, fileById);
        (0, paths_1.writeFileAtomic)(fullPath, body);
        generatedFiles.push(toPosix(relative));
    }
    const indexRelative = "Argos Index.md";
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(output, indexRelative), renderIndex(db, nodes, fileById));
    generatedFiles.push(indexRelative);
    const canvasRelative = "Argos Knowledge Graph.canvas";
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(output, canvasRelative), `${JSON.stringify(renderCanvas(nodes, edges, fileById), null, 2)}\n`);
    generatedFiles.push(canvasRelative);
    const manifestPath = node_path_1.default.join(output, ".argos-export.json");
    const previous = readManifest(manifestPath);
    let filesPruned = 0;
    let modifiedFilesPreserved = 0;
    if (prune && previous) {
        const current = new Set(generatedFiles);
        for (const relative of previous.generatedFiles) {
            if (current.has(relative))
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
        : [...new Set([...(previous?.generatedFiles ?? []), ...generatedFiles])];
    const sha256ByFile = {};
    for (const relative of managedFiles) {
        const candidate = node_path_1.default.resolve(output, relative);
        if (isInside(output, candidate) && node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile()) {
            sha256ByFile[relative] = sha256File(candidate);
        }
    }
    const manifest = {
        formatVersion: 2,
        generatedAt: new Date().toISOString(),
        generatedFiles: managedFiles.sort(),
        sha256ByFile
    };
    (0, paths_1.writeFileAtomic)(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
        output,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        filesWritten: generatedFiles.length + 1,
        filesPruned,
        modifiedFilesPreserved,
        manifestPath,
        canvasPath: node_path_1.default.join(output, canvasRelative)
    };
}
function renderNote(node, edges, fileById) {
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
    }
    else {
        for (const edge of related) {
            if (edge.fromId === node.publicId) {
                lines.push(`- \`${edge.type}\` -> ${wikiLink(fileById.get(edge.toId), edge.toTitle)}`);
            }
            else {
                lines.push(`- <- \`${edge.type}\` - ${wikiLink(fileById.get(edge.fromId), edge.fromTitle)}`);
            }
        }
    }
    lines.push("<!-- argos:relations:end -->", "");
    return `${lines.filter((line, index) => !(line === "" && lines[index - 1] === "" && index > 9)).join("\n")}\n`;
}
function renderIndex(db, nodes, fileById) {
    const grouped = new Map();
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
            lines.push(`- ${wikiLink(fileById.get(node.publicId), node.title)} - updated ${node.ageDays} day(s) ago`);
        }
        lines.push("");
    }
    return `${lines.join("\n")}\n`;
}
function renderCanvas(nodes, edges, fileById) {
    const typeOrder = [...new Set(nodes.map((node) => node.type))].sort();
    const rowByType = new Map(typeOrder.map((type, index) => [type, index]));
    const countByType = new Map();
    return {
        nodes: nodes.map((node) => {
            const column = countByType.get(node.type) ?? 0;
            countByType.set(node.type, column + 1);
            return {
                id: node.publicId,
                type: "file",
                file: toPosix(fileById.get(node.publicId)),
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
