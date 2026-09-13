# Changelog

All notable changes to Argos are documented here.

## [0.1.1] - 2026-09-12

### Added

- Automatic on-use Obsidian sync with persistent status, refresh, enable, interval, destination, and pruning controls.
- Sync follows a moved or copied workspace by resolving internal vault paths from the root used by each tool call.
- Structural gap checks for partial hypothesis premises, untested downstream sinks, missing technical paths, intel-only conclusions, and reopened refuted hypotheses.
- Separate technical chains and contextual relations in node inspection responses.

### Changed

- Chain discovery now follows explicit edge direction and technical relations, with `depends_on` allowed only as the first step from a hypothesis.
- Refutation checks focus on later technical or premise changes instead of the order used to attach test metadata.
- Research skills now keep test and conclusion scope exact and revisit prior conclusions through explicit graph links.
- Canonical identity guidance now keeps the visible map current: changed knowledge updates the same node, while internal revisions retain prior text.

### Removed

- Built-in co-agent orchestration, sessions, messaging, and councils. Argos now focuses on research knowledge and graph operations.

### Fixed

- Obsidian note titles that already end in `.md` no longer produce `.md.md` files. Safe pruning removes an unchanged legacy projection on the next export.

## [0.1.0] - 2026-09-12

### Added

- Canonical free-form Markdown nodes with aliases, timestamps, age, and internal revision history.
- Explicit duplicate-node consolidation with retained history, relation rewiring, and retired-ID redirects.
- Typed, explicit graph relations and reviewable relation suggestions.
- Hybrid full-text, identifier, and graph-aware retrieval with compact node inspection.
- Bounded sink-path discovery and graph checks for partial coverage, mixed evidence, changed relations or linked notes after refutation, old knowledge, and missing context.
- Explicit guarantee applicability: nearby protection notes only satisfy coverage when a `guards` relation links them to the sink or boundary.
- Relation suggestions that can return to review after either rejected endpoint changes.
- Obsidian Markdown, wikilink, index, and Canvas export from an atomic graph snapshot with hash-checked stale-file pruning.
- No-op update protection so empty or unchanged writes do not refresh knowledge age.
- CLI and strict-schema MCP interfaces for every knowledge operation.
- Codex and experimental Claude Code plugin packages.
- Project-local OpenCode coordinator setup.
- Optional OpenCode-backed Chimera co-agents with persistent sessions, scoped labs, per-session network and autoapproval controls, direct messages, bounded workflow snapshots, stop and recovery control, and ordered councils.
- Research skills for map-first coordination, codebase mapping, chain discovery, evidence testing, adaptive fuzzing, exploit validation, external intelligence, and finding reports.
- Cross-process SQLite locking, orphan-lock recovery, and regression tests for concurrent identity, relation, message, inbox, session, and council operations on Windows and Linux CI.
- Version-driven CI packaging with changelog-based GitHub release notes and automatic tags after a tested merge to `main`.
