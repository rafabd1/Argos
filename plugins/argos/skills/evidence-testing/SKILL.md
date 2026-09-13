---
name: evidence-testing
description: Design and record exact security tests that separate observation from inference and keep conclusions within proven path and condition limits. Use for hypotheses, negative controls, regressions, boundary checks, and conclusions that may need reopening.
---

# Evidence Testing

Test the proposition that would change the decision. Keep the result tied to its exact path and conditions.

Record only durable target knowledge in Argos. Keep run progress, harness operations, task state, and tool issues outside the graph.

## Build A Decisive Test

Identify the attacker-controlled input, target version, normal configuration, entry point, state, sink, and observable result. Add negative controls that distinguish the suspected mechanism from a nearby expected behavior.

Use a small harness, trace, debugger, protocol client, or manual black-box sequence when it gives a clear oracle. Preserve useful artifacts in an `artifact` node. Point `tests` at each exact component, behavior, boundary, guarantee, or sink that the run exercised.

## Bound The Result

Record what happened and what it proves in plain Markdown. State any untested producers, direct callers, orderings, authorities, or downstream consumers that could change the result.

A successful normal-path check does not settle alternate paths. A failed payload does not refute the mechanism if the payload never reached the sink. A local bound does not justify a global discard. Link the test to a hypothesis with `supports` or `refutes` only when the test covers the decisive premises and terminal effect of that conclusion.

## Update Instead Of Accumulating

Reuse one canonical test node for the same scenario. Update its current body when rerun against a new version or condition; replaced text is discarded. Create a separate test node when the scenario has a different identity or can reach a different conclusion.

After each material result, reopen the relevant map. Update any hypothesis whose premise changed. Adding test scope after its conclusion should not require recreating an existing evidence edge; Argos reopens conclusions when technical premises change, not because related test links were written in a different order.
