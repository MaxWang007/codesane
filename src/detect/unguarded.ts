import type { DiffFile, DiffLine, Finding } from "../types.js";
import { addedLinesOf, deletedLinesOf } from "../git.js";
import { isCommentOnly, isSuppressed, stripLineComment } from "../text.js";

/**
 * Specific auth / permission / validation identifiers.
 * Kept tight: bare words like "if" or "auth" are not enough.
 */
export const GUARD_TOKENS = [
  "requireAuth",
  "requireLogin",
  "requireUser",
  "requireAdmin",
  "requireRole",
  "requirePermission",
  "checkAuth",
  "checkAuthentication",
  "checkPermission",
  "checkRole",
  "isAuthenticated",
  "isAuthorized",
  "hasPermission",
  "hasRole",
  "canAccess",
  "authorizeRequest",
  "authorizeUser",
  "authorize",
  "verifyToken",
  "verifyJwt",
  "verifyJWT",
  "verifyCsrf",
  "verifyAuth",
  "csrfProtect",
  "csrfToken",
  "csrf",
  "validateRequest",
  "validateToken",
  "assertPermission",
  "assertAuthenticated",
  "assertAuthorized",
  "assertLoggedIn",
  "sanitizeHtml",
  "sanitizeInput",
  "sanitize",
  "ensureAuth",
  "ensureAuthenticated",
  "authMiddleware",
  "requireAuthMiddleware",
] as const;

const TOKEN_RE = new RegExp(`\\b(${GUARD_TOKENS.join("|")})\\b`);

export function guardTokensIn(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    const token = match[1];
    if (token && !found.includes(token)) found.push(token);
  }
  return found;
}

function codeTokens(line: string): string[] {
  if (isCommentOnly(line)) return [];
  return guardTokensIn(stripLineComment(line));
}

/** Tokens added as real code (not comments) anywhere in the given diffs. */
export function addedGuardTokens(files: DiffFile[]): Set<string> {
  const set = new Set<string>();
  for (const file of files) {
    for (const row of addedLinesOf(file)) {
      for (const token of codeTokens(row.content)) {
        set.add(token.toLowerCase());
      }
    }
  }
  return set;
}

function evidenceLines(file: DiffFile, oldLine: number): string {
  const rows: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del" && line.oldLine === oldLine) {
        rows.push(`-${line.content}`);
      }
      if (line.type === "add" && nearbyComment(line, oldLine)) {
        rows.push(`+${line.content}`);
      }
    }
  }
  return rows.join("\n");
}

function nearbyComment(line: DiffLine, oldLine: number): boolean {
  if (line.type !== "add" || line.newLine == null) return false;
  // A commented-out guard usually lands at the same or a very close new line.
  return Math.abs((line.newLine ?? 0) - oldLine) <= 4 && isCommentOnly(line.content);
}

function reportLine(file: DiffFile, oldLine: number): number {
  for (const hunk of file.hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!;
      if (line.type !== "del" || line.oldLine !== oldLine) continue;
      for (let j = i + 1; j < hunk.lines.length; j++) {
        const nxt = hunk.lines[j]!;
        if (nxt.newLine != null) return nxt.newLine;
      }
      for (let j = i - 1; j >= 0; j--) {
        const prev = hunk.lines[j]!;
        if (prev.newLine != null) return prev.newLine;
      }
      return hunk.newStart;
    }
  }
  return oldLine;
}

export function detectUnguarded(file: DiffFile, addedTokens: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const row of deletedLinesOf(file)) {
    if (isCommentOnly(row.content)) continue;
    const tokens = codeTokens(row.content);
    if (tokens.length === 0) continue;
    const unresolved = tokens.filter((t) => !addedTokens.has(t.toLowerCase()));
    if (unresolved.length === 0) continue;
    const line = reportLine(file, row.line);
    const contentForIgnore = file.newContent || file.oldContent;
    if (isSuppressed(contentForIgnore, line, "unguarded")) continue;
    if (file.oldContent && isSuppressed(file.oldContent, row.line, "unguarded")) continue;
    findings.push({
      rule: "unguarded",
      severity: "error",
      path: file.path,
      line,
      message: `Removed ${unresolved.join(", ")} guard without a replacement in this diff`,
      evidence: evidenceLines(file, row.line),
    });
  }
  return findings;
}
