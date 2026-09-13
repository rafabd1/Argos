import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function resolveCommandFile(command: string): string {
  if (process.platform !== "win32") return command;

  const candidates = commandCandidates(command);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".exe" || extension === ".com") return candidate;
    if (extension === ".cmd" || extension === ".bat" || extension === ".ps1") {
      const target = resolveShimExecutable(candidate);
      if (target) return target;
    }
  }
  return command;
}

function commandCandidates(command: string): string[] {
  const hasDirectory = path.isAbsolute(command) || command.includes("/") || command.includes("\\");
  const roots = hasDirectory
    ? [path.resolve(command)]
    : String(process.env.PATH ?? "")
      .split(path.delimiter)
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .map((entry) => path.join(entry, command));
  const extensions = path.extname(command) ? [""] : [".exe", ".com", ".cmd", ".bat", ".ps1", ""];
  return [...new Set(roots.flatMap((root) => extensions.map((extension) => `${root}${extension}`)))];
}

function resolveShimExecutable(shimPath: string): string | null {
  let source: string;
  try {
    source = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }

  const base = path.dirname(shimPath);
  const adjacentOpenCode = path.join(base, "node_modules", "opencode-ai", "bin", "opencode.exe");
  if (fs.existsSync(adjacentOpenCode)) return adjacentOpenCode;

  for (const match of source.matchAll(/["']([^"'\r\n]*\.exe)["']/gi)) {
    const expanded = match[1]
      .replace(/^%~?dp0%?[\\/]?/i, "")
      .replace(/^\$basedir[\\/]?/i, "")
      .replace(/\//g, path.sep);
    const target = path.resolve(base, expanded);
    if (fs.existsSync(target)) return target;
  }
  return null;
}
