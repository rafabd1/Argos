# Argos Command Reference

Every CLI command accepts `--root <workspace-root>`. MCP tools require `root` explicitly.

## Knowledge Base

```text
argos init [--name <target>]
argos status
argos vocabulary list
argos vocabulary add --kind node|relation --name <type>
```

MCP: `argos_init`, `argos_status`, `argos_vocabulary_add`.

## Canonical Nodes

```text
argos node resolve --type <type> --title <title> [--aliases <a,b>] [--content <markdown> | --content-file <path|->]
argos node create --type <type> --title <title> [--content <markdown> | --content-file <path|->]
                  [--aliases <a,b>] [--distinct-from <N...,...>]
argos node update --id <N...> [--title <title>] [--content <markdown> | --content-file <path|->]
                  [--aliases <a,b>] [--mode replace|append]
argos node merge --source <N...> --into <N...> --content <reviewed-markdown>
                 [--title <title>] [--aliases <a,b>]
argos node get --id <N...> [--relation-limit <n>]
argos node list [--type <type>] [--limit <n>] [--offset <n>]
argos history --id <N...> [--limit <n>]
```

MCP: `argos_resolve_node`, `argos_create_node`, `argos_update_node`, `argos_merge_nodes`, `argos_get_node`, `argos_list_nodes`, `argos_node_history`.

Use `--content-file -` to read Markdown from stdin. A create result with `resolutionRequired: true` means the caller must inspect candidates. Exact identity returns `canonical` instead of creating a duplicate.
Merge only after both notes are confirmed to be one item. Supply the reviewed final body; Argos preserves aliases and revisions, rewires relations, and redirects the retired ID.

## Relations And Retrieval

```text
argos link add --from <N...> --type <relation> --to <N...>
argos link remove --id <E...>
argos link suggest --id <N...> [--limit <n>]
argos link list [--status pending|accepted|rejected]
argos link accept --id <L...> [--type <relation>]
argos link reject --id <L...>

argos search --query <text> [--type <type>] [--depth <0-3>] [--limit <n>]
argos inspect --id <N...> [--depth <0-5>] [--map-limit <n>] [--relation-limit <n>] [--max-hops <1-7>] [--chain-limit <n>]
argos map --id <N...> [--depth <0-5>] [--limit <n>]
argos chains --from <N...> [--max-hops <1-7>] [--limit <n>]
argos gaps [--id <N...>] [--age-days <n>]
argos stale [--age-days <n>] [--limit <n>]
```

MCP: `argos_add_link`, `argos_remove_link`, `argos_suggest_links`, `argos_review_link_suggestion`, `argos_search`, `argos_inspect_node`, `argos_map`, `argos_find_chains`, `argos_find_gaps`, `argos_list_old_knowledge`.

`inspect` is the normal recovery call after search. It returns the canonical note, a bounded map, objective coverage gaps, nearby sink paths, and pending suggestions without accepting any relation. When `map.truncated` is true, follow `frontierNodeIds` with targeted reads; omitted context is never evidence of absence.

## Obsidian

```text
argos export obsidian [--out <vault-path>] [--prune]
```

MCP: `argos_export_obsidian`.

The export writes one note per node, an index, generated wikilinks, and an Obsidian Canvas. `--prune` removes only files listed in the previous Argos export manifest.

## Chimera Setup

Configuration is user-wide, separate from workspace initialization:

```text
argos chimera config init --opencode-command opencode --model <provider/model> --variant <name> --max-agents 5
argos chimera config show
argos chimera config set [same options] [--network] [--auto-approve]
argos chimera doctor --root <workspace-root>
```

MCP: `argos_chimera_config`, `argos_chimera_doctor`.

## Chimera Sessions

```text
argos chimera start --goal <text> [--role generalist|<skill>] [--nodes <N...,...>]
                     [--access explorer|editor] [--access-notes <exact rules>]
                     [--network true|false] [--auto-approve true|false]
argos chimera list [--active] [--limit <n>]
argos chimera poll [--identity coordinator|<CH...>] [--all] [--peek]
argos chimera send --to coordinator|<CH...> --body <text> [--priority]
argos chimera broadcast --body <text> [--priority]
argos chimera workflow-snapshot --id <CH...> [--limit <n>] [--max-message-chars <n>]
argos chimera kill --id <CH...> [--reason <text>]
argos chimera run --id <CH...> [--message <recovery instruction>]
```

MCP tools use the same names with the `argos_chimera_` prefix.

`start` starts the co-agent in the background. `send --priority` delivers directly to an OpenCode recipient and can resume an idle persisted session. `run` is a recovery command for a stopped session. `workflow-snapshot` returns only bounded user and assistant text, without tool calls or tool output. `broadcast` reaches active sessions only.

Inside a co-agent, source identity comes from `ARGOS_CHIMERA_ID`. Do not pass `from` unless diagnosing identity outside the managed process. Priority has no effect when sending to the coordinator.

## Chimera Council

```text
argos chimera council invite --topic <text> [--participants <CH...,...>] [--max-rounds 2]
argos chimera council accept --id <CC...>
argos chimera council begin --id <CC...> --body <coordinator opening>
argos chimera council turn --id <CC...> --body <one participant turn>
argos chimera council advance --id <CC...> --body <next-round opening> [--extend]
argos chimera council close --id <CC...> --body <final conclusion>
argos chimera council status --id <CC...>
argos chimera council list [--limit <n>]
```

MCP tools are `argos_chimera_council_invite`, `argos_chimera_council_accept`, `argos_chimera_council_begin`, `argos_chimera_council_turn`, `argos_chimera_council_advance`, `argos_chimera_council_close`, `argos_chimera_council_status`, and `argos_chimera_council_list`.

All participants accept before the coordinator begins. Argos enforces one current speaker, records an exclusive ordered transcript, and cues the next participant. At the end of a full participant cycle, control returns to the coordinator. Extending beyond `maxRounds` requires `--extend`.

## OpenCode Host Setup

This is separate from Chimera. It lets OpenCode itself act as the Argos coordinator in a target workspace:

```text
argos opencode install --root <workspace-root>
argos opencode doctor --root <workspace-root>
```

MCP: `argos_opencode_install`, `argos_opencode_doctor`.

The installer preserves unrelated `opencode.json` fields and adds project-local Argos instructions, skills, `/argos`, and the `argos-mcp` entry. It skips modified managed files unless `--force` is explicit.
