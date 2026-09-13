# Argos Chimera

Chimera runs independent OpenCode co-agents under one Argos coordinator. Each
co-agent receives a complete goal, selected graph context, its own lab, Argos
skills, a persistent OpenCode session, and a shared message channel.

Normal Argos knowledge, CLI, MCP, skills, and Obsidian export work without
Chimera.

## Global Configuration

Install and configure OpenCode through its
[official repository](https://github.com/anomalyco/opencode). Then configure
Chimera once for the current user:

```powershell
argos chimera config init --opencode-command opencode --model provider/model --variant high --max-agents 5
argos chimera config show
argos chimera doctor --root C:\path\to\target
```

The defaults apply across workspaces. `maxAgents` defaults to 5. Global
`--network` allows OpenCode web tools by default. A session can override model,
variant, network, and autoapproval when it starts. Agent name, network access,
autoapproval, model, variant, and command are captured by each new session so
later global changes do not silently alter an existing co-agent.

Argos reuses a healthy configured OpenCode server or a healthy loopback server
on ports 4096 through 4115. If none exists, it starts one on `127.0.0.1` and
stores its URL for later sessions.

## Start A Co-agent

```powershell
argos chimera start --root C:\path\to\target --role chain-discovery --goal "Map every natural producer of N000012, test the two strongest sink paths, and stop after posting a scoped result." --nodes N000012,N000019 --access explorer
```

Session overrides are explicit booleans:

```powershell
argos chimera start --root C:\path\to\target --goal "Compare upstream parser behavior." --access explorer --network true --auto-approve false
```

`start` creates the session and launches it in the background. The initial
status is `starting`; it changes to `running` when OpenCode begins. A completed,
aborted, or failed execution becomes `stopped` and remains resumable.

Use `generalist` for a broad independent front or a packaged skill name for a
specialist front. The dossier contains the selected canonical notes and their
bounded maps. Every co-agent can load the Chimera operating skill and the
specialist research methods without placing them all in the prompt. A
specialist loads its named method first, but can combine another method when the
graph requires it; the role is a focus, not a capability boundary. The
coordinator-only `argos` entrypoint is not injected into co-agent sessions.

The goal should include the research question, relevant target context,
authorization limits, expected output, and a clear stop condition. Co-agents
continue independently until that condition, a real blocker, or a coordinator
stop.

## Access

`explorer` gives read access to the target and write access inside the session
lab. `editor` still uses lab-only writes unless `--access-notes` names each
allowed path and action:

```powershell
argos chimera start --root C:\path\to\target --goal "Build and run the parser harness." --access editor --access-notes "Read the target. Write only src/test-fixtures/argos-parser/ and the session lab. Shell commands must be non-destructive."
```

Every generated agent instruction names the shared target root. Co-agents must
use that root for Argos commands and must not initialize a second graph inside
their session or lab. In explorer mode, OpenCode edit tools deny other paths and
allow the session lab. Shell commands run with the host process authority and
must follow the same path boundary stated in the co-agent instructions.

## Session Control

```powershell
argos chimera list --root C:\path\to\target --active
argos chimera poll --root C:\path\to\target --identity coordinator
argos chimera workflow-snapshot --root C:\path\to\target --id CH-0001 --limit 8 --max-message-chars 1200
argos chimera kill --root C:\path\to\target --id CH-0001 --reason "Scope changed"
```

`list --active` returns only `starting` and `running` sessions. `poll` reads the
Argos inbox and reconciles current OpenCode state. `workflow-snapshot` reads a
bounded tail of user and assistant text from the live OpenCode session. It
excludes tool calls and tool output and falls back to a file-backed OpenCode
export when the API is unavailable.

`kill` calls the OpenCode abort API, signals the tracked worker tree, and marks
the session stopped. It keeps the dossier, lab, transcript, and OpenCode session
ID.

## Resume And Recovery

Send a normal priority message to continue an existing OpenCode session:

```powershell
argos chimera send --root C:\path\to\target --to CH-0001 --priority --body "Reopen the producer map with the new boundary relation and report the delta."
```

This uses OpenCode's asynchronous prompt API and does not resend the initial
dossier. If a session has no OpenCode ID yet, priority delivery starts its
worker so the queued message can be read.

Use `run` only when a stopped worker needs explicit recovery and direct message
delivery cannot resume it:

```powershell
argos chimera run --root C:\path\to\target --id CH-0001 --message "Recover the same goal after the runtime failure."
```

`run` reuses the existing goal, lab, dossier, and OpenCode session. It rejects
`starting` and `running` sessions. Session claiming is atomic, so concurrent
recovery attempts cannot launch two workers for the same Chimera ID.

## Messages

One command handles coordinator-to-agent, agent-to-coordinator, and
agent-to-agent messages:

```powershell
argos chimera send --root C:\path\to\target --to CH-0002 --body "N000019 now has a second producer." --priority
argos chimera send --root C:\path\to\target --to coordinator --body "The alternate producer survived the negative control."
argos chimera broadcast --root C:\path\to\target --body "Recheck maps that depend on N000019."
```

Managed co-agents inherit their source identity from `ARGOS_CHIMERA_ID`.
Priority asks OpenCode to deliver directly when the recipient is a co-agent. It
is ignored when the recipient is the coordinator, who reads through `poll`.
Broadcast reaches active co-agents only.

Message insertion and unread polling are transactional. Two simultaneous polls
cannot both consume the same unread message.

## Council

A council is a short ordered discussion for a pivot, shared premise, or weak
progress that benefits from several independent views.

1. The coordinator invites named agents, or all active agents when participants
   are omitted.
2. Each co-agent accepts at a safe pause point.
3. The coordinator begins with the question and its current view.
4. Argos sends the complete council transcript to the first participant.
5. Each participant submits one turn. Argos advances and cues the next agent.
6. Control returns to the coordinator after every participant spoke.
7. The coordinator advances another round or closes with one conclusion.

```powershell
argos chimera council invite --root C:\path\to\target --topic "Which premise should be tested next?" --participants CH-0001,CH-0002 --max-rounds 2
argos chimera council begin --root C:\path\to\target --id CC-0001 --body "Challenge the current producer assumption and rank decisive tests."
argos chimera council advance --root C:\path\to\target --id CC-0001 --body "Use the first-round evidence to choose one test."
argos chimera council close --root C:\path\to\target --id CC-0001 --body "Test the direct producer first; reopen the state path only if it survives."
```

Inside a managed co-agent:

```powershell
argos chimera council accept --root C:\path\to\target --id CC-0001
argos chimera council turn --root C:\path\to\target --id CC-0001 --body "The second producer changes the guard premise; trace it before fuzzing."
```

Only the current speaker can write a turn. Argos records the ordered transcript
and advances the turn in one transaction. The default two-round limit prevents
an open-ended exchange; `--extend` is required to exceed it. Closing sends the
coordinator conclusion and tells each participant to resume or apply the pivot.
