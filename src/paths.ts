import fs from "node:fs";
import path from "node:path";

export function resolveTargetRoot(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

export function argosDir(root: string): string {
  return path.join(root, ".argos");
}

export function knowledgePath(root: string): string {
  return path.join(argosDir(root), "knowledge.sqlite");
}

export function configPath(root: string): string {
  return path.join(argosDir(root), "config.json");
}

export function defaultVaultPath(root: string, targetName: string): string {
  return path.join(argosDir(root), "obsidian", safeVaultName(targetName));
}

export function safeVaultName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .replace(/[. ]+$/g, "");
  const name = cleaned || "Argos target";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name) ? `_${name}` : name;
}

export function obsidianSyncStatePath(root: string): string {
  return path.join(argosDir(root), "obsidian-sync.json");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (process.platform !== "win32" || !fs.existsSync(filePath)) throw error;
    fs.copyFileSync(temporary, filePath);
    fs.unlinkSync(temporary);
  }
}
