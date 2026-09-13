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
- Updating a node stores the old body in `node_revisions`.
- An empty or unchanged update creates no revision and does not refresh the
  note's age.
- A reviewed merge requires a consolidated body, rewires relations, retains
  both histories, and redirects the retired ID to the canonical node.

Identity resolution and insertion run in one immediate transaction. Parallel
attempts to create the same item resolve to one node.

## Retrieval

Text retrieval combines SQLite FTS5, normalized token overlap, code and path
identifiers, titles, and aliases. Argos then expands the strongest seeds through
nearby graph relations with a distance penalty. Results include match reasons,
distance, timestamps, and age.

`inspect` is the compact recovery operation. It returns:

- the complete canonical note and direct relations;
- a bounded neighborhood of compact node summaries;
- nearby paths to other sinks;
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

`chains` performs a bounded graph traversal from one node to other sinks. It
returns every edge and its direction. A returned path is a navigation aid; it
does not assert that data can traverse the full path or that the sinks form an
exploit.

## Blind-Spot Checks

The gap engine reports facts that deserve review. It does not make research
decisions. Checks include:

- isolated sinks or hypotheses;
- sinks without test, flow, authority, or state context;
- sinks near a boundary without a mapped conditional guarantee;
- several recorded sink inputs with tests linked to only part of them;
- a boundary linked to some direct sink inputs but not the rest;
- both supporting and refuting evidence on one hypothesis;
- a refutation whose test covers only part of the recorded sink inputs;
- graph relations added after the latest refuting evidence;
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
process for that database. Message creation, message consumption, session
claims, and council turns use the same pattern.

Chimera runtime state uses a separate database:

```text
<root>/.argos/chimera/runtime.sqlite
```

Operational sessions and chat records therefore do not become target knowledge
nodes.

## Obsidian Projection

The Obsidian exporter writes one Markdown file per canonical node. Minimal
frontmatter contains the stable Argos ID, type, aliases, and timestamps. A
generated relation section uses wikilinks. The export also creates an index and
an Obsidian Canvas.

SQLite remains canonical. A manifest tracks generated files and their hashes
across renames. `--prune` removes only unchanged stale files listed in that
manifest and contained inside the chosen vault. It preserves a stale projection
that was edited after export and reports the count. Files inherited from a
legacy manifest without hashes are also preserved because their state cannot be
verified.

## Interfaces

The CLI and MCP server call the same TypeScript domain methods. MCP schemas
reject unknown top-level fields. Tool responses include structured JSON and a
text copy for hosts that do not consume structured content.

Plugin packages expose the same skills and MCP runtime to Codex and Claude Code.
OpenCode project support installs local skills, instructions, `/argos`, and MCP
wiring. Chimera uses OpenCode as an optional co-agent runtime and remains
separate from OpenCode acting as the main coordinator.
