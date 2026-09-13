export type SuggestionStatus = "pending" | "accepted" | "rejected";

export interface ArgosConfig {
  formatVersion: number;
  name: string;
  nodeTypes: string[];
  relationTypes: string[];
  ageNoticeDays: number;
}

export interface KnowledgeNode {
  id: number;
  publicId: string;
  type: string;
  title: string;
  aliases: string[];
  content: string;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
}

export interface NodeSummary extends Omit<KnowledgeNode, "content"> {
  excerpt: string;
}

export interface KnowledgeEdge {
  id: number;
  publicId: string;
  fromId: string;
  type: string;
  toId: string;
  createdAt: string;
}

export interface EdgeView extends KnowledgeEdge {
  fromTitle: string;
  fromType: string;
  toTitle: string;
  toType: string;
}

export interface LinkSuggestion {
  id: number;
  publicId: string;
  fromId: string;
  relationType: string;
  toId: string;
  score: number;
  reasons: string[];
  status: SuggestionStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SearchHit {
  node: NodeSummary;
  score: number;
  matchReasons: string[];
  distance: number;
  via?: { fromId: string; edgeType: string };
}

export interface GraphMap {
  root: KnowledgeNode;
  nodes: NodeSummary[];
  edges: EdgeView[];
  depth: number;
  nodeLimit: number;
  truncated: boolean;
  frontierNodeIds: string[];
  omittedNeighborCount: number;
  omittedEdgeCount: number;
}

export interface ChainPath {
  nodes: NodeSummary[];
  edges: EdgeView[];
  hopCount: number;
  oldestAgeDays: number;
}

export interface KnowledgeGap {
  code: string;
  nodeId: string;
  message: string;
  relatedNodeIds: string[];
}

export interface KnowledgeInspection {
  context: {
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
    revisionCount: number;
  };
  map: GraphMap;
  gaps: KnowledgeGap[];
  chains: ChainPath[];
  pendingSuggestions: LinkSuggestion[];
  pendingSuggestionCount: number;
  pendingSuggestionsTruncated: boolean;
}

export type ChimeraStatus = "starting" | "running" | "stopped";
export type ChimeraAccessMode = "explorer" | "editor";

export interface ChimeraConfig {
  enabled: boolean;
  opencodeCommand: string;
  defaultModel: string | null;
  defaultVariant: string | null;
  defaultAgent: string;
  maxAgents: number;
  defaultNetwork: boolean;
  autoApprove: boolean;
  serverUrl: string | null;
  serverPid: number | null;
}

export interface ChimeraSession {
  id: number;
  publicId: string;
  role: string;
  goal: string;
  nodeIds: string[];
  status: ChimeraStatus;
  accessMode: ChimeraAccessMode;
  accessNotes: string;
  model: string | null;
  variant: string | null;
  sessionDir: string;
  labDir: string;
  opencodeCommand: string;
  opencodeAgent: string;
  networkAllowed: boolean;
  autoApprove: boolean;
  opencodeServerUrl: string | null;
  opencodeSessionId: string | null;
  runPid: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
}

export type ChimeraMessageDirection =
  | "coordinator_to_agent"
  | "agent_to_coordinator"
  | "agent_to_agent"
  | "system";

export interface ChimeraMessage {
  id: number;
  publicId: string;
  sessionId: number | null;
  direction: ChimeraMessageDirection;
  fromId: string;
  toId: string;
  kind: "message" | "snapshot" | "council" | "system";
  body: string;
  priority: boolean;
  readByCoordinator: boolean;
  readByAgent: boolean;
  createdAt: string;
}

export interface ChimeraWorkflowMessage {
  ordinal: number;
  role: "user" | "assistant";
  createdAt: string | null;
  text: string;
  truncated: boolean;
}

export type CouncilStatus = "inviting" | "open" | "closed";

export interface ChimeraCouncil {
  id: number;
  publicId: string;
  topic: string;
  participantIds: string[];
  acceptedIds: string[];
  status: CouncilStatus;
  round: number;
  currentParticipantId: string | null;
  maxRounds: number;
  finalMessage: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ChimeraCouncilTurn {
  id: number;
  councilId: string;
  round: number;
  speakerId: string;
  body: string;
  createdAt: string;
}
