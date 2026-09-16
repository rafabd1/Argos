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
  aliasCount: number;
  aliasesTruncated: boolean;
}

export interface NodeListItem extends NodeSummary {
  aliasCount: number;
  aliasesTruncated: boolean;
}

export interface NodeListPage {
  nodes: NodeListItem[];
  returned: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  truncatedByBudget: boolean;
  maxPayloadBytes: number;
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
  relationType: string | null;
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
  root: NodeSummary;
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
  relatedNodeCount: number;
  relatedNodeIdsTruncated: boolean;
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
  };
  map: GraphMap;
  gaps: KnowledgeGap[];
  chainMode: "directed_technical";
  technicalRelations: EdgeView[];
  contextRelations: EdgeView[];
  technicalChains: ChainPath[];
  /** Backward-compatible alias for technicalChains. */
  chains: ChainPath[];
  pendingSuggestions: LinkSuggestion[];
  pendingSuggestionCount: number;
  pendingSuggestionsTruncated: boolean;
  output: {
    maxPayloadBytes: number;
    serializedBytes: number;
    truncatedByBudget: boolean;
    nodeContentTruncated: boolean;
    omitted: {
      nodeContentChars: number;
      nodeAliases: number;
      outgoingRelations: number;
      incomingRelations: number;
      classifiedRelations: number;
      supersededBy: number;
      mapNodes: number;
      mapEdges: number;
      mapFrontierNodeIds: number;
      gaps: number;
      technicalChains: number;
      pendingSuggestions: number;
    };
  };
}
