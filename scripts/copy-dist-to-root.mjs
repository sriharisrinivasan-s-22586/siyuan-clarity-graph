import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

copyFileSync(resolve(root, "dist/index.js"), resolve(root, "index.js"));
copyFileSync(resolve(root, "dist/index.css"), resolve(root, "index.css"));

