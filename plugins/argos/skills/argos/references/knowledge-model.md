# Knowledge Model

## Nodes

Default node types describe identity, not a body schema:

- `target`: the product, repository, service, or versioned system.
- `component`: a module or subsystem with its own responsibility.
- `sink`: an operation with a security-relevant effect.
- `behavior`: a stable behavior that may cross several components.
- `data`: a value, document, token, path, message, or other data item.
- `state`: a durable or temporary state that changes later behavior.
- `principal`: an actor, role, process identity, or authority.
- `boundary`: a trust, process, tenant, privilege, or serialization boundary.
- `guarantee`: a validation, invariant, or protection with a specific scope and conditions.
- `dependency`: an upstream package, service, protocol, or native layer.
- `hypothesis`: one falsifiable security proposition.
- `test`: one reusable test scenario and its current result.
- `finding`: a validated vulnerability identity.
- `intel`: external facts, expected behavior, fixes, and timelines.
- `artifact`: a PoC, harness, trace, sample, or other retained object.
- `note`: useful knowledge that has no better stable identity yet.

Extend the vocabulary only when the new type carries a stable meaning that cannot be expressed by these types.

## Relations

Relations are explicit and directional unless `related_to` is used:

- Structure: `contains`, `exposes`, `depends_on`, `derived_from`.
- Execution and data: `calls`, `flows_to`, `transforms`, `reads`, `writes`, `produces`, `consumes`.
- Security context: `crosses`, `runs_as`, `guards`, `influences`, `affects`.
- Evidence: `tests`, `supports`, `refutes`.
- Change: `supersedes`.
- Weak but checked association: `related_to`.

Prefer the most precise relation that the code or evidence proves. Put conditions, version limits, and uncertainty in the connected notes rather than inventing a relation type for every qualifier.

## Canonical Identity

Titles identify the real item. Aliases help resolve symbols, paths, old names, and labels. Exact title or alias matches return the canonical node. Strong but ambiguous matches stop creation until the caller reviews them and passes `distinctFrom` for items confirmed to be different.

If later evidence proves that two nodes are the same item, merge the duplicate into the chosen canonical node with an explicitly reviewed body. The retired ID remains resolvable; its history and graph connections move to the canonical identity.

## Suggestions

Suggested links live outside the graph until accepted. Their score and reasons help triage. Acceptance requires a valid relation type and creates a normal edge. Rejection keeps a review trail without changing the graph.
