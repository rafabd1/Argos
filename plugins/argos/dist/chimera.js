"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHIMERA_CONFIG = void 0;
exports.readChimeraConfig = readChimeraConfig;
exports.configureChimera = configureChimera;
exports.saveChimeraConfig = saveChimeraConfig;
exports.doctorChimera = doctorChimera;
exports.startChimera = startChimera;
exports.runChimera = runChimera;
exports.runChimeraWorker = runChimeraWorker;
exports.listChimera = listChimera;
exports.sendChimera = sendChimera;
exports.broadcastChimera = broadcastChimera;
exports.pollChimera = pollChimera;
exports.killChimera = killChimera;
exports.workflowSnapshot = workflowSnapshot;
exports.inviteCouncil = inviteCouncil;
exports.acceptCouncil = acceptCouncil;
exports.beginCouncil = beginCouncil;
exports.submitCouncilTurn = submitCouncilTurn;
exports.advanceCouncil = advanceCouncil;
exports.closeCouncil = closeCouncil;
exports.councilStatus = councilStatus;
exports.listCouncils = listCouncils;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_net_1 = __importDefault(require("node:net"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const node_child_process_1 = require("node:child_process");
const db_1 = require("./db");
const chimera_store_1 = require("./chimera-store");
const paths_1 = require("./paths");
const process_1 = require("./process");
exports.DEFAULT_CHIMERA_CONFIG = {
    enabled: false,
    opencodeCommand: "opencode",
    defaultModel: null,
    defaultVariant: null,
    defaultAgent: "argos-chimera",
    maxAgents: 5,
    defaultNetwork: false,
    autoApprove: true,
    serverUrl: null,
    serverPid: null
};
function readChimeraConfig() {
    const file = (0, paths_1.globalChimeraConfigPath)();
    if (!node_fs_1.default.existsSync(file))
        return { ...exports.DEFAULT_CHIMERA_CONFIG };
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return normalizeConfig(parsed);
    }
    catch (error) {
        throw new Error(`Invalid Chimera config at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function configureChimera(input = {}) {
    const release = acquireGlobalServerLock();
    try {
        const current = readChimeraConfig();
        const supplied = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
        const next = normalizeConfig({ ...current, ...supplied, enabled: input.enabled ?? true });
        saveChimeraConfig(next);
        return next;
    }
    finally {
        release();
    }
}
function saveChimeraConfig(config) {
    (0, paths_1.writeFileAtomic)((0, paths_1.globalChimeraConfigPath)(), `${JSON.stringify(normalizeConfig(config), null, 2)}\n`);
}
async function doctorChimera(root) {
    const config = readChimeraConfig();
    const command = commandParts(config.opencodeCommand);
    const version = (0, node_child_process_1.spawnSync)(command.file, [...command.args, "--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000
    });
    const skills = resolveSkillsDir();
    const checks = [
        {
            name: "target",
            ok: node_fs_1.default.existsSync((0, paths_1.knowledgePath)(root)),
            detail: node_fs_1.default.existsSync((0, paths_1.knowledgePath)(root)) ? `Argos is initialized at ${root}` : `Argos is not initialized at ${root}`
        },
        {
            name: "configuration",
            ok: config.enabled,
            detail: config.enabled ? `Chimera enabled; maxAgents=${config.maxAgents}` : "Chimera is disabled"
        },
        {
            name: "opencode",
            ok: version.status === 0 && String(version.stdout).trim().length > 0,
            detail: version.status === 0 ? String(version.stdout).trim() : String(version.stderr || version.error?.message || "OpenCode command failed").trim()
        },
        {
            name: "skills",
            ok: skills !== null,
            detail: skills ?? "Argos skill package was not found"
        }
    ];
    if (config.serverUrl) {
        const health = await openCodeHealth(config.serverUrl);
        checks.push({ name: "server", ok: health.ok, detail: health.ok ? `OpenCode server available at ${config.serverUrl}` : health.error ?? "OpenCode server is unavailable" });
    }
    return { ok: checks.every((check) => check.ok), config, checks };
}
async function startChimera(root, input) {
    requireInitialized(root);
    const config = readChimeraConfig();
    if (!config.enabled)
        throw new Error("Chimera is disabled. Run `argos chimera config init` once for this user.");
    const role = normalizeRole(input.role ?? "generalist");
    const goal = input.goal.trim();
    if (!goal)
        throw new Error("Chimera goal cannot be empty");
    const accessMode = input.accessMode ?? "explorer";
    const accessNotes = input.accessNotes?.trim() ?? "";
    if (accessMode === "editor" && !accessNotes) {
        throw new Error("Editor mode requires explicit --access-notes describing allowed paths and shell actions");
    }
    const nodeIds = resolveAnchorNodes(root, input.nodeIds ?? []);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        const active = await reconcileSessions(store, store.listSessions({ active: true, limit: 500 }));
        if (active.length >= config.maxAgents) {
            throw new Error(`Chimera maxAgents limit reached (${config.maxAgents}). Reuse or stop an active session.`);
        }
        let session = store.createSession({
            role,
            goal,
            nodeIds,
            accessMode,
            accessNotes,
            model: cleanNullable(input.model) ?? config.defaultModel,
            variant: cleanNullable(input.variant) ?? config.defaultVariant,
            opencodeCommand: config.opencodeCommand,
            opencodeAgent: config.defaultAgent,
            networkAllowed: input.networkAllowed ?? config.defaultNetwork,
            autoApprove: input.autoApprove ?? config.autoApprove,
            serverUrl: config.serverUrl,
            maxAgents: config.maxAgents
        });
        try {
            materializeSession(root, session, config);
            const launch = launchWorker(root, session.publicId);
            session = launch.started
                ? store.registerWorkerPid(session.publicId, launch.pid)
                : store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: launch.detail, stopped: true });
            writeSessionStatus(session);
            return { session, launch };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            session = store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: message, stopped: true });
            writeSessionStatus(session);
            throw error;
        }
    }
    finally {
        store.close();
    }
}
async function runChimera(root, reference, instruction) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        let session = await reconcileSession(store, store.getSession(reference));
        if (session.status === "starting" || session.status === "running") {
            throw new Error(`Chimera ${session.publicId} is already ${session.status}. Use poll, workflow-snapshot, send, or kill.`);
        }
        clearKillFlag(session);
        session = store.claimSessionStart(session.publicId);
        let launch;
        try {
            if (instruction?.trim()) {
                store.addMessage({
                    sessionReference: session.publicId,
                    direction: "coordinator_to_agent",
                    fromId: "coordinator",
                    toId: session.publicId,
                    body: instruction,
                    priority: true
                });
            }
            launch = launchWorker(root, session.publicId);
        }
        catch (error) {
            store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: error instanceof Error ? error.message : String(error), stopped: true });
            throw error;
        }
        session = launch.started
            ? store.registerWorkerPid(session.publicId, launch.pid)
            : store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: launch.detail, stopped: true });
        writeSessionStatus(session);
        return { session, launch };
    }
    finally {
        store.close();
    }
}
async function runChimeraWorker(root, reference) {
    const store = new chimera_store_1.ChimeraStore(root);
    let session = store.getSession(reference);
    const config = readChimeraConfig();
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    (0, paths_1.ensureDir)(opencodeDir);
    let stdout = null;
    let stderr = null;
    try {
        materializeSession(root, session, config);
        const server = await ensureOpenCodeServer({ ...config, opencodeCommand: session.opencodeCommand });
        session = store.updateSession(session.publicId, {
            status: session.opencodeSessionId ? "running" : "starting",
            runPid: node_process_1.default.pid,
            opencodeServerUrl: server.url,
            lastError: null
        });
        writeSessionStatus(session);
        const args = buildOpenCodeRunArgs(session, server.url);
        const command = commandParts(session.opencodeCommand);
        const stdoutPath = node_path_1.default.join(opencodeDir, "stdout.log");
        const stderrPath = node_path_1.default.join(opencodeDir, "stderr.log");
        const stdoutStream = node_fs_1.default.createWriteStream(stdoutPath, { flags: "a" });
        const stderrStream = node_fs_1.default.createWriteStream(stderrPath, { flags: "a" });
        stdout = stdoutStream;
        stderr = stderrStream;
        const startedAt = new Date().toISOString();
        const child = (0, node_child_process_1.spawn)(command.file, [...command.args, ...args], {
            cwd: session.sessionDir,
            env: {
                ...node_process_1.default.env,
                ARGOS_ROOT: root,
                ARGOS_CHIMERA_ID: session.publicId,
                ARGOS_CHIMERA_LAB: session.labDir,
                ARGOS_CHIMERA_ACCESS_MODE: session.accessMode
            },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdoutTail = "";
        let stderrTail = "";
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stdoutStream.write(text);
            stdoutTail = tail(`${stdoutTail}${text}`, 32_000);
            const discovered = extractOpenCodeSessionId(text) ?? extractOpenCodeSessionId(stdoutTail);
            if (discovered && discovered !== session.opencodeSessionId) {
                session = store.updateSession(session.publicId, { status: "running", opencodeSessionId: discovered });
                (0, paths_1.writeFileAtomic)(node_path_1.default.join(opencodeDir, "session-id.txt"), `${discovered}\n`);
                writeSessionStatus(session);
            }
            else if (session.status === "starting") {
                session = store.updateSession(session.publicId, { status: "running" });
                writeSessionStatus(session);
            }
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stderrStream.write(text);
            stderrTail = tail(`${stderrTail}${text}`, 16_000);
        });
        const exit = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
        });
        if (!session.opencodeSessionId) {
            const discovered = await discoverOpenCodeSession(server.url, session);
            if (discovered)
                session = store.updateSession(session.publicId, { opencodeSessionId: discovered });
        }
        const killed = node_fs_1.default.existsSync(node_path_1.default.join(session.sessionDir, "kill.flag"));
        const error = exit.code === 0 || killed
            ? null
            : tail(stderrTail.trim() || lastOpenCodeError(stdoutTail) || `OpenCode exited with code ${exit.code}`, 4_000);
        session = store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: error, stopped: true });
        writeSessionStatus(session);
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(opencodeDir, "run.json"), `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), exitCode: exit.code, signal: exit.signal, killed, stdoutPath, stderrPath, opencodeSessionId: session.opencodeSessionId, error }, null, 2)}\n`);
        store.addMessage({
            sessionReference: session.publicId,
            direction: "system",
            fromId: session.publicId,
            toId: "coordinator",
            kind: "system",
            body: error ? `${session.publicId} stopped after an OpenCode error: ${error}` : `${session.publicId} completed its current execution and is resumable.`,
            priority: false
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session = store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: message, stopped: true });
        writeSessionStatus(session);
        store.addMessage({
            sessionReference: session.publicId,
            direction: "system",
            fromId: session.publicId,
            toId: "coordinator",
            kind: "system",
            body: `${session.publicId} could not start: ${message}`
        });
        throw error;
    }
    finally {
        stdout?.end();
        stderr?.end();
        store.close();
    }
}
async function listChimera(root, options = {}) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        return await reconcileSessions(store, store.listSessions(options));
    }
    finally {
        store.close();
    }
}
async function sendChimera(root, input) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        const from = inferIdentity(input.from);
        const to = normalizeRecipient(input.to);
        if (from === "coordinator" && to === "coordinator")
            throw new Error("Coordinator cannot send a Chimera message to itself");
        if (from !== "coordinator")
            store.getSession(from);
        const target = to === "coordinator" ? null : store.getSession(to);
        const direction = from === "coordinator"
            ? "coordinator_to_agent"
            : to === "coordinator"
                ? "agent_to_coordinator"
                : "agent_to_agent";
        const priority = Boolean(input.priority && to !== "coordinator");
        const message = store.addMessage({
            sessionReference: target?.publicId ?? (from === "coordinator" ? undefined : from),
            direction,
            fromId: from,
            toId: to,
            kind: input.kind,
            body: input.body,
            priority
        });
        const delivery = target && priority
            ? await deliverPriorityMessage(root, store, target, message)
            : {
                attempted: false,
                accepted: false,
                mode: "queued",
                detail: to === "coordinator"
                    ? "Stored for coordinator polling; priority is not used in this direction"
                    : "Stored for the co-agent's periodic poll; use --priority for direct OpenCode delivery",
                status: null
            };
        return { message, delivery };
    }
    finally {
        store.close();
    }
}
async function broadcastChimera(root, input) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    let sessions;
    try {
        sessions = await reconcileSessions(store, store.listSessions({ active: true, limit: 500 }));
    }
    finally {
        store.close();
    }
    const from = inferIdentity(input.from);
    const delivered = [];
    const skipped = [];
    for (const session of sessions) {
        if (session.publicId === from) {
            skipped.push({ publicId: session.publicId, reason: "sender" });
            continue;
        }
        delivered.push(await sendChimera(root, { to: session.publicId, from, body: input.body, priority: input.priority }));
    }
    return { delivered, skipped };
}
async function pollChimera(root, input = {}) {
    requireInitialized(root);
    const identity = inferIdentity(input.identity);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        const sessions = identity === "coordinator"
            ? await reconcileSessions(store, store.listSessions({ active: true, limit: 500 }))
            : [await reconcileSession(store, store.getSession(identity))];
        const messages = store.pollMessages({
            identity,
            unread: input.unread !== false,
            markRead: input.peek !== true,
            limit: input.limit
        });
        return { identity, sessions, messages };
    }
    finally {
        store.close();
    }
}
async function killChimera(root, reference, reasonInput = "Stopped by coordinator") {
    requireInitialized(root);
    const reason = reasonInput.trim() || "Stopped by coordinator";
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        const session = await reconcileSession(store, store.getSession(reference));
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "kill.flag"), `${reason}\n`);
        let abort = null;
        if (session.opencodeServerUrl && session.opencodeSessionId && (await openCodeHealth(session.opencodeServerUrl)).ok) {
            abort = await httpJson(`${trimSlash(session.opencodeServerUrl)}/session/${encodeURIComponent(session.opencodeSessionId)}/abort?directory=${encodeURIComponent(session.sessionDir)}`, { method: "POST", body: {} });
        }
        const processSignaled = session.runPid ? terminateProcessTree(session.runPid) : false;
        const updated = store.updateSession(session.publicId, { status: "stopped", runPid: null, lastError: null, stopped: true });
        writeSessionStatus(updated);
        store.addMessage({
            sessionReference: updated.publicId,
            direction: "system",
            fromId: "coordinator",
            toId: updated.publicId,
            kind: "system",
            body: reason
        });
        return { session: updated, abort, processSignaled };
    }
    finally {
        store.close();
    }
}
async function workflowSnapshot(root, reference, input = {}) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        let session = await reconcileSession(store, store.getSession(reference));
        if (!session.opencodeSessionId)
            throw new Error(`${session.publicId} has no OpenCode session yet`);
        const opencodeSessionId = session.opencodeSessionId;
        const limit = clampInteger(input.limit, 1, 50, 8);
        const maxChars = clampInteger(input.maxMessageChars, 80, 8_000, 1_200);
        let raw;
        let source = "api";
        let serverUrl = session.opencodeServerUrl;
        if (!serverUrl || !(await openCodeHealth(serverUrl)).ok) {
            const server = await ensureOpenCodeServer(readChimeraConfig());
            serverUrl = server.url;
            session = store.updateSession(session.publicId, { opencodeServerUrl: serverUrl });
        }
        const response = await httpJson(`${trimSlash(serverUrl)}/session/${encodeURIComponent(opencodeSessionId)}/message?directory=${encodeURIComponent(session.sessionDir)}&limit=${Math.max(limit * 3, 20)}`);
        if (response.ok && Array.isArray(response.body)) {
            raw = response.body;
        }
        else {
            source = "export";
            raw = exportOpenCodeSession(session);
        }
        const messages = extractWorkflowMessages(raw, limit, maxChars);
        const generatedAt = new Date().toISOString();
        const outDir = node_path_1.default.join(session.sessionDir, "opencode", "workflow-snapshots");
        (0, paths_1.ensureDir)(outDir);
        const stamp = generatedAt.replace(/[-:.TZ]/g, "");
        const json = node_path_1.default.join(outDir, `${stamp}.json`);
        const markdown = node_path_1.default.join(outDir, `${stamp}.md`);
        const result = { session, generatedAt, messages, files: { json, markdown }, source };
        (0, paths_1.writeFileAtomic)(json, `${JSON.stringify(result, null, 2)}\n`);
        (0, paths_1.writeFileAtomic)(markdown, renderWorkflowMarkdown(result));
        return result;
    }
    finally {
        store.close();
    }
}
async function inviteCouncil(root, input) {
    requireInitialized(root);
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        const participantSessions = input.participantIds && input.participantIds.length > 0
            ? await reconcileSessions(store, input.participantIds.map((id) => store.getSession(id)))
            : await reconcileSessions(store, store.listSessions({ active: true, limit: 500 }));
        const stopped = participantSessions.filter((session) => session.status === "stopped");
        if (stopped.length > 0)
            throw new Error(`Council participants must be active: ${stopped.map((session) => session.publicId).join(", ")}`);
        const participants = participantSessions.map((session) => session.publicId);
        council = store.createCouncil(input.topic, participants, input.maxRounds);
    }
    finally {
        store.close();
    }
    const invitations = [];
    for (const participant of council.participantIds) {
        invitations.push(await sendChimera(root, {
            to: participant,
            kind: "council",
            priority: true,
            body: `Council ${council.publicId} invitation: ${council.topic}\nAccept only at a safe pause point with: argos chimera council accept --root "${root}" --id ${council.publicId}`
        }));
    }
    return { council, invitations };
}
async function acceptCouncil(root, councilReference, participantInput) {
    const participant = inferIdentity(participantInput);
    if (participant === "coordinator")
        throw new Error("A Chimera participant id is required to accept a council");
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        council = store.acceptCouncil(councilReference, participant);
    }
    finally {
        store.close();
    }
    const notice = await sendChimera(root, {
        to: "coordinator",
        from: participant,
        kind: "council",
        body: `${participant} accepted council ${council.publicId} at a safe pause point.`
    });
    return { council, notice };
}
async function beginCouncil(root, councilReference, opening) {
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        council = store.beginCouncil(councilReference, opening).council;
    }
    finally {
        store.close();
    }
    const cue = await cueCouncilParticipant(root, council);
    return { council, cue };
}
async function submitCouncilTurn(root, councilReference, body, speakerInput) {
    const speaker = inferIdentity(speakerInput);
    if (speaker === "coordinator")
        throw new Error("Use council advance for coordinator turns");
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        council = store.addCouncilTurn(councilReference, speaker, body).council;
    }
    finally {
        store.close();
    }
    return { council, cue: council.currentParticipantId === "coordinator" ? null : await cueCouncilParticipant(root, council) };
}
async function advanceCouncil(root, councilReference, opening, extend = false) {
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        council = store.advanceCouncil(councilReference, opening, extend).council;
    }
    finally {
        store.close();
    }
    return { council, cue: await cueCouncilParticipant(root, council) };
}
async function closeCouncil(root, councilReference, finalMessage) {
    const store = new chimera_store_1.ChimeraStore(root);
    let council;
    try {
        council = store.closeCouncil(councilReference, finalMessage);
    }
    finally {
        store.close();
    }
    const deliveries = [];
    for (const participant of council.participantIds) {
        deliveries.push(await sendChimera(root, {
            to: participant,
            kind: "council",
            priority: true,
            body: `Council ${council.publicId} closed. Coordinator conclusion: ${finalMessage}\nResume your prior work if it remains valid, or apply this conclusion to your next move.`
        }));
    }
    return { council, deliveries };
}
function councilStatus(root, councilReference) {
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        return { council: store.getCouncil(councilReference), turns: store.councilTurns(councilReference) };
    }
    finally {
        store.close();
    }
}
function listCouncils(root, limit) {
    const store = new chimera_store_1.ChimeraStore(root);
    try {
        return store.listCouncils(limit);
    }
    finally {
        store.close();
    }
}
async function cueCouncilParticipant(root, council) {
    const participant = council.currentParticipantId;
    if (!participant || participant === "coordinator")
        throw new Error(`Council ${council.publicId} is not waiting on a co-agent`);
    const state = councilStatus(root, council.publicId);
    const transcript = state.turns
        .map((turn) => `[round ${turn.round}] ${turn.speakerId}: ${turn.body}`)
        .join("\n");
    return sendChimera(root, {
        to: participant,
        kind: "council",
        priority: true,
        body: `It is your ordered turn in council ${council.publicId}, round ${council.round}.\n\nCouncil transcript:\n${transcript}\n\nReply once with: argos chimera council turn --root "${root}" --id ${council.publicId} --body "..."\nDo not pass the turn yourself; Argos advances it atomically.`
    });
}
async function deliverPriorityMessage(root, store, targetInput, message) {
    let target = await reconcileSession(store, store.getSession(targetInput.publicId));
    const config = readChimeraConfig();
    if (!target.opencodeSessionId) {
        if (target.status === "starting" && target.runPid && isProcessAlive(target.runPid)) {
            return { attempted: false, accepted: false, mode: "queued", detail: "Initial OpenCode session is still starting; the message is queued in Argos", status: null };
        }
        clearKillFlag(target);
        target = store.claimSessionStart(target.publicId);
        let launch;
        try {
            launch = launchWorker(root, target.publicId);
        }
        catch (error) {
            store.updateSession(target.publicId, { status: "stopped", runPid: null, lastError: error instanceof Error ? error.message : String(error), stopped: true });
            throw error;
        }
        target = launch.started
            ? store.registerWorkerPid(target.publicId, launch.pid)
            : store.updateSession(target.publicId, { status: "stopped", runPid: null, lastError: launch.detail, stopped: true });
        writeSessionStatus(target);
        return { attempted: true, accepted: launch.started, mode: "worker", detail: launch.detail, status: null, pid: launch.pid };
    }
    let serverUrl = target.opencodeServerUrl;
    if (!serverUrl || !(await openCodeHealth(serverUrl)).ok) {
        const server = await ensureOpenCodeServer({ ...config, opencodeCommand: target.opencodeCommand });
        serverUrl = server.url;
        target = store.updateSession(target.publicId, { opencodeServerUrl: serverUrl });
    }
    const opencodeSessionId = target.opencodeSessionId;
    if (!opencodeSessionId)
        return { attempted: false, accepted: false, mode: "queued", detail: "OpenCode session id was not available after recovery", status: null };
    clearKillFlag(target);
    const model = parseModel(target.model);
    const body = {
        agent: target.opencodeAgent,
        variant: target.variant ?? undefined,
        parts: [{ type: "text", text: renderDirectPrompt(root, target, message) }]
    };
    if (model)
        body.model = model;
    const response = await httpJson(`${trimSlash(serverUrl)}/session/${encodeURIComponent(opencodeSessionId)}/prompt_async?directory=${encodeURIComponent(target.sessionDir)}`, {
        method: "POST",
        body
    });
    if (response.ok) {
        const updated = store.updateSession(target.publicId, { status: "running", lastError: null });
        writeSessionStatus(updated);
    }
    return {
        attempted: true,
        accepted: response.ok,
        mode: "prompt_async",
        detail: response.ok
            ? "OpenCode accepted the direct asynchronous prompt; semantic acknowledgement still requires agent polling or a reply"
            : response.error ?? `OpenCode returned HTTP ${response.status ?? "unknown"}`,
        status: response.status
    };
}
async function reconcileSessions(store, sessions) {
    const reconciled = [];
    for (const session of sessions)
        reconciled.push(await reconcileSession(store, session));
    return reconciled;
}
async function reconcileSession(store, sessionInput) {
    let session = sessionInput;
    if (session.runPid && isProcessAlive(session.runPid)) {
        const expected = session.opencodeSessionId ? "running" : "starting";
        if (session.status !== expected)
            session = store.updateSession(session.publicId, { status: expected });
        return session;
    }
    const serverUrl = session.opencodeServerUrl ?? readChimeraConfig().serverUrl;
    if (serverUrl && (await openCodeHealth(serverUrl)).ok) {
        if (!session.opencodeSessionId) {
            const discovered = await discoverOpenCodeSession(serverUrl, session);
            if (discovered)
                session = store.updateSession(session.publicId, { opencodeSessionId: discovered, opencodeServerUrl: serverUrl });
        }
        if (session.opencodeSessionId) {
            const response = await httpJson(`${trimSlash(serverUrl)}/session/status?directory=${encodeURIComponent(session.sessionDir)}`);
            if (!response.ok || typeof response.body !== "object" || response.body === null)
                return session;
            const status = objectValue(response.body, session.opencodeSessionId);
            if (typeof status !== "object" || status === null)
                return session;
            const kind = typeof status === "object" && status !== null && "type" in status ? String(status.type ?? "") : "";
            const active = kind === "busy" || kind === "retry" || kind === "running";
            const desired = active ? "running" : "stopped";
            if (session.status !== desired || session.runPid !== null) {
                session = store.updateSession(session.publicId, { status: desired, runPid: null, stopped: !active });
                writeSessionStatus(session);
            }
            return session;
        }
    }
    if ((session.status === "starting" || session.status === "running") && (!session.runPid || !isProcessAlive(session.runPid))) {
        session = store.updateSession(session.publicId, { status: "stopped", runPid: null, stopped: true });
        writeSessionStatus(session);
    }
    return session;
}
function launchWorker(root, publicId) {
    const cli = resolveArgosCliPath();
    const child = (0, node_child_process_1.spawn)(node_process_1.default.execPath, [cli, "chimera", "_worker", "--root", root, "--id", publicId], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        env: { ...node_process_1.default.env, ARGOS_ROOT: root, ARGOS_CHIMERA_ID: publicId }
    });
    child.unref();
    return { started: Boolean(child.pid), pid: child.pid ?? null, detail: child.pid ? "Chimera worker started in the background" : "Chimera worker did not return a PID" };
}
function materializeSession(root, session, config) {
    (0, paths_1.ensureDir)(session.labDir);
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, "opencode"));
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, ".opencode", "agents"));
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, ".opencode", "skills"));
    const db = new db_1.ArgosDb(root);
    try {
        const contexts = session.nodeIds.map((id) => db.getContext(id));
        const maps = session.nodeIds.map((id) => db.map(id, 2));
        const dossier = renderDossier(root, session, contexts);
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "dossier.md"), dossier);
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "graph-context.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), anchors: session.nodeIds, maps }, null, 2)}\n`);
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "agent-instructions.md"), renderAgentInstructions(root, session));
        (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "opencode", "prompt.md"), renderInitialPrompt(session));
        writeOpenCodeAgent(session);
        linkSkills(session);
        writeSessionStatus(session);
    }
    finally {
        db.close();
    }
}
function renderDossier(root, session, contexts) {
    const lines = [
        `# Argos Chimera ${session.publicId}`,
        "",
        `Role: ${session.role}`,
        `Goal: ${session.goal}`,
        `Knowledge root: ${root}`,
        `Lab: ${session.labDir}`,
        "",
        "## Knowledge Anchors",
        ""
    ];
    if (contexts.length === 0) {
        lines.push("No anchor nodes were supplied. Search Argos before creating knowledge, then attach work to canonical nodes.", "");
    }
    for (const context of contexts) {
        lines.push(`### ${context.node.publicId} | ${context.node.type} | ${context.node.title}`, "", `Updated: ${context.node.updatedAt} (${context.node.ageDays} days ago)`, "", context.node.content || "_No body yet._", "", "Relations:", ...context.outgoing.map((edge) => `- ${edge.fromId} ${edge.type} ${edge.toId} (${edge.toType}: ${edge.toTitle})`), ...context.incoming.map((edge) => `- ${edge.fromId} (${edge.fromType}: ${edge.fromTitle}) ${edge.type} ${edge.toId}`), "");
    }
    return `${lines.join("\n")}\n`;
}
function renderAgentInstructions(root, session) {
    const access = session.accessMode === "editor"
        ? `Editor mode. Create or edit files only in ${session.labDir}, except for these exact coordinator grants: ${session.accessNotes}`
        : `Explorer mode. Treat the target workspace as read-only. Create scripts, notes, payloads, and artifacts only in ${session.labDir}. ${session.accessNotes}`;
    return `# Chimera Operating Instructions

You are ${session.publicId}, an independent ${session.role} co-agent in a coordinated research team. You are not a short-lived subagent. Develop your assigned front fully, make your own rational choices inside scope, and bring a distinct view to the shared knowledge map.

## Scope

- Goal: ${session.goal}
- Argos root: ${root}
- ${access}
- Shell actions must stay within the goal and access grant. Do not clean, reset, move, or rewrite shared repositories.
- Network use is ${session.networkAllowed ? "allowed within the target authorization and coordinator restrictions" : "disabled by default"}.
- Do not stop after one command or one line of thought. Stop only when the goal is met, a real blocker prevents progress, or the coordinator tells you to stop.

## Knowledge Work

- Read dossier.md, graph-context.json, agent-instructions.md, and the injected Argos skills before substantial work.
- Your assigned role is the initial research lens, not a boundary. Load its skill first when specialized, then use another available method when the graph or evidence calls for it.
- Every Argos CLI call must use the shared root: argos ... --root "${root}". Never initialize Argos inside your lab or a subdirectory.
- Resolve and search before creating a node. Update the canonical note when the real item already exists.
- Treat node age as a revalidation signal. Old notes are leads, not current truth.
- Keep conclusions scoped to the path and conditions actually tested. A guard's presence does not prove input provenance or coverage of alternate paths.
- When new evidence changes a producer, consumer, route, authority boundary, state transition, or guarantee, revisit the linked map and any conclusion that depended on it.
- Use map, chains, gaps, and link suggestions to combine facts that would otherwise remain separate. Suggestions are leads; accept an edge only after checking it.
- Store useful knowledge as concise free-form Markdown in canonical nodes. Do not create process diaries or duplicate records.

## Coordination

- Poll periodically: argos chimera poll --root "${root}" --identity ${session.publicId}
- Send a message: argos chimera send --root "${root}" --to coordinator --body "..."
- Send to another co-agent only when it can change or unblock that front. You do not need to answer every shared message.
- Priority is meaningful only when the recipient is another Chimera agent. Messages to the coordinator are read through polling.
- In a council, accept only at a safe pause point. Wait for your ordered cue, read the supplied transcript, and submit exactly one concise turn. Argos advances the turn; do not cue another participant yourself.
- Ask the coordinator only about authorization, scope, access, or a strategic choice that cannot be settled from evidence. Do not wait for step-by-step supervision.
`;
}
function renderInitialPrompt(session) {
    return `Start Argos Chimera session ${session.publicId}. Read dossier.md and agent-instructions.md, load the available Argos skills, inspect the linked graph before creating knowledge, and pursue the assigned goal independently. Poll Argos messages before long work and before stopping. Report useful results by updating canonical nodes and by sending a concise message to the coordinator.`;
}
function writeOpenCodeAgent(session) {
    const labPattern = `${session.labDir.replace(/\\/g, "/").replace(/\/$/, "")}/**`;
    const permission = {
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        bash: "allow",
        external_directory: "allow",
        skill: "allow",
        lsp: "allow",
        task: "deny",
        question: "deny",
        edit: session.accessMode === "editor" ? "allow" : { "*": "deny", [labPattern]: "allow" },
        webfetch: session.networkAllowed ? "allow" : "deny",
        websearch: session.networkAllowed ? "allow" : "deny"
    };
    const yaml = Object.entries(permission).flatMap(([key, value]) => {
        if (typeof value === "string")
            return [`  ${key}: ${value}`];
        return [`  ${key}:`, ...Object.entries(value).map(([pattern, action]) => `    ${JSON.stringify(pattern)}: ${action}`)];
    }).join("\n");
    const model = session.model ? `model: ${session.model}\n` : "";
    const agent = `---
description: Independent Argos Chimera co-agent for ${session.role} research.
mode: primary
${model}permission:
${yaml}
---

Read dossier.md and agent-instructions.md before acting. Follow the access boundary exactly, use the shared Argos root for knowledge operations, and work until the assigned goal or a real blocker is reached.
`;
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, ".opencode", "agents", `${session.opencodeAgent}.md`), agent);
}
function linkSkills(session) {
    const sourceRoot = resolveSkillsDir();
    if (!sourceRoot)
        return;
    const available = node_fs_1.default.readdirSync(sourceRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && node_fs_1.default.existsSync(node_path_1.default.join(sourceRoot, entry.name, "SKILL.md")))
        .map((entry) => entry.name);
    const wanted = ["chimera-agent", ...available.filter((name) => name !== "argos" && name !== "chimera-agent")];
    for (const name of wanted) {
        const source = node_path_1.default.join(sourceRoot, name);
        const destination = node_path_1.default.join(session.sessionDir, ".opencode", "skills", name);
        if (node_fs_1.default.existsSync(destination))
            continue;
        try {
            node_fs_1.default.symlinkSync(source, destination, node_process_1.default.platform === "win32" ? "junction" : "dir");
        }
        catch {
            node_fs_1.default.cpSync(source, destination, { recursive: true });
        }
    }
}
function buildOpenCodeRunArgs(session, serverUrl) {
    const args = ["run", "--pure", "--format", "json", "--thinking", "--attach", serverUrl, "--dir", session.sessionDir, "--agent", session.opencodeAgent];
    if (session.opencodeSessionId) {
        args.push("--session", session.opencodeSessionId);
    }
    else {
        args.push("--title", `Argos ${session.publicId} ${session.role}`);
        args.push("--file", node_path_1.default.join(session.sessionDir, "dossier.md"));
        args.push("--file", node_path_1.default.join(session.sessionDir, "agent-instructions.md"));
    }
    if (session.model)
        args.push("--model", session.model);
    if (session.variant)
        args.push("--variant", session.variant);
    if (session.autoApprove)
        args.push("--auto");
    args.push(session.opencodeSessionId
        ? `Resume ${session.publicId}. Poll unread Argos messages first, preserve the existing goal and graph context, and continue with the next useful move.`
        : renderInitialPrompt(session));
    return args;
}
function renderDirectPrompt(root, session, message) {
    return `Priority Argos message ${message.publicId} for ${session.publicId} from ${message.fromId}:\n\n${message.body}\n\nA canonical copy is in the Argos inbox. Poll it now to acknowledge receipt:\nargos chimera poll --root "${root}" --identity ${session.publicId}\n\nApply it at the next safe step. Reply only when asked or when your response changes the shared work.`;
}
async function ensureOpenCodeServer(configInput) {
    const release = acquireGlobalServerLock();
    try {
        let config = readChimeraConfig();
        if (configInput.opencodeCommand !== config.opencodeCommand)
            config = { ...config, opencodeCommand: configInput.opencodeCommand };
        if (config.serverUrl && (await openCodeHealth(config.serverUrl)).ok) {
            return { url: config.serverUrl, pid: config.serverPid, reused: true };
        }
        for (let port = 4096; port <= 4115; port += 1) {
            const url = `http://127.0.0.1:${port}`;
            if ((await openCodeHealth(url)).ok) {
                saveChimeraConfig({ ...config, serverUrl: url, serverPid: null });
                return { url, pid: null, reused: true };
            }
        }
        for (let port = 4096; port <= 4115; port += 1) {
            if (!(await portAvailable(port)))
                continue;
            const command = commandParts(config.opencodeCommand);
            const logDir = node_path_1.default.dirname((0, paths_1.globalChimeraConfigPath)());
            (0, paths_1.ensureDir)(logDir);
            const stdoutFd = node_fs_1.default.openSync(node_path_1.default.join(logDir, "opencode-server.stdout.log"), "a");
            const stderrFd = node_fs_1.default.openSync(node_path_1.default.join(logDir, "opencode-server.stderr.log"), "a");
            const child = (0, node_child_process_1.spawn)(command.file, [...command.args, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
                detached: true,
                windowsHide: true,
                stdio: ["ignore", stdoutFd, stderrFd]
            });
            child.unref();
            node_fs_1.default.closeSync(stdoutFd);
            node_fs_1.default.closeSync(stderrFd);
            const url = `http://127.0.0.1:${port}`;
            for (let attempt = 0; attempt < 60; attempt += 1) {
                await sleep(250);
                if ((await openCodeHealth(url)).ok) {
                    saveChimeraConfig({ ...config, serverUrl: url, serverPid: child.pid ?? null });
                    return { url, pid: child.pid ?? null, reused: false };
                }
                if (child.exitCode !== null)
                    break;
            }
            if (child.pid && isProcessAlive(child.pid))
                terminateProcessTree(child.pid);
        }
        throw new Error("Could not find or start an OpenCode server on 127.0.0.1:4096-4115");
    }
    finally {
        release();
    }
}
async function openCodeHealth(url) {
    const current = await httpJson(`${trimSlash(url)}/global/health`, { timeoutMs: 2_000 });
    if (current.ok && typeof current.body === "object" && current.body !== null && current.body.healthy === true)
        return current;
    const legacy = await httpJson(`${trimSlash(url)}/session`, { timeoutMs: 2_000 });
    return legacy.ok && Array.isArray(legacy.body) ? legacy : current;
}
async function discoverOpenCodeSession(serverUrl, session) {
    const response = await httpJson(`${trimSlash(serverUrl)}/session?directory=${encodeURIComponent(session.sessionDir)}`);
    if (!response.ok || !Array.isArray(response.body))
        return null;
    const normalizedDir = normalizePath(session.sessionDir);
    const candidates = response.body
        .filter((item) => typeof item === "object" && item !== null)
        .filter((item) => normalizePath(String(item.directory ?? "")) === normalizedDir || titleMatchesSession(String(item.title ?? ""), session.publicId))
        .sort((left, right) => sessionUpdateTime(right) - sessionUpdateTime(left));
    const id = candidates[0]?.id;
    return typeof id === "string" && id.startsWith("ses") ? id : null;
}
function exportOpenCodeSession(session) {
    if (!session.opencodeSessionId)
        throw new Error(`${session.publicId} has no OpenCode session id`);
    const command = commandParts(session.opencodeCommand);
    const temporaryDir = node_path_1.default.join(session.sessionDir, "opencode", "workflow-snapshots", ".tmp");
    (0, paths_1.ensureDir)(temporaryDir);
    const stamp = `${node_process_1.default.pid}-${Date.now()}`;
    const stdoutPath = node_path_1.default.join(temporaryDir, `${stamp}.json`);
    const stderrPath = node_path_1.default.join(temporaryDir, `${stamp}.err.log`);
    const stdoutFd = node_fs_1.default.openSync(stdoutPath, "w");
    const stderrFd = node_fs_1.default.openSync(stderrPath, "w");
    try {
        const result = (0, node_child_process_1.spawnSync)(command.file, [...command.args, "export", session.opencodeSessionId], {
            cwd: session.sessionDir,
            windowsHide: true,
            stdio: ["ignore", stdoutFd, stderrFd],
            timeout: 60_000
        });
        if (result.status !== 0) {
            const error = node_fs_1.default.readFileSync(stderrPath, "utf8").trim();
            throw new Error(error || `OpenCode export exited with code ${result.status}`);
        }
        return JSON.parse(node_fs_1.default.readFileSync(stdoutPath, "utf8"));
    }
    finally {
        node_fs_1.default.closeSync(stdoutFd);
        node_fs_1.default.closeSync(stderrFd);
        for (const file of [stdoutPath, stderrPath]) {
            try {
                node_fs_1.default.rmSync(file, { force: true });
            }
            catch { }
        }
    }
}
function extractWorkflowMessages(raw, limit, maxChars) {
    const candidates = Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null && Array.isArray(raw.messages)
            ? raw.messages
            : [];
    const messages = [];
    for (const candidate of candidates) {
        if (typeof candidate !== "object" || candidate === null)
            continue;
        const value = candidate;
        const roleValue = value.info?.role ?? value.role;
        if (roleValue !== "user" && roleValue !== "assistant")
            continue;
        const parts = Array.isArray(value.parts) ? value.parts : [];
        const text = parts
            .filter((part) => typeof part === "object" && part !== null)
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => String(part.text))
            .join("\n")
            .trim();
        if (!text)
            continue;
        const clipped = clip(text, maxChars);
        const timeValue = value.info?.time ?? value.time;
        messages.push({
            ordinal: messages.length + 1,
            role: roleValue,
            createdAt: extractMessageTime(timeValue),
            text: clipped.text,
            truncated: clipped.truncated
        });
    }
    const selected = messages.slice(-limit);
    return selected.map((message, index) => ({ ...message, ordinal: index + 1 }));
}
function renderWorkflowMarkdown(snapshot) {
    const lines = [
        `# ${snapshot.session.publicId} Workflow Snapshot`,
        "",
        `Generated: ${snapshot.generatedAt}`,
        `Source: ${snapshot.source}`,
        `Messages: ${snapshot.messages.length}`,
        ""
    ];
    for (const message of snapshot.messages) {
        lines.push(`## ${message.ordinal}. ${message.role}${message.createdAt ? ` | ${message.createdAt}` : ""}`, "", message.text, "");
    }
    return `${lines.join("\n")}\n`;
}
function resolveAnchorNodes(root, references) {
    const db = new db_1.ArgosDb(root);
    try {
        return [...new Set(references.map((reference) => db.getNode(reference).publicId))];
    }
    finally {
        db.close();
    }
}
function writeSessionStatus(session) {
    (0, paths_1.writeFileAtomic)(node_path_1.default.join(session.sessionDir, "status.json"), `${JSON.stringify(session, null, 2)}\n`);
}
function clearKillFlag(session) {
    const flag = node_path_1.default.join(session.sessionDir, "kill.flag");
    try {
        node_fs_1.default.unlinkSync(flag);
    }
    catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"))
            throw error;
    }
}
function resolveSkillsDir() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "..", "plugins", "argos", "skills"),
        node_path_1.default.resolve(__dirname, "..", "skills")
    ];
    return candidates.find((candidate) => node_fs_1.default.existsSync(candidate)) ?? null;
}
function resolveArgosCliPath() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "cli.js"),
        node_path_1.default.resolve(__dirname, "..", "dist", "cli.js")
    ];
    const result = candidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    if (!result)
        throw new Error("Could not resolve the built Argos CLI. Run `npm run build` first.");
    return result;
}
function normalizeConfig(input) {
    return {
        enabled: input.enabled === true,
        opencodeCommand: cleanNullable(input.opencodeCommand) ?? exports.DEFAULT_CHIMERA_CONFIG.opencodeCommand,
        defaultModel: cleanNullable(input.defaultModel),
        defaultVariant: cleanNullable(input.defaultVariant),
        defaultAgent: normalizeSlug(cleanNullable(input.defaultAgent) ?? exports.DEFAULT_CHIMERA_CONFIG.defaultAgent, "OpenCode agent name"),
        maxAgents: clampInteger(input.maxAgents, 1, 32, exports.DEFAULT_CHIMERA_CONFIG.maxAgents),
        defaultNetwork: input.defaultNetwork === true,
        autoApprove: input.autoApprove !== false,
        serverUrl: cleanNullable(input.serverUrl),
        serverPid: Number.isInteger(input.serverPid) && Number(input.serverPid) > 0 ? Number(input.serverPid) : null
    };
}
function commandParts(value) {
    const parts = [];
    let current = "";
    let quote = null;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (quote) {
            if (char === quote)
                quote = null;
            else
                current += char;
        }
        else if (char === '"' || char === "'") {
            quote = char;
        }
        else if (/\s/.test(char)) {
            if (current) {
                parts.push(current);
                current = "";
            }
        }
        else {
            current += char;
        }
    }
    if (quote)
        throw new Error(`Unclosed quote in command: ${value}`);
    if (current)
        parts.push(current);
    if (parts.length === 0)
        throw new Error("OpenCode command cannot be empty");
    return { file: (0, process_1.resolveCommandFile)(parts[0]), args: parts.slice(1) };
}
function parseModel(value) {
    if (!value)
        return null;
    const slash = value.indexOf("/");
    if (slash <= 0 || slash === value.length - 1)
        return null;
    return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}
function inferIdentity(value) {
    return normalizeRecipient(value ?? node_process_1.default.env.ARGOS_CHIMERA_ID ?? "coordinator");
}
function normalizeRecipient(value) {
    const normalized = value.trim();
    if (/^coordinator$/i.test(normalized))
        return "coordinator";
    if (/^CH-\d+$/i.test(normalized))
        return normalized.toUpperCase();
    throw new Error(`Invalid Chimera identity: ${value}`);
}
function normalizeRole(value) {
    const normalized = normalizeSlug(value, "Chimera role");
    if (normalized !== "generalist") {
        const source = resolveSkillsDir();
        const roles = source
            ? node_fs_1.default.readdirSync(source, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && !["argos", "chimera-agent"].includes(entry.name) && node_fs_1.default.existsSync(node_path_1.default.join(source, entry.name, "SKILL.md")))
                .map((entry) => entry.name)
                .sort()
            : [];
        if (!roles.includes(normalized))
            throw new Error(`Unknown Chimera role '${value}'. Available: generalist${roles.length ? `, ${roles.join(", ")}` : ""}`);
    }
    return normalized;
}
function normalizeSlug(value, label) {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!normalized)
        throw new Error(`${label} cannot be empty`);
    return normalized;
}
function cleanNullable(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function requireInitialized(root) {
    if (!node_fs_1.default.existsSync((0, paths_1.knowledgePath)(root)))
        throw new Error(`Argos is not initialized at ${root}`);
}
function acquireGlobalServerLock() {
    const lockDir = `${(0, paths_1.globalChimeraConfigPath)()}.lock`;
    (0, paths_1.ensureDir)(node_path_1.default.dirname(lockDir));
    const started = Date.now();
    const token = `${node_process_1.default.pid}-${node_crypto_1.default.randomUUID()}`;
    while (true) {
        try {
            node_fs_1.default.mkdirSync(lockDir);
            node_fs_1.default.writeFileSync(node_path_1.default.join(lockDir, "owner.json"), `${JSON.stringify({ token, pid: node_process_1.default.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
            return () => {
                try {
                    const owner = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(lockDir, "owner.json"), "utf8"));
                    if (owner.token !== token)
                        return;
                    node_fs_1.default.rmSync(lockDir, { recursive: true, force: true });
                }
                catch { }
            };
        }
        catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"))
                throw error;
            try {
                const owner = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(lockDir, "owner.json"), "utf8"));
                const age = Date.now() - Date.parse(owner.createdAt ?? "");
                if (age > 2_000 && (!owner.pid || !isProcessAlive(owner.pid))) {
                    node_fs_1.default.rmSync(lockDir, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                try {
                    const age = Date.now() - node_fs_1.default.statSync(lockDir).mtimeMs;
                    if (age > 2_000) {
                        node_fs_1.default.rmSync(lockDir, { recursive: true, force: true });
                        continue;
                    }
                }
                catch { }
            }
            if (Date.now() - started > 30_000)
                throw new Error("Timed out waiting for the global Chimera server lock");
            sleepSync(50);
        }
    }
}
function titleMatchesSession(title, publicId) {
    return title === publicId || title.startsWith(`Argos ${publicId} `);
}
async function httpJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
        const response = await fetch(url, {
            method: options.method ?? "GET",
            headers: options.body === undefined ? undefined : { "content-type": "application/json" },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal
        });
        const text = await response.text();
        let body = null;
        if (text.trim()) {
            try {
                body = JSON.parse(text);
            }
            catch {
                body = text;
            }
        }
        return { ok: response.ok, status: response.status, body, error: response.ok ? null : typeof body === "string" ? body : JSON.stringify(body) };
    }
    catch (error) {
        return { ok: false, status: null, body: null, error: error instanceof Error ? error.message : String(error) };
    }
    finally {
        clearTimeout(timer);
    }
}
function portAvailable(port) {
    return new Promise((resolve) => {
        const server = node_net_1.default.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
}
function terminateProcessTree(pid) {
    if (!isProcessAlive(pid))
        return false;
    if (node_process_1.default.platform === "win32") {
        const result = (0, node_child_process_1.spawnSync)("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
        return result.status === 0 || !isProcessAlive(pid);
    }
    try {
        node_process_1.default.kill(-pid, "SIGTERM");
        return true;
    }
    catch { }
    try {
        node_process_1.default.kill(pid, "SIGTERM");
        return true;
    }
    catch {
        return false;
    }
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        node_process_1.default.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function extractOpenCodeSessionId(text) {
    const direct = text.match(/"sessionID"\s*:\s*"(ses_[^"]+)"/);
    if (direct)
        return direct[1];
    const alternate = text.match(/"sessionId"\s*:\s*"(ses_[^"]+)"/);
    return alternate?.[1] ?? null;
}
function lastOpenCodeError(text) {
    const lines = text.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
        try {
            const value = JSON.parse(line);
            if (value.type === "error")
                return value.error?.data?.message ?? value.error?.message ?? line;
        }
        catch { }
    }
    return null;
}
function extractMessageTime(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return new Date(value).toISOString();
    if (typeof value === "string" && value.trim())
        return value;
    if (typeof value === "object" && value !== null) {
        const object = value;
        for (const key of ["created", "completed", "updated"]) {
            if (typeof object[key] === "number")
                return new Date(Number(object[key])).toISOString();
            if (typeof object[key] === "string")
                return String(object[key]);
        }
    }
    return null;
}
function objectValue(value, key) {
    return typeof value === "object" && value !== null ? value[key] : undefined;
}
function sessionUpdateTime(value) {
    const time = value.time;
    if (typeof time === "object" && time !== null)
        return Number(time.updated ?? 0);
    return 0;
}
function normalizePath(value) {
    return node_path_1.default.resolve(value || ".").replace(/\\/g, "/").toLowerCase();
}
function trimSlash(value) {
    return value.replace(/\/+$/, "");
}
function clip(value, maxChars) {
    if (value.length <= maxChars)
        return { text: value, truncated: false };
    return { text: `${value.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]`, truncated: true };
}
function tail(value, maxChars) {
    return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}
function clampInteger(value, min, max, fallback) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(min, Math.min(max, Math.floor(Number(value))));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
