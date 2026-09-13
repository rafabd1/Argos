#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const candidates = [
  path.join(pluginRoot, "dist", "mcp.js"),
  path.join(repoRoot, "dist", "mcp.js")
];
let server = candidates.find((candidate) => fs.existsSync(candidate));

if (!server) {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  server = path.join(repoRoot, "dist", "mcp.js");
}

require(server);
