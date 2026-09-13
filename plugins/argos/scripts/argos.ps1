$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $pluginRoot)
$cli = @(
  (Join-Path $pluginRoot "dist\cli.js"),
  (Join-Path $repoRoot "dist\cli.js")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cli) { throw "Argos CLI build not found" }
& node $cli @args
exit $LASTEXITCODE
