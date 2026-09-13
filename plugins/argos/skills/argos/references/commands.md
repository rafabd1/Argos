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
Use `node update` when the same item's current interpretation, version, payload, or proof changes. Internal revisions retain the earlier text; do not create historical or generic copies to preserve old tests.
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

`inspect` is the normal recovery call after search. It returns the canonical note, a bounded map, objective coverage gaps, directed technical sink paths, separate direct context relations, and pending suggestions without accepting any relation. `chains` remains a compatibility alias of `technicalChains` in this response. When `map.truncated` is true, follow `frontierNodeIds` with targeted reads; omitted context is never evidence of absence.

## Obsidian

```text
argos export obsidian [--out <vault-path>] [--prune]
argos obsidian sync enable [--out <vault-path>] [--interval-seconds <n>] [--prune true|false]
argos obsidian sync status
argos obsidian sync refresh
argos obsidian sync disable
```

MCP: `argos_export_obsidian`, `argos_obsidian_sync`.

The export writes one note per node, one outgoing wikilink per directed relation, a compact index, and `Argos Explorer.base`. Incoming relations remain readable without creating reverse graph edges. Each normal Argos operation refreshes a due projection at the 30-second default interval. `refresh` forces it now. A manual disable persists for that workspace until `enable` turns it back on. Internal vault paths follow the current tool root after a move or copy. Pruning removes only unchanged files listed in the previous Argos export manifest. Retired generated Canvas files are removed only when their recorded hash still matches.

## OpenCode Host Setup

This lets OpenCode act as the Argos coordinator in a target workspace:

```text
argos opencode install --root <workspace-root>
argos opencode doctor --root <workspace-root>
```

MCP: `argos_opencode_install`, `argos_opencode_doctor`.

The installer preserves unrelated `opencode.json` fields and adds project-local Argos instructions, skills, `/argos`, and the `argos-mcp` entry. It skips modified managed files unless `--force` is explicit.
