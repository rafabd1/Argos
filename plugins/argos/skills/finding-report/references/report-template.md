# Vulnerability Report Template

Write this for the triager. A reader with no prior context should quickly
understand the flaw, its concrete impact, and how to reproduce it.

If the user, program, or platform provides a report template or custom
instructions, follow that structure first. Do not add sections it does not
contain unless triage truly requires them. Keep the same substance, but fit it
naturally into the provided fields.

Use natural, direct language. The report should not read like a legal document,
a checklist, or an AI-generated worksheet. Prefer short paragraphs, useful
bullets, and no long sections unless the evidence requires them.

Do not mention local paths, agent roles, memory files, Argos, or the research
workflow. When adjusting a draft, write the external report itself, not a reply
to the researcher or a note about local work.

Avoid em dashes, filler, generic hype, defensive wording, needless caveats, and
reframing such as "this is not X, it is Y." Do not use headings or stock phrases
such as "Why this matters," "This matters," or "This is security relevant
because."

## Title

Use one concrete sentence that names the affected boundary and impact.

## CWE

Use the most accurate CWE. If uncertain, state the best candidate and keep the
uncertainty explicit.

## Summary

Start directly. In one or two short paragraphs, explain what breaks, who can
trigger it, the root cause at a high level, and the realistic security impact.
A reader with no prior context should understand the issue from this section.

Address likely triage questions naturally in the prose: why the behavior is
unexpected, why the attacker boundary is realistic, where the target owns the
root cause, what the victim loses, and why the PoC is not a lab artifact. Do not
turn these points into a checklist unless the supplied template asks for one.

## Root Cause

Include this section when it helps triage. Explain the target-owned mistake
simply, then add only the technical detail needed to understand the flaw. Keep
it short or omit it when the summary and reproduction already make it clear and
the supplied template allows that.

## PoC Details

Use this section when the proof needs context beyond the reproduction steps.
Prefer manual black-box proof through browser actions, HTTP requests, `curl`, or
normal CLI commands. If a helper script is necessary, explain the manual flow
it automates. Include short snippets only when they make the proof easier to
trust, and state what each snippet does and what output proves the issue.

```bash
# Request or manual command, when useful
```

## Steps To Reproduce

Keep each step terse: action and expected output. Put interpretation in PoC
Details or in one short note after the steps. Do not repeat the same proof.

1.

## Impact

Prefer short bullet points. List the proven attacker scenario, affected victim
resources, and security consequence. Keep caveats, prerequisites, reframing,
and arguments about relevance in Summary or PoC Details.

Add another section only when the program template requires it or the triage
context specifically needs it.
