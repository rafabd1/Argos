---
name: adaptive-fuzzing
description: Use feedback-led fuzzing to learn a specific parser, protocol, state machine, or sink boundary rather than replay generic payload lists. Use when code reading cannot settle input behavior or subtle transformations may expose new graph relations.
---

# Adaptive Fuzzing

Fuzz to learn the boundary, then sharpen the input family around what changed.

Record only durable target knowledge in Argos. Keep run progress, task state, tool issues, and harness operations outside the graph.

## Establish The Model

Map the input origin, transformations, parser layers, state, sink, and observable signals. Start with valid seeds and one variable at a time. Choose oracles that reveal semantic differences, not only crashes.

Useful signals include:

- a different parser stage or consumer;
- normalization disagreement;
- authority or namespace drift;
- state that survives a rejected request;
- a new file, query, object key, message, or callback;
- timing or retry behavior that changes ordering;
- memory safety diagnostics in native code.

## Calibrate From Feedback

Group mutations by the property they test. Retain inputs that produce a new state, edge, coverage feature, or sink behavior. Reduce them, add negative controls, then mutate around the smallest distinguishing feature.

Avoid a generic payload dictionary detached from the component. If the target has a mature parser, protocol, or coverage engine, use it rather than replacing it with a weak script.

## Feed The Map

Update the canonical component, data, sink, or state note when fuzzing reveals a new relation. Link the test and artifact. Revisit nearby hypotheses automatically; a new parser route or consumer can invalidate an old discard even without a crash.
