import fs from "node:fs";
import { LockedSqliteDatabase } from "./locked-sqlite";
import { argosDir, ensureDir, knowledgePath } from "./paths";
import type {
  ArgosConfig,
  ChainPath,
  EdgeView,
  GraphMap,
  KnowledgeEdge,
  KnowledgeGap,
  KnowledgeInspection,
  KnowledgeNode,
  LinkSuggestion,
  NodeSummary,
  SearchHit,
  SuggestionStatus
} from "./types";
import {
  assertNodeType,
  assertRelationType,
  initializeConfig,
  readConfig
} from "./vocabulary";

type Row = Record<string, unknown>;

const TECHNICAL_CHAIN_RELATIONS = new Set([
  "exposes",
  "calls",
  "flows_to",
  "transforms",
  "reads",
  "writes",
  "produces",
  "consumes",
  "influences",
  "crosses",
  "runs_as",
  "affects"
]);

const CHAIN_EXCLUDED_NODE_TYPES = new Set([
  "target",
  "test",
  "finding",
  "intel",
  "artifact",
  "note"
]);

export interface IdentityCandidate {
  node: NodeSummary;
  score: number;
  reasons: string[];
}

export interface CreateNodeInput {
  type: string;
  title: string;
  content?: string;
  aliases?: string[];
  distinctFrom?: string[];
}

export interface CreateNodeResult {
  created: boolean;
  resolutionRequired: boolean;
  node?: KnowledgeNode;
  canonical?: KnowledgeNode;
  candidates: IdentityCandidate[];
}

export interface UpdateNodeInput {
  title?: string;
  content?: string;
  aliases?: string[];
  mode?: "replace" | "append";
  edits?: NodeTextEdit[];
}

export interface NodeTextEdit {
  oldText: string;
  newText: string;
}

export interface MergeNodesInput {
  source: string | number;
  into: string | number;
  content: string;
  title?: string;
  aliases?: string[];
}

export interface MergeNodesResult {
  source: KnowledgeNode;
  canonical: KnowledgeNode;
  redirectedFrom: string;
  movedEdges: number;
  deduplicatedEdges: number;
  movedSuggestions: number;
  deduplicatedSuggestions: number;
  droppedSelfRelations: number;
}

export interface RemoveNodeResult {
  requestedId: string;
  removed: NodeSummary;
  removedEdges: number;
  removedSuggestions: number;
  removedRedirects: number;
  reason: string;
}

export interface NodeContext {
  requestedId: string;
  resolvedFrom: string | null;
  node: KnowledgeNode;
  outgoing: EdgeView[];
  incoming: EdgeView[];
  outgoingTotal: number;
  incomingTotal: number;
  relationLimit: number;
  relationsTruncated: boolean;
  supersededBy: NodeSummary[];
}

export interface StatusView {
  initialized: boolean;
  name: string;
  root: string;
  schemaVersion: number;
  counts: {
    nodes: number;
    edges: number;
    pendingSuggestions: number;
  };
  nodeTypes: Record<string, number>;
}

export interface KnowledgeSnapshot {
  nodes: KnowledgeNode[];
  edges: EdgeView[];
}

export class ArgosDb {
  readonly root: string;
  readonly config: ArgosConfig;
  private readonly db: LockedSqliteDatabase;

  constructor(root: string, create = false) {
    this.root = root;
    const file = knowledgePath(root);
    if (!create && !fs.existsSync(file)) throw new Error(`Argos is not initialized at ${root}`);
    ensureDir(argosDir(root));
    this.db = new LockedSqliteDatabase(file);
    this.configure();
    this.migrate();
    this.config = readConfig(root);
  }

  close(): void {
    this.db.close();
  }

  status(): StatusView {
    const count = (table: string, where = "") =>
      Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as Row).count ?? 0);
    const typeRows = this.db.prepare("SELECT type, COUNT(*) AS count FROM nodes GROUP BY type ORDER BY type").all() as Row[];
    return {
      initialized: true,
      name: this.config.name,
      root: this.root,
      schemaVersion: Number(this.metadata("schema_version") ?? 1),
      counts: {
        nodes: count("nodes"),
        edges: count("edges"),
        pendingSuggestions: count("link_suggestions", "WHERE status = 'pending'")
      },
      nodeTypes: Object.fromEntries(typeRows.map((row) => [String(row.type), Number(row.count)]))
    };
  }

  createNode(input: CreateNodeInput): CreateNodeResult {
    const type = assertNodeType(this.config, input.type);
    const title = cleanTitle(input.title);
    const aliases = cleanAliases(input.aliases ?? [], title);
    const acknowledged = new Set((input.distinctFrom ?? []).map((value) => nodePublicId(this.resolveNodeId(parseNodeId(value)))));
    let outcome: CreateNodeResult | undefined;
    this.transaction(() => {
      const candidates = this.resolveIdentity(type, title, aliases, 8, input.content ?? "");
      const exact = candidates.find((candidate) => candidate.score >= 0.999);
      if (exact) {
        outcome = {
          created: false,
          resolutionRequired: false,
          canonical: this.getNode(exact.node.publicId),
          candidates
        };
        return;
      }

      const unresolved = candidates.filter((candidate) => candidate.score >= 0.78 && !acknowledged.has(candidate.node.publicId));
      if (unresolved.length > 0) {
        outcome = { created: false, resolutionRequired: true, candidates: unresolved };
        return;
      }

      const now = new Date().toISOString();
      const result = this.db.prepare(
        `INSERT INTO nodes(type, title, normalized_title, aliases_json, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(type, title, normalizeIdentity(title), JSON.stringify(aliases), input.content ?? "", now, now);
      const id = Number(result.lastInsertRowid);
      this.indexNode(id, title, aliases, input.content ?? "");
      outcome = {
        created: true,
        resolutionRequired: false,
        node: this.getNode(id),
        candidates
      };
    });
    return outcome!;
  }

  updateNode(reference: string | number, input: UpdateNodeInput): KnowledgeNode {
    if (input.title === undefined && input.content === undefined && input.aliases === undefined && input.edits === undefined) {
      throw new Error("Node update requires a title, content, aliases, or exact text edits");
    }
    if (input.content !== undefined && input.edits !== undefined) throw new Error("Use either content or exact text edits in one node update");
    if (input.mode !== undefined && input.edits !== undefined) throw new Error("Update mode cannot be used with exact text edits");
    let updated: KnowledgeNode | undefined;
    this.transaction(() => {
      const current = this.getNode(reference);
      const title = input.title === undefined ? current.title : cleanTitle(input.title);
      const aliases = input.aliases === undefined ? [...current.aliases] : cleanAliases(input.aliases, title);
      if (title !== current.title && !aliases.some((alias) => normalizeIdentity(alias) === normalizeIdentity(current.title))) {
        aliases.push(current.title);
      }
      const normalizedAliases = cleanAliases(aliases, title);
      this.assertIdentityAvailable(
        title,
        normalizedAliases,
        new Set([current.id]),
        new Set([current.title, ...current.aliases].map(normalizeIdentity))
      );
      const mode = input.mode ?? "replace";
      const content = input.edits !== undefined
        ? applyExactTextEdits(current.content, input.edits)
        : input.content === undefined
          ? current.content
        : mode === "append" && input.content.trim().length === 0
          ? current.content
          : mode === "append" && current.content.trim().length > 0
            ? `${current.content.trimEnd()}\n\n${input.content.trimStart()}`
          : input.content;
      if (title === current.title && arraysEqual(normalizedAliases, current.aliases) && content === current.content) {
        updated = current;
        return;
      }
      const now = new Date().toISOString();
      this.db.prepare(
        `UPDATE nodes SET title = ?, normalized_title = ?, aliases_json = ?, content = ?, updated_at = ? WHERE id = ?`
      ).run(title, normalizeIdentity(title), JSON.stringify(normalizedAliases), content, now, current.id);
      this.indexNode(current.id, title, normalizedAliases, content);
      updated = this.getNode(current.id);
    });
    return updated!;
  }

  removeNode(reference: string | number, reasonInput: string): RemoveNodeResult {
    const requestedNumericId = parseNodeId(reference);
    const requestedId = nodePublicId(requestedNumericId);
    const reason = reasonInput.trim();
    if (!reason) throw new Error("Node removal requires a reason");
    if (reason.length > 500) throw new Error("Node removal reason must be at most 500 characters");

    let result: RemoveNodeResult | undefined;
    this.transaction(() => {
      const canonicalId = this.resolveNodeId(requestedNumericId);
      if (canonicalId !== requestedNumericId) {
        throw new Error(`${requestedId} resolves to ${nodePublicId(canonicalId)}; pass the canonical ID explicitly to remove it`);
      }
      const current = this.getNode(canonicalId);
      const removedEdges = this.countWhere(
        "edges",
        "from_node_id = ? OR to_node_id = ?",
        canonicalId,
        canonicalId
      );
      const removedSuggestions = this.countWhere(
        "link_suggestions",
        "from_node_id = ? OR to_node_id = ?",
        canonicalId,
        canonicalId
      );
      const removedRedirects = this.countWhere(
        "node_redirects",
        "destination_node_id = ?",
        canonicalId
      );

      this.db.prepare("DELETE FROM node_fts WHERE node_id = ?").run(canonicalId);
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(canonicalId);
      result = {
        requestedId,
        removed: summarizeNode(current),
        removedEdges,
        removedSuggestions,
        removedRedirects,
        reason
      };
    });
    return result!;
  }

  getNode(reference: string | number): KnowledgeNode {
    const id = this.resolveNodeId(parseNodeId(reference));
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error(`Node ${nodePublicId(id)} was not found`);
    return rowToNode(row);
  }

  getContext(reference: string | number, relationLimitInput = 200): NodeContext {
    const requestedId = nodePublicId(parseNodeId(reference));
    const node = this.getNode(reference);
    const edges = this.getAllEdgeViews();
    const relationLimit = boundedInteger(relationLimitInput, 200, 1, 1000);
    const outgoingAll = edges.filter((edge) => edge.fromId === node.publicId);
    const incomingAll = edges.filter((edge) => edge.toId === node.publicId);
    const supersededBy = incomingAll
      .filter((edge) => edge.type === "supersedes")
      .map((edge) => summarizeNode(this.getNode(edge.fromId)));
    return {
      requestedId,
      resolvedFrom: requestedId === node.publicId ? null : requestedId,
      node,
      outgoing: outgoingAll.slice(0, relationLimit),
      incoming: incomingAll.slice(0, relationLimit),
      outgoingTotal: outgoingAll.length,
      incomingTotal: incomingAll.length,
      relationLimit,
      relationsTruncated: outgoingAll.length > relationLimit || incomingAll.length > relationLimit,
      supersededBy
    };
  }

  inspect(reference: string | number, options: { depth?: number; mapLimit?: number; relationLimit?: number; maxHops?: number; chainLimit?: number } = {}): KnowledgeInspection {
    const context = this.getContext(reference, options.relationLimit ?? 200);
    const suggestionCount = Number((this.db.prepare(
      "SELECT COUNT(*) AS count FROM link_suggestions WHERE status = 'pending' AND (from_node_id = ? OR to_node_id = ?)"
    ).get(context.node.id, context.node.id) as Row).count ?? 0);
    const pendingSuggestions = (this.db.prepare(
      "SELECT * FROM link_suggestions WHERE status = 'pending' AND (from_node_id = ? OR to_node_id = ?) ORDER BY score DESC, id LIMIT 100"
    ).all(context.node.id, context.node.id) as Row[]).map(rowToSuggestion);
    const directRelations = uniqueEdges([...context.outgoing, ...context.incoming]);
    const technicalChains = this.discoverChains(context.node.publicId, options.maxHops ?? 5, options.chainLimit ?? 10);
    return {
      context,
      map: this.map(context.node.publicId, options.depth ?? 2, options.mapLimit ?? 80),
      gaps: this.gaps(context.node.publicId),
      chainMode: "directed_technical",
      technicalRelations: directRelations.filter((edge) => TECHNICAL_CHAIN_RELATIONS.has(edge.type)),
      contextRelations: directRelations.filter((edge) => !TECHNICAL_CHAIN_RELATIONS.has(edge.type)),
      technicalChains,
      chains: technicalChains,
      pendingSuggestions,
      pendingSuggestionCount: suggestionCount,
      pendingSuggestionsTruncated: suggestionCount > pendingSuggestions.length
    };
  }

  listNodes(options: { type?: string; limit?: number; offset?: number } = {}): NodeSummary[] {
    const limit = boundedInteger(options.limit, 50, 1, 500);
    const offset = boundedInteger(options.offset, 0, 0, 1_000_000);
    if (options.type) {
      const type = assertNodeType(this.config, options.type);
      return (this.db.prepare("SELECT * FROM nodes WHERE type = ? ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?").all(type, limit, offset) as Row[])
        .map((row) => summarizeNode(rowToNode(row)));
    }
    return (this.db.prepare("SELECT * FROM nodes ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?").all(limit, offset) as Row[])
      .map((row) => summarizeNode(rowToNode(row)));
  }

  mergeNodes(input: MergeNodesInput): MergeNodesResult {
    if (input.content === undefined || !input.content.trim()) throw new Error("A non-empty reviewed consolidated Markdown body is required for node merge");
    let result: MergeNodesResult | undefined;
    this.transaction(() => {
      const sourceId = this.resolveNodeId(parseNodeId(input.source));
      const destinationId = this.resolveNodeId(parseNodeId(input.into));
      if (sourceId === destinationId) throw new Error("Source and destination resolve to the same canonical node");
      const source = this.getNode(sourceId);
      const destination = this.getNode(destinationId);
      const title = input.title === undefined ? destination.title : cleanTitle(input.title);
      const aliases = cleanAliases([
        ...destination.aliases,
        source.title,
        ...source.aliases,
        ...(input.aliases ?? [])
      ], title);
      this.assertIdentityAvailable(title, aliases, new Set([sourceId, destinationId]), new Set());

      const now = new Date().toISOString();

      let movedEdges = 0;
      let deduplicatedEdges = 0;
      let movedSuggestions = 0;
      let deduplicatedSuggestions = 0;
      let droppedSelfRelations = 0;

      const edgeRows = this.db.prepare(
        "SELECT * FROM edges WHERE from_node_id = ? OR to_node_id = ? ORDER BY id"
      ).all(sourceId, sourceId) as Row[];
      this.db.prepare("DELETE FROM edges WHERE from_node_id = ? OR to_node_id = ?").run(sourceId, sourceId);
      for (const row of edgeRows) {
        let fromId = Number(row.from_node_id) === sourceId ? destinationId : Number(row.from_node_id);
        let toId = Number(row.to_node_id) === sourceId ? destinationId : Number(row.to_node_id);
        const relationType = String(row.type);
        if (fromId === toId) {
          droppedSelfRelations += 1;
          continue;
        }
        if (relationType === "related_to" && fromId > toId) [fromId, toId] = [toId, fromId];
        const existing = this.db.prepare(
          "SELECT id FROM edges WHERE from_node_id = ? AND type = ? AND to_node_id = ?"
        ).get(fromId, relationType, toId) as Row | undefined;
        if (existing) {
          deduplicatedEdges += 1;
          continue;
        }
        this.db.prepare(
          "INSERT INTO edges(from_node_id, type, to_node_id, created_at) VALUES (?, ?, ?, ?)"
        ).run(fromId, relationType, toId, String(row.created_at));
        movedEdges += 1;
      }

      const suggestionRows = this.db.prepare(
        "SELECT * FROM link_suggestions WHERE from_node_id = ? OR to_node_id = ? ORDER BY id"
      ).all(sourceId, sourceId) as Row[];
      this.db.prepare("DELETE FROM link_suggestions WHERE from_node_id = ? OR to_node_id = ?").run(sourceId, sourceId);
      for (const row of suggestionRows) {
        let fromId = Number(row.from_node_id) === sourceId ? destinationId : Number(row.from_node_id);
        let toId = Number(row.to_node_id) === sourceId ? destinationId : Number(row.to_node_id);
        const relationType = String(row.relation_type);
        if (fromId === toId) {
          droppedSelfRelations += 1;
          continue;
        }
        if (relationType === "related_to" && fromId > toId) [fromId, toId] = [toId, fromId];
        const existing = this.db.prepare(
          "SELECT * FROM link_suggestions WHERE from_node_id = ? AND relation_type = ? AND to_node_id = ?"
        ).get(fromId, relationType, toId) as Row | undefined;
        if (existing) {
          const combinedStatus = mergeSuggestionStatus(String(existing.status) as SuggestionStatus, String(row.status) as SuggestionStatus);
          const combinedReasons = [...new Set([...parseStringArray(existing.reasons_json), ...parseStringArray(row.reasons_json)])];
          const reviewedAt = combinedStatus === "pending"
            ? null
            : latestTimestamp(existing.reviewed_at, row.reviewed_at);
          this.db.prepare(
            "UPDATE link_suggestions SET score = ?, reasons_json = ?, status = ?, reviewed_at = ? WHERE id = ?"
          ).run(
            Math.max(Number(existing.score), Number(row.score)),
            JSON.stringify(combinedReasons),
            combinedStatus,
            reviewedAt,
            Number(existing.id)
          );
          deduplicatedSuggestions += 1;
          continue;
        }
        this.db.prepare(`
          INSERT INTO link_suggestions(
            from_node_id, relation_type, to_node_id, score, reasons_json, status, created_at, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fromId,
          relationType,
          toId,
          Number(row.score),
          String(row.reasons_json),
          String(row.status),
          String(row.created_at),
          row.reviewed_at ?? null
        );
        movedSuggestions += 1;
      }

      this.db.prepare("UPDATE node_redirects SET destination_node_id = ? WHERE destination_node_id = ?")
        .run(destinationId, sourceId);
      this.db.prepare(
        "UPDATE nodes SET title = ?, normalized_title = ?, aliases_json = ?, content = ?, updated_at = ? WHERE id = ?"
      ).run(title, normalizeIdentity(title), JSON.stringify(aliases), input.content, now, destinationId);
      this.indexNode(destinationId, title, aliases, input.content);
      this.db.prepare("DELETE FROM node_fts WHERE node_id = ?").run(sourceId);
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(sourceId);
      this.db.prepare(
        "INSERT INTO node_redirects(source_id, destination_node_id, merged_at) VALUES (?, ?, ?)"
      ).run(sourceId, destinationId, now);

      result = {
        source,
        canonical: this.getNode(destinationId),
        redirectedFrom: nodePublicId(sourceId),
        movedEdges,
        deduplicatedEdges,
        movedSuggestions,
        deduplicatedSuggestions,
        droppedSelfRelations
      };
    });
    return result!;
  }

  snapshot(): KnowledgeSnapshot {
    return this.transaction(() => ({
      nodes: this.allNodes(),
      edges: this.getAllEdgeViews()
    }));
  }

  resolveIdentity(typeInput: string, titleInput: string, aliasesInput: string[] = [], limit = 10, contentInput = ""): IdentityCandidate[] {
    const type = assertNodeType(this.config, typeInput);
    const title = cleanTitle(titleInput);
    const aliases = cleanAliases(aliasesInput, title);
    const queryNames = [title, ...aliases];
    const queryText = `${queryNames.join(" ")} ${contentInput}`;
    const queryTerms = meaningfulTerms(queryText);
    const queryIdentifiers = extractIdentifiers(queryText);
    const nodes = this.allNodes();
    const candidates: IdentityCandidate[] = [];
    for (const node of nodes) {
      let score = 0;
      const reasons: string[] = [];
      const nodeNames = [node.title, ...node.aliases];
      for (const queryName of queryNames) {
        for (const nodeName of nodeNames) {
          const rawIdentityScore = identitySimilarity(queryName, nodeName);
          const identityScore = node.type === type
            ? rawIdentityScore
            : rawIdentityScore >= 0.999
              ? 0.98
              : rawIdentityScore * 0.85;
          if (identityScore > score) score = identityScore;
          if (rawIdentityScore >= 0.999) {
            reasons.push(node.type === type
              ? `exact identity match: ${nodeName}`
              : `exact identity already exists as ${node.type}: ${nodeName}`);
          }
        }
      }
      const nodeText = `${node.title} ${node.aliases.join(" ")} ${node.content}`;
      const sharedIdentifiers = intersection(queryIdentifiers, extractIdentifiers(nodeText));
      if (sharedIdentifiers.length > 0) {
        const identifierScore = Math.min(node.type === type ? 0.9 : 0.84, 0.64 + sharedIdentifiers.length * 0.07);
        score = Math.max(score, identifierScore);
        reasons.push(`shared identifier: ${sharedIdentifiers.slice(0, 3).join(", ")}`);
      }
      const contentOverlap = jaccard(queryTerms, meaningfulTerms(nodeText));
      if (contentInput.trim() && contentOverlap >= 0.18) {
        score = Math.max(score, Math.min(node.type === type ? 0.76 : 0.72, 0.35 + contentOverlap * 0.5));
        reasons.push("overlapping concepts in proposed note content");
      }
      if (score >= 0.45) {
        if (reasons.length === 0) reasons.push("similar title or alias");
        candidates.push({ node: summarizeNode(node), score: roundScore(score), reasons: [...new Set(reasons)] });
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.node.publicId.localeCompare(b.node.publicId)).slice(0, boundedInteger(limit, 10, 1, 100));
  }

  search(queryInput: string, options: { type?: string; limit?: number; depth?: number } = {}): SearchHit[] {
    const query = queryInput.trim();
    if (!query) throw new Error("Search query cannot be empty");
    const type = options.type ? assertNodeType(this.config, options.type) : undefined;
    const limit = boundedInteger(options.limit, 20, 1, 100);
    const depth = boundedInteger(options.depth, 1, 0, 3);
    const ftsIds = this.ftsMatches(query, Math.max(50, limit * 4));
    const queryTerms = meaningfulTerms(query);
    const queryIdentifiers = extractIdentifiers(query);
    const seeds: SearchHit[] = [];
    for (const node of this.allNodes()) {
      if (type && node.type !== type) continue;
      const reasons: string[] = [];
      const titleIdentity = identitySimilarity(query, node.title);
      const bodyTerms = meaningfulTerms(`${node.title} ${node.aliases.join(" ")} ${node.content}`);
      const termScore = jaccard(queryTerms, bodyTerms);
      const sharedIdentifiers = intersection(queryIdentifiers, extractIdentifiers(`${node.title} ${node.aliases.join(" ")} ${node.content}`));
      const ftsRank = ftsIds.get(node.id);
      let score = Math.max(titleIdentity * 0.95, termScore * 0.75);
      if (ftsRank !== undefined) {
        score = Math.max(score, 0.64 + Math.max(0, 0.16 - ftsRank * 0.01));
        reasons.push("full-text match");
      }
      if (titleIdentity >= 0.6) reasons.push("title or alias proximity");
      if (sharedIdentifiers.length > 0) {
        score = Math.max(score, Math.min(0.96, 0.78 + sharedIdentifiers.length * 0.05));
        reasons.push(`shared identifier: ${sharedIdentifiers.slice(0, 3).join(", ")}`);
      }
      if (score >= 0.12) {
        seeds.push({ node: summarizeNode(node), score: roundScore(score), matchReasons: [...new Set(reasons.length ? reasons : ["content overlap"])], distance: 0 });
      }
    }
    seeds.sort((a, b) => b.score - a.score || b.node.updatedAt.localeCompare(a.node.updatedAt));
    if (depth === 0) return seeds.slice(0, limit);

    const result = new Map<string, SearchHit>();
    const edges = this.getAllEdgeViews();
    const nodeById = new Map(this.allNodes().map((node) => [node.publicId, node]));
    const queue: Array<{ id: string; distance: number; seedScore: number }> = [];
    for (const seed of seeds.slice(0, Math.min(limit, 8))) {
      result.set(seed.node.publicId, seed);
      queue.push({ id: seed.node.publicId, distance: 0, seedScore: seed.score });
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.distance >= depth) continue;
      for (const edge of edges) {
        let neighborId: string | null = null;
        if (edge.fromId === current.id) neighborId = edge.toId;
        else if (edge.toId === current.id) neighborId = edge.fromId;
        if (!neighborId) continue;
        const distance = current.distance + 1;
        const node = nodeById.get(neighborId);
        if (!node || (type && node.type !== type)) continue;
        const candidate: SearchHit = {
          node: summarizeNode(node),
          score: roundScore(current.seedScore * Math.pow(0.62, distance)),
          matchReasons: [`graph neighbor through ${edge.type}`],
          distance,
          via: { fromId: current.id, edgeType: edge.type }
        };
        const previous = result.get(neighborId);
        if (!previous || candidate.score > previous.score) result.set(neighborId, candidate);
        if (!previous || distance < previous.distance) queue.push({ id: neighborId, distance, seedScore: current.seedScore });
      }
    }
    return [...result.values()].sort((a, b) => b.score - a.score || a.distance - b.distance).slice(0, limit);
  }

  addEdge(fromReference: string | number, typeInput: string, toReference: string | number): KnowledgeEdge {
    let fromId = this.resolveNodeId(parseNodeId(fromReference));
    let toId = this.resolveNodeId(parseNodeId(toReference));
    const type = assertRelationType(this.config, typeInput);
    this.getNode(fromId);
    this.getNode(toId);
    if (fromId === toId) throw new Error("A node cannot link to itself");
    if (type === "related_to" && fromId > toId) [fromId, toId] = [toId, fromId];
    return this.transaction(() => this.addEdgeInternal(fromId, type, toId));
  }

  private addEdgeInternal(fromId: number, type: string, toId: number): KnowledgeEdge {
    const existing = this.db.prepare("SELECT * FROM edges WHERE from_node_id = ? AND type = ? AND to_node_id = ?").get(fromId, type, toId) as Row | undefined;
    if (existing) return rowToEdge(existing);
    const now = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO edges(from_node_id, type, to_node_id, created_at) VALUES (?, ?, ?, ?)").run(fromId, type, toId, now);
    return rowToEdge(this.db.prepare("SELECT * FROM edges WHERE id = ?").get(Number(result.lastInsertRowid)) as Row);
  }

  removeEdge(reference: string | number): KnowledgeEdge {
    const id = parsePrefixedId(reference, "E");
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as Row | undefined;
      if (!row) throw new Error(`Edge ${edgePublicId(id)} was not found`);
      this.db.prepare("DELETE FROM edges WHERE id = ?").run(id);
      return rowToEdge(row);
    });
  }

  map(reference: string | number, depthInput = 2, limitInput = 80): GraphMap {
    const root = this.getNode(reference);
    const depth = boundedInteger(depthInput, 2, 0, 5);
    const nodeLimit = boundedInteger(limitInput, 80, 1, 500);
    const edges = this.getAllEdgeViews();
    const allNodes = new Map(this.allNodes().map((node) => [node.publicId, node]));
    const distance = new Map<string, number>([[root.publicId, 0]]);
    const queue = [root.publicId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = distance.get(current)!;
      if (currentDepth >= depth) continue;
      for (const edge of edges) {
        const neighbor = edge.fromId === current ? edge.toId : edge.toId === current ? edge.fromId : null;
        if (!neighbor || distance.has(neighbor) || distance.size >= nodeLimit) continue;
        distance.set(neighbor, currentDepth + 1);
        queue.push(neighbor);
      }
    }
    const included = new Set(distance.keys());
    const frontier = new Set<string>();
    for (const edge of edges) {
      const fromIncluded = included.has(edge.fromId);
      const toIncluded = included.has(edge.toId);
      if (fromIncluded === toIncluded) continue;
      const inside = fromIncluded ? edge.fromId : edge.toId;
      const outside = fromIncluded ? edge.toId : edge.fromId;
      if ((distance.get(inside) ?? depth) < depth) frontier.add(outside);
    }
    const edgeLimit = Math.min(4_000, Math.max(80, nodeLimit * 8));
    const internalEdges = edges
      .filter((edge) => included.has(edge.fromId) && included.has(edge.toId))
      .sort((left, right) => {
        const leftDistance = Math.min(distance.get(left.fromId) ?? depth, distance.get(left.toId) ?? depth);
        const rightDistance = Math.min(distance.get(right.fromId) ?? depth, distance.get(right.toId) ?? depth);
        return leftDistance - rightDistance || left.id - right.id;
      });
    return {
      root,
      nodes: [...included].map((id) => summarizeNode(allNodes.get(id)!)).sort((a, b) => (distance.get(a.publicId)! - distance.get(b.publicId)!) || a.publicId.localeCompare(b.publicId)),
      edges: internalEdges.slice(0, edgeLimit),
      depth,
      nodeLimit,
      truncated: frontier.size > 0 || internalEdges.length > edgeLimit,
      frontierNodeIds: [...frontier].sort().slice(0, 50),
      omittedNeighborCount: frontier.size,
      omittedEdgeCount: Math.max(0, internalEdges.length - edgeLimit)
    };
  }

  discoverChains(reference: string | number, maxHopsInput = 5, limitInput = 20): ChainPath[] {
    const start = this.getNode(reference);
    const maxHops = boundedInteger(maxHopsInput, 5, 1, 7);
    const limit = boundedInteger(limitInput, 20, 1, 100);
    const edges = this.getAllEdgeViews();
    const nodes = new Map(this.allNodes().map((node) => [node.publicId, node]));
    const adjacency = new Map<string, Array<{ nodeId: string; edge: EdgeView; technical: boolean }>>();
    for (const edge of edges) {
      if (TECHNICAL_CHAIN_RELATIONS.has(edge.type)) {
        pushChainAdjacency(adjacency, edge.fromId, edge.toId, edge, true);
      } else if (start.type === "hypothesis" && edge.type === "depends_on" && edge.fromId === start.publicId) {
        pushChainAdjacency(adjacency, edge.fromId, edge.toId, edge, false);
      }
    }
    const results: ChainPath[] = [];
    const queue: Array<{ ids: string[]; pathEdges: EdgeView[]; technicalEdges: number }> = [{ ids: [start.publicId], pathEdges: [], technicalEdges: 0 }];
    let explored = 0;
    while (queue.length > 0 && explored < 10_000 && results.length < limit) {
      explored += 1;
      const current = queue.shift()!;
      const last = current.ids[current.ids.length - 1];
      const hops = current.pathEdges.length;
      if (hops > 0 && current.technicalEdges > 0 && nodes.get(last)?.type === "sink") {
        const pathNodes = current.ids.map((id) => summarizeNode(nodes.get(id)!));
        results.push({
          nodes: pathNodes,
          edges: current.pathEdges,
          hopCount: hops,
          oldestAgeDays: Math.max(...pathNodes.map((node) => node.ageDays))
        });
        continue;
      }
      if (hops >= maxHops) continue;
      for (const neighbor of adjacency.get(last) ?? []) {
        if (current.ids.includes(neighbor.nodeId)) continue;
        if (!neighbor.technical && hops > 0) continue;
        const neighborNode = nodes.get(neighbor.nodeId);
        if (!neighborNode || (neighborNode.type !== "sink" && CHAIN_EXCLUDED_NODE_TYPES.has(neighborNode.type))) continue;
        queue.push({
          ids: [...current.ids, neighbor.nodeId],
          pathEdges: [...current.pathEdges, neighbor.edge],
          technicalEdges: current.technicalEdges + (neighbor.technical ? 1 : 0)
        });
      }
    }
    return results.sort((a, b) => a.hopCount - b.hopCount || a.oldestAgeDays - b.oldestAgeDays);
  }

  suggestLinks(reference: string | number, limitInput = 10): Array<LinkSuggestion & { from: NodeSummary; to: NodeSummary }> {
    const source = this.getNode(reference);
    const limit = boundedInteger(limitInput, 10, 1, 50);
    const edges = this.getAllEdgeViews();
    const connected = new Set<string>();
    for (const edge of edges) {
      if (edge.fromId === source.publicId) connected.add(edge.toId);
      if (edge.toId === source.publicId) connected.add(edge.fromId);
    }
    const sourceTerms = meaningfulTerms(`${source.title} ${source.aliases.join(" ")} ${source.content}`);
    const sourceIdentifiers = extractIdentifiers(`${source.title} ${source.aliases.join(" ")} ${source.content}`);
    const sourceNeighbors = neighborIds(source.publicId, edges);
    const candidates: Array<{ node: KnowledgeNode; score: number; reasons: string[] }> = [];
    for (const node of this.allNodes()) {
      if (node.id === source.id || connected.has(node.publicId)) continue;
      const reasons: string[] = [];
      const sharedIdentifiers = intersection(sourceIdentifiers, extractIdentifiers(`${node.title} ${node.aliases.join(" ")} ${node.content}`));
      const termOverlap = jaccard(sourceTerms, meaningfulTerms(`${node.title} ${node.aliases.join(" ")} ${node.content}`));
      const commonNeighbors = intersection(sourceNeighbors, neighborIds(node.publicId, edges));
      let score = termOverlap * 0.5;
      if (sharedIdentifiers.length > 0) {
        score += Math.min(0.55, 0.28 + sharedIdentifiers.length * 0.09);
        reasons.push(`shared identifier: ${sharedIdentifiers.slice(0, 4).join(", ")}`);
      }
      if (termOverlap >= 0.12) reasons.push("overlapping concepts in note content");
      if (commonNeighbors.length > 0) {
        score += Math.min(0.35, commonNeighbors.length * 0.14);
        reasons.push(`shared graph neighbor: ${commonNeighbors.slice(0, 3).join(", ")}`);
      }
      if (source.type === "sink" && node.type === "sink" && (sharedIdentifiers.length > 0 || commonNeighbors.length > 0)) {
        score += 0.08;
        reasons.push("two sinks may act as gadgets in one path");
      }
      if (score >= 0.2) candidates.push({ node, score: Math.min(1, score), reasons });
    }
    candidates.sort((a, b) => b.score - a.score || a.node.publicId.localeCompare(b.node.publicId));
    const output: Array<LinkSuggestion & { from: NodeSummary; to: NodeSummary }> = [];
    for (const candidate of candidates.slice(0, limit)) {
      const suggestion = this.upsertSuggestion(source.id, candidate.node.id, "related_to", candidate.score, candidate.reasons);
      output.push({
        ...suggestion,
        from: summarizeNode(this.getNode(suggestion.fromId)),
        to: summarizeNode(this.getNode(suggestion.toId))
      });
    }
    return output;
  }

  reviewSuggestion(reference: string | number, action: "accept" | "reject", relationType?: string): LinkSuggestion & { edge?: KnowledgeEdge } {
    const id = parsePrefixedId(reference, "L");
    const acceptedRelation = action === "accept"
      ? assertRelationType(this.config, relationType ?? this.getSuggestion(id).relationType)
      : undefined;
    return this.transaction(() => {
      const suggestion = this.getSuggestion(id);
      if (suggestion.status !== "pending") throw new Error(`Suggestion ${suggestion.publicId} is already ${suggestion.status}`);
      const reviewedAt = new Date().toISOString();
      if (action === "reject") {
        this.db.prepare("UPDATE link_suggestions SET status = 'rejected', reviewed_at = ? WHERE id = ?").run(reviewedAt, id);
        return this.getSuggestion(id);
      }

      let fromId = parseNodeId(suggestion.fromId);
      let toId = parseNodeId(suggestion.toId);
      if (acceptedRelation === "related_to" && fromId > toId) [fromId, toId] = [toId, fromId];
      const edge = this.addEdgeInternal(fromId, acceptedRelation!, toId);
      this.db.prepare("UPDATE link_suggestions SET status = 'accepted', relation_type = ?, reviewed_at = ? WHERE id = ?")
        .run(acceptedRelation, reviewedAt, id);
      return { ...this.getSuggestion(id), edge };
    });
  }

  listSuggestions(status: SuggestionStatus = "pending", limitInput = 50): LinkSuggestion[] {
    const limit = boundedInteger(limitInput, 50, 1, 500);
    return (this.db.prepare("SELECT * FROM link_suggestions WHERE status = ? ORDER BY score DESC, id LIMIT ?").all(status, limit) as Row[])
      .map(rowToSuggestion);
  }

  gaps(reference?: string | number, ageDaysInput?: number): KnowledgeGap[] {
    const ageThreshold = boundedInteger(ageDaysInput, this.config.ageNoticeDays, 1, 100_000);
    const nodeList = this.allNodes();
    const nodes = reference === undefined
      ? nodeList.filter((node) => node.type === "sink" || node.type === "hypothesis" || node.type === "behavior")
      : [this.getNode(reference)];
    const edges = this.getAllEdgeViews();
    const allNodes = new Map(nodeList.map((node) => [node.publicId, node]));
    const pending = this.listSuggestions("pending", 500);
    const gaps: KnowledgeGap[] = [];
    for (const node of nodes) {
      const relatedEdges = edges.filter((edge) => edge.fromId === node.publicId || edge.toId === node.publicId);
      const directNeighbors = relatedEdges.map((edge) => edge.fromId === node.publicId ? edge.toId : edge.fromId);
      if (relatedEdges.length === 0) {
        gaps.push(gap("isolated_node", node, "This node has no graph relations.", []));
      }
      if (node.ageDays >= ageThreshold) {
        gaps.push(gap("old_knowledge", node, `This note was updated ${node.ageDays} days ago and may need comparison with the current target.`, []));
        const newerNeighbors = directNeighbors.filter((id) => {
          const neighbor = allNodes.get(id);
          return neighbor && neighbor.updatedAt > node.updatedAt && neighbor.ageDays < ageThreshold;
        });
        if (newerNeighbors.length > 0) {
          gaps.push(gap("old_note_next_to_new_knowledge", node, "Newer adjacent knowledge may have changed this note's premises.", newerNeighbors));
        }
      }
      const superseding = edges.filter((edge) => edge.type === "supersedes" && edge.toId === node.publicId);
      if (superseding.length > 0) {
        gaps.push(gap("superseded_knowledge", node, "Newer knowledge explicitly supersedes this node.", superseding.map((edge) => edge.fromId)));
      }
      if (node.type === "sink") {
        const testNodes = relatedEdges
          .filter((edge) => edge.type === "tests" && edge.toId === node.publicId && allNodes.get(edge.fromId)?.type === "test")
          .map((edge) => edge.fromId);
        if (testNodes.length === 0) gaps.push(gap("sink_without_test", node, "No test node is linked to this sink.", []));
        const flowNeighbors = relatedEdges.filter((edge) => ["flows_to", "produces", "consumes", "reads", "writes", "calls", "influences"].includes(edge.type));
        if (flowNeighbors.length === 0) gaps.push(gap("sink_without_flow_context", node, "No data, state, producer, consumer, or call-flow relation is linked to this sink.", []));
        const upstreamIds = [...new Set(edges
          .filter((edge) => edge.toId === node.publicId && ["flows_to", "produces", "writes", "calls", "transforms", "influences"].includes(edge.type))
          .map((edge) => edge.fromId))];
        if (testNodes.length > 0 && upstreamIds.length > 1) {
          const testedTargets = new Set(testNodes.flatMap((testId) => testTargetIds(testId, edges, allNodes)));
          const uncovered = upstreamIds.filter((id) => !testedTargets.has(id));
          if (uncovered.length > 0) {
            gaps.push(gap(
              "partial_sink_path_coverage",
              node,
              `${testNodes.length} linked test(s) cover ${upstreamIds.length - uncovered.length} of ${upstreamIds.length} direct input paths recorded for this sink.`,
              uncovered
            ));
          }
        }
        if (upstreamIds.length > 1) {
          const boundaryNodes = nodeList.filter((candidate) => candidate.type === "boundary");
          for (const boundary of boundaryNodes) {
            const covered = upstreamIds.filter((producerId) => edges.some((edge) =>
              ["crosses", "influences", "contains"].includes(edge.type)
              && ((edge.fromId === producerId && edge.toId === boundary.publicId) || (edge.toId === producerId && edge.fromId === boundary.publicId))
            ));
            if (covered.length > 0 && covered.length < upstreamIds.length) {
              const uncovered = upstreamIds.filter((id) => !covered.includes(id));
              gaps.push(gap(
                "conditional_boundary_coverage",
                node,
                `${boundary.publicId} is linked to ${covered.length} of ${upstreamIds.length} direct input paths. The graph does not establish equivalent coverage for the rest.`,
                [boundary.publicId, ...uncovered]
              ));
            }
          }
        }
        if (!hasNodeTypeWithinRelations(node.publicId, "principal", 2, edges, allNodes, SINK_CONTEXT_RELATIONS)) {
          gaps.push(gap("sink_without_authority_context", node, "No principal is recorded within two graph edges of this sink.", []));
        }
        if (!hasNodeTypeWithinRelations(node.publicId, "state", 2, edges, allNodes, SINK_CONTEXT_RELATIONS)) {
          gaps.push(gap("sink_without_state_context", node, "No state or lifecycle node is recorded within two graph edges of this sink.", []));
        }
        const nearbyBoundaries = nodeIdsOfTypeWithinRelations(node.publicId, "boundary", 2, edges, allNodes, SINK_CONTEXT_RELATIONS);
        const applicableGuarantees = edges.filter((edge) => {
          if (edge.type !== "guards" || allNodes.get(edge.fromId)?.type !== "guarantee") return false;
          return edge.toId === node.publicId || nearbyBoundaries.includes(edge.toId);
        });
        if (nearbyBoundaries.length > 0 && applicableGuarantees.length === 0) {
          gaps.push(gap("boundary_without_guarantee_context", node, "A nearby boundary is recorded, but no guarantee explicitly guards this sink or that boundary.", nearbyBoundaries));
        }
        const chain = this.discoverChains(node.publicId, 4, 3)[0];
        if (chain) {
          gaps.push(gap("related_sink_path", node, `Another sink is reachable through ${chain.hopCount} graph edges. Inspect the path for gadget composition.`, [chain.nodes[chain.nodes.length - 1].publicId]));
        }
      }
      if (node.type === "behavior") {
        const downstreamSinkIds = [...new Set(this.discoverChains(node.publicId, 5, 20)
          .map((chain) => chain.nodes.at(-1)?.publicId)
          .filter((id): id is string => Boolean(id)))];
        const untestedSinkIds = downstreamSinkIds.filter((sinkId) => !hasTestTarget(sinkId, edges, allNodes));
        if (untestedSinkIds.length > 0) {
          gaps.push(gap(
            "behavior_reaches_untested_sink",
            node,
            "This behavior has a recorded technical path to sink(s) with no exact test relation. Test the downstream effect before extending a result from the behavior alone.",
            untestedSinkIds
          ));
        }
      }
      if (node.type === "hypothesis") {
        const conclusionEdges = relatedEdges.filter((edge) => edge.type === "supports" || edge.type === "refutes");
        if (conclusionEdges.length === 0) gaps.push(gap("hypothesis_without_evidence_relation", node, "No supporting or refuting relation is linked to this hypothesis.", []));
        const supportEdges = conclusionEdges.filter((edge) => edge.type === "supports");
        const refuteEdges = conclusionEdges.filter((edge) => edge.type === "refutes");
        const premiseIds = [...new Set(edges
          .filter((edge) => edge.fromId === node.publicId && edge.type === "depends_on")
          .map((edge) => edge.toId))];
        if (premiseIds.length === 0) {
          gaps.push(gap("hypothesis_without_premise_relation", node, "No explicit premise is linked with depends_on. Record decisive premises that must survive for this hypothesis to hold.", []));
        }
        const technicalChains = this.discoverChains(node.publicId, 6, 20);
        if (premiseIds.length > 0 && technicalChains.length === 0) {
          gaps.push(gap(
            "hypothesis_without_technical_sink_path",
            node,
            "The recorded premises do not form a directed technical path to a sink. Check relation direction and missing data, state, boundary, or execution links.",
            premiseIds
          ));
        }
        if (technicalChains.length > 0) {
          if (!hasNodeTypeWithinRelations(node.publicId, "principal", 3, edges, allNodes, HYPOTHESIS_CONTEXT_RELATIONS)
            && !hasNodeTypeWithinRelations(node.publicId, "boundary", 3, edges, allNodes, HYPOTHESIS_CONTEXT_RELATIONS)) {
            gaps.push(gap("hypothesis_without_authority_context", node, "No principal or boundary is connected through the hypothesis's technical context. Confirm whether authority changes the result.", []));
          }
          if (!hasNodeTypeWithinRelations(node.publicId, "state", 3, edges, allNodes, HYPOTHESIS_CONTEXT_RELATIONS)) {
            gaps.push(gap("hypothesis_without_state_context", node, "No state or lifecycle node is connected through the hypothesis's technical context. Confirm whether order, retries, caches, or lifetime matter.", []));
          }
        }
        const evidenceIds = [...new Set(conclusionEdges.map((edge) => edge.fromId === node.publicId ? edge.toId : edge.fromId))];
        const terminalSinkIds = [...new Set(technicalChains
          .map((chain) => chain.nodes.at(-1)?.publicId)
          .filter((id): id is string => Boolean(id)))];
        const evidenceGroups = [
          { label: "supporting", edges: supportEdges },
          { label: "refuting", edges: refuteEdges }
        ];
        for (const group of evidenceGroups) {
          const groupEvidenceIds = [...new Set(group.edges.map((edge) => edge.fromId === node.publicId ? edge.toId : edge.fromId))];
          const groupTestIds = groupEvidenceIds.filter((id) => allNodes.get(id)?.type === "test");
          if (groupTestIds.length === 0) continue;
          const testedTargets = new Set(groupTestIds.flatMap((testId) => testTargetIds(testId, edges, allNodes)));
          if (premiseIds.length > 0) {
            const uncoveredPremises = premiseIds.filter((id) => !testedTargets.has(id));
            if (uncoveredPremises.length > 0) {
              gaps.push(gap(
                "hypothesis_partial_premise_coverage",
                node,
                `The ${group.label} test set does not target every recorded premise. Keep that conclusion scoped to the tested items.`,
                [...uncoveredPremises, ...groupTestIds]
              ));
            }
          }
          const untestedTerminalSinks = terminalSinkIds.filter((id) => !testedTargets.has(id));
          if (untestedTerminalSinks.length > 0) {
            gaps.push(gap(
              "hypothesis_evidence_stops_before_sink",
              node,
              `The ${group.label} test set covers a premise or intermediate item but not every terminal sink in the recorded technical path.`,
              [...untestedTerminalSinks, ...groupTestIds]
            ));
          }
        }
        if (evidenceIds.length > 0 && evidenceIds.every((id) => allNodes.get(id)?.type === "intel")) {
          gaps.push(gap(
            "hypothesis_conclusion_only_from_intel",
            node,
            "Every supporting or refuting relation points to intel. Add target-specific observation or testing before treating the conclusion as current.",
            evidenceIds
          ));
        }
        const legacyHypothesisIds = edges
          .filter((edge) => edge.fromId === node.publicId && edge.type === "derived_from" && allNodes.get(edge.toId)?.type === "hypothesis")
          .map((edge) => edge.toId);
        for (const legacyId of legacyHypothesisIds) {
          const legacyWasRefuted = edges.some((edge) => edge.type === "refutes" && (edge.fromId === legacyId || edge.toId === legacyId));
          const explicitRevision = edges.some((edge) =>
            (edge.type === "supersedes" && edge.fromId === node.publicId && edge.toId === legacyId)
            || (edge.type === "refutes" && edge.toId === legacyId && (edge.fromId === node.publicId || evidenceIds.includes(edge.fromId)))
          );
          if (legacyWasRefuted && !explicitRevision) {
            gaps.push(gap(
              "reopened_hypothesis_without_change_relation",
              node,
              "This hypothesis derives from a previously refuted hypothesis without an explicit refutes or supersedes relation explaining what changed.",
              [legacyId]
            ));
          }
        }
        if (supportEdges.length > 0 && refuteEdges.length > 0) {
          gaps.push(gap(
            "mixed_hypothesis_evidence",
            node,
            "The hypothesis has both supporting and refuting relations. Reconcile their scope instead of treating either as a global verdict.",
            conclusionEdges.map((edge) => edge.fromId === node.publicId ? edge.toId : edge.fromId)
          ));
        }
        for (const refuteEdge of refuteEdges) {
          const evidenceId = refuteEdge.fromId === node.publicId ? refuteEdge.toId : refuteEdge.fromId;
          if (allNodes.get(evidenceId)?.type !== "test") continue;
          const testedTargets = testTargetIds(evidenceId, edges, allNodes);
          for (const sinkId of testedTargets.filter((id) => allNodes.get(id)?.type === "sink")) {
            const upstreamIds = [...new Set(edges
              .filter((edge) => edge.toId === sinkId && ["flows_to", "produces", "writes", "calls", "transforms", "influences"].includes(edge.type))
              .map((edge) => edge.fromId))];
            const testScope = new Set(testedTargets);
            const uncovered = upstreamIds.filter((id) => !testScope.has(id));
            if (upstreamIds.length > 1 && uncovered.length > 0) {
              gaps.push(gap(
                "refutation_with_partial_path_coverage",
                node,
                `${evidenceId} refutes this hypothesis but does not link to every recorded input path of ${sinkId}. Keep the conclusion scoped to the tested path.`,
                [sinkId, ...uncovered]
              ));
            }
          }
        }
        if (refuteEdges.length > 0) {
          const latestRefute = Math.max(...refuteEdges.map((edge) => Date.parse(edge.createdAt)));
          const focusIds = new Set(directNeighbors);
          for (const edge of refuteEdges) {
            const evidenceId = edge.fromId === node.publicId ? edge.toId : edge.fromId;
            for (const testedTargetId of testTargetIds(evidenceId, edges, allNodes)) focusIds.add(testedTargetId);
          }
          const newerRelations = edges.filter((edge) => {
            if (!REFUTATION_RECHECK_RELATIONS.has(edge.type)) return false;
            return Date.parse(edge.createdAt) > latestRefute && (focusIds.has(edge.fromId) || focusIds.has(edge.toId));
          });
          if (newerRelations.length > 0) {
            gaps.push(gap(
              "new_relation_after_refutation",
              node,
              "Relations added after the latest refuting evidence may change the scope or premises of the earlier conclusion.",
              newerRelations.flatMap((edge) => [edge.fromId, edge.toId])
            ));
          }
          const affectedIds = new Set(focusIds);
          for (const focusId of focusIds) {
            for (const adjacentId of neighborIds(focusId, edges)) affectedIds.add(adjacentId);
          }
          const changedKnowledge = [...affectedIds].filter((id) => {
            if (id === node.publicId) return false;
            const candidate = allNodes.get(id);
            return candidate !== undefined
              && !CONTEXT_ONLY_NODE_TYPES.has(candidate.type)
              && Date.parse(candidate.createdAt) <= latestRefute
              && Date.parse(candidate.updatedAt) > latestRefute;
          });
          if (changedKnowledge.length > 0) {
            gaps.push(gap(
              "linked_knowledge_updated_after_refutation",
              node,
              "Knowledge within the refuted path changed after the latest refuting evidence. Recheck which premises and paths the old conclusion still covers.",
              changedKnowledge
            ));
          }
        }
      }
      const nodeSuggestions = pending.filter((suggestion) => suggestion.fromId === node.publicId || suggestion.toId === node.publicId);
      if (nodeSuggestions.length > 0) {
        gaps.push(gap("pending_relation_suggestion", node, `${nodeSuggestions.length} possible relation(s) await review.`, nodeSuggestions.map((suggestion) => suggestion.fromId === node.publicId ? suggestion.toId : suggestion.fromId)));
      }
    }
    return uniqueGaps(gaps);
  }

  stale(ageDaysInput?: number, limitInput = 100): NodeSummary[] {
    const threshold = boundedInteger(ageDaysInput, this.config.ageNoticeDays, 1, 100_000);
    const limit = boundedInteger(limitInput, 100, 1, 1000);
    return this.allNodes().filter((node) => node.ageDays >= threshold).sort((a, b) => b.ageDays - a.ageDays).slice(0, limit).map(summarizeNode);
  }

  getAllEdgeViews(): EdgeView[] {
    return (this.db.prepare(
      `SELECT e.*, f.title AS from_title, f.type AS from_type, t.title AS to_title, t.type AS to_type
       FROM edges e
       JOIN nodes f ON f.id = e.from_node_id
       JOIN nodes t ON t.id = e.to_node_id
       ORDER BY e.id`
    ).all() as Row[]).map(rowToEdgeView);
  }

  private configure(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 120000");
  }

  private migrate(): void {
    this.transaction(() => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(type, normalized_title)
      );

      CREATE TABLE IF NOT EXISTS node_redirects (
        source_id INTEGER PRIMARY KEY,
        destination_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        merged_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        to_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(from_node_id, type, to_node_id),
        CHECK(from_node_id <> to_node_id)
      );

      CREATE TABLE IF NOT EXISTS link_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        to_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        score REAL NOT NULL,
        reasons_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        UNIQUE(from_node_id, relation_type, to_node_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
        node_id UNINDEXED,
        title,
        aliases,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_node_redirects_destination ON node_redirects(destination_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
      CREATE INDEX IF NOT EXISTS idx_suggestions_status ON link_suggestions(status, score DESC);
      `);
      this.db.exec("DROP TABLE IF EXISTS node_revisions");
      this.db.prepare(`
        INSERT INTO metadata(key, value) VALUES ('schema_version', '3')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        WHERE metadata.value <> excluded.value
      `).run();
    });
  }

  private metadata(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  private countWhere(table: string, where: string, ...params: unknown[]): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params) as Row;
    return Number(row.count ?? 0);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private indexNode(id: number, title: string, aliases: string[], content: string): void {
    this.db.prepare("DELETE FROM node_fts WHERE node_id = ?").run(id);
    this.db.prepare("INSERT INTO node_fts(node_id, title, aliases, content) VALUES (?, ?, ?, ?)").run(id, title, aliases.join(" "), content);
  }

  private allNodes(): KnowledgeNode[] {
    return (this.db.prepare("SELECT * FROM nodes ORDER BY id").all() as Row[]).map(rowToNode);
  }

  private assertIdentityAvailable(title: string, aliases: string[], exceptIds: Set<number>, existingIdentityKeys: Set<string>): void {
    for (const node of this.allNodes()) {
      if (exceptIds.has(node.id)) continue;
      const names = [node.title, ...node.aliases].map(normalizeIdentity);
      for (const candidate of [title, ...aliases].map(normalizeIdentity)) {
        if (existingIdentityKeys.has(candidate)) continue;
        if (names.includes(candidate)) throw new Error(`Identity '${candidate}' already belongs to ${node.publicId} (${node.type}) ${node.title}`);
      }
    }
  }

  private ftsMatches(query: string, limit: number): Map<number, number> {
    const tokens = [...meaningfulTerms(query)].slice(0, 16);
    if (tokens.length === 0) return new Map();
    const expression = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
    try {
      const rows = this.db.prepare("SELECT CAST(node_id AS INTEGER) AS node_id, bm25(node_fts) AS rank FROM node_fts WHERE node_fts MATCH ? ORDER BY rank LIMIT ?").all(expression, limit) as Row[];
      return new Map(rows.map((row) => [Number(row.node_id), Math.abs(Number(row.rank ?? 0))]));
    } catch {
      return new Map();
    }
  }

  private upsertSuggestion(fromId: number, toId: number, relationType: string, score: number, reasons: string[]): LinkSuggestion {
    return this.transaction(() => {
      const existing = relationType === "related_to"
        ? this.db.prepare(`
            SELECT * FROM link_suggestions
            WHERE relation_type = ? AND ((from_node_id = ? AND to_node_id = ?) OR (from_node_id = ? AND to_node_id = ?))
          `).get(relationType, fromId, toId, toId, fromId) as Row | undefined
        : this.db.prepare("SELECT * FROM link_suggestions WHERE from_node_id = ? AND relation_type = ? AND to_node_id = ?")
            .get(fromId, relationType, toId) as Row | undefined;
      if (existing) {
        const status = String(existing.status) as SuggestionStatus;
        const reviewedAt = typeof existing.reviewed_at === "string" ? existing.reviewed_at : null;
        const sourceUpdatedAt = String((this.db.prepare("SELECT updated_at FROM nodes WHERE id = ?").get(fromId) as Row).updated_at);
        const targetUpdatedAt = String((this.db.prepare("SELECT updated_at FROM nodes WHERE id = ?").get(toId) as Row).updated_at);
        const changedAfterReview = reviewedAt !== null && (sourceUpdatedAt > reviewedAt || targetUpdatedAt > reviewedAt);
        if (status === "pending" || (status === "rejected" && changedAfterReview)) {
          const nextReasons = changedAfterReview
            ? [...new Set([...reasons, "an endpoint changed after the previous rejection"])]
            : [...new Set(reasons)];
          this.db.prepare("UPDATE link_suggestions SET score = ?, reasons_json = ? WHERE id = ?")
            .run(roundScore(score), JSON.stringify(nextReasons), Number(existing.id));
          if (status === "rejected" && changedAfterReview) {
            this.db.prepare("UPDATE link_suggestions SET status = 'pending', reviewed_at = NULL WHERE id = ?")
              .run(Number(existing.id));
          }
        }
        return rowToSuggestion(this.db.prepare("SELECT * FROM link_suggestions WHERE id = ?").get(Number(existing.id)) as Row);
      }
      const result = this.db.prepare(`
        INSERT INTO link_suggestions(from_node_id, relation_type, to_node_id, score, reasons_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(fromId, relationType, toId, roundScore(score), JSON.stringify([...new Set(reasons)]), new Date().toISOString());
      return rowToSuggestion(this.db.prepare("SELECT * FROM link_suggestions WHERE id = ?").get(Number(result.lastInsertRowid)) as Row);
    });
  }

  private getSuggestion(id: number): LinkSuggestion {
    const row = this.db.prepare("SELECT * FROM link_suggestions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error(`Suggestion ${suggestionPublicId(id)} was not found`);
    return rowToSuggestion(row);
  }

  private resolveNodeId(id: number): number {
    const visited = new Set<number>();
    let current = id;
    while (!visited.has(current)) {
      visited.add(current);
      const redirect = this.db.prepare("SELECT destination_node_id FROM node_redirects WHERE source_id = ?").get(current) as Row | undefined;
      if (!redirect) return current;
      current = Number(redirect.destination_node_id);
    }
    throw new Error(`Node redirect cycle detected at ${nodePublicId(current)}`);
  }
}

export function initializeArgos(root: string, name?: string): StatusView {
  initializeConfig(root, name?.trim() || root.split(/[\\/]/).filter(Boolean).at(-1) || "Argos target");
  const db = new ArgosDb(root, true);
  try {
    return db.status();
  } finally {
    db.close();
  }
}

export function nodePublicId(id: number): string {
  return `N${String(id).padStart(6, "0")}`;
}

export function edgePublicId(id: number): string {
  return `E${String(id).padStart(6, "0")}`;
}

export function suggestionPublicId(id: number): string {
  return `L${String(id).padStart(6, "0")}`;
}

function parseNodeId(reference: string | number): number {
  return parsePrefixedId(reference, "N");
}

function parsePrefixedId(reference: string | number, prefix: string): number {
  if (typeof reference === "number" && Number.isInteger(reference) && reference > 0) return reference;
  const text = String(reference).trim().toUpperCase();
  const match = text.match(new RegExp(`^(?:${prefix})?0*([1-9][0-9]*)$`));
  if (!match) throw new Error(`Invalid ${prefix} identifier: ${reference}`);
  return Number(match[1]);
}

function rowToNode(row: Row): KnowledgeNode {
  const id = Number(row.id);
  const updatedAt = String(row.updated_at);
  return {
    id,
    publicId: nodePublicId(id),
    type: String(row.type),
    title: String(row.title),
    aliases: parseStringArray(row.aliases_json),
    content: String(row.content ?? ""),
    createdAt: String(row.created_at),
    updatedAt,
    ageDays: ageInDays(updatedAt)
  };
}

function rowToEdge(row: Row): KnowledgeEdge {
  const id = Number(row.id);
  return {
    id,
    publicId: edgePublicId(id),
    fromId: nodePublicId(Number(row.from_node_id)),
    type: String(row.type),
    toId: nodePublicId(Number(row.to_node_id)),
    createdAt: String(row.created_at)
  };
}

function rowToEdgeView(row: Row): EdgeView {
  return {
    ...rowToEdge(row),
    fromTitle: String(row.from_title),
    fromType: String(row.from_type),
    toTitle: String(row.to_title),
    toType: String(row.to_type)
  };
}

function rowToSuggestion(row: Row): LinkSuggestion {
  const id = Number(row.id);
  return {
    id,
    publicId: suggestionPublicId(id),
    fromId: nodePublicId(Number(row.from_node_id)),
    relationType: String(row.relation_type),
    toId: nodePublicId(Number(row.to_node_id)),
    score: Number(row.score),
    reasons: parseStringArray(row.reasons_json),
    status: String(row.status) as SuggestionStatus,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at === null || row.reviewed_at === undefined ? null : String(row.reviewed_at)
  };
}

function summarizeNode(node: KnowledgeNode): NodeSummary {
  const plain = node.content.replace(/```[\s\S]*?```/g, " ").replace(/[#*_>`\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return {
    id: node.id,
    publicId: node.publicId,
    type: node.type,
    title: node.title,
    aliases: node.aliases,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ageDays: node.ageDays,
    excerpt: plain.length > 240 ? `${plain.slice(0, 237)}...` : plain
  };
}

function cleanTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Node title cannot be empty");
  if (title.length > 240) throw new Error("Node title cannot exceed 240 characters");
  return title;
}

function cleanAliases(values: string[], title: string): string[] {
  if (values.length > 100) throw new Error("A node cannot have more than 100 aliases");
  const titleKey = normalizeIdentity(title);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const alias = value.replace(/\s+/g, " ").trim();
    if (alias.length > 240) throw new Error("Node aliases cannot exceed 240 characters");
    const key = normalizeIdentity(alias);
    if (!alias || key === titleKey || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyExactTextEdits(content: string, edits: NodeTextEdit[]): string {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error("Exact text edits require at least one edit");
  if (edits.length > 100) throw new Error("A node update accepts at most 100 exact text edits");
  let updated = content;
  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      throw new Error(`Exact text edit ${index + 1} must be an object`);
    }
    const unknown = Object.keys(edit).filter((key) => key !== "oldText" && key !== "newText");
    if (unknown.length > 0) throw new Error(`Unknown exact text edit field: ${unknown[0]}`);
    if (typeof edit.oldText !== "string" || !edit.oldText) {
      throw new Error(`Exact text edit ${index + 1} requires non-empty oldText`);
    }
    if (typeof edit.newText !== "string") throw new Error(`Exact text edit ${index + 1} requires string newText`);
    const matches = exactOccurrenceCount(updated, edit.oldText);
    if (matches !== 1) {
      throw new Error(`Exact text edit ${index + 1} expected one oldText match but found ${matches}`);
    }
    const at = updated.indexOf(edit.oldText);
    updated = `${updated.slice(0, at)}${edit.newText}${updated.slice(at + edit.oldText.length)}`;
  }
  return updated;
}

function exactOccurrenceCount(content: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - needle.length) {
    const at = content.indexOf(needle, offset);
    if (at === -1) break;
    count += 1;
    offset = at + 1;
  }
  return count;
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}._:/\\#@-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function identitySimilarity(left: string, right: string): number {
  const a = normalizeIdentity(left);
  const b = normalizeIdentity(right);
  if (a === b) return 1;
  const aTerms = meaningfulTerms(a);
  const bTerms = meaningfulTerms(b);
  const overlap = jaccard(aTerms, bTerms);
  if (aTerms.size >= 2 && bTerms.size >= 2 && (a.includes(b) || b.includes(a))) return Math.max(0.82, overlap);
  return overlap;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "de", "da", "das", "do", "dos", "e", "em", "for", "from", "in", "is", "o", "of", "on", "or", "para", "the", "to", "um", "uma", "with"
]);

function meaningfulTerms(value: string): Set<string> {
  return new Set(
    normalizeIdentity(value)
      .split(/[^\p{L}\p{N}._:/\\#@-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term))
  );
}

function extractIdentifiers(value: string): Set<string> {
  const result = new Set<string>();
  for (const match of value.matchAll(/`([^`]{2,160})`/g)) result.add(normalizeIdentity(match[1]));
  for (const match of value.matchAll(/(?:[A-Za-z]:\\)?[A-Za-z0-9_@.-]+(?:[\\/][A-Za-z0-9_@.-]+)+|[A-Za-z_][A-Za-z0-9_]*(?:::|\.|#)[A-Za-z0-9_.:#]+/g)) {
    result.add(normalizeIdentity(match[0]));
  }
  return result;
}

function intersection<T>(left: Set<T>, right: Set<T>): T[] {
  return [...left].filter((value) => right.has(value));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const shared = intersection(left, right).length;
  return shared / (left.size + right.size - shared);
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function ageInDays(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor((Date.now() - value) / 86_400_000));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mergeSuggestionStatus(left: SuggestionStatus, right: SuggestionStatus): SuggestionStatus {
  if (left === "accepted" || right === "accepted") return "accepted";
  if (left === "pending" || right === "pending") return "pending";
  return "rejected";
}

function latestTimestamp(left: unknown, right: unknown): string | null {
  const values = [left, right]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return values.at(-1) ?? null;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

const HYPOTHESIS_CONTEXT_RELATIONS = new Set([
  ...TECHNICAL_CHAIN_RELATIONS,
  "depends_on",
  "guards"
]);

const SINK_CONTEXT_RELATIONS = new Set([
  ...TECHNICAL_CHAIN_RELATIONS,
  "guards"
]);

const REFUTATION_RECHECK_RELATIONS = new Set([
  ...TECHNICAL_CHAIN_RELATIONS,
  "depends_on",
  "guards",
  "supersedes"
]);

const CONTEXT_ONLY_NODE_TYPES = new Set([
  "target",
  "test",
  "finding",
  "intel",
  "artifact",
  "note"
]);

function pushChainAdjacency(
  map: Map<string, Array<{ nodeId: string; edge: EdgeView; technical: boolean }>>,
  from: string,
  to: string,
  edge: EdgeView,
  technical: boolean
): void {
  const list = map.get(from) ?? [];
  list.push({ nodeId: to, edge, technical });
  map.set(from, list);
}

function uniqueEdges(edges: EdgeView[]): EdgeView[] {
  const seen = new Set<number>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  }).sort((left, right) => left.id - right.id);
}

function neighborIds(id: string, edges: EdgeView[]): Set<string> {
  const result = new Set<string>();
  for (const edge of edges) {
    if (edge.fromId === id) result.add(edge.toId);
    if (edge.toId === id) result.add(edge.fromId);
  }
  return result;
}

function hasNodeTypeWithinRelations(
  startId: string,
  type: string,
  maxDepth: number,
  edges: EdgeView[],
  nodes: Map<string, KnowledgeNode>,
  relationTypes: Set<string>
): boolean {
  return nodeIdsOfTypeWithinRelations(startId, type, maxDepth, edges, nodes, relationTypes).length > 0;
}

function nodeIdsOfTypeWithinRelations(
  startId: string,
  type: string,
  maxDepth: number,
  edges: EdgeView[],
  nodes: Map<string, KnowledgeNode>,
  relationTypes: Set<string>
): string[] {
  const visited = new Set([startId]);
  let frontier = [startId];
  const matches = new Set<string>();
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of edges) {
        if (!relationTypes.has(edge.type)) continue;
        const neighbor = edge.fromId === id ? edge.toId : edge.toId === id ? edge.fromId : null;
        if (!neighbor || visited.has(neighbor)) continue;
        if (nodes.get(neighbor)?.type === type) matches.add(neighbor);
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return [...matches];
}

function testTargetIds(testId: string, edges: EdgeView[], nodes: Map<string, KnowledgeNode>): string[] {
  if (nodes.get(testId)?.type !== "test") return [];
  return edges
    .filter((edge) => edge.type === "tests" && edge.fromId === testId)
    .map((edge) => edge.toId);
}

function hasTestTarget(targetId: string, edges: EdgeView[], nodes: Map<string, KnowledgeNode>): boolean {
  return edges.some((edge) => edge.type === "tests" && edge.toId === targetId && nodes.get(edge.fromId)?.type === "test");
}

function gap(code: string, node: KnowledgeNode, message: string, relatedNodeIds: string[]): KnowledgeGap {
  return { code, nodeId: node.publicId, message, relatedNodeIds: [...new Set(relatedNodeIds)] };
}

function uniqueGaps(gaps: KnowledgeGap[]): KnowledgeGap[] {
  const seen = new Set<string>();
  return gaps.filter((item) => {
    const key = `${item.code}:${item.nodeId}:${[...item.relatedNodeIds].sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
