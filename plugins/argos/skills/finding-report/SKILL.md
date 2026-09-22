---
name: finding-report
description: Write a concise vulnerability report for an external triager from validated Argos knowledge and a supplied template. Use after exploit validation or when revising report wording, impact, or reproduction steps.
---

# Finding Report

Write for an external triager with no local context. Follow the user's template exactly when supplied and do not add sections it does not contain. When no template is supplied, use [references/report-template.md](references/report-template.md).

If the finding changes Argos, update only its durable target knowledge. Keep report-writing progress, review notes, and tool issues outside the graph.

Use natural, direct language. Explain the flaw, attacker path, and real impact in simple technical terms. Anticipate likely questions inside the summary and PoC details without turning the report into a checklist or legal document.

## Style

- Keep sections short and formatting light.
- Avoid em dashes.
- Avoid defensive reframing such as "this is not X, it is Y."
- Do not write "Why this matters," "This matters," or "This is security relevant because."
- Do not address the user or mention local workspace paths, private research state, or research tooling.
- Do not repeat caveats in several sections.

## Impact

List the proven impacts, preferably as short bullet points. Keep prerequisites and caveats in the mechanism or PoC details. Do not use the Impact section to argue that the flaw should count despite a limitation.

## Steps

Each step needs the action and expected output. Keep long interpretation outside the numbered action, in the PoC details or one short note after the steps. Remove repeated explanations.

Use only facts supported by the linked Argos evidence. Translate internal node IDs into the code, request, object, or behavior a triager can verify.

State the exact stable release on which the issue was reproduced. Do not report a canary, nightly, or other prerelease result as proof of an affected stable version.

Leave out hashes of files, scripts, logs, screenshots, and other artifacts when they add no proof. Include a checksum only when the bytes may change during a relevant step, such as upload or archive processing, and comparing the input and output is necessary to establish the flaw. Name both sides of the comparison and explain the result. A hash is not a substitute for showing the behavior.
