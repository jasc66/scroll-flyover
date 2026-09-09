#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const filesToInstall = ["SKILL.md", "references"];
const defaultTarget = path.join(os.homedir(), ".claude", "skills", "scroll-flyover");

function packageVersion() {
  const raw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
  return JSON.parse(raw).version;
}

const usage = `scroll-flyover — install the skill files into an agent's skills directory.

Usage:
  npx scroll-flyover [--dir <path>]

Options:
  -d, --dir <path>  Directory to install into. It receives SKILL.md and references/
                    directly, so name the skill's own folder, not its parent.
                    Default: ${defaultTarget}
  -h, --help        Show this message.
  -v, --version     Print the package version.

Examples:
  npx scroll-flyover
      Install for Claude Code, for every project on this machine.

  npx scroll-flyover --dir .claude/skills/scroll-flyover
      Install into the current project only, so it can be committed with the repo.

  npx scroll-flyover --dir ./vendor/scroll-flyover
      Install anywhere else. SKILL.md's frontmatter is Claude Code's format, but the
      file and everything under references/ is plain Markdown that any agent — or
      person — can read.`;

function parseArgs(argv) {
  let dir = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "-v" || arg === "--version") return { version: true };

    if (arg === "-d" || arg === "--dir") {
      dir = argv[++i];
      if (dir === undefined) throw new Error(`${arg} requires a path.`);
      continue;
    }

    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (dir !== null && dir.trim() === "") throw new Error("--dir requires a path.");
  return { dir };
}

function install(target) {
  // Refuse rather than let cpSync fail halfway with a less obvious message.
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${target}`);
  }

  fs.mkdirSync(target, { recursive: true });

  for (const name of filesToInstall) {
    fs.cpSync(path.join(packageRoot, name), path.join(target, name), {
      recursive: true,
      force: true,
    });
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(1);
  }

  if (options.help) {
    console.log(usage);
    return;
  }

  if (options.version) {
    console.log(packageVersion());
    return;
  }

  const isDefaultTarget = options.dir === null;
  const target = isDefaultTarget ? defaultTarget : path.resolve(options.dir);

  try {
    install(target);
  } catch (error) {
    console.error(`Could not install to ${target}\n${error.message}`);
    process.exit(1);
  }

  console.log(`scroll-flyover skill installed to ${target}`);
  console.log(
    isDefaultTarget
      ? "Restart Claude Code (or start a new session) to pick it up."
      : "Point your agent at SKILL.md in that directory."
  );
}

main();
