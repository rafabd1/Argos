import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "dist", "cli.js");
const mock = path.join(repo, "scripts", "mock-opencode.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "argos-smoke-"));
const target = path.join(temp, "target");
const argosHome = path.join(temp, "home");
const mockState = path.join(temp, "mock-opencode-state.json");
fs.mkdirSync(target, { recursive: true });
const env = { ...process.env, ARGOS_HOME: argosHome, ARGOS_MOCK_STATE: mockState, OPENCODE_COMMAND: process.execPath };
let server = null;

try {
  const version = run("--version");
  assert.equal(version.version, "0.1.0");
  const initialized = run("init", "--root", target, "--name", "Smoke Target");
  assert.equal(initialized.initialized, true);
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

  const targetNode = create("target", "Smoke Target", "Version 1.0 target.", ["smoke-app"]);
  const component = create("component", "Archive importer", "Accepts an archive and emits normalized entries.", ["ArchiveImporter", "src/importer.ts"]);
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
  link(state.publicId, "flows_to", sinkB.publicId);
  link(test.publicId, "tests", sinkA.publicId);
  link(test.publicId, "refutes", hypothesis.publicId);
  const repeated = link(state.publicId, "flows_to", sinkB.publicId);
  assert.equal(repeated.publicId, "E000005");

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

  const beforeUpdate = run("node", "get", "--root", target, "--id", hypothesis.publicId);
  const updated = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--mode", "append", "--content", "Reopen if another archive producer bypasses normalization.");
  assert(updated.content.includes("Reopen"));
  const history = run("history", "--root", target, "--id", hypothesis.publicId);
  assert.equal(history.length, 1);
  assert.equal(history[0].content, beforeUpdate.node.content);
  const noFields = runFailure("node", "update", "--root", target, "--id", hypothesis.publicId);
  assert(noFields.includes("requires a title, content, or aliases change"));
  const beforeNoop = run("node", "get", "--root", target, "--id", hypothesis.publicId);
  const noop = run("node", "update", "--root", target, "--id", hypothesis.publicId, "--content", beforeNoop.node.content);
  assert.equal(noop.updatedAt, beforeNoop.node.updatedAt);
  assert.equal(run("history", "--root", target, "--id", hypothesis.publicId).length, 1);
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
  assert.equal(exported.nodeCount, 8);
  assert(fs.existsSync(path.join(vault, "Argos Index.md")));
  assert(fs.existsSync(path.join(vault, "Argos Knowledge Graph.canvas")));
  const concurrentExports = await Promise.all(Array.from({ length: 2 }, () => runAsync("export", "obsidian", "--root", target, "--out", vault)));
  assert(concurrentExports.every((result) => result.nodeCount === 8));
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
  const concurrent = await Promise.all(concurrentNames.map((name) => runAsync("node", "create", "--root", target, "--type", "note", "--title", name, "--content", "lock test")));
  assert(concurrent.every((result) => result.created));
  const sameIdentity = await Promise.all(Array.from({ length: 6 }, () => runAsync("node", "create", "--root", target, "--type", "note", "--title", "Canonical concurrent note", "--content", "same identity race")));
  assert.equal(sameIdentity.filter((result) => result.created).length, 1);
  assert.equal(new Set(sameIdentity.map((result) => (result.node ?? result.canonical).publicId)).size, 1);
  const canonicalConcurrent = sameIdentity[0].node ?? sameIdentity[0].canonical;
  const sameEdges = await Promise.all(Array.from({ length: 6 }, () => runAsync("link", "add", "--root", target, "--from", targetNode.publicId, "--type", "related_to", "--to", canonicalConcurrent.publicId)));
  assert.equal(new Set(sameEdges.map((edge) => edge.publicId)).size, 1);
  const status = run("status", "--root", target);
  assert.equal(status.counts.nodes, 17);

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
  const mergedHistory = run("history", "--root", target, "--id", mergeDestination.publicId);
  assert(mergedHistory.some((revision) => revision.title === "Legacy archive dispatcher"));
  assert.equal(run("node", "list", "--root", target, "--limit", "100").some((node) => node.publicId === mergeSource.publicId), false);

  const crossTypeComponent = create("component", "Shared dispatch operation", "Owns the dispatch implementation.");
  const crossTypeReview = runReview("node", "create", "--root", target, "--type", "sink", "--title", "Shared dispatch operation", "--content", "Same name, different proposed type.");
  assert.equal(crossTypeReview.resolutionRequired, true);
  assert.equal(crossTypeReview.candidates[0].node.publicId, crossTypeComponent.publicId);
  assert.equal(crossTypeReview.candidates[0].node.type, "component");
  const reviewedDistinct = run("node", "create", "--root", target, "--type", "sink", "--title", "Shared dispatch operation", "--content", "A separately reviewed sink identity.", "--distinct-from", crossTypeComponent.publicId);
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
  const suggestionSource = create("behavior", "Shared token propagation", "Carries `bridge.token` between two internal boundaries.");
  const relationCandidates = run("link", "suggest", "--root", target, "--id", suggestionSource.publicId, "--limit", "10");
  const suggested = relationCandidates.find((item) => item.to.publicId === suggestionTarget.publicId);
  assert(suggested, "expected a reviewable relation suggestion");
  const invalidReview = runFailure("link", "accept", "--root", target, "--id", suggested.publicId, "--type", "not_a_relation");
  assert(invalidReview.includes("Unknown relation type"));
  const stillPending = run("link", "list", "--root", target, "--status", "pending");
  assert(stillPending.some((item) => item.publicId === suggested.publicId));
  const acceptedSuggestion = run("link", "accept", "--root", target, "--id", suggested.publicId, "--type", "influences");
  assert.equal(acceptedSuggestion.status, "accepted");
  assert.equal(acceptedSuggestion.edge.type, "influences");
  assert.equal(acceptedSuggestion.edge.fromId, suggestionSource.publicId);
  assert.equal(acceptedSuggestion.edge.toId, suggestionTarget.publicId);
  const reconsiderTarget = create("component", "Deferred token consumer", "Consumes `recheck.token` after a delayed transition.");
  const reconsiderSource = create("behavior", "Deferred token propagation", "Carries `recheck.token` toward a later consumer.");
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

  const alternateDataResult = run("node", "create", "--root", target, "--type", "data", "--title", "Alternate archive entry path", "--content", "A second producer reaches the same write sink through a different parser.", "--aliases", "alternate.entry.path", "--distinct-from", data.publicId);
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
  assert(hypothesisGaps.some((gap) => gap.code === "linked_knowledge_updated_after_refutation" && gap.relatedNodeIds.includes(alternateData.publicId)));
  const inspection = run("inspect", "--root", target, "--id", sinkA.publicId, "--depth", "2");
  assert.equal(inspection.context.node.publicId, sinkA.publicId);
  assert(inspection.map.nodes.some((node) => node.publicId === alternateData.publicId));
  assert(inspection.gaps.some((gap) => gap.code === "partial_sink_path_coverage"));

  fs.writeFileSync(path.join(target, "opencode.json"), `${JSON.stringify({ theme: "system" }, null, 2)}\n`);
  const openCodeInstall = run("opencode", "install", "--root", target);
  assert(openCodeInstall.created.some((file) => file.endsWith(path.join("commands", "argos.md"))));
  const openCodeConfig = JSON.parse(fs.readFileSync(path.join(target, "opencode.json"), "utf8"));
  assert.equal(openCodeConfig.theme, "system");
  assert.deepEqual(openCodeConfig.mcp.argos.command, ["argos-mcp"]);
  assert(fs.existsSync(path.join(target, ".opencode", "skills", "argos", "references", "commands.md")));
  const openCodeDoctor = run("opencode", "doctor", "--root", target);
  assert.equal(openCodeDoctor.ok, true, JSON.stringify(openCodeDoctor));

  const port = await freePort();
  server = spawn(process.execPath, [mock, "serve", "--port", String(port)], { env, windowsHide: true, stdio: "ignore" });
  await waitForHealth(port);
  const mockCommand = `"${process.execPath}" "${mock}"`;
  const configPath = path.join(argosHome, "chimera", "config.json");
  const orphanedConfigLock = `${configPath}.lock`;
  fs.mkdirSync(orphanedConfigLock, { recursive: true });
  const oldLockTime = new Date(Date.now() - 5_000);
  fs.utimesSync(orphanedConfigLock, oldLockTime, oldLockTime);
  run("chimera", "config", "init", "--opencode-command", mockCommand, "--model", "mock/model", "--variant", "high", "--max-agents", "5");
  assert.equal(fs.existsSync(orphanedConfigLock), false);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.serverUrl = `http://127.0.0.1:${port}`;
  config.serverPid = server.pid;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const doctor = run("chimera", "doctor", "--root", target);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.config.maxAgents, 5);
  const unknownRole = runFailure("chimera", "start", "--root", target, "--role", "imaginary-specialist", "--goal", "This should not start.");
  assert(unknownRole.includes("Unknown Chimera role"));
  const firstStart = run("chimera", "start", "--root", target, "--role", "generalist", "--goal", "Map the archive-to-build relation and stop after a concise result.", "--nodes", `${component.publicId},${sinkA.publicId}`, "--access", "explorer");
  assert.equal(firstStart.session.status, "starting");
  assert(firstStart.launch.pid);
  assert.equal(firstStart.session.opencodeAgent, "argos-chimera");
  assert.equal(firstStart.session.networkAllowed, false);
  assert.equal(firstStart.session.autoApprove, true);
  const first = await waitForSession("CH-0001", "stopped");
  assert(first.opencodeSessionId?.startsWith("ses_mock_"));
  assert(fs.existsSync(path.join(first.sessionDir, ".opencode", "skills", "chimera-agent", "SKILL.md")));
  assert(fs.existsSync(path.join(first.sessionDir, ".opencode", "skills", "chain-discovery", "SKILL.md")));
  assert.equal(fs.existsSync(path.join(first.sessionDir, ".opencode", "skills", "argos", "SKILL.md")), false);
  assert(fs.readFileSync(path.join(first.sessionDir, "dossier.md"), "utf8").includes("Archive file write"));
  const explorerAgent = fs.readFileSync(path.join(first.sessionDir, ".opencode", "agents", `${first.opencodeAgent}.md`), "utf8");
  assert(explorerAgent.includes('"*": deny'));
  assert(explorerAgent.includes(`${first.labDir.replace(/\\/g, "/")}/**`));

  const secondStart = run("chimera", "start", "--root", target, "--role", "chain-discovery", "--goal", "Inspect the linked sinks and return one bounded chain decision.", "--nodes", sinkA.publicId, "--access", "editor", "--access-notes", "Writes are allowed only inside the generated Chimera lab.", "--network", "true", "--auto-approve", "false");
  assert.equal(secondStart.session.status, "starting");
  assert.equal(secondStart.session.networkAllowed, true);
  assert.equal(secondStart.session.autoApprove, false);
  const second = await waitForSession("CH-0002", "stopped");
  assert(second.opencodeSessionId);
  assert(fs.existsSync(path.join(second.sessionDir, ".opencode", "skills", "evidence-testing", "SKILL.md")));
  assert.equal(fs.existsSync(path.join(second.sessionDir, ".opencode", "skills", "argos", "SKILL.md")), false);

  const queuedBodies = Array.from({ length: 8 }, (_, index) => `Concurrent inbox message ${index + 1}`);
  const queuedWrites = await Promise.all(queuedBodies.map((body) => runAsync("chimera", "send", "--root", target, "--to", "CH-0002", "--body", body)));
  assert.equal(new Set(queuedWrites.map((entry) => entry.message.publicId)).size, queuedBodies.length);
  const parallelPolls = await Promise.all(Array.from({ length: 2 }, () => runAsyncWithEnv(env, "chimera", "poll", "--root", target, "--identity", "CH-0002", "--limit", "50")));
  const polledBodies = parallelPolls.flatMap((entry) => entry.messages).filter((message) => message.body.startsWith("Concurrent inbox message"));
  assert.equal(polledBodies.length, queuedBodies.length);
  assert.equal(new Set(polledBodies.map((message) => message.publicId)).size, queuedBodies.length);

  config.defaultAgent = "changed-global-agent";
  config.defaultNetwork = true;
  config.autoApprove = false;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const direct = run("chimera", "send", "--root", target, "--to", "CH-0001", "--body", "Check the alternate producer before closing.", "--priority");
  assert.equal(direct.delivery.accepted, true);
  assert.equal(direct.delivery.mode, "prompt_async");
  const directState = JSON.parse(fs.readFileSync(mockState, "utf8"));
  assert.equal(directState.sessions[first.opencodeSessionId].lastPrompt.agent, first.opencodeAgent);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const snapshot = run("chimera", "workflow-snapshot", "--root", target, "--id", "CH-0001", "--limit", "4", "--max-message-chars", "220");
  assert(snapshot.messages.length > 0 && snapshot.messages.length <= 4);
  assert(snapshot.messages.every((message) => !message.text.includes("excluded tool output")));
  assert(snapshot.messages.every((message) => message.text.length <= 220));

  const agentPost = runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0001" }, "chimera", "send", "--root", target, "--to", "coordinator", "--body", "I checked the alternate producer; the scope remains open.", "--priority");
  assert.equal(agentPost.message.fromId, "CH-0001");
  assert.equal(agentPost.message.priority, false);
  const coordinatorPoll = run("chimera", "poll", "--root", target, "--identity", "coordinator");
  assert(coordinatorPoll.messages.some((message) => message.fromId === "CH-0001"));

  const { ChimeraStore } = await import(pathToFileUrl(path.join(repo, "dist", "chimera-store.js")));
  const legacyChimeraTarget = path.join(temp, "legacy-chimera-target");
  const legacyChimeraDir = path.join(legacyChimeraTarget, ".argos", "chimera");
  fs.mkdirSync(legacyChimeraDir, { recursive: true });
  const legacyChimeraDb = new DatabaseSync(path.join(legacyChimeraDir, "runtime.sqlite"));
  legacyChimeraDb.exec(`
    CREATE TABLE chimera_sessions (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      goal TEXT NOT NULL,
      node_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      access_mode TEXT NOT NULL,
      access_notes TEXT NOT NULL DEFAULT '',
      model TEXT,
      variant TEXT,
      session_dir TEXT NOT NULL,
      lab_dir TEXT NOT NULL,
      opencode_command TEXT NOT NULL,
      opencode_server_url TEXT,
      opencode_session_id TEXT,
      run_pid INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      stopped_at TEXT
    );
    INSERT INTO chimera_sessions (
      id, public_id, role, goal, status, access_mode, session_dir, lab_dir,
      opencode_command, created_at, updated_at
    ) VALUES (
      1, 'CH-0001', 'generalist', 'legacy goal', 'stopped', 'explorer',
      'legacy-session', 'legacy-lab', 'opencode',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  legacyChimeraDb.close();
  const migratedStore = new ChimeraStore(legacyChimeraTarget);
  const migratedSession = migratedStore.getSession("CH-0001");
  assert.equal(migratedSession.opencodeAgent, "argos-chimera");
  assert.equal(migratedSession.networkAllowed, false);
  assert.equal(migratedSession.autoApprove, true);
  migratedStore.close();
  const store = new ChimeraStore(target);
  store.updateSession("CH-0001", { status: "stopped", runPid: null, stopped: true });
  const notResurrected = store.registerWorkerPid("CH-0001", process.pid);
  assert.equal(notResurrected.status, "stopped");
  assert.equal(notResurrected.runPid, null);
  store.updateSession("CH-0001", { status: "running" });
  store.updateSession("CH-0002", { status: "running" });
  store.close();
  const councilMockState = JSON.parse(fs.readFileSync(mockState, "utf8"));
  councilMockState.sessions[first.opencodeSessionId].status = "busy";
  councilMockState.sessions[second.opencodeSessionId].status = "busy";
  fs.writeFileSync(mockState, `${JSON.stringify(councilMockState, null, 2)}\n`);
  const invite = run("chimera", "council", "invite", "--root", target, "--topic", "Which relation should be tested next?", "--participants", "CH-0001,CH-0002", "--max-rounds", "2");
  const councilId = invite.council.publicId;
  runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0001" }, "chimera", "council", "accept", "--root", target, "--id", councilId);
  runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0002" }, "chimera", "council", "accept", "--root", target, "--id", councilId);
  let council = run("chimera", "council", "begin", "--root", target, "--id", councilId, "--body", "Round one: challenge the current producer assumption.");
  assert.equal(council.council.currentParticipantId, "CH-0001");
  council = runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0001" }, "chimera", "council", "turn", "--root", target, "--id", councilId, "--body", "Inspect direct archive entry producers.");
  assert.equal(council.council.currentParticipantId, "CH-0002");
  council = runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0002" }, "chimera", "council", "turn", "--root", target, "--id", councilId, "--body", "Inspect stale workspace state as the second gadget.");
  assert.equal(council.council.currentParticipantId, "coordinator");
  council = run("chimera", "council", "advance", "--root", target, "--id", councilId, "--body", "Round two: rank the two paths by decisive evidence.");
  assert.equal(council.council.round, 2);
  runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0001" }, "chimera", "council", "turn", "--root", target, "--id", councilId, "--body", "Direct producers have the clearer source-to-sink oracle.");
  runWithEnv({ ...env, ARGOS_CHIMERA_ID: "CH-0002" }, "chimera", "council", "turn", "--root", target, "--id", councilId, "--body", "State chaining has higher impact but needs a durable-state proof.");
  const councilStatus = run("chimera", "council", "status", "--root", target, "--id", councilId);
  assert.equal(councilStatus.turns.length, 6);
  const overLimit = runFailure("chimera", "council", "advance", "--root", target, "--id", councilId, "--body", "Unbounded round");
  assert(overLimit.includes("round limit"));
  const closed = run("chimera", "council", "close", "--root", target, "--id", councilId, "--body", "Test direct producers first, then durable state if the source path survives.");
  assert.equal(closed.council.status, "closed");

  await new Promise((resolve) => setTimeout(resolve, 500));
  const killedSecond = run("chimera", "kill", "--root", target, "--id", "CH-0002", "--reason", "Resume control");
  assert.equal(killedSecond.session.status, "stopped");
  assert(fs.existsSync(path.join(second.sessionDir, "kill.flag")));
  const resumedSecond = run("chimera", "run", "--root", target, "--id", "CH-0002", "--message", "Resume the same goal once, then stop.");
  assert(resumedSecond.launch.started);
  const secondAfterResume = await waitForSession("CH-0002", "stopped");
  assert.equal(fs.existsSync(path.join(secondAfterResume.sessionDir, "kill.flag")), false);
  const resumedRun = JSON.parse(fs.readFileSync(path.join(secondAfterResume.sessionDir, "opencode", "run.json"), "utf8"));
  assert.equal(resumedRun.killed, false);
  const resumedState = JSON.parse(fs.readFileSync(mockState, "utf8"));
  assert.equal(resumedState.sessions[secondAfterResume.opencodeSessionId].lastPrompt.agent, secondAfterResume.opencodeAgent);
  assert.equal(resumedState.sessions[secondAfterResume.opencodeSessionId].lastPrompt.autoApprove, false);
  assert(fs.existsSync(path.join(secondAfterResume.sessionDir, ".opencode", "agents", `${secondAfterResume.opencodeAgent}.md`)));
  assert.equal(fs.existsSync(path.join(secondAfterResume.sessionDir, ".opencode", "agents", "changed-global-agent.md")), false);
  run("chimera", "send", "--root", target, "--to", "CH-0001", "--body", "Remain active for broadcast test.", "--priority");
  const broadcast = run("chimera", "broadcast", "--root", target, "--body", "Active-only message");
  assert.equal(broadcast.delivered.length, 1);
  assert.equal(broadcast.delivered[0].message.toId, "CH-0001");

  process.stdout.write("Argos smoke test passed.\n");
} finally {
  if (server?.pid) {
    try { process.kill(server.pid, "SIGTERM"); } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("argos-smoke-")) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function create(type, title, content, aliases = []) {
  const args = ["node", "create", "--root", target, "--type", type, "--title", title, "--content", content];
  if (aliases.length) args.push("--aliases", aliases.join(","));
  const result = run(...args);
  assert.equal(result.created, true, JSON.stringify(result));
  return result.node;
}

function link(from, type, to) {
  return run("link", "add", "--root", target, "--from", from, "--type", type, "--to", to);
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

async function waitForSession(id, status) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const sessions = run("chimera", "list", "--root", target, "--limit", "10");
    const session = sessions.find((item) => item.publicId === id);
    if (session?.status === status && session.opencodeSessionId) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${id} to become ${status}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/global/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Mock OpenCode server did not become healthy");
}

function pathToFileUrl(file) {
  const normalized = path.resolve(file).replace(/\\/g, "/");
  return `file:///${normalized}`;
}
