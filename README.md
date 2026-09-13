<div align="center">

# Argos

**A connected knowledge map for deep security research**

<p>
  <a href="#install">Install</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#knowledge-model">Knowledge Model</a> &bull;
  <a href="#documentation">Documentation</a>
</p>

<p>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D24-43853d" />
  <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue" />
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-CLI%20%2B%20MCP%20%2B%20Skills-222222" />
  <a href="https://github.com/rafabd1/Argos/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rafabd1/Argos/actions/workflows/ci.yml/badge.svg" /></a>
</p>

</div>

Argos keeps a durable map of what a target does, how its parts relate, what has
been tested, and which conclusions still depend on unproven assumptions. Each
real item has one canonical Markdown note. Typed links connect components,
sinks, data, authority, state, tests, evidence, and findings.

The map helps an agent recover more than matching text. It can follow nearby
relations, find paths between sinks, flag partial test coverage, show knowledge
age, and suggest missing links for review. Every structural change remains
explicit.

| Canonical knowledge | Linked recovery | Blind-spot checks | Obsidian view |
| --- | --- | --- | --- |
| One current note per item, with hidden revision history. | Bounded subgraphs instead of full database dumps. | Partial path coverage, mixed evidence, old premises, and missing context. | Automatically refreshed Markdown notes, exact graph links, a compact index, and a Bases explorer. |

## Install

Argos requires Node.js 24 or newer.

```powershell
npm install -g https://codeload.github.com/rafabd1/Argos/tar.gz/refs/heads/main
argos --version
```

Install the Codex plugin marketplace:

```powershell
codex plugin marketplace add rafabd1/Argos
```

Then install or enable `argos` in Codex and invoke it with `@argos`.

Claude Code support is experimental:

```text
/plugin marketplace add rafabd1/Argos
/plugin install argos@argos-marketplace
```

Use `/argos:argos` after installation. See [Installation](docs/INSTALLATION.md)
for source installs, MCP fallback, and OpenCode project setup.

## Quick Start

For normal use, ask the agent to initialize and maintain Argos at the target
workspace root:

```text
@argos initialize the knowledge map for this repository and recover any existing context
```

The direct CLI remains useful for inspection and recovery:

```powershell
argos init --root C:\path\to\target --name target-name
argos search --root C:\path\to\target --query "object key write path"
argos inspect --root C:\path\to\target --id N000012 --depth 2
argos export obsidian --root C:\path\to\target
```

Argos stores target knowledge in `.argos/knowledge.sqlite`. The default
Obsidian vault is `.argos/obsidian/<config-name>/`. Normal Argos operations
refresh it when the configured interval has elapsed. Use
`argos obsidian sync status|refresh|disable` to inspect, force, or disable it.
The projection emits each directed relation once, keeps incoming context in the
note without duplicating graph links, and provides `Argos Explorer.base` for
filtered views when the Obsidian Bases core plugin is enabled.

## Knowledge Model

Node bodies are free-form Markdown. A node type gives the item a stable role;
it does not impose a form on the note.

Common node types include:

- `component`, `sink`, `data`, `state`, `principal`, `boundary`, and `guarantee` for the target map;
- `hypothesis`, `test`, `artifact`, and `finding` for research knowledge;
- `dependency` and `intel` for upstream and external context.

Relations describe durable facts such as `flows_to`, `calls`, `crosses`,
`runs_as`, `guards`, `tests`, `supports`, `refutes`, and `supersedes`. Conditions,
version limits, and uncertainty stay in the note body.

Creating a node first checks titles, aliases, symbols, paths, and strong content
matches. An exact identity returns the existing node. Ambiguous matches stop
creation until the caller reviews them, including exact identities already
recorded under another node type. If two reviewed nodes prove to be the same
item, an explicit merge preserves their aliases, revisions, and relations under
one canonical ID. Suggested links stay outside the graph until accepted.

The visible graph reflects current knowledge. When an item's interpretation,
tested version, or proof changes, update its canonical note and keep the old
scope in the related test or evidence note. Internal revisions preserve prior
text without adding historical copies to the map.

Every read includes `updatedAt` and `ageDays`. An update refreshes that age only
when the canonical note changes. Old knowledge remains available as prior
evidence and signals when revalidation may be useful.

## Retrieval

`argos search` combines full-text search, token overlap, code and path
identifiers, and bounded graph expansion. `argos inspect` returns the current
note, its local map, objective coverage gaps, directed technical sink paths,
separate context relations, and pending link suggestions in one response.

`argos gaps` can surface cases where:

- a sink has several recorded inputs but its tests cover only part of them;
- a boundary is linked to some input paths and not the others;
- a hypothesis has both supporting and refuting evidence;
- a hypothesis has untested premises or a test that stops before its terminal sink;
- a behavior reaches a sink that has no exact test relation;
- technical or premise relations appeared after the latest refutation;
- linked knowledge changed after the latest refutation;
- a conclusion relies only on historical intel;
- a reopened refuted hypothesis lacks an explicit change relation;
- a sink lacks mapped authority, state, flow, or test context.

These results guide inspection. Code and evidence decide the conclusion.

## Development

```powershell
npm install
npm test
```

The test suite checks TypeScript, CLI and MCP behavior, canonical identity,
concurrent writes, graph retrieval, Obsidian export, and OpenCode project setup.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [CLI and MCP](docs/RUNTIME.md)

## License

Argos is licensed under GPL-3.0-or-later.
