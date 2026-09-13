# Argos Installation

Argos ships a CLI runtime, an MCP server, a Codex plugin, a Claude Code plugin,
and project-local OpenCode support. Install the runtime first because graph and
export operations use `argos` and `argos-mcp`.

## Runtime

Argos requires Node.js 24 or newer.

```powershell
npm install -g https://codeload.github.com/rafabd1/Argos/tar.gz/refs/heads/main
argos --version
```

For local development:

```powershell
git clone https://github.com/rafabd1/Argos
cd Argos
npm install
npm test
npm link
```

## Codex

Add the marketplace:

```powershell
codex plugin marketplace add rafabd1/Argos
```

Install or enable the `argos` plugin in Codex. Its manifest starts the external
`argos-mcp` command, so no separate MCP registration is needed after the CLI is
installed. Use `@argos` as the normal entrypoint so the coordinator can load the
main skill and select specialist skills when useful.

Manual MCP fallback:

```powershell
codex mcp add argos -- argos-mcp
```

## Claude Code

Claude Code support is experimental. It has not received the same field testing
as Codex, and model policy may limit some offensive security tasks.

```text
/plugin marketplace add rafabd1/Argos
/plugin install argos@argos-marketplace
```

The plugin bundles its MCP launcher. Use `/argos:argos` after installation.
Register the global runtime only if the host does not load the plugin MCP:

```powershell
claude mcp add -s user argos -- argos-mcp
```

## OpenCode As Coordinator

Follow the [official OpenCode repository](https://github.com/anomalyco/opencode)
to install and configure OpenCode. Then add Argos to a target project:

```powershell
argos opencode install --root C:\path\to\target
argos opencode doctor --root C:\path\to\target
```

The installer preserves unrelated strict-JSON settings and adds:

- an `argos-mcp` local server in `opencode.json`;
- `.opencode/instructions/argos.md`;
- `.opencode/commands/argos.md` for `/argos`;
- the main and specialist skills under `.opencode/skills/`.

Argos skips a commented JSONC config because rewriting it would discard
comments. Add the same MCP and instruction entries manually in that case.
Existing managed instruction, command, or skill files are kept unless `--force`
is explicit.

Installing OpenCode project support does not initialize target knowledge. The
coordinator can run `argos init` at the workspace root when needed.

## Verify

```powershell
argos --version
argos help
argos init --root C:\path\to\target --name target-name
argos status --root C:\path\to\target
argos-mcp
```

`argos-mcp` waits for JSON-RPC input. Press `Ctrl+C` after confirming that it
starts without an error.

## Releases

Pull requests and pushes to `main` run the full test suite on Windows and Linux.
A merge that changes the package version creates the matching `v<version>` tag,
GitHub release, npm tarball, and release notes from that version's changelog
entry. If the tag already exists, the release job stops without replacing it.

## Uninstall

```powershell
npm uninstall -g @rafabd1/argos
```

Uninstalling the runtime does not remove any target `.argos` knowledge base.
