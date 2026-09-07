#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const packageRoot = path.join(__dirname, "..");
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
