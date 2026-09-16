import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "dist", "cli.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "argos-smoke-"));
const target = path.join(temp, "target");
fs.mkdirSync(target, { recursive: true });
const env = {
  ...process.env,
  ARGOS_DISABLE_OBSIDIAN_SYNC: "1",
  OPENCODE_COMMAND: process.execPath
};

try {
  const version = run("--version");
  assert.equal(version.version, "0.1.7");
  const initialized = run("init", "--root", target, "--name", "Smoke Target");
  assert.equal(initialized.initialized, true);
  const namedDefaultExport = run("export", "obsidian", "--root", target);
  assert.equal(namedDefaultExport.output, path.join(target, ".argos", "obsidian", "Smoke Target"));
  assert(fs.existsSync(namedDefaultExport.indexPath));
  assert.equal(namedDefaultExport.graphColorGroupsAdded, 8);
  const defaultGraphConfig = JSON.parse(fs.readFileSync(namedDefaultExport.graphConfigPath, "utf8"));
  assert.deepEqual(defaultGraphConfig.colorGroups.map((group) => group.query), [
    "[type:component]",
    "[type:boundary]",
    "[type:principal]",
    "[type:sink]",
    "[type:test]",
    "[type:hypothesis]",
    "[type:finding]",
    "[type:guarantee]"
  ]);
  assert.deepEqual(Object.fromEntries(defaultGraphConfig.colorGroups.map((group) => [group.query, group.color.rgb])), {
    "[type:component]": 0x2869ff,
    "[type:boundary]": 0xfbef00,
    "[type:principal]": 0x9e41ff,
    "[type:sink]": 0xc21800,
    "[type:test]": 0x61ebff,
    "[type:hypothesis]": 0xf339ff,
    "[type:finding]": 0xffffff,
    "[type:guarantee]": 0x1cae9e
  });
  const sanitizedNameTarget = path.join(temp, "sanitized-name-target");
  fs.mkdirSync(sanitizedNameTarget, { recursive: true });
  run("init", "--root", sanitizedNameTarget, "--name", "Review / Target: 2026.");
  const sanitizedDefaultExport = run("export", "obsidian", "--root", sanitizedNameTarget);
  assert.equal(sanitizedDefaultExport.output, path.join(sanitizedNameTarget, ".argos", "obsidian", "Review Target 2026"));
  const legacyConfigPath = path.join(target, ".argos", "config.json");
  const legacyConfig = JSON.parse(fs.readFileSync(legacyConfigPath, "utf8"));
  legacyConfig.nodeTypes = legacyConfig.nodeTypes.filter((type) => type !== "guarantee");
  legacyConfig.relationTypes = legacyConfig.relationTypes.filter((type) => type !== "guards");
  fs.writeFileSync(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
  const upgradedVocabulary = run("vocabulary", "list", "--root", target);
  assert(upgradedVocabulary.nodeTypes.includes("guarantee"));
  assert(upgradedVocabulary.relationTypes.includes("guards"));
  await Promise.all([
    runAsync("vocabulary", "add", "--root", target, "--kind", "node", "--name", "protocol_frame"),
    runAsync("vocabulary", "add", "--root", target, "--kind", "relation", "--name", "decodes_as")
  ]);
  const concurrentVocabulary = run("vocabulary", "list", "--root", target);
  assert(concurrentVocabulary.nodeTypes.includes("protocol_frame"));
  assert(concurrentVocabulary.relationTypes.includes("decodes_as"));
  const unknownOption = runFailure("node", "create", "--root", target, "--type", "note", "--title", "Typo must fail", "--conent", "lost body");
  assert(unknownOption.includes("Unknown option: --conent"));
  const extraArgument = runFailure("status", "--root", target, "ignored-value");
  assert(extraArgument.includes("Unexpected positional argument"));
  const invalidBoolean = runFailure("export", "obsidian", "--root", target, "--prune", "sometimes");
  assert(invalidBoolean.includes("--prune must be true or false"));
  const removedOrchestrationCommand = runFailure("chimera");
  assert(removedOrchestrationCommand.includes("Unknown command"));

  const targetNode = create("target", "Smoke Target", "Version 1.0 target.", ["smoke-app"]);
  const beforeRejectedOrphan = run("status", "--root", target).counts.nodes;
  const rejectedOrphan = runFailure("node", "create", "--root", target, "--type", "component", "--title", "Detached component", "--content", "Must roll back.");
  assert(rejectedOrphan.includes("requires an initialRelation"));
  assert.equal(run("status", "--root", target).counts.nodes, beforeRejectedOrphan);
  const rejectedGenericRelation = runFailure(
    "node", "create", "--root", target, "--type", "component", "--title", "Generic attachment", "--content", "Must roll back.",
    "--link-to", targetNode.publicId, "--relation", "related_to", "--direction", "incoming"
  );
  assert(rejectedGenericRelation.includes("related_to cannot be used"));
  assert.equal(run("status", "--root", target).counts.nodes, beforeRejectedOrphan);
  const rejectedFlatSink = runFailure(
    "node", "create", "--root", target, "--type", "sink", "--title", "Root-level sink", "--content", "Must roll back.",
    "--link-to", targetNode.publicId, "--relation", "contains", "--direction", "incoming"
  );
  assert(rejectedFlatSink.includes("Attach detailed knowledge"));
  assert.equal(run("status", "--root", target).counts.nodes, beforeRejectedOrphan);
  const component = create("component", "Archive importer", "Accepts an archive and emits normalized entries. A catch-all route may be written as `[[...slug]]`.", ["ArchiveImporter", "src/importer.ts"]);
  const data = create("data", "Archive entry path", "A path supplied by an imported archive.", ["entry.path"]);
  const sinkA = create("sink", "Archive file write", "Writes a normalized entry under the extraction root.", ["writeEntry"]);
  const state = create("state", "Imported workspace tree", "Files become visible to the build worker after extraction.", ["workspace tree"]);
  const sinkB = create("sink", "Build hook execution", "Runs a project hook as the build principal.", ["runHook"]);
  const hypothesis = create("hypothesis", "Archive path reaches build hook", "Open until the path and execution boundary are tested.");
  const test = create("test", "Archive traversal negative control", "Valid entry stays below the extraction root; alternate encodings remain untested.");

  const duplicate = run("node", "create", "--root", target, "--type", "sink", "--title", "Archive file write", "--content", "duplicate body");
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.canonical.publicId, sinkA.publicId);

  link(targetNode.publicId, "contains", component.publicId);
  link(component.publicId, "reads", data.publicId);
  link(data.publicId, "flows_to", sinkA.publicId);
  link(sinkA.publicId, "produces", state.publicId);
  const stateToSinkB = link(state.publicId, "flows_to", sinkB.publicId);
  link(test.publicId, "tests", sinkA.publicId);
  link(test.publicId, "refutes", hypothesis.publicId);
  const repeated = link(state.publicId, "flows_to", sinkB.publicId);
  assert.equal(repeated.publicId, stateToSinkB.publicId);

  const map = run("map", "--root", target, "--id", sinkA.publicId, "--depth", "3");
  assert(map.nodes.some((node) => node.publicId === sinkB.publicId));
  const boundedMap = run("map", "--root", target, "--id", sinkA.publicId, "--depth", "3", "--limit", "3");
  assert.equal(boundedMap.nodes.length, 3);
  assert.equal(boundedMap.truncated, true);
  assert(boundedMap.omittedNeighborCount > 0);
  const chains = run("chains", "--root", target, "--from", sinkA.publicId, "--max-hops", "4");
  assert(chains.some((chain) => chain.nodes.at(-1).publicId === sinkB.publicId));
  const search = run("search", "--root", target, "--query", "entry.path build worker", "--depth", "2");
  assert(search.some((hit) => hit.node.publicId === data.publicId));
  const symbolNode = create(
    "component",
    "Tungstenite acceptance tracing",
    "The accept path records request spans through query_spans before protocol handoff.",
    ["query_spans", "accept tracing"]
  );
  const exactSymbolSearch = run("search", "--root", target, "--query", "query_spans", "--depth", "0", "--limit", "5");
  assert.equal(exactSymbolSearch[0].node.publicId, symbolNode.publicId);
  const compoundSymbolSearch = run("search", "--root", target, "--query", "tungstenite accept query_spans", "--depth", "0", "--limit", "5");
  assert(compoundSymbolSearch.slice(0, 3).some((hit) => hit.node.publicId === symbolNode.publicId));

  const updated = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--mode", "append", "--content", "Reopen if another archive producer bypasses normalization.");
  assert(updated.content.includes("Reopen"));
  const editsFile = path.join(temp, "node-edits.json");
  fs.writeFileSync(editsFile, JSON.stringify([
    {
      oldText: "Open until the path and execution boundary are tested.",
      newText: "Testing remains open until the path and the execution boundary are tested."
    },
    {
      oldText: "Reopen if another archive producer bypasses normalization.",
      newText: "Recheck if another archive producer bypasses normalization."
    }
  ]));
  const edited = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--edits-file", editsFile);
  assert(edited.content.includes("Testing remains open"));
  assert(edited.content.includes("Recheck if another archive producer"));
  const directlyEdited = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--old-text", "Testing remains open", "--new-text", "Testing is still open");
  assert(directlyEdited.content.includes("Testing is still open"));
  const missingReplacement = runFailure("node", "update", "--root", target, "--id", hypothesis.publicId, "--old-text", "Testing is still open", "--new-text");
  assert(missingReplacement.includes("Missing --new-text value"));

  const beforeFailedEdit = run("node", "get", "--root", target, "--id", hypothesis.publicId).node;
  fs.writeFileSync(editsFile, JSON.stringify([
    { oldText: "Testing is still open", newText: "This first edit must roll back" },
    { oldText: "missing exact text", newText: "must fail" }
  ]));
  const missingEdit = runFailure("node", "update", "--root", target, "--id", hypothesis.publicId, "--edits-file", editsFile);
  assert(missingEdit.includes("expected one oldText match but found 0"));
  const afterFailedEdit = run("node", "get", "--root", target, "--id", hypothesis.publicId).node;
  assert.equal(afterFailedEdit.content, beforeFailedEdit.content);
  assert.equal(afterFailedEdit.updatedAt, beforeFailedEdit.updatedAt);

  fs.writeFileSync(editsFile, JSON.stringify([{ oldText: "the ", newText: "a " }]));
  const ambiguousEdit = runFailure("node", "update", "--root", target, "--id", hypothesis.publicId, "--edits-file", editsFile);
  assert(ambiguousEdit.includes("expected one oldText match but found 2"));

  const deletedText = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--old-text", "\n\nRecheck if another archive producer bypasses normalization.", "--new-text=");
  assert.equal(deletedText.content.includes("Recheck if another archive producer"), false);
  const noFields = runFailure("node", "update", "--root", target, "--id", hypothesis.publicId);
  assert(noFields.includes("requires a title, content, aliases, or exact text edits"));
  const beforeNoop = run("node", "get", "--root", target, "--id", hypothesis.publicId);
  const noop = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--content", beforeNoop.node.content);
  assert.equal(noop.updatedAt, beforeNoop.node.updatedAt);
  assert(runFailure("history", "--root", target).includes("Unknown command: history"));

  const legacyDb = new DatabaseSync(path.join(target, ".argos", "knowledge.sqlite"));
  legacyDb.exec(`
    CREATE TABLE node_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      content TEXT NOT NULL,
      replaced_at TEXT NOT NULL,
      previous_updated_at TEXT NOT NULL
    )
  `);
  legacyDb.prepare(
    "INSERT INTO node_revisions(node_id, title, aliases_json, content, replaced_at, previous_updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(hypothesis.id, hypothesis.title, "[]", "Former body", new Date().toISOString(), hypothesis.updatedAt);
  legacyDb.prepare(`
    INSERT INTO link_suggestions(from_node_id, relation_type, to_node_id, score, reasons_json, status, created_at)
    VALUES (?, 'related_to', ?, 0.5, '["legacy similarity"]', 'pending', ?)
  `).run(symbolNode.id, sinkB.id, new Date().toISOString());
  legacyDb.prepare("UPDATE metadata SET value = '2' WHERE key = 'schema_version'").run();
  legacyDb.close();
  const migratedStatus = run("status", "--root", target);
  assert.equal(migratedStatus.schemaVersion, 4);
  assert.equal("revisions" in migratedStatus.counts, false);
  const migratedDb = new DatabaseSync(path.join(target, ".argos", "knowledge.sqlite"));
  assert.equal(migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'node_revisions'").get(), undefined);
  assert.equal(migratedDb.prepare("SELECT relation_type FROM link_suggestions WHERE reasons_json = '[\"legacy similarity\"]'").get().relation_type, "candidate");
  migratedDb.prepare("UPDATE link_suggestions SET status = 'rejected', reviewed_at = ? WHERE reasons_json = '[\"legacy similarity\"]'").run(new Date().toISOString());
  migratedDb.close();
  const invalidInteger = runFailure("map", "--root", target, "--id", hypothesis.publicId, "--limit", "2.5");
  assert(invalidInteger.includes("--limit must be an integer"));
  const conflictingReference = runFailure("node", "get", hypothesis.publicId, "--root", target, "--id", sinkA.publicId);
  assert(conflictingReference.includes("either as an option or a positional value"));

  const suggestions = run("link", "suggest", "--root", target, "--id", sinkA.publicId, "--limit", "20");
  assert(Array.isArray(suggestions));
  const gaps = run("gaps", "--root", target);
  assert(gaps.some((gap) => gap.code === "sink_without_test" && gap.nodeId === sinkB.publicId));

  const sqlite = new DatabaseSync(path.join(target, ".argos", "knowledge.sqlite"));
  sqlite.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", sinkB.id);
  sqlite.close();
  const stale = run("stale", "--root", target, "--age-days", "90");
  assert(stale.some((node) => node.publicId === sinkB.publicId && node.ageDays > 1000));

  const vault = path.join(temp, "vault");
  const exported = run("export", "obsidian", "--root", target, "--out", vault);
  assert.equal(exported.nodeCount, 9);
  assert(fs.existsSync(path.join(vault, "Argos Index.md")));
  assert(fs.existsSync(path.join(vault, "Argos Explorer.base")));
  assert.equal(fs.existsSync(path.join(vault, "Argos Knowledge Graph.canvas")), false);
  const graphConfigPath = path.join(vault, ".obsidian", "graph.json");
  const customizedGraphConfig = JSON.parse(fs.readFileSync(graphConfigPath, "utf8"));
  customizedGraphConfig.showArrow = true;
  customizedGraphConfig["collapse-color-groups"] = true;
  customizedGraphConfig.colorGroups.find((group) => group.query === "[type:component]").color.rgb = 0x123456;
  customizedGraphConfig.colorGroups = customizedGraphConfig.colorGroups
    .filter((group) => group.query !== "[type:sink]");
  customizedGraphConfig.colorGroups.push({ query: "path:Manual", color: { a: 1, rgb: 0xabcdef } });
  fs.writeFileSync(graphConfigPath, `${JSON.stringify(customizedGraphConfig, null, 2)}\n`);
  const mergedGraphExport = run("export", "obsidian", "--root", target, "--out", vault);
  assert.equal(mergedGraphExport.graphColorGroupsAdded, 1);
  assert.equal(mergedGraphExport.graphConfigWarning, null);
  const mergedGraphConfig = JSON.parse(fs.readFileSync(graphConfigPath, "utf8"));
  assert.equal(mergedGraphConfig.showArrow, true);
  assert.equal(mergedGraphConfig["collapse-color-groups"], true);
  assert.equal(mergedGraphConfig.colorGroups.find((group) => group.query === "[type:component]").color.rgb, 0x123456);
  assert.equal(mergedGraphConfig.colorGroups.filter((group) => group.query === "[type:sink]").length, 1);
  assert(mergedGraphConfig.colorGroups.some((group) => group.query === "path:Manual"));
  assert.equal(JSON.parse(fs.readFileSync(exported.manifestPath, "utf8")).generatedFiles.includes(".obsidian/graph.json"), false);

  const invalidGraphVault = path.join(temp, "invalid-graph-vault");
  const invalidGraphConfigPath = path.join(invalidGraphVault, ".obsidian", "graph.json");
  fs.mkdirSync(path.dirname(invalidGraphConfigPath), { recursive: true });
  fs.writeFileSync(invalidGraphConfigPath, "{user-managed-invalid-json\n");
  const invalidGraphExport = run("export", "obsidian", "--root", target, "--out", invalidGraphVault);
  assert.match(invalidGraphExport.graphConfigWarning, /not valid JSON/);
  assert.equal(fs.readFileSync(invalidGraphConfigPath, "utf8"), "{user-managed-invalid-json\n");
  const indexBody = fs.readFileSync(path.join(vault, "Argos Index.md"), "utf8");
  assert(indexBody.includes("![[Argos Explorer.base]]"));
  assert.equal((indexBody.match(/\[\[/g) ?? []).length, 1);
  const projectedNodeNotes = fs.readdirSync(vault, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".md") && name !== "Argos Index.md");
  const componentNote = projectedNodeNotes.find((name) => name.includes("Archive importer"));
  assert(componentNote);
  const componentNoteBody = fs.readFileSync(path.join(vault, componentNote), "utf8");
  assert(componentNoteBody.includes("`\\[\\[...slug]]`"));
  assert.equal(/(?<!\\)\[\[\.\.\.slug\]\]/.test(componentNoteBody), false);
  const projectedRelationLinks = projectedNodeNotes.reduce((count, relative) => {
    const body = fs.readFileSync(path.join(vault, relative), "utf8");
    const relations = body.slice(body.indexOf("<!-- argos:relations:start -->"));
    return count + (relations.match(/^- .*(?<!\\)\[\[/gm) ?? []).length;
  }, 0);
  assert.equal(projectedRelationLinks, exported.edgeCount);
  const incomingOnlyNote = fs.readdirSync(vault, { recursive: true }).map(String).find((name) => name.includes("Build hook execution"));
  assert(incomingOnlyNote);
  const incomingOnlyBody = fs.readFileSync(path.join(vault, incomingOnlyNote), "utf8");
  assert(incomingOnlyBody.includes("### Incoming"));
  assert.equal(incomingOnlyBody.includes("[["), false);
  assert(incomingOnlyBody.includes("argos_relation_count:"));
  assert(incomingOnlyBody.includes("argos_stale: true"));

  const initialManifestPath = path.join(vault, ".argos-export.json");
  const initialManifest = JSON.parse(fs.readFileSync(initialManifestPath, "utf8"));
  const retiredCanvasPath = path.join(vault, "Argos Knowledge Graph.canvas");
  fs.writeFileSync(retiredCanvasPath, '{"nodes":[],"edges":[]}\n');
  initialManifest.generatedFiles.push("Argos Knowledge Graph.canvas");
  initialManifest.sha256ByFile["Argos Knowledge Graph.canvas"] = sha256(retiredCanvasPath);
  fs.writeFileSync(initialManifestPath, `${JSON.stringify(initialManifest, null, 2)}\n`);
  const unmanagedLegacyNote = path.join(vault, "Argos Knowledge Graph.md");
  fs.writeFileSync(unmanagedLegacyNote, "");
  const migratedExport = run("export", "obsidian", "--root", target, "--out", vault);
  assert.equal(migratedExport.filesPruned, 1);
  assert.equal(fs.existsSync(retiredCanvasPath), false);
  assert.equal(fs.existsSync(unmanagedLegacyNote), true);
  assert(migratedExport.legacyFilesPreserved.includes(unmanagedLegacyNote));

  const preservedManifest = JSON.parse(fs.readFileSync(initialManifestPath, "utf8"));
  fs.writeFileSync(retiredCanvasPath, '{"nodes":[],"edges":[]}\n');
  preservedManifest.generatedFiles.push("Argos Knowledge Graph.canvas");
  preservedManifest.sha256ByFile["Argos Knowledge Graph.canvas"] = sha256(retiredCanvasPath);
  fs.appendFileSync(retiredCanvasPath, "user change\n");
  fs.writeFileSync(initialManifestPath, `${JSON.stringify(preservedManifest, null, 2)}\n`);
  const preservedCanvasExport = run("export", "obsidian", "--root", target, "--out", vault);
  assert.equal(preservedCanvasExport.modifiedFilesPreserved, 1);
  assert.equal(fs.existsSync(retiredCanvasPath), true);
  assert(preservedCanvasExport.legacyFilesPreserved.includes(retiredCanvasPath));
  fs.unlinkSync(retiredCanvasPath);
  const concurrentExports = await Promise.all(Array.from({ length: 2 }, () => runAsync("export", "obsidian", "--root", target, "--out", vault)));
  assert(concurrentExports.every((result) => result.nodeCount === 9));
  const sinkNote = fs.readdirSync(vault, { recursive: true }).map(String).find((name) => name.includes("Archive file write"));
  assert(sinkNote);
  assert(fs.readFileSync(path.join(vault, sinkNote), "utf8").includes("[["));
  const oldTargetNote = fs.readdirSync(vault, { recursive: true }).map(String).find((name) => name.includes("N000001 Smoke Target.md"));
  assert(oldTargetNote);
  const oldComponentNote = fs.readdirSync(vault, { recursive: true }).map(String).find((name) => name.includes("N000002 Archive importer.md"));
  assert(oldComponentNote);
  run("node", "update", "--root", target, "--id", targetNode.publicId, "--title", "Smoke Target 1.0");
  run("node", "update", "--root", target, "--id", component.publicId, "--title", "Archive importer 1.0");
  run("export", "obsidian", "--root", target, "--out", vault);
  assert(fs.existsSync(path.join(vault, oldTargetNote)));
  assert(fs.existsSync(path.join(vault, oldComponentNote)));
  fs.appendFileSync(path.join(vault, oldComponentNote), "\nManual vault annotation.\n");
  const newTargetNote = fs.readdirSync(vault, { recursive: true }).map(String).find((name) => name.includes("N000001 Smoke Target 1.0.md"));
  assert(newTargetNote);
  const prunedExport = run("export", "obsidian", "--root", target, "--out", vault, "--prune");
  assert.equal(prunedExport.filesPruned, 1);
  assert.equal(prunedExport.modifiedFilesPreserved, 1);
  assert.equal(fs.existsSync(path.join(vault, oldTargetNote)), false);
  assert.equal(fs.existsSync(path.join(vault, oldComponentNote)), true);
  const legacyRelative = "Sink/N999999 Legacy projection.md";
  const legacyPath = path.join(vault, ...legacyRelative.split("/"));
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, "---\nargos_id: N999999\n---\n\nLegacy projection.\n");
  const manifestPath = path.join(vault, ".argos-export.json");
  const legacyManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  legacyManifest.formatVersion = 1;
  legacyManifest.generatedFiles.push(legacyRelative);
  delete legacyManifest.sha256ByFile;
  fs.writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
  const legacyPrune = run("export", "obsidian", "--root", target, "--out", vault, "--prune");
  assert.equal(legacyPrune.modifiedFilesPreserved, 1);
  assert.equal(fs.existsSync(legacyPath), true);

  const concurrentNames = ["Quartz", "Nimbus", "Orbit", "Tundra", "Helix", "Cobalt", "Vector", "Lantern"];
  const rootAttachment = ["--link-to", targetNode.publicId, "--relation", "contains", "--direction", "incoming"];
  const concurrent = await Promise.all(concurrentNames.map((name) => runAsync("node", "create", "--root", target, "--type", "note", "--title", name, "--content", "lock test", ...rootAttachment)));
  assert(concurrent.every((result) => result.created));
  const sameIdentity = await Promise.all(Array.from({ length: 6 }, () => runAsync("node", "create", "--root", target, "--type", "note", "--title", "Canonical concurrent note", "--content", "same identity race", ...rootAttachment)));
  assert.equal(sameIdentity.filter((result) => result.created).length, 1);
  assert.equal(new Set(sameIdentity.map((result) => (result.node ?? result.canonical).publicId)).size, 1);
  const canonicalConcurrent = sameIdentity[0].node ?? sameIdentity[0].canonical;
  const sameEdges = await Promise.all(Array.from({ length: 6 }, () => runAsync("link", "add", "--root", target, "--from", targetNode.publicId, "--type", "contains", "--to", canonicalConcurrent.publicId)));
  assert.equal(new Set(sameEdges.map((edge) => edge.publicId)).size, 1);
  const status = run("status", "--root", target);
  assert.equal(status.counts.nodes, 18);
  assert.equal(status.counts.isolatedNodes, 0);
  assert.equal(status.counts.broadRootLinks, 0);
  assert.deepEqual(status.integrityWarnings, []);

  const mergeSource = create("component", "Legacy archive dispatcher", "The earlier note recorded `ArchiveDispatch.call` and one caller.", ["LegacyArchiveDispatch"]);
  run("node", "update", "--root", target, "--id", mergeSource.publicId, "--mode", "append", "--content", "A later trace showed this is the same dispatcher implementation.");
  const mergeDestination = create("component", "Canonical archive dispatcher", "Canonical dispatcher note.", ["ArchiveDispatch.call"]);
  link(targetNode.publicId, "contains", mergeSource.publicId);
  link(targetNode.publicId, "contains", mergeDestination.publicId);
  const merged = run(
    "node", "merge", "--root", target,
    "--source", mergeSource.publicId,
    "--into", mergeDestination.publicId,
    "--content", "`ArchiveDispatch.call` is the canonical dispatcher. Both observed callers are retained here."
  );
  assert.equal(merged.redirectedFrom, mergeSource.publicId);
  assert.equal(merged.canonical.publicId, mergeDestination.publicId);
  assert(merged.canonical.aliases.includes("Legacy archive dispatcher"));
  assert.equal(merged.deduplicatedEdges, 1);
  const redirectedContext = run("node", "get", "--root", target, "--id", mergeSource.publicId);
  assert.equal(redirectedContext.resolvedFrom, mergeSource.publicId);
  assert.equal(redirectedContext.node.publicId, mergeDestination.publicId);
  const redirectedEdge = link(mergeSource.publicId, "calls", sinkA.publicId);
  assert.equal(redirectedEdge.fromId, mergeDestination.publicId);
  assert.equal(run("node", "list", "--root", target, "--limit", "100").some((node) => node.publicId === mergeSource.publicId), false);
  const redirectedRemoval = runFailure("node", "remove", "--root", target, "--id", mergeSource.publicId, "--reason", "Retired ID must not delete its canonical node implicitly");
  assert(redirectedRemoval.includes(`resolves to ${mergeDestination.publicId}`));
  const removedMergedNode = run("node", "remove", "--root", target, "--id", mergeDestination.publicId, "--reason", "Synthetic smoke-test identity no longer belongs in the map");
  assert.equal(removedMergedNode.removed.publicId, mergeDestination.publicId);
  assert.equal(removedMergedNode.removedRedirects, 1);
  assert(removedMergedNode.removedEdges >= 1);
  assert(runFailure("node", "get", "--root", target, "--id", mergeDestination.publicId).includes("was not found"));
  assert(runFailure("node", "get", "--root", target, "--id", mergeSource.publicId).includes("was not found"));

  const crossTypeComponent = create("component", "Shared dispatch operation", "Owns the dispatch implementation.");
  const crossTypeReview = runReview("node", "create", "--root", target, "--type", "sink", "--title", "Shared dispatch operation", "--content", "Same name, different proposed type.");
  assert.equal(crossTypeReview.resolutionRequired, true);
  assert.equal(crossTypeReview.candidates[0].node.publicId, crossTypeComponent.publicId);
  assert.equal(crossTypeReview.candidates[0].node.type, "component");
  const reviewedDistinct = run("node", "create", "--root", target, "--type", "sink", "--title", "Shared dispatch operation", "--content", "A separately reviewed sink identity.", "--distinct-from", crossTypeComponent.publicId, "--link-to", crossTypeComponent.publicId, "--relation", "calls", "--direction", "incoming");
  assert.equal(reviewedDistinct.created, true);
  const contentOnlyUpdate = run("node", "update", "--root", target, "--id", reviewedDistinct.node.publicId, "--mode", "append", "--content", "Cross-type distinction remains explicit.");
  assert(contentOnlyUpdate.content.includes("Cross-type distinction"));
  const symbolSource = create("component", "Dispatch implementation", "Calls `SharedDispatcher.execute` with `DispatchEnvelope.payload` after normalization.");
  const symbolReview = runReview("node", "create", "--root", target, "--type", "component", "--title", "Normalized action runner", "--content", "The path reaches `SharedDispatcher.execute` with `DispatchEnvelope.payload` under a different label.");
  assert.equal(symbolReview.resolutionRequired, true);
  assert(symbolReview.candidates.some((candidate) => candidate.node.publicId === symbolSource.publicId && candidate.reasons.some((reason) => reason.includes("shared identifier"))));
  const boundary = create("boundary", "Archive extraction boundary", "Archive-controlled data crosses into the workspace filesystem.");
  const guarantee = create("guarantee", "Extraction root containment", "The path check guards writes only after the normal archive decoder has produced an entry.");
  link(data.publicId, "crosses", boundary.publicId);
  link(guarantee.publicId, "guards", sinkA.publicId);
  link(test.publicId, "tests", guarantee.publicId);
  const guardedGaps = run("gaps", "--root", target, "--id", sinkA.publicId);
  assert.equal(guardedGaps.some((gap) => gap.code === "boundary_without_guarantee_context"), false);
  const unguardedSink = create("sink", "Deferred archive publish", "Publishes staged entries after a separate boundary transition.");
  const unguardedBoundary = create("boundary", "Deferred publish boundary", "Separates staged data from the publishing worker.");
  const nearbyButUnappliedGuarantee = create("guarantee", "Unrelated staging checksum", "Checks an adjacent staging object but does not guard publication.");
  link(unguardedSink.publicId, "crosses", unguardedBoundary.publicId);
  link(nearbyButUnappliedGuarantee.publicId, "related_to", unguardedBoundary.publicId);
  const unguardedGaps = run("gaps", "--root", target, "--id", unguardedSink.publicId);
  assert(unguardedGaps.some((gap) => gap.code === "boundary_without_guarantee_context"));
  link(nearbyButUnappliedGuarantee.publicId, "guards", unguardedBoundary.publicId);
  const explicitlyGuardedGaps = run("gaps", "--root", target, "--id", unguardedSink.publicId);
  assert.equal(explicitlyGuardedGaps.some((gap) => gap.code === "boundary_without_guarantee_context"), false);
  const boundedContext = run("node", "get", "--root", target, "--id", sinkA.publicId, "--relation-limit", "1");
  assert.equal(boundedContext.relationLimit, 1);
  assert.equal(boundedContext.relationsTruncated, true);
  assert(boundedContext.incomingTotal > boundedContext.incoming.length || boundedContext.outgoingTotal > boundedContext.outgoing.length);

  const suggestionTarget = create("component", "Bridge token adapter", "Consumes `bridge.token` before dispatch.");
  const suggestionSource = create("component", "Shared token propagation", "Carries `bridge.token` between two internal boundaries.");
  const relationCandidates = run("link", "suggest", "--root", target, "--id", suggestionSource.publicId, "--limit", "10");
  const suggested = relationCandidates.find((item) => item.to.publicId === suggestionTarget.publicId);
  assert(suggested, "expected a reviewable relation suggestion");
  assert.equal(suggested.relationType, null);
  const missingRelationType = runFailure("link", "accept", "--root", target, "--id", suggested.publicId);
  assert(missingRelationType.includes("requires an explicit relation type"));
  const invalidReview = runFailure("link", "accept", "--root", target, "--id", suggested.publicId, "--type", "not_a_relation");
  assert(invalidReview.includes("Unknown relation type"));
  const stillPending = run("link", "list", "--root", target, "--status", "pending");
  assert(stillPending.some((item) => item.publicId === suggested.publicId));
  const acceptedSuggestion = run("link", "accept", "--root", target, "--id", suggested.publicId, "--type", "influences");
  assert.equal(acceptedSuggestion.status, "accepted");
  assert.equal(acceptedSuggestion.edge.type, "influences");
  assert.equal(acceptedSuggestion.edge.fromId, suggestionSource.publicId);
  assert.equal(acceptedSuggestion.edge.toId, suggestionTarget.publicId);
  const noisySuggestionTarget = create("component", "Alpha adapter surface", "Smoke Target v16.2.12 commit abcdef123456 records alpha quartz behavior.");
  const noisySuggestionSource = create("component", "Beta renderer boundary", "Smoke Target v16.2.12 commit abcdef123456 records beta zephyr behavior.");
  const noisySuggestions = run("link", "suggest", "--root", target, "--id", noisySuggestionSource.publicId, "--limit", "50");
  assert.equal(noisySuggestions.some((item) => item.to.publicId === noisySuggestionTarget.publicId), false);
  const reconsiderTarget = create("component", "Deferred token consumer", "Consumes `recheck.token` after a delayed transition.");
  const reconsiderSource = create("component", "Deferred token propagation", "Carries `recheck.token` toward a later consumer.");
  const firstSuggestion = run("link", "suggest", "--root", target, "--id", reconsiderSource.publicId, "--limit", "10")
    .find((item) => item.to.publicId === reconsiderTarget.publicId);
  assert(firstSuggestion);
  const rejectedSuggestion = run("link", "reject", "--root", target, "--id", firstSuggestion.publicId);
  assert.equal(rejectedSuggestion.status, "rejected");
  await new Promise((resolve) => setTimeout(resolve, 5));
  run("node", "update", "--root", target, "--id", reconsiderTarget.publicId, "--mode", "append", "--content", "A new trace changed the endpoint after the previous link review.");
  const reconsideredSuggestion = run("link", "suggest", "--root", target, "--id", reconsiderSource.publicId, "--limit", "10")
    .find((item) => item.publicId === firstSuggestion.publicId);
  assert.equal(reconsideredSuggestion.status, "pending");
  assert(reconsideredSuggestion.reasons.some((reason) => reason.includes("changed after the previous rejection")));

  const alternateDataResult = run("node", "create", "--root", target, "--type", "data", "--title", "Alternate archive entry path", "--content", "A second producer reaches the same write sink through a different parser.", "--aliases", "alternate.entry.path", "--distinct-from", data.publicId, "--link-to", sinkA.publicId, "--relation", "flows_to", "--direction", "outgoing");
  assert.equal(alternateDataResult.created, true);
  const alternateData = alternateDataResult.node;
  link(alternateData.publicId, "flows_to", sinkA.publicId);
  await new Promise((resolve) => setTimeout(resolve, 5));
  run("node", "update", "--root", target, "--id", alternateData.publicId, "--mode", "append", "--content", "A fresh trace changed the producer assumptions after the earlier refutation.");
  const coverageGaps = run("gaps", "--root", target, "--id", sinkA.publicId);
  assert(coverageGaps.some((gap) => gap.code === "partial_sink_path_coverage" && gap.relatedNodeIds.includes(alternateData.publicId)));
  const hypothesisGaps = run("gaps", "--root", target, "--id", hypothesis.publicId);
  assert(hypothesisGaps.some((gap) => gap.code === "refutation_with_partial_path_coverage"));
  assert(hypothesisGaps.some((gap) => gap.code === "new_relation_after_refutation"));
  assert.equal(hypothesisGaps.some((gap) => gap.code === "linked_knowledge_updated_after_refutation" && gap.relatedNodeIds.includes(alternateData.publicId)), false);
  const inspection = run("inspect", "--root", target, "--id", sinkA.publicId, "--depth", "2");
  assert.equal(inspection.context.node.publicId, sinkA.publicId);
  assert(inspection.map.nodes.some((node) => node.publicId === alternateData.publicId));
  assert(inspection.gaps.some((gap) => gap.code === "partial_sink_path_coverage"));
  assert(Buffer.byteLength(JSON.stringify(inspection), "utf8") <= inspection.output.maxPayloadBytes);
  const largeNoteFile = path.join(temp, "large-target-note.md");
  fs.writeFileSync(largeNoteFile, `Current target knowledge.\n\n${"Detailed implementation evidence. ".repeat(1_500)}END-OF-COMPLETE-NOTE`);
  const largeNote = run(
    "node", "create", "--root", target, "--type", "note", "--title", "Large canonical target note",
    "--content-file", largeNoteFile,
    "--link-to", targetNode.publicId, "--relation", "contains", "--direction", "incoming"
  ).node;
  const boundedInspection = run("inspect", "--root", target, "--id", largeNote.publicId, "--max-payload-bytes", "8192");
  assert(Buffer.byteLength(JSON.stringify(boundedInspection), "utf8") <= 8192);
  assert.equal(boundedInspection.output.nodeContentTruncated, true);
  assert(boundedInspection.output.omitted.nodeContentChars > 0);
  assert.equal(boundedInspection.context.node.content.includes("END-OF-COMPLETE-NOTE"), false);
  assert(run("node", "get", "--root", target, "--id", largeNote.publicId).node.content.includes("END-OF-COMPLETE-NOTE"));

  const graphTarget = path.join(temp, "directed-graph-target");
  fs.mkdirSync(graphTarget, { recursive: true });
  run("init", "--root", graphTarget, "--name", "Directed graph target");
  const graphRoot = createAt(graphTarget, "target", "Directed graph target", "Synthetic graph used to verify traversal semantics.");
  const graphComponent = createAt(graphTarget, "component", "Frame dispatcher", "Dispatches decoded frames.");
  const graphSink = createAt(graphTarget, "sink", "Privileged frame action", "Performs the recorded side effect.");
  const contextOnlySink = createAt(graphTarget, "sink", "Unrelated target sink", "Shares only the target container.");
  const graphBehavior = createAt(graphTarget, "behavior", "Frame type confusion", "Changes the decoded frame type.");
  const graphData = createAt(graphTarget, "data", "Alternate frame producer", "A second premise and producer.");
  const graphHypothesis = createAt(graphTarget, "hypothesis", "Confused frame reaches privileged action", "One falsifiable chain proposition.");
  const graphTest = createAt(graphTarget, "test", "Frame confusion primitive test", "Tests only the primitive at first.");
  linkAt(graphTarget, graphRoot.publicId, "contains", graphComponent.publicId);
  linkAt(graphTarget, graphComponent.publicId, "contains", contextOnlySink.publicId);
  linkAt(graphTarget, graphHypothesis.publicId, "depends_on", graphBehavior.publicId);
  linkAt(graphTarget, graphHypothesis.publicId, "depends_on", graphData.publicId);
  linkAt(graphTarget, graphBehavior.publicId, "affects", graphComponent.publicId);
  linkAt(graphTarget, graphComponent.publicId, "flows_to", graphSink.publicId);
  linkAt(graphTarget, graphData.publicId, "flows_to", graphSink.publicId);
  linkAt(graphTarget, graphTest.publicId, "tests", graphBehavior.publicId);
  linkAt(graphTarget, graphTest.publicId, "supports", graphHypothesis.publicId);

  const technicalChains = run("chains", "--root", graphTarget, "--from", graphHypothesis.publicId, "--max-hops", "5");
  assert(technicalChains.some((chain) => chain.nodes.at(-1).publicId === graphSink.publicId));
  assert.equal(technicalChains.some((chain) => chain.nodes.some((node) => node.publicId === graphRoot.publicId)), false);
  assert.equal(technicalChains.some((chain) => chain.nodes.at(-1).publicId === contextOnlySink.publicId), false);
  assert(technicalChains.every((chain) => chain.edges.every((edge, index) => edge.fromId === chain.nodes[index].publicId && edge.toId === chain.nodes[index + 1].publicId)));
  const graphInspection = run("inspect", "--root", graphTarget, "--id", graphHypothesis.publicId, "--depth", "3");
  assert.equal(graphInspection.chainMode, "directed_technical");
  assert.deepEqual(graphInspection.chains, graphInspection.technicalChains);
  assert(graphInspection.contextRelations.some((edge) => edge.type === "depends_on"));
  assert.equal(graphInspection.technicalChains.some((chain) => chain.nodes.at(-1).publicId === contextOnlySink.publicId), false);
  const authorityPrincipal = createAt(graphTarget, "principal", "Frame worker identity", "Runs decoded frame work.");
  const authorityOnlyBehavior = createAt(graphTarget, "behavior", "Authority-only frame context", "A behavior linked only through execution identity.");
  const authorityOnlySink = createAt(graphTarget, "sink", "Unrelated authority sink", "A sink sharing only an execution identity.");
  linkAt(graphTarget, authorityOnlyBehavior.publicId, "runs_as", authorityPrincipal.publicId);
  linkAt(graphTarget, authorityPrincipal.publicId, "influences", authorityOnlySink.publicId);
  assert.equal(run("chains", "--root", graphTarget, "--from", authorityOnlyBehavior.publicId).length, 0);
  const authorityInspection = run("inspect", "--root", graphTarget, "--id", authorityOnlyBehavior.publicId);
  assert(authorityInspection.contextRelations.some((edge) => edge.type === "runs_as"));
  const genericOnlyResult = run(
    "node", "create", "--root", graphTarget, "--type", "component", "--title", "Legacy generic-only component",
    "--content", "A legacy item used to verify repair diagnostics.",
    "--link-to", graphRoot.publicId, "--relation", "contains", "--direction", "incoming"
  );
  linkAt(graphTarget, genericOnlyResult.node.publicId, "related_to", graphComponent.publicId);
  run("link", "remove", "--root", graphTarget, "--id", genericOnlyResult.initialRelation.publicId);
  const genericStatus = run("status", "--root", graphTarget);
  assert(genericStatus.counts.genericOnlyNodes >= 1);
  assert(genericStatus.integrityWarnings.some((warning) => warning.code === "generic_only_nodes"));
  assert(run("gaps", "--root", graphTarget, "--id", genericOnlyResult.node.publicId).some((gap) => gap.code === "generic_only_node"));
  const graphHypothesisGaps = run("gaps", "--root", graphTarget, "--id", graphHypothesis.publicId);
  assert(graphHypothesisGaps.some((gap) => gap.code === "hypothesis_partial_premise_coverage" && gap.relatedNodeIds.includes(graphData.publicId)));
  assert(graphHypothesisGaps.some((gap) => gap.code === "hypothesis_evidence_stops_before_sink" && gap.relatedNodeIds.includes(graphSink.publicId)));
  const behaviorGaps = run("gaps", "--root", graphTarget, "--id", graphBehavior.publicId);
  assert(behaviorGaps.some((gap) => gap.code === "behavior_reaches_untested_sink" && gap.relatedNodeIds.includes(graphSink.publicId)));

  linkAt(graphTarget, graphTest.publicId, "refutes", graphHypothesis.publicId);
  await new Promise((resolve) => setTimeout(resolve, 5));
  linkAt(graphTarget, graphTest.publicId, "tests", graphData.publicId);
  linkAt(graphTarget, graphTest.publicId, "tests", graphSink.publicId);
  const completedEvidenceGaps = run("gaps", "--root", graphTarget, "--id", graphHypothesis.publicId);
  assert.equal(completedEvidenceGaps.some((gap) => gap.code === "new_relation_after_refutation"), false);
  assert.equal(completedEvidenceGaps.some((gap) => gap.code === "hypothesis_partial_premise_coverage"), false);
  assert.equal(completedEvidenceGaps.some((gap) => gap.code === "hypothesis_evidence_stops_before_sink"), false);
  assert.equal(run("gaps", "--root", graphTarget, "--id", graphBehavior.publicId).some((gap) => gap.code === "behavior_reaches_untested_sink"), false);

  await new Promise((resolve) => setTimeout(resolve, 5));
  run("node", "update", "--root", graphTarget, "--id", graphData.publicId, "--mode", "append", "--content", "The producer changed after the refutation.");
  assert(run("gaps", "--root", graphTarget, "--id", graphHypothesis.publicId)
    .some((gap) => gap.code === "linked_knowledge_updated_after_refutation" && gap.relatedNodeIds.includes(graphData.publicId)));
  const postRefuteState = createAt(graphTarget, "state", "Deferred frame state", "Changes how the action runs later.");
  linkAt(graphTarget, graphBehavior.publicId, "influences", postRefuteState.publicId);
  assert(run("gaps", "--root", graphTarget, "--id", graphHypothesis.publicId).some((gap) => gap.code === "new_relation_after_refutation"));

  const intel = createAt(graphTarget, "intel", "Historical frame advisory", "Historical external context only.");
  const intelHypothesis = createAt(graphTarget, "hypothesis", "Historical frame claim", "Requires target-specific validation.");
  linkAt(graphTarget, intel.publicId, "supports", intelHypothesis.publicId);
  assert(run("gaps", "--root", graphTarget, "--id", intelHypothesis.publicId).some((gap) => gap.code === "hypothesis_conclusion_only_from_intel"));
  const legacyHypothesis = createAt(graphTarget, "hypothesis", "Legacy frame conclusion", "Earlier conclusion.");
  const legacyTest = createAt(graphTarget, "test", "Legacy frame negative control", "Refuted the earlier proposition.");
  linkAt(graphTarget, legacyTest.publicId, "refutes", legacyHypothesis.publicId);
  const reopenedHypothesis = createAt(graphTarget, "hypothesis", "Reopened frame conclusion", "Revisits the older proposition.");
  linkAt(graphTarget, reopenedHypothesis.publicId, "derived_from", legacyHypothesis.publicId);
  assert(run("gaps", "--root", graphTarget, "--id", reopenedHypothesis.publicId).some((gap) => gap.code === "reopened_hypothesis_without_change_relation"));

  const markdownTitle = createAt(graphTarget, "note", "CURRENT-RESULTS.md", "A title that already carries a Markdown extension.");
  const graphVault = path.join(temp, "directed-graph-vault");
  run("export", "obsidian", "--root", graphTarget, "--out", graphVault);
  const noteFolder = path.join(graphVault, "Note");
  const normalizedNote = fs.readdirSync(noteFolder).find((name) => name.startsWith(markdownTitle.publicId));
  assert(normalizedNote?.endsWith("CURRENT-RESULTS.md"));
  assert.equal(normalizedNote?.endsWith(".md.md"), false);
  const legacyDoubleExtension = `${normalizedNote}.md`;
  fs.copyFileSync(path.join(noteFolder, normalizedNote), path.join(noteFolder, legacyDoubleExtension));
  const graphManifestPath = path.join(graphVault, ".argos-export.json");
  const graphManifest = JSON.parse(fs.readFileSync(graphManifestPath, "utf8"));
  const legacyManifestPath = `Note/${legacyDoubleExtension}`;
  graphManifest.generatedFiles.push(legacyManifestPath);
  graphManifest.sha256ByFile[legacyManifestPath] = sha256(path.join(noteFolder, legacyDoubleExtension));
  fs.writeFileSync(graphManifestPath, `${JSON.stringify(graphManifest, null, 2)}\n`);
  const normalizedExport = run("export", "obsidian", "--root", graphTarget, "--out", graphVault, "--prune");
  assert.equal(normalizedExport.filesPruned, 1);
  assert.equal(fs.existsSync(path.join(noteFolder, legacyDoubleExtension)), false);

  const syncTarget = path.join(temp, "automatic-sync-target");
  const relocatedSyncTarget = path.join(temp, "relocated-sync-target");
  fs.mkdirSync(syncTarget, { recursive: true });
  const syncEnv = { ...env, ARGOS_OBSIDIAN_SYNC_INTERVAL_SECONDS: "1" };
  delete syncEnv.ARGOS_DISABLE_OBSIDIAN_SYNC;
  const syncInit = runWithEnv(syncEnv, "init", "--root", syncTarget, "--name", "Automatic sync target");
  assert.equal(syncInit.obsidianSync.automatic, true);
  assert.equal(syncInit.obsidianSync.mode, "on_use");
  const firstSync = await waitForObsidianSync(syncTarget, syncEnv, (status) => status.lastResult?.nodeCount === 0 && !status.due);
  assert(fs.existsSync(firstSync.lastResult.indexPath));
  assert(fs.existsSync(firstSync.lastResult.explorerPath));
  assert.equal(fs.existsSync(path.join(firstSync.output, "Argos Knowledge Graph.canvas")), false);
  const storedSync = JSON.parse(fs.readFileSync(path.join(syncTarget, ".argos", "obsidian-sync.json"), "utf8"));
  assert.equal(storedSync.output, ".argos/obsidian/Automatic sync target");
  assert.equal("root" in storedSync, false);
  assert.equal("pid" in storedSync, false);
  const manualVault = path.join(syncTarget, "manual-vault");
  fs.rmSync(firstSync.output, { recursive: true, force: true });
  const manualOnly = runWithEnv(syncEnv, "export", "obsidian", "--root", syncTarget, "--out", manualVault);
  assert(fs.existsSync(manualOnly.manifestPath));
  assert.equal(fs.existsSync(firstSync.output), false);
  const syncRoot = runWithEnv(syncEnv, "node", "create", "--root", syncTarget, "--type", "target", "--title", "Automatic sync target", "--content", "Projection test root.").node;
  const syncedNode = runWithEnv(syncEnv, "node", "create", "--root", syncTarget, "--type", "component", "--title", "Automatically projected component", "--content", "Written after automatic sync was enabled.", "--link-to", syncRoot.publicId, "--relation", "contains", "--direction", "incoming").node;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const concurrentChecks = await Promise.all(Array.from({ length: 4 }, () =>
    runAsyncWithEnv(syncEnv, "obsidian", "sync", "status", "--root", syncTarget)));
  assert(concurrentChecks.every((status) => status.lastError === null));
  const updatedSync = await waitForObsidianSync(syncTarget, syncEnv, (status) => status.lastResult?.nodeCount === 2 && !status.due);
  assert(fs.readdirSync(path.join(updatedSync.output, "Component")).some((name) => name.startsWith(syncedNode.publicId)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(syncTarget, ".argos", "obsidian-sync.json"), "utf8")).attemptToken, null);
  await renameWithRetry(syncTarget, relocatedSyncTarget);
  const relocatedStatus = runWithEnv(syncEnv, "status", "--root", relocatedSyncTarget);
  assert.equal(relocatedStatus.obsidianSync.root, path.resolve(relocatedSyncTarget));
  assert.equal(relocatedStatus.obsidianSync.output, path.join(path.resolve(relocatedSyncTarget), ".argos", "obsidian", "Automatic sync target"));
  const relocatedSync = await waitForObsidianSync(relocatedSyncTarget, syncEnv, (status) => status.lastResult?.nodeCount === 2 && !status.due);
  assert(fs.readdirSync(path.join(relocatedSync.output, "Component")).some((name) => name.startsWith(syncedNode.publicId)));
  assert.equal(relocatedSync.lastResult.output, path.join(path.resolve(relocatedSyncTarget), ".argos", "obsidian", "Automatic sync target"));
  assert.equal(fs.existsSync(syncTarget), false);
  const stoppedSync = runWithEnv(syncEnv, "obsidian", "sync", "disable", "--root", relocatedSyncTarget);
  assert.equal(stoppedSync.enabled, false);
  assert.equal(stoppedSync.nextEligibleAt, null);
  const statusWhileDisabled = runWithEnv(syncEnv, "status", "--root", relocatedSyncTarget);
  assert.equal(statusWhileDisabled.obsidianSync.enabled, false);
  const restartedSync = runWithEnv(syncEnv, "obsidian", "sync", "enable", "--root", relocatedSyncTarget, "--interval-seconds", "1");
  assert.equal(restartedSync.enabled, true);
  assert.equal(restartedSync.lastResult?.nodeCount, 2);
  assert.equal(runWithEnv(syncEnv, "obsidian", "sync", "refresh", "--root", relocatedSyncTarget).lastResult?.nodeCount, 2);
  assert.equal(runWithEnv(syncEnv, "obsidian", "sync", "disable", "--root", relocatedSyncTarget).enabled, false);

  const customVault = path.join(relocatedSyncTarget, "custom-vault");
  const customSync = runWithEnv(syncEnv, "obsidian", "sync", "enable", "--root", relocatedSyncTarget, "--out", customVault);
  assert.equal(customSync.output, customVault);
  assert.equal(JSON.parse(fs.readFileSync(path.join(relocatedSyncTarget, ".argos", "obsidian-sync.json"), "utf8")).output, "custom-vault");

  const legacySyncTarget = path.join(temp, "legacy-sync-target");
  fs.mkdirSync(legacySyncTarget, { recursive: true });
  run("init", "--root", legacySyncTarget, "--name", "Legacy sync target");
  fs.writeFileSync(path.join(legacySyncTarget, ".argos", "obsidian-sync.json"), `${JSON.stringify({
    formatVersion: 1,
    enabled: true,
    output: ".argos/obsidian",
    intervalSeconds: 1,
    prune: true,
    attemptToken: null,
    lastAttemptAt: null,
    lastExportAt: null,
    lastResult: null,
    lastError: null
  }, null, 2)}\n`);
  const preservedLegacySync = runWithEnv(syncEnv, "obsidian", "sync", "refresh", "--root", legacySyncTarget);
  assert.equal(preservedLegacySync.output, path.join(legacySyncTarget, ".argos", "obsidian"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(legacySyncTarget, ".argos", "obsidian-sync.json"), "utf8")).output, ".argos/obsidian");

  fs.writeFileSync(path.join(target, "opencode.json"), `${JSON.stringify({ theme: "system" }, null, 2)}\n`);
  const openCodeInstall = run("opencode", "install", "--root", target);
  assert(openCodeInstall.created.some((file) => file.endsWith(path.join("commands", "argos.md"))));
  const openCodeConfig = JSON.parse(fs.readFileSync(path.join(target, "opencode.json"), "utf8"));
  assert.equal(openCodeConfig.theme, "system");
  assert.deepEqual(openCodeConfig.mcp.argos.command, ["argos-mcp"]);
  assert(fs.existsSync(path.join(target, ".opencode", "skills", "argos", "references", "commands.md")));
  assert(fs.existsSync(path.join(target, ".opencode", "skills", "argos-finding-report", "references", "report-template.md")));
  const openCodeDoctor = run("opencode", "doctor", "--root", target);
  assert.equal(openCodeDoctor.ok, true, JSON.stringify(openCodeDoctor));

  process.stdout.write("Argos smoke test passed.\n");
} finally {
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("argos-smoke-")) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function create(type, title, content, aliases = []) {
  const args = ["node", "create", "--root", target, "--type", type, "--title", title, "--content", content];
  if (aliases.length) args.push("--aliases", aliases.join(","));
  if (type !== "target") args.push(...defaultAttachment(target, type));
  const result = run(...args);
  assert.equal(result.created, true, JSON.stringify(result));
  return result.node;
}

function link(from, type, to) {
  return run("link", "add", "--root", target, "--from", from, "--type", type, "--to", to);
}

function createAt(root, type, title, content) {
  const args = ["node", "create", "--root", root, "--type", type, "--title", title, "--content", content];
  if (type !== "target") args.push(...defaultAttachment(root, type));
  const result = run(...args);
  assert.equal(result.created, true, JSON.stringify(result));
  return result.node;
}

function defaultAttachment(root, type) {
  const rootNode = run("node", "list", "--root", root, "--type", "target", "--limit", "1")[0];
  assert(rootNode, `Expected a target root at ${root}`);
  if (["component", "boundary", "principal", "note"].includes(type)) {
    return ["--link-to", rootNode.publicId, "--relation", "contains", "--direction", "incoming"];
  }
  const component = run("node", "list", "--root", root, "--type", "component", "--limit", "1")[0];
  assert(component, `Expected a component parent at ${root}`);
  return ["--link-to", component.publicId, "--relation", "contains", "--direction", "incoming"];
}

function linkAt(root, from, type, to) {
  return run("link", "add", "--root", root, "--from", from, "--type", type, "--to", to);
}

function run(...args) {
  return runWithEnv(env, ...args);
}

function runWithEnv(customEnv, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: customEnv, windowsHide: true });
  if (result.status !== 0) throw new Error(`argos ${args.join(" ")} failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function runFailure(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, windowsHide: true });
  assert.notEqual(result.status, 0);
  return `${result.stderr}\n${result.stdout}`;
}

function runReview(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, windowsHide: true });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runAsync(...args) {
  return runAsyncWithEnv(env, ...args);
}

function runAsyncWithEnv(customEnv, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env: customEnv, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || `exit ${code}`)));
  });
}

async function waitForObsidianSync(root, customEnv, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = runWithEnv(customEnv, "obsidian", "sync", "status", "--root", root);
    if (predicate(status)) return status;
    if (status.lastError) throw new Error(`Obsidian sync failed: ${status.lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for automatic Obsidian sync");
}

async function renameWithRetry(from, to) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
