import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CodesaneConfig, DiffFile, Finding } from "../src/types.js";
import { parseUnifiedDiff } from "../src/git.js";
import { detectWeakening } from "../src/detect/index.js";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const require = createRequire(join(REPO_ROOT, "package.json"));
export const TSX_LOADER = pathToFileURL(require.resolve("tsx")).href;

export interface SpawnResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[]): SpawnResult {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=codesane-test",
      "-c",
      "user.email=codesane@test.local",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runCli(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): SpawnResult {
  const result = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd: cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...(env ?? {}) },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function diffFile(path: string, oldContent: string, newContent: string): DiffFile {
  const dir = mkdtempSync(join(tmpdir(), "codesane-diff-"));
  const oldPath = join(dir, "old");
  const newPath = join(dir, "new");
  writeFileSync(oldPath, oldContent);
  writeFileSync(newPath, newContent);
  const result = spawnSync(
    "git",
    ["-c", "core.quotepath=false", "diff", "--no-index", "--no-ext-diff", "--no-color", "--unified=3", oldPath, newPath],
    { encoding: "utf8", env: { ...process.env, GIT_PAGER: "cat", PAGER: "cat" } },
  );
  rmSync(dir, { recursive: true, force: true });
  const hunks = [...parseUnifiedDiff(result.stdout ?? "").values()].flat();
  let status: DiffFile["status"] = "modified";
  if (!oldContent && newContent) status = "added";
  else if (oldContent && !newContent) status = "deleted";
  return { path, status, oldContent, newContent, hunks };
}

export function findingsFor(
  path: string,
  oldContent: string,
  newContent: string,
  config: CodesaneConfig = {},
): Finding[] {
  return detectWeakening([diffFile(path, oldContent, newContent)], config);
}

export function findingsForFiles(files: DiffFile[], config: CodesaneConfig = {}): Finding[] {
  return detectWeakening(files, config);
}

export function rulesOf(findings: Finding[]): string[] {
  return findings.filter((f) => !f.allowed).map((f) => f.rule);
}

/** Commit `before` files, then apply `after` as an uncommitted worktree. */
export function makeRepo(files: Record<string, string>, after?: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), "codesane-repo-"));
  writeTree(dir, files);
  const init = git(dir, ["init", "-b", "main"]);
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  git(dir, ["add", "-A"]);
  const commit = git(dir, ["commit", "-m", "before", "--allow-empty"]);
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}\n${commit.stdout}`);
  if (after) writeTree(dir, after);
  return dir;
}

function writeTree(dir: string, files: Record<string, string | null>): void {
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    if (content == null) {
      if (existsSync(dest)) rmSync(dest, { force: true });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}

const TEMPS: string[] = [];

export function trackTemp(dir: string): string {
  TEMPS.push(dir);
  return dir;
}

export function cleanupTemps(): void {
  for (const dir of TEMPS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { join };
