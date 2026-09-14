# Argos Architecture

## Model

Argos stores durable knowledge about a target as canonical Markdown notes and
typed graph relations. SQLite is the source of truth. The graph is built around
the target itself, so knowledge remains useful across separate research runs.

The model has two structural objects:

```text
node(id, type, title, aliases, markdown, created_at, updated_at)
edge(id, from_node, type, to_node, created_at)
```

Node types describe stable identities such as a component, sink, data item,
state, principal, boundary, guarantee, hypothesis, test, or finding. Relation types
describe facts such as `flows_to`, `calls`, `crosses`, `runs_as`, `tests`,
`guards`, `supports`, and `refutes`.

Conditions and uncertainty stay in free-form Markdown. Argos does not parse
prose to change types, relations, conclusions, or other important state.

## Canonical Identity

A target item has one visible node. Before insertion, Argos compares the
proposed title and aliases with existing nodes. It also checks code identifiers,
paths, and strong title overlap. Exact identities in another node type require
review instead of silently creating a second representation of the same item.

- An exact title or alias returns the canonical node.
- An exact identity under another type stops creation for review.
- A strong ambiguous match stops creation and returns candidates.
- `distinctFrom` records that the caller reviewed those candidates before
  creating a separate item.
- A rename keeps the old title as an alias.
- An update replaces or extends the current body. Ordered exact edits can change
  small sections without sending the complete note again.
- Replaced content is discarded. An empty or unchanged update does not refresh
  the note's age.
- A reviewed merge requires a consolidated body, rewires relations, retains
  aliases, and redirects the retired ID to the canonical node.
- An explicit removal deletes a node that never belonged in target knowledge,
  along with its relations, suggestions, and redirects.

The first `target` is the graph root. Every later inserted node carries one
initial relation to an existing canonical node. Argos validates and writes the
node and edge in the same transaction, and rolls both back on failure. The
initial edge must name a concrete relation; `related_to` cannot serve as a
generic attachment. This keeps the map connected while leaving later
cross-links free to represent flows, authority, state, evidence, and chains.
Direct target links are limited to `contains` edges for top-level components,
boundaries, principals, and target-wide notes. Detailed nodes must sit under or
beside the exact item they describe.

The visible node describes the current item. Changes in understanding, tested
version, payload shape, or proof update that node. A separate test or evidence
node is valid only when it represents an independently useful current item.
Campaign state, progress logs, task lists, messages, runtime health, and tool
issues stay outside the graph.

Identity resolution and insertion run in one immediate transaction. Parallel
attempts to create the same item resolve to one node. Exact text edits, merges,
and removals are also atomic.

## Retrieval

Text retrieval combines SQLite FTS5, normalized token overlap, code and path
identifiers, titles, and aliases. Argos then expands the strongest seeds through
nearby graph relations with a distance penalty. Results include match reasons,
distance, timestamps, and age.

`inspect` is the compact recovery operation. It returns:

- the complete canonical note and direct relations;
- a bounded neighborhood of compact node summaries;
- directed technical paths to other sinks;
- direct technical and contextual relations in separate arrays;
- objective graph gaps;
- pending relation suggestions touching the node.

Map responses cap nodes and dense internal edges. They report truncation,
omitted counts, and a short frontier of node IDs so the caller can continue
with targeted reads. Gap checks use directed questions over the stored graph;
a truncated presentation map is never used as proof that context is absent.

The caller reads full bodies only for nodes that can affect the next decision.
This keeps large target maps usable without losing linked context.

## Relation Discovery

`suggest-links` ranks unlinked nodes through shared symbols, paths, concepts,
common graph neighbors, and sink-to-sink composition potential. Each suggestion
contains a score and plain reasons. Suggestions live outside the canonical
graph until accepted or rejected.

A rejected suggestion returns to pending review when either endpoint changes
and the relation is suggested again. The new reason records that the earlier
review predates the changed knowledge.

Acceptance validates the chosen relation and creates the edge in the same
transaction that marks the suggestion accepted. Duplicate edges return the
existing edge.

`chains` performs a bounded directed traversal from one node to other sinks.
It follows execution, data, boundary, state, and effect relations. A hypothesis
may use one outgoing `depends_on` edge to enter a technical path. Structure,
evidence, provenance, and weak-association edges stay in the inspection context
and cannot bridge two sinks. A returned path remains a navigation aid; it does
not assert exploitability.

## Blind-Spot Checks

The gap engine reports facts that deserve review. It does not make research
decisions. Checks include:

- isolated sinks or hypotheses;
- sinks without test, flow, authority, or state context;
- sinks near a boundary without a mapped conditional guarantee;
- several recorded sink inputs with tests linked to only part of them;
- a boundary linked to some direct sink inputs but not the rest;
- both supporting and refuting evidence on one hypothesis;
- hypothesis premises not covered by conclusion-linked tests;
- conclusion-linked tests that stop before a terminal sink;
- a hypothesis whose premises do not reach a sink through directed technical links;
- a behavior that reaches a sink with no exact test relation;
- conclusions supported or refuted only by intel;
- a reopened refuted hypothesis with no explicit change relation;
- a refutation whose test covers only part of the recorded sink inputs;
- technical, premise, guarantee, or supersession relations added after the latest refuting evidence;
- linked notes updated after the latest refuting evidence;
- old knowledge next to newer linked knowledge;
- explicit supersession and pending link suggestions;
- bounded paths between distinct sinks.

These checks keep local results local. A test of one path cannot silently stand
for every producer, caller, state, or authority path recorded around a sink.

## Knowledge Age

Argos manages `createdAt` and `updatedAt`. Reads compute `ageDays` from the
current clock. Empty and identical updates do not refresh `updatedAt`; changing
the title, aliases, or body does. Age does not change node state. It tells the
agent when prior knowledge may need comparison with the current target,
dependency, defaults, or threat model.

A `supersedes` relation records a known replacement. Its absence does not prove
that an old note remains current.

## Storage And Concurrency

Target knowledge lives in:

```text
<root>/.argos/knowledge.sqlite
```

Writes use WAL mode, SQLite busy retries, immediate transactions for compound
operations, and a process-wide file lock shared by every Argos CLI and MCP
process for that database.

## Obsidian Projection

The Obsidian exporter writes one Markdown file per canonical node. Frontmatter
contains the stable Argos ID, type, aliases, timestamps, age, revalidation
signal, relation counts, and relation types. Each directed relation creates one
wikilink from its source note. Incoming context remains visible as plain text,
so the global graph does not receive a reverse copy of the same edge.
Literal wikilink syntax in a canonical note body is escaped only in the
projection, which prevents route names and examples from appearing as extra
Obsidian nodes. SQLite content remains unchanged.

`Argos Index.md` summarizes node types, relation types, stale knowledge, and
isolated notes without linking every note into an artificial hub. It embeds
`Argos Explorer.base`, which provides filtered Obsidian Bases views for all
knowledge, findings, hypotheses, tests, stale notes, and isolated notes. The
export does not write `.obsidian` preferences.

SQLite remains canonical. A manifest tracks generated files and their hashes
across renames. `--prune` removes only unchanged stale files listed in that
manifest and contained inside the chosen vault. It preserves a stale projection
that was edited after export and reports the count. Files inherited from a
legacy manifest without hashes are also preserved because their state cannot be
verified. A retired generated Canvas is removed when its recorded hash still
matches, even when a manual export omits `--prune`. Modified or unmanaged legacy
files are preserved and returned in `legacyFilesPreserved`.

After each successful Argos operation, an on-use synchronizer checks the last
export time. It refreshes the projection when the 30-second default interval has
elapsed. A short state lock claims each export, so concurrent agents do not
project the same interval twice.
The export itself uses the same database snapshot and vault lock as a manual
export. `.argos/obsidian-sync.json` stores the relative or external destination,
interval, last attempt, last export, result, and error.

The default destination is `.argos/obsidian/<config-name>`. Argos sanitizes only
the directory segment and keeps the original target name in the knowledge
configuration and index. Existing destinations, including the pre-0.1.3
default, remain unchanged until the user selects a new path.

No process stays open between calls. Internal vault paths are stored relative
to the current tool root, so they follow a moved or copied workspace. An
external custom vault path remains absolute. No database migration is needed.

## Interfaces

The CLI and MCP server call the same TypeScript domain methods. MCP schemas
reject unknown top-level fields. Tool responses include structured JSON and a
text copy for hosts that do not consume structured content.

Plugin packages expose the same skills and MCP runtime to Codex and Claude Code.
OpenCode project support installs local skills, instructions, `/argos`, and MCP
wiring so OpenCode can use Argos as the main research interface.
