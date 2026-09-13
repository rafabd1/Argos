import fs from "node:fs";
import path from "node:path";
import { LockedSqliteDatabase } from "./locked-sqlite";
import { chimeraDbPath, chimeraSessionsDir, ensureDir } from "./paths";
import type {
  ChimeraAccessMode,
  ChimeraCouncil,
  ChimeraCouncilTurn,
  ChimeraMessage,
  ChimeraMessageDirection,
  ChimeraSession,
  ChimeraStatus
} from "./types";

interface SessionRow {
  id: number;
  public_id: string;
  role: string;
  goal: string;
  node_ids_json: string;
  status: ChimeraStatus;
  access_mode: ChimeraAccessMode;
  access_notes: string;
  model: string | null;
  variant: string | null;
  session_dir: string;
  lab_dir: string;
  opencode_command: string;
  opencode_agent: string;
  network_allowed: number;
  auto_approve: number;
  opencode_server_url: string | null;
  opencode_session_id: string | null;
  run_pid: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  stopped_at: string | null;
}

interface MessageRow {
  id: number;
  public_id: string;
  session_id: number | null;
  direction: ChimeraMessageDirection;
  from_id: string;
  to_id: string;
  kind: ChimeraMessage["kind"];
  body: string;
  priority: number;
  read_by_coordinator: number;
  read_by_agent: number;
  created_at: string;
}

interface CouncilRow {
  id: number;
  public_id: string;
  topic: string;
  participant_ids_json: string;
  accepted_ids_json: string;
  status: ChimeraCouncil["status"];
  round: number;
  current_participant_id: string | null;
  max_rounds: number;
  final_message: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface CouncilTurnRow {
  id: number;
  council_id: number;
  council_public_id: string;
  round: number;
  speaker_id: string;
  body: string;
  created_at: string;
}

export interface CreateSessionInput {
  role: string;
  goal: string;
  nodeIds: string[];
  accessMode: ChimeraAccessMode;
  accessNotes: string;
  model: string | null;
  variant: string | null;
  opencodeCommand: string;
  opencodeAgent: string;
  networkAllowed: boolean;
  autoApprove: boolean;
  serverUrl: string | null;
  maxAgents?: number;
}

export interface UpdateSessionInput {
  status?: ChimeraStatus;
  opencodeServerUrl?: string | null;
  opencodeSessionId?: string | null;
  runPid?: number | null;
  lastError?: string | null;
  stopped?: boolean;
}

export class ChimeraStore {
  private readonly db: LockedSqliteDatabase;

  constructor(readonly root: string) {
    ensureDir(chimeraSessionsDir(root));
    this.db = new LockedSqliteDatabase(chimeraDbPath(root));
    this.configure();
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createSession(input: CreateSessionInput): ChimeraSession {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const maxAgents = clampInteger(input.maxAgents, 1, 100, 5);
      const active = this.db.prepare("SELECT COUNT(*) AS count FROM chimera_sessions WHERE status IN ('starting', 'running')").get() as { count: number };
      if (Number(active.count) >= maxAgents) {
        throw new Error(`Chimera maxAgents limit reached (${maxAgents}). Reuse or stop an active session.`);
      }
      const row = this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM chimera_sessions").get() as { next_id: number };
      const id = Number(row.next_id);
      const publicId = sessionPublicId(id);
      const sessionDir = path.join(chimeraSessionsDir(this.root), publicId);
      const labDir = path.join(sessionDir, "lab");
      ensureDir(labDir);
      this.db.prepare(`
        INSERT INTO chimera_sessions (
          id, public_id, role, goal, node_ids_json, status, access_mode, access_notes,
          model, variant, session_dir, lab_dir, opencode_command, opencode_agent,
          network_allowed, auto_approve, opencode_server_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        publicId,
        input.role,
        input.goal,
        JSON.stringify(input.nodeIds),
        input.accessMode,
        input.accessNotes,
        input.model,
        input.variant,
        sessionDir,
        labDir,
        input.opencodeCommand,
        input.opencodeAgent,
        input.networkAllowed ? 1 : 0,
        input.autoApprove ? 1 : 0,
        input.serverUrl,
        now,
        now
      );
      this.db.exec("COMMIT");
      return this.getSession(publicId);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSession(reference: string | number): ChimeraSession {
    const row = this.findSessionRow(reference);
    if (!row) throw new Error(`Unknown Chimera session: ${reference}`);
    return toSession(row);
  }

  listSessions(options: { active?: boolean; limit?: number } = {}): ChimeraSession[] {
    const limit = clampInteger(options.limit, 1, 500, 50);
    const rows = options.active
      ? this.db.prepare("SELECT * FROM chimera_sessions WHERE status IN ('starting', 'running') ORDER BY id DESC LIMIT ?").all(limit)
      : this.db.prepare("SELECT * FROM chimera_sessions ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as SessionRow[]).map(toSession);
  }

  updateSession(reference: string | number, input: UpdateSessionInput): ChimeraSession {
    const current = this.getSession(reference);
    const now = new Date().toISOString();
    const assignments = ["updated_at = ?"];
    const values: unknown[] = [now];
    const add = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (input.status !== undefined) add("status", input.status);
    if (input.opencodeServerUrl !== undefined) add("opencode_server_url", input.opencodeServerUrl);
    if (input.opencodeSessionId !== undefined) add("opencode_session_id", input.opencodeSessionId);
    if (input.runPid !== undefined) add("run_pid", input.runPid);
    if (input.lastError !== undefined) add("last_error", input.lastError);
    if (input.stopped === true || input.status === "stopped") add("stopped_at", now);
    else if (input.status === "running" || input.status === "starting") add("stopped_at", null);
    values.push(current.id);
    this.db.prepare(`UPDATE chimera_sessions SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    return this.getSession(current.id);
  }

  claimSessionStart(reference: string | number): ChimeraSession {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getSession(reference);
      if (current.status !== "stopped") {
        throw new Error(`Chimera ${current.publicId} is already ${current.status}. Use poll, workflow-snapshot, send, or kill.`);
      }
      this.db.prepare(`
        UPDATE chimera_sessions
        SET status = 'starting', run_pid = NULL, last_error = NULL, stopped_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'stopped'
      `).run(new Date().toISOString(), current.id);
      this.db.exec("COMMIT");
      return this.getSession(current.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  registerWorkerPid(reference: string | number, pid: number): ChimeraSession {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Worker PID must be a positive integer");
    const current = this.getSession(reference);
    this.db.prepare(`
      UPDATE chimera_sessions
      SET run_pid = ?, updated_at = ?
      WHERE id = ? AND status = 'starting'
    `).run(pid, new Date().toISOString(), current.id);
    return this.getSession(current.id);
  }

  addMessage(input: {
    sessionReference?: string | number;
    direction: ChimeraMessageDirection;
    fromId: string;
    toId: string;
    kind?: ChimeraMessage["kind"];
    body: string;
    priority?: boolean;
  }): ChimeraMessage {
    const body = input.body.trim();
    if (!body) throw new Error("Message body cannot be empty");
    const session = input.sessionReference === undefined ? null : this.getSession(input.sessionReference);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM chimera_messages").get() as { next_id: number };
      const id = Number(next.next_id);
      this.db.prepare(`
        INSERT INTO chimera_messages (
          id, public_id, session_id, direction, from_id, to_id, kind, body, priority,
          read_by_coordinator, read_by_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        messagePublicId(id),
        session?.id ?? null,
        input.direction,
        input.fromId,
        input.toId,
        input.kind ?? "message",
        body,
        input.priority ? 1 : 0,
        input.toId === "coordinator" ? 0 : 1,
        input.toId === "coordinator" ? 1 : 0,
        now
      );
      this.db.exec("COMMIT");
      return this.getMessage(id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getMessage(reference: string | number): ChimeraMessage {
    const row = typeof reference === "number" || /^\d+$/.test(String(reference))
      ? this.db.prepare("SELECT * FROM chimera_messages WHERE id = ?").get(Number(reference))
      : this.db.prepare("SELECT * FROM chimera_messages WHERE public_id = ? COLLATE NOCASE").get(String(reference));
    if (!row) throw new Error(`Unknown Chimera message: ${reference}`);
    return toMessage(row as MessageRow);
  }

  pollMessages(input: {
    identity: string;
    unread?: boolean;
    limit?: number;
    markRead?: boolean;
  }): ChimeraMessage[] {
    const identity = normalizeIdentity(input.identity);
    const limit = clampInteger(input.limit, 1, 500, 50);
    const readColumn = identity === "coordinator" ? "read_by_coordinator" : "read_by_agent";
    const clauses = ["to_id = ? COLLATE NOCASE"];
    if (input.unread !== false) clauses.push(`${readColumn} = 0`);
    let rows: MessageRow[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      rows = this.db.prepare(`
        SELECT * FROM chimera_messages
        WHERE ${clauses.join(" AND ")}
        ORDER BY id ASC LIMIT ?
      `).all(identity, limit) as MessageRow[];
      if (input.markRead !== false && rows.length > 0) {
        const ids = rows.map((row) => row.id);
        const placeholders = ids.map(() => "?").join(", ");
        this.db.prepare(`UPDATE chimera_messages SET ${readColumn} = 1 WHERE id IN (${placeholders})`).run(...ids);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return rows.map((row) => ({ ...toMessage(row), ...(identity === "coordinator" ? { readByCoordinator: input.markRead === false ? Boolean(row.read_by_coordinator) : true } : { readByAgent: input.markRead === false ? Boolean(row.read_by_agent) : true }) }));
  }

  createCouncil(topicInput: string, participantReferences: Array<string | number>, maxRoundsInput = 2): ChimeraCouncil {
    const topic = topicInput.trim();
    if (!topic) throw new Error("Council topic cannot be empty");
    const participants = [...new Set(participantReferences.map((reference) => this.getSession(reference).publicId))];
    if (participants.length === 0) throw new Error("Council requires at least one participant");
    const stopped = participants.filter((id) => this.getSession(id).status === "stopped");
    if (stopped.length > 0) throw new Error(`Council participants must be active: ${stopped.join(", ")}`);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM chimera_councils").get() as { next_id: number };
      const id = Number(next.next_id);
      this.db.prepare(`
        INSERT INTO chimera_councils (
          id, public_id, topic, participant_ids_json, accepted_ids_json, status, round,
          current_participant_id, max_rounds, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '[]', 'inviting', 0, NULL, ?, ?, ?)
      `).run(id, councilPublicId(id), topic, JSON.stringify(participants), clampInteger(maxRoundsInput, 1, 12, 2), now, now);
      this.db.exec("COMMIT");
      return this.getCouncil(id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCouncil(reference: string | number): ChimeraCouncil {
    const row = typeof reference === "number" || /^\d+$/.test(String(reference))
      ? this.db.prepare("SELECT * FROM chimera_councils WHERE id = ?").get(Number(reference))
      : this.db.prepare("SELECT * FROM chimera_councils WHERE public_id = ? COLLATE NOCASE").get(String(reference));
    if (!row) throw new Error(`Unknown Chimera council: ${reference}`);
    return toCouncil(row as CouncilRow);
  }

  listCouncils(limitInput = 20): ChimeraCouncil[] {
    return (this.db.prepare("SELECT * FROM chimera_councils ORDER BY id DESC LIMIT ?").all(clampInteger(limitInput, 1, 200, 20)) as CouncilRow[]).map(toCouncil);
  }

  acceptCouncil(councilReference: string | number, participantReference: string | number): ChimeraCouncil {
    const participant = this.getSession(participantReference).publicId;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const council = this.getCouncil(councilReference);
      if (council.status !== "inviting") throw new Error(`Council ${council.publicId} is not accepting invitations`);
      if (!council.participantIds.includes(participant)) throw new Error(`${participant} is not invited to ${council.publicId}`);
      const accepted = [...new Set([...council.acceptedIds, participant])];
      this.db.prepare("UPDATE chimera_councils SET accepted_ids_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(accepted), new Date().toISOString(), council.id);
      this.db.exec("COMMIT");
      return this.getCouncil(council.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  beginCouncil(councilReference: string | number, coordinatorOpening: string): { council: ChimeraCouncil; turn: ChimeraCouncilTurn } {
    const body = coordinatorOpening.trim();
    if (!body) throw new Error("The coordinator opening cannot be empty");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const council = this.getCouncil(councilReference);
      if (council.status !== "inviting") throw new Error(`Council ${council.publicId} has already started or closed`);
      const missing = council.participantIds.filter((id) => !council.acceptedIds.includes(id));
      if (missing.length > 0) throw new Error(`Council is waiting for: ${missing.join(", ")}`);
      const turn = this.insertCouncilTurn(council, 1, "coordinator", body);
      this.db.prepare(`
        UPDATE chimera_councils SET status = 'open', round = 1,
          current_participant_id = ?, updated_at = ? WHERE id = ?
      `).run(council.participantIds[0], new Date().toISOString(), council.id);
      this.db.exec("COMMIT");
      return { council: this.getCouncil(council.id), turn };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  addCouncilTurn(councilReference: string | number, speakerReference: string, bodyInput: string): { council: ChimeraCouncil; turn: ChimeraCouncilTurn } {
    const speaker = normalizeIdentity(speakerReference);
    if (speaker === "coordinator") throw new Error("Use council advance for a coordinator round opening");
    const body = bodyInput.trim();
    if (!body) throw new Error("Council turn cannot be empty");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const council = this.getCouncil(councilReference);
      if (council.status !== "open") throw new Error(`Council ${council.publicId} is not open`);
      if (council.currentParticipantId !== speaker) {
        throw new Error(`It is ${council.currentParticipantId ?? "nobody"}'s turn, not ${speaker}'s`);
      }
      const turn = this.insertCouncilTurn(council, council.round, speaker, body);
      const index = council.participantIds.indexOf(speaker);
      const next = index >= 0 && index + 1 < council.participantIds.length
        ? council.participantIds[index + 1]
        : "coordinator";
      this.db.prepare("UPDATE chimera_councils SET current_participant_id = ?, updated_at = ? WHERE id = ?")
        .run(next, new Date().toISOString(), council.id);
      this.db.exec("COMMIT");
      return { council: this.getCouncil(council.id), turn };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  advanceCouncil(councilReference: string | number, coordinatorOpening: string, extend = false): { council: ChimeraCouncil; turn: ChimeraCouncilTurn } {
    const body = coordinatorOpening.trim();
    if (!body) throw new Error("The next-round opening cannot be empty");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const council = this.getCouncil(councilReference);
      if (council.status !== "open" || council.currentParticipantId !== "coordinator") {
        throw new Error(`Council ${council.publicId} has not returned to the coordinator`);
      }
      if (council.round >= council.maxRounds && !extend) {
        throw new Error(`Council reached its ${council.maxRounds}-round limit. Close it or use --extend deliberately.`);
      }
      const nextRound = council.round + 1;
      const turn = this.insertCouncilTurn(council, nextRound, "coordinator", body);
      this.db.prepare(`
        UPDATE chimera_councils SET round = ?, current_participant_id = ?,
          max_rounds = ?, updated_at = ? WHERE id = ?
      `).run(
        nextRound,
        council.participantIds[0],
        extend && nextRound > council.maxRounds ? nextRound : council.maxRounds,
        new Date().toISOString(),
        council.id
      );
      this.db.exec("COMMIT");
      return { council: this.getCouncil(council.id), turn };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  closeCouncil(councilReference: string | number, finalMessageInput: string): ChimeraCouncil {
    const finalMessage = finalMessageInput.trim();
    if (!finalMessage) throw new Error("Council final message cannot be empty");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const council = this.getCouncil(councilReference);
      if (council.status === "closed") {
        this.db.exec("COMMIT");
        return council;
      }
      this.insertCouncilTurn(council, Math.max(1, council.round), "coordinator", finalMessage);
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE chimera_councils SET status = 'closed', current_participant_id = NULL,
          final_message = ?, updated_at = ?, closed_at = ? WHERE id = ?
      `).run(finalMessage, now, now, council.id);
      this.db.exec("COMMIT");
      return this.getCouncil(council.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  councilTurns(councilReference: string | number, limitInput = 100): ChimeraCouncilTurn[] {
    const council = this.getCouncil(councilReference);
    const rows = this.db.prepare(`
      SELECT t.*, c.public_id AS council_public_id
      FROM chimera_council_turns t
      JOIN chimera_councils c ON c.id = t.council_id
      WHERE t.council_id = ? ORDER BY t.id ASC LIMIT ?
    `).all(council.id, clampInteger(limitInput, 1, 1000, 100)) as CouncilTurnRow[];
    return rows.map(toCouncilTurn);
  }

  private insertCouncilTurn(council: ChimeraCouncil, round: number, speakerId: string, body: string): ChimeraCouncilTurn {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO chimera_council_turns (council_id, round, speaker_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(council.id, round, speakerId, body, now) as { lastInsertRowid: bigint | number };
    return {
      id: Number(result.lastInsertRowid),
      councilId: council.publicId,
      round,
      speakerId,
      body,
      createdAt: now
    };
  }

  private findSessionRow(reference: string | number): SessionRow | undefined {
    if (typeof reference === "number" || /^\d+$/.test(String(reference))) {
      return this.db.prepare("SELECT * FROM chimera_sessions WHERE id = ?").get(Number(reference)) as SessionRow | undefined;
    }
    return this.db.prepare("SELECT * FROM chimera_sessions WHERE public_id = ? COLLATE NOCASE").get(String(reference)) as SessionRow | undefined;
  }

  private configure(): void {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 120000");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chimera_sessions (
        id INTEGER PRIMARY KEY,
        public_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        goal TEXT NOT NULL,
        node_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('starting', 'running', 'stopped')),
        access_mode TEXT NOT NULL CHECK(access_mode IN ('explorer', 'editor')),
        access_notes TEXT NOT NULL DEFAULT '',
        model TEXT,
        variant TEXT,
        session_dir TEXT NOT NULL,
        lab_dir TEXT NOT NULL,
        opencode_command TEXT NOT NULL,
        opencode_agent TEXT NOT NULL DEFAULT 'argos-chimera',
        network_allowed INTEGER NOT NULL DEFAULT 0,
        auto_approve INTEGER NOT NULL DEFAULT 1,
        opencode_server_url TEXT,
        opencode_session_id TEXT,
        run_pid INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stopped_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chimera_sessions_status ON chimera_sessions(status, id);

      CREATE TABLE IF NOT EXISTS chimera_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        session_id INTEGER REFERENCES chimera_sessions(id) ON DELETE SET NULL,
        direction TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        read_by_coordinator INTEGER NOT NULL DEFAULT 0,
        read_by_agent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chimera_messages_recipient ON chimera_messages(to_id, id);

      CREATE TABLE IF NOT EXISTS chimera_councils (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        topic TEXT NOT NULL,
        participant_ids_json TEXT NOT NULL,
        accepted_ids_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('inviting', 'open', 'closed')),
        round INTEGER NOT NULL DEFAULT 0,
        current_participant_id TEXT,
        max_rounds INTEGER NOT NULL,
        final_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS chimera_council_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        council_id INTEGER NOT NULL REFERENCES chimera_councils(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        speaker_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chimera_council_turns ON chimera_council_turns(council_id, id);
    `);
    this.ensureColumn("chimera_sessions", "opencode_agent", "TEXT NOT NULL DEFAULT 'argos-chimera'");
    this.ensureColumn("chimera_sessions", "network_allowed", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("chimera_sessions", "auto_approve", "INTEGER NOT NULL DEFAULT 1");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function toSession(row: SessionRow): ChimeraSession {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    role: row.role,
    goal: row.goal,
    nodeIds: parseStringArray(row.node_ids_json),
    status: row.status,
    accessMode: row.access_mode,
    accessNotes: row.access_notes,
    model: row.model,
    variant: row.variant,
    sessionDir: row.session_dir,
    labDir: row.lab_dir,
    opencodeCommand: row.opencode_command,
    opencodeAgent: row.opencode_agent,
    networkAllowed: Boolean(row.network_allowed),
    autoApprove: Boolean(row.auto_approve),
    opencodeServerUrl: row.opencode_server_url,
    opencodeSessionId: row.opencode_session_id,
    runPid: row.run_pid === null ? null : Number(row.run_pid),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stoppedAt: row.stopped_at
  };
}

function toMessage(row: MessageRow): ChimeraMessage {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: row.session_id === null ? null : Number(row.session_id),
    direction: row.direction,
    fromId: row.from_id,
    toId: row.to_id,
    kind: row.kind,
    body: row.body,
    priority: Boolean(row.priority),
    readByCoordinator: Boolean(row.read_by_coordinator),
    readByAgent: Boolean(row.read_by_agent),
    createdAt: row.created_at
  };
}

function toCouncil(row: CouncilRow): ChimeraCouncil {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    topic: row.topic,
    participantIds: parseStringArray(row.participant_ids_json),
    acceptedIds: parseStringArray(row.accepted_ids_json),
    status: row.status,
    round: Number(row.round),
    currentParticipantId: row.current_participant_id,
    maxRounds: Number(row.max_rounds),
    finalMessage: row.final_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}

function toCouncilTurn(row: CouncilTurnRow): ChimeraCouncilTurn {
  return {
    id: Number(row.id),
    councilId: row.council_public_id,
    round: Number(row.round),
    speakerId: row.speaker_id,
    body: row.body,
    createdAt: row.created_at
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeIdentity(value: string): string {
  const normalized = value.trim();
  if (/^coordinator$/i.test(normalized)) return "coordinator";
  if (/^CH-\d+$/i.test(normalized)) return normalized.toUpperCase();
  throw new Error(`Invalid Chimera identity: ${value}`);
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

export function sessionPublicId(id: number): string {
  return `CH-${String(id).padStart(4, "0")}`;
}

function messagePublicId(id: number): string {
  return `CM-${String(id).padStart(6, "0")}`;
}

function councilPublicId(id: number): string {
  return `CC-${String(id).padStart(4, "0")}`;
}

export function removeChimeraRuntimeForTests(root: string): void {
  const target = path.resolve(chimeraDbPath(root));
  const allowed = path.resolve(root, ".argos", "chimera");
  if (!target.startsWith(`${allowed}${path.sep}`)) throw new Error("Refusing to remove Chimera runtime outside target root");
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${target}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}
