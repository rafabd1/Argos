# Argos CLI And MCP

Every target operation needs the workspace root. The CLI accepts `--root`; MCP
tools require `root`. Keep the same root throughout a target so agents share one
knowledge graph.

## Initialize And Inspect

```powershell
argos init --root C:\path\to\target --name target-name
argos status --root C:\path\to\target
argos vocabulary list --root C:\path\to\target
```

Add a vocabulary type only when the item or relation has a stable meaning that
the default vocabulary cannot express:

```powershell
argos vocabulary add --root C:\path\to\target --kind node --name protocol_message
argos vocabulary add --root C:\path\to\target --kind relation --name deserializes
```

MCP: `argos_init`, `argos_status`, `argos_vocabulary_add`.

## Canonical Nodes

Resolve before creating when the identity may already exist:

```powershell
argos node resolve --root C:\path\to\target --type sink --title "Archive file write" --aliases "writeEntry,src/importer.ts" --content "Calls `writeEntry` with the normalized path."
```

Create or update free-form Markdown:

```powershell
argos node create --root C:\path\to\target --type sink --title "Archive file write" --content-file sink.md --aliases "writeEntry"
argos node update --root C:\path\to\target --id N000012 --mode append --content "A second producer reaches this sink."
argos node merge --root C:\path\to\target --source N000021 --into N000012 --content-file consolidated.md
argos node get --root C:\path\to\target --id N000012 --relation-limit 200
argos node list --root C:\path\to\target --type sink --limit 50 --offset 0
argos history --root C:\path\to\target --id N000012 --limit 20
```

Use `--content-file -` to read Markdown from stdin. Exact identity returns
`canonical` with `created: false`. A strong ambiguous match returns
`resolutionRequired: true` and exits with code 2. After review, pass the checked
IDs through `--distinct-from` only when the item is genuinely separate.

`node update` requires at least one of title, content, or aliases. An identical
replacement and an empty append are no-ops: they create no revision and do not
refresh `updatedAt`.

Use an update when the same item's current interpretation, version, payload, or
proof changes. Historical tests keep their scope in their own note; they do not
require a generic or former copy of the target item in the visible graph.

Use `node merge` only after confirming that two nodes describe the same real
item. The supplied Markdown becomes the reviewed canonical body. Argos keeps
both note histories, folds source names into aliases, rewires relations and
suggestions, and resolves later reads of the retired ID to the destination.

MCP: `argos_resolve_node`, `argos_create_node`, `argos_update_node`,
`argos_merge_nodes`, `argos_get_node`, `argos_list_nodes`,
`argos_node_history`.

## Relations

```powershell
argos link add --root C:\path\to\target --from N000003 --type flows_to --to N000012
argos link remove --root C:\path\to\target --id E000019
argos link suggest --root C:\path\to\target --id N000012 --limit 10
argos link list --root C:\path\to\target --status pending
argos link accept --root C:\path\to\target --id L000004 --type influences
argos link reject --root C:\path\to\target --id L000005
```

Suggestions never alter the graph until accepted. Acceptance may replace the
suggested `related_to` with a more exact relation. A rejected suggestion can
return to pending when either endpoint changes and a later discovery pass
proposes the relation again.

MCP: `argos_add_link`, `argos_remove_link`, `argos_suggest_links`,
`argos_review_link_suggestion`.

## Search And Recovery

```powershell
argos search --root C:\path\to\target --query "signed URL object key" --depth 2 --limit 20
argos inspect --root C:\path\to\target --id N000012 --depth 2 --map-limit 80 --relation-limit 200 --max-hops 5 --chain-limit 10
argos map --root C:\path\to\target --id N000012 --depth 3 --limit 80
argos chains --root C:\path\to\target --from N000012 --max-hops 5 --limit 20
argos gaps --root C:\path\to\target --id N000012 --age-days 90
argos stale --root C:\path\to\target --age-days 90 --limit 100
```

Search returns lexical and structural matches with reasons and distance.
`inspect` is the usual next call for a likely center. `map` is useful when the
caller needs a wider neighborhood, while `chains` focuses on paths that reach
another sink through directed technical relations. Inspection returns those
paths as both `technicalChains` and the backward-compatible `chains`, while
`contextRelations` keeps direct structure, evidence, and provenance separate.
Maps report `truncated`, omitted counts, and a bounded frontier;
follow that frontier with targeted reads instead of treating omitted context as
evidence that a relation is absent.

MCP: `argos_search`, `argos_inspect_node`, `argos_map`, `argos_find_chains`,
`argos_find_gaps`, `argos_list_old_knowledge`.

## Obsidian

```powershell
argos export obsidian --root C:\path\to\target
argos export obsidian --root C:\path\to\target --out C:\vaults\target --prune
argos obsidian sync status --root C:\path\to\target
argos obsidian sync enable --root C:\path\to\target --out C:\vaults\target --interval-seconds 30
argos obsidian sync refresh --root C:\path\to\target
argos obsidian sync disable --root C:\path\to\target
```

The default output is `<root>/.argos/obsidian`. Every normal Argos operation
checks whether the graph changed and whether the 30-second default interval has
elapsed. A due export runs before that command returns and uses safe pruning.
`refresh` forces it immediately. A manual disable remains in effect for that
workspace until `enable` turns it back on.

The state contains no persistent process or fixed workspace root. Internal
vault paths follow the `root` passed by the current tool after a move or copy.
External custom vault paths remain unchanged.

`--prune` on a manual export removes old generated
note filenames after renames. It only removes paths recorded in the Argos
manifest and contained inside the output directory. Hashes protect stale files
that a user edited after export; those files are retained and counted as
`modifiedFilesPreserved`. The same fail-safe applies to files inherited from a
legacy manifest that has no hash.

MCP: `argos_export_obsidian`, `argos_obsidian_sync`.

## OpenCode Project Support

```powershell
argos opencode install --root C:\path\to\target
argos opencode doctor --root C:\path\to\target
```

Use `--force` only to replace modified Argos-managed OpenCode files. The
installer always preserves unrelated fields in a valid strict-JSON
`opencode.json`.

MCP: `argos_opencode_install`, `argos_opencode_doctor`.

## Exit Behavior

CLI success writes one JSON value to stdout. Errors write a short message to
stderr and exit nonzero. Canonical ambiguity uses exit code 2 so automation can
distinguish review from a runtime failure.

MCP errors return `isError: true` with `{ ok: false, error }` in structured
content. Successful tools return their JSON object as structured content and a
formatted text copy.
