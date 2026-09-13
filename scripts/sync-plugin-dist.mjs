import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "dist");
const destination = path.join(root, "plugins", "argos", "dist");

if (!fs.existsSync(source)) throw new Error(`Missing build output: ${source}`);
if (!destination.startsWith(`${path.join(root, "plugins", "argos")}${path.sep}`)) {
  throw new Error("Refusing to sync plugin output outside plugins/argos");
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
