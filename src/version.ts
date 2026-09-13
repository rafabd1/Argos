import fs from "node:fs";
import path from "node:path";

export function packageVersion(runtimeDir = __dirname): string {
  const candidates = [
    path.resolve(runtimeDir, "..", "package.json"),
    path.resolve(runtimeDir, "..", ".codex-plugin", "plugin.json"),
    path.resolve(runtimeDir, "..", ".claude-plugin", "plugin.json"),
    path.resolve(runtimeDir, "..", "..", "..", "package.json")
  ];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof value.version === "string" && value.version.trim()) return value.version.trim();
    } catch {}
  }
  return "0.0.0";
}
