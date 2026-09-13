---
name: codebase-mapping
description: Map a security-relevant codebase area into canonical Argos components, flows, authority, state, guarantees, and sinks. Use when entering a new subsystem, tracing a candidate, or repairing an incomplete target map.
---

# Codebase Mapping

Map what controls later decisions. Do not turn the repository into a file catalog.

Record only durable target knowledge in Argos. Keep coverage logs, assignments, task state, and tool issues outside the graph.

## Choose A Useful Center

Start from a concrete request path, sink, state transition, trust boundary, parser, worker, or data object. Search Argos first and open the nearest existing map.

Follow the implementation far enough to answer:

- which component owns the behavior;
- where data originates and how it changes;
- which principal acts at each step;
- where state persists or changes over time;
- which checks apply, with what input provenance and path coverage;
- which operation creates the security-relevant effect.

Add canonical nodes only for items with independent meaning. Link them as soon as the relation is proven.

## Trace Through The Real Layer

Wrappers often hide the deciding behavior. Continue into generated code, native libraries, protocol adapters, parsers, storage engines, upstream dependencies, or remote workers when they own the guarantee or side effect.

Stop expanding when another edge cannot change attacker control, authority, state, exploitability, impact, or the next test. Record the unexamined boundary instead of claiming coverage.

## Map Guarantees By Scope

For every relevant guard, determine:

- what value it checks;
- who supplied that value;
- when the check runs;
- which callers and alternate routes reach it;
- whether later code can replace or reinterpret the value;
- which target versions and defaults the conclusion covers.

Write each meaningful protection as a canonical `guarantee` note and keep its conditions in the natural body. Use relations for the stable connection, such as `flows_to`, `crosses`, `runs_as`, `guards`, `tests`, or `depends_on`.

## Refresh After New Evidence

When a test or code trace changes a producer, consumer, authority, lifetime, or guarantee, reopen the nearby map. Update dependent hypotheses and conclusions on your own. A prior local result must not remain a global conclusion after its premise changes.
