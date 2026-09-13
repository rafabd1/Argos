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

export function defaultVaultPath(root: string): string {
  return path.join(argosDir(root), "obsidian");
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
