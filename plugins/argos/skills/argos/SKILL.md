---
name: argos
description: Build, query, and revise an Argos knowledge graph during deep security research. Use when mapping a target, recovering prior knowledge, recording components or sinks, linking evidence, revisiting conclusions, finding blind spots, or exploring chains.
---

# Argos

Argos is the research memory. Build a connected account of the target that makes the next decision easier.

## Start From The Map

Use the workspace root for every Argos call. Initialize it once when `.argos/knowledge.sqlite` is absent.

1. Search for the concrete component, symbol, path, sink, behavior, or hypothesis.
2. Inspect the best canonical node and its bounded map.
3. Check the node age and any `supersedes`, `supports`, or `refutes` links.
4. Continue from the strongest open relation or missing proof.

Do not load the whole graph. Expand around the current item, then follow only relations that can change the research decision.

Use `inspect` after search when one node is the likely center. It returns the note, local map, coverage gaps, nearby sink paths, and pending suggestions in one bounded call.

At a useful checkpoint, inspect the active hypothesis and its terminal sinks or boundaries again. This catches changed premises without turning Argos into a campaign manager.

## One Item, One Node

A node represents one real item. The note body is free-form Markdown.

- Resolve before create.
- Update the existing node when the same component, sink, test scenario, or hypothesis already exists.
- Keep the visible node as the current understanding of that item. A changed interpretation, tested version, payload shape, or stronger proof belongs in an update, not a replacement node.
- Use aliases for symbols, paths, old names, and common labels.
- Create a distinct node only when it has an independent identity, still exists in the current map, and can change separately.
- Link facts instead of repeating them in several notes.
- Promote a premise from prose to a node when it can be tested, revised, or reused by another conclusion. Do not create a node for every checklist line.

Argos keeps prior note bodies as internal revisions. Never keep a generic umbrella node or create a second node only to preserve an old test, name, conclusion, or representation. Record the old scope and version in the test or evidence note while the canonical target item stays current.
If two existing nodes are later proven to be the same item, inspect both and use the explicit merge operation with a reviewed consolidated body. Do not leave parallel canonical identities or discard one note's evidence.

## Let Relations Change The Work

The graph matters when it changes what you inspect next. Refresh the local map whenever new evidence changes any of these:

- a producer or consumer of data;
- an authority boundary or execution identity;
- a state transition, order, retry, or lifetime;
- the scope or provenance of a validation;
- an assumption used to discard or promote a hypothesis;
- a sink that can feed another sink.

When one of these changes, revisit linked hypotheses and tests without waiting for the user to point out the connection.

## Keep Conclusions Narrow

Evidence from one path supports a conclusion about that path and its proven conditions.

- A limit on one producer does not bound every producer.
- A guard's presence does not prove where its parameters came from or which alternate routes bypass it.
- A normal-path test does not settle direct callers, retries, stale state, native code, upstream dependencies, or other consumers.
- A safe result at one stage does not prove safety before or after that stage.
- A prior discard must be reopened when a linked premise changes.

Record the exact scope in natural prose. Point `tests` to the precise item exercised. Add `supports` or `refutes` only when the observed scope covers that conclusion; a primitive-only test stays linked to the primitive. Use `depends_on` for decisive premises and `supersedes` or `refutes` when new knowledge changes an older conclusion.

When older research becomes relevant again, create or recover only the prior conclusion that affects the current work. Link the new evidence to it explicitly. Do not copy a whole legacy log into the graph or silently treat the old verdict as current.

## Find Missing Combinations

Use relation suggestions and sink paths as prompts for inspection. They do not become facts until checked. Sink paths follow edge direction and technical relations; ownership, evidence, and provenance links remain context and cannot manufacture a chain.

The gap engine reports what the map establishes, such as a test linked to only part of a sink's recorded inputs or a boundary linked to some paths but not others. Treat each result as a question to settle in code or a test, never as proof of a vulnerability or proof that an unlisted path exists.

For a meaningful sink:

- map its inputs, transformations, authority, state, and outputs;
- inspect other producers of the same data and consumers of its output;
- ask whether its side effect becomes a useful gadget under another component's authority or timing;
- query paths to related sinks;
- review nearby tests and old conclusions;
- suggest links, then accept only the relation the code or evidence supports.

The goal is to expose useful combinations, not to manufacture a chain between unrelated behaviors.

## Age And Change

Every node reports `updatedAt` and `ageDays`. Age is a reason to verify, not a status judgment.

Recheck old knowledge when the target version, nearby component, upstream dependency, configuration default, or threat model changed. Update the same node and use `supersedes` only when a separate item or conclusion truly replaced another.

## Obsidian Projection

Argos checks the Obsidian projection after normal workspace operations. When the configured interval elapsed, it updates the vault before the operation returns and safely prunes only unchanged files owned by an earlier export. Use sync status to see when the next projection is due and sync refresh to force one now. Disable it only when the user does not want automatic export for that workspace.

## Useful Knowledge

Keep notes short enough to recover and rich enough to act on. Useful content often includes:

- what the item does and where it lives;
- concrete inputs, outputs, callers, and side effects;
- whose authority applies and where it is checked;
- state or timing that changes behavior;
- conditions that make a guarantee hold;
- what was observed, what remains inferred, and what would settle it;
- the target version or date when that matters.

These are prompts, not a required template. Leave out fields that add no knowledge.

## Research Depth

Follow a promising path through the layer that actually implements it. That may include native code, parsers, protocols, generated code, upstream dependencies, caches, storage formats, workers, or alternate entry points. Use focused fuzzing or a small harness when reading cannot settle behavior.

Do not call a broad area covered because the visible wrapper was read. State what remains outside the tested scope and connect it to the relevant nodes.

Before treating a candidate as finished, search for realistic impact elevation. Check alternate consumers, stronger authority transitions, durable effects, and combinations with other mapped sinks. Keep the strongest impact that works in a common, correctly configured scenario. Artificially weakened limits, trust, permissions, or isolation do not establish impact.

## Command Reference

Read [references/commands.md](references/commands.md) for the full CLI and MCP surface. Read [references/knowledge-model.md](references/knowledge-model.md) when choosing node or relation types.
