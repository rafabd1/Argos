---
name: chain-discovery
description: Develop realistic, non-obvious security chains from Argos sinks, side effects, authority transitions, state, and indirect graph paths. Use when a primitive needs impact elevation or the map contains related sinks that have not been tested together.
---

# Chain Discovery

A sink becomes a gadget when its output, authority, state change, or side effect helps another operation.

Record only durable target knowledge in Argos. Keep run progress, task state, tool issues, and agent coordination outside the graph.

## Recover The Local Graph

Open the sink node, map two or three hops, and query bounded paths to other sinks. Technical paths follow the recorded edge direction. `contains`, `supports`, `derived_from`, and other context links help explain the map but do not connect gadgets. Check old tests and conclusions before proposing new work.

For each plausible connection, inspect:

- values the first operation produces or preserves;
- alternate consumers of those values;
- identity or tenant changes between steps;
- durable state, retries, caches, queues, and stale reads;
- parsing or normalization differences at each boundary;
- timing windows and order-sensitive guarantees;
- native or upstream code that interprets the output differently.

Create or accept a relation only after the connection is real. Keep weak ideas as a hypothesis node, not a false graph edge. If a useful path is absent because one handoff has not been mapped, verify and add that exact technical relation instead of weakening the chain search.

## Avoid The First Story

The obvious route is a baseline. Look for a different producer, direct caller, delayed consumer, cross-component conversion, or authority shift that changes the result. Randomness is not the goal; a useful chain has a concrete data or state handoff.

When a candidate works at a limited impact, search mapped neighbors for realistic elevation before closing it. Prefer common default deployments and normal attacker actions. Reject chains that need artificial permissions, weakened limits, or lab-only state.

## Reopen Killed Paths Carefully

Reopen a discarded hypothesis when a linked premise changed, a previously separate sink now connects, or the old test covered only one path. Update the same hypothesis and link the new evidence with `refutes` or `supersedes` where it changes the old conclusion. Do not create a replacement node to bypass the old conclusion.

Use `argos chains`, `argos map`, `argos suggest_links`, and targeted search as navigation aids. The code and tests decide whether the path exists.
