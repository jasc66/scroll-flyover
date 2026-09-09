#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(os.homedir(), ".claude", "skills", "scroll-flyover");

const filesToInstall = ["SKILL.md", "references"];

fs.mkdirSync(targetDir, { recursive: true });

for (const name of filesToInstall) {
  fs.cpSync(path.join(packageRoot, name), path.join(targetDir, name), {
    recursive: true,
  });
}

console.log(`scroll-flyover skill installed to ${targetDir}`);
console.log("Restart Claude Code (or start a new session) to pick it up.");
