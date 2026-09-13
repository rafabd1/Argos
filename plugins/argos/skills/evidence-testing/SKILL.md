---
name: evidence-testing
description: Design and record exact security tests that separate observation from inference and keep conclusions within proven path and condition limits. Use for hypotheses, negative controls, regressions, boundary checks, and conclusions that may need reopening.
---

# Evidence Testing

Test the proposition that would change the decision. Keep the result tied to its exact path and conditions.

## Build A Decisive Test

Identify the attacker-controlled input, target version, normal configuration, entry point, state, sink, and observable result. Add negative controls that distinguish the suspected mechanism from a nearby expected behavior.

Use a small harness, trace, debugger, protocol client, or manual black-box sequence when it gives a clear oracle. Preserve useful artifacts in an `artifact` node and link the `test` node to the component, sink, and hypothesis it covers.

## Bound The Result

Record what happened and what it proves in plain Markdown. State any untested producers, direct callers, orderings, authorities, or downstream consumers that could change the result.

A successful normal-path check does not settle alternate paths. A failed payload does not refute the mechanism if the payload never reached the sink. A local bound does not justify a global discard.

## Update Instead Of Accumulating

Reuse one canonical test node for the same scenario. Update it when rerun against a new version or condition; Argos keeps the prior revision. Create a separate test node when the scenario has a different identity or can reach a different conclusion.

After each material result, reopen the relevant map. Update any hypothesis whose premise changed and add `supports` or `refutes` only when the evidence warrants it.
