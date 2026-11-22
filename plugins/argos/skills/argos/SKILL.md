---
name: argos
description: Operate an Argos knowledge graph for offensive security research. Use when initializing, searching, inspecting, updating, linking, merging, repairing, or exporting target knowledge.
---

# Argos

Argos stores the current connected knowledge of a target. Use it as a map, not as a campaign log or a substitute for the research method chosen by the user or host agent.

## Use One Workspace Root

Pass the target workspace root to every Argos operation. Initialize once when `.argos/knowledge.sqlite` is absent. Do not create another database inside a repository subdirectory or a per-agent lab.

Before writing:

1. Search for the concrete item by title, alias, symbol, path, mechanism, and other stable identifiers.
2. Read the best matching excerpts.
3. Inspect the likely canonical node and its bounded local map.
4. Decide whether the new knowledge updates that item, adds a relation, or represents a separate item.

Do not load the whole graph. Use bounded search, inspection, and content windows around the item being handled.

## Store Target Knowledge Only

Store durable facts about the target, its dependencies, and evidence that changes target knowledge. Keep campaign goals, task lists, progress logs, transcripts, checkpoints, agent messages, tool errors, runtime configuration, and Argos usage notes outside the graph.

An `artifact` node must represent target evidence such as a PoC, trace, sample, report, or reproducible output. Do not use artifact nodes as general file records or work logs.

## Keep One Canonical Node Per Item

A node represents one item that can change independently. Its body is free-form Markdown.

- Update an existing node when the same component, sink, boundary, test, hypothesis, or other item already exists.
- Keep the visible body as the current understanding. Do not create a replacement node to preserve old wording, an old conclusion, or an earlier representation.
- Use aliases for symbols, paths, former names, and common labels.
- Create a separate node only when it has an independent identity and a distinct role in the map.
- Link shared facts instead of copying the same text into several notes.
- Merge reviewed duplicate nodes with the explicit merge operation and a consolidated current body.
- Remove nodes that contain only operational material. Do not remove target knowledge merely because its conclusion changed; revise its body and relations.

Use exact edits for small changes and body replacement when stale text must disappear. Read the affected window first and make the update in one operation. Do not retain prior body versions inside the note.

## Maintain A Concrete Hierarchy

Every non-target node needs a reviewed initial relation. Creation writes the node and that relation atomically.

- The first `target` node is the only relation-free root.
- Attach top-level components to the target with `contains`.
- Attach lower-level components to their real owner.
- Attach data, state, sinks, boundaries, principals, guarantees, tests, hypotheses, artifacts, evidence, and findings to the specific item they describe.
- Do not attach detailed nodes only to the target when a concrete owner, flow, tested item, premise, or evidence subject exists.
- Do not use `related_to` as the initial attachment.
- Do not invent a generic edge to satisfy creation.

If `status` reports isolated nodes, broad root links, generic-only nodes, or high-fanout hubs, run `find_gaps` without an ID. Add the exact relation first, then remove the stale broad relation.

Read [references/knowledge-model.md](references/knowledge-model.md) before choosing an unfamiliar node or relation type.

## Keep Relations Exact

Relations are typed and directed facts. Add a relation only when the recorded knowledge supports that exact connection and direction. Put conditions, version limits, and uncertainty in the node body.

Suggestions and gap results are review queues, not graph facts. Accept a suggestion only after choosing the relation supported by the target knowledge. Reject loose matches based only on names, versions, or broad similarity.

Link tests and evidence to the precise item and scope they cover. A result for one path does not automatically support or refute adjacent paths. When knowledge changes a prior conclusion, update the canonical note and use `supports`, `refutes`, or `supersedes` only when that relation is exact.

## Read Bounded Content

Search results include bounded title, alias, and body matches with line and character positions. Read those excerpts first. Use `get_node` with `startLine` or `contentOffset` for the surrounding section, and follow `contentWindow.nextOffset` only while more of that note is needed.

Use `inspect` when one node is the center of the task. It returns a bounded note preview, local graph, coverage gaps, sink paths, and pending suggestions. When `output.nodeContentTruncated` is true, read a targeted window instead of widening the whole response.

Run several small searches when identity is unclear. Compare the returned excerpts and nearby relations before creating another node. A similar result may be the same canonical item, a new fact for it, a missing relation, or a separate item.

## Track Age Without Guessing State

Every node reports `updatedAt` and `ageDays`. Age means the note may need review; it does not make the knowledge false or current. When the target, dependency, or relevant condition changes, verify the item and update the same canonical node.

## Keep Obsidian In Sync

Normal Argos operations check whether the Obsidian projection is due and refresh it before returning. The default vault is `.argos/obsidian/<config-name>/`.

Use sync status to inspect the schedule, sync refresh to force an export, and sync disable only when automatic projection is not wanted for that workspace. The projection is derived output; use the Argos database and tools as the canonical source.

## References

- Read [references/commands.md](references/commands.md) for the CLI and MCP operations.
- Read [references/knowledge-model.md](references/knowledge-model.md) for node types, relation types, direction, and graph rules.
