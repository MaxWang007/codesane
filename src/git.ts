import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DiffFile, DiffHunk, DiffLine, FileStatus } from "./types.js";
import { CodesaneError } from "./types.js";
import { normalizePath, splitLines } from "./paths.js";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function runGit(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_PAGER: "cat", PAGER: "cat" },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? (result.error ? 1 : 0),
  };
}

export function findGitRoot(cwd: string): string {
  const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.code !== 0) {
    throw new CodesaneError(`Not a git repository: ${cwd}`);
  }
  return result.stdout.trim();
}

export function refExists(cwd: string, ref: string): boolean {
  return runGit(cwd, ["rev-parse", "--verify", "--quiet", ref]).code === 0;
}

export function detectDefaultBase(cwd: string): string {
  const originHead = runGit(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead.code === 0) {
    const short = originHead.stdout.trim().replace(/^refs\/remotes\//, "");
    if (refExists(cwd, short)) return short;
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (refExists(cwd, candidate)) return candidate;
  }
  const upstream = runGit(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream.code === 0 && upstream.stdout.trim()) return upstream.stdout.trim();
  return "HEAD";
}

export function resolveBase(cwd: string, requested?: string): string {
  const base = requested ?? detectDefaultBase(cwd);
  if (!refExists(cwd, base)) {
    throw new CodesaneError(`Unknown git ref: ${base}`);
  }
  return base;
}

function parseNameStatus(stdout: string): { status: FileStatus; path: string; oldPath?: string }[] {
  const rows: { status: FileStatus; path: string; oldPath?: string }[] = [];
  for (const line of splitLines(stdout)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const code = line.slice(0, tab).trim();
    const rest = line.slice(tab + 1);
    const parts = rest.split("\t");
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = normalizePath(parts[0] ?? "");
      const path = normalizePath(parts[1] ?? parts[0] ?? "");
      rows.push({ status: "renamed", path, oldPath });
    } else if (code.startsWith("A")) {
      rows.push({ status: "added", path: normalizePath(parts[0] ?? "") });
    } else if (code.startsWith("D")) {
      rows.push({ status: "deleted", path: normalizePath(parts[0] ?? "") });
    } else {
      rows.push({ status: "modified", path: normalizePath(parts[0] ?? "") });
    }
  }
  return rows;
}

function showAt(cwd: string, ref: string, path: string): string {
  const result = runGit(cwd, ["show", `${ref}:${path}`]);
  if (result.code !== 0) return "";
  return result.stdout;
}

export function parseUnifiedDiff(text: string): Map<string, DiffHunk[]> {
  const map = new Map<string, DiffHunk[]>();
  const lines = splitLines(text);
  let currentPath: string | undefined;
  let hunks: DiffHunk[] = [];
  let i = 0;

  const flush = () => {
    if (currentPath) map.set(currentPath, hunks);
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("diff --git ")) {
      flush();
      const parsed = parseDiffGitHeader(line);
      currentPath = parsed ?? currentPath;
      hunks = [];
      i++;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const plus = line.slice(4).trim();
      if (plus !== "/dev/null") {
        currentPath = normalizePath(plus.replace(/^[ab]\//, ""));
      }
      i++;
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      let oldLine = Number(hunkMatch[1]);
      let newLine = Number(hunkMatch[2]);
      const hunk: DiffHunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      i++;
      while (i < lines.length) {
        const hl = lines[i] ?? "";
        if (hl.startsWith("@@ ") || hl.startsWith("diff --git ") || hl.startsWith("diff --")) break;
        if (hl.startsWith("\\")) {
          i++;
          continue;
        }
        const kind = hl[0];
        if (kind === "+") {
          hunk.lines.push({ type: "add", content: hl.slice(1), newLine });
          newLine++;
        } else if (kind === "-") {
          hunk.lines.push({ type: "del", content: hl.slice(1), oldLine });
          oldLine++;
        } else if (kind === " " || hl === "") {
          hunk.lines.push({
            type: "context",
            content: kind === " " ? hl.slice(1) : hl,
            oldLine,
            newLine,
          });
          oldLine++;
          newLine++;
        } else {
          break;
        }
        i++;
      }
      hunks.push(hunk);
      continue;
    }
    i++;
  }
  flush();
  return map;
}

function parseDiffGitHeader(line: string): string | undefined {
  const quoted = line.match(/^diff --git (?:a\/|"a\/)(.+?)(?: "| )(?:b\/|"b\/)(.+?)"?$/);
  if (quoted) return normalizePath((quoted[2] ?? quoted[1] ?? "").replace(/"$/, ""));
  const parts = line.slice("diff --git ".length).split(" ");
  if (parts.length >= 2) {
    const b = parts[parts.length - 1] ?? "";
    return normalizePath(b.replace(/^b\//, ""));
  }
  return undefined;
}

export function getWorktreeDiffs(cwd: string, base: string): DiffFile[] {
  const nameStatus = runGit(cwd, ["diff", "--name-status", "--find-renames", base]);
  if (nameStatus.code !== 0 && nameStatus.stderr.trim()) {
    throw new CodesaneError(nameStatus.stderr.trim() || `git diff ${base} failed`);
  }
  const rows = parseNameStatus(nameStatus.stdout);

  const untracked = runGit(cwd, ["ls-files", "--others", "--exclude-standard"]);
  for (const path of splitLines(untracked.stdout)) {
    const n = normalizePath(path.trim());
    if (!n) continue;
    if (!rows.some((r) => r.path === n)) rows.push({ status: "added", path: n });
  }

  const rawDiff = runGit(cwd, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--unified=3",
    "--find-renames",
    base,
  ]);
  const hunksByPath = parseUnifiedDiff(rawDiff.stdout);

  const files: DiffFile[] = [];
  for (const row of rows) {
    let oldContent = "";
    let newContent = "";
    if (row.status === "added") {
      newContent = readWorktree(cwd, row.path);
    } else if (row.status === "deleted") {
      oldContent = showAt(cwd, base, row.oldPath ?? row.path);
    } else if (row.status === "renamed") {
      oldContent = showAt(cwd, base, row.oldPath ?? row.path);
      newContent = readWorktree(cwd, row.path);
    } else {
      oldContent = showAt(cwd, base, row.path);
      newContent = existsSync(join(cwd, row.path)) ? readWorktree(cwd, row.path) : "";
    }
    files.push({
      path: row.path,
      oldPath: row.oldPath,
      status: row.status,
      oldContent,
      newContent,
      hunks: hunksByPath.get(row.path) ?? hunksByPath.get(row.oldPath ?? "") ?? [],
    });
  }
  return files;
}

function readWorktree(cwd: string, path: string): string {
  const full = join(cwd, path);
  if (!existsSync(full)) return "";
  try {
    return readFileSync(full, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message) return "";
    return "";
  }
}

export function addedLinesOf(file: DiffFile): { line: number; content: string }[] {
  const out: { line: number; content: string }[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && line.newLine != null) {
        out.push({ line: line.newLine, content: line.content });
      }
    }
  }
  return out;
}

export function deletedLinesOf(file: DiffFile): { line: number; content: string }[] {
  const out: { line: number; content: string }[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del" && line.oldLine != null) {
        out.push({ line: line.oldLine, content: line.content });
      }
    }
  }
  return out;
}

/** New-file line numbers that were added (not context) in this diff. */
export function addedLineSet(file: DiffFile): Set<number> {
  const set = new Set<number>();
  for (const row of addedLinesOf(file)) set.add(row.line);
  return set;
}

/** Old-file line numbers that were deleted in this diff. */
export function deletedLineSet(file: DiffFile): Set<number> {
  const set = new Set<number>();
  for (const row of deletedLinesOf(file)) set.add(row.line);
  return set;
}

export function snippetFor(file: DiffFile, pred: (line: DiffLine) => boolean, limit = 6): string {
  const rows: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (!pred(line)) continue;
      const mark = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
      rows.push(`${mark}${line.content}`);
      if (rows.length >= limit) return rows.join("\n");
    }
  }
  return rows.join("\n");
}
