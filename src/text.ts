import { splitLines } from "./paths.js";

/** Strip a trailing line comment and surrounding whitespace, language-aware enough for detectors. */
export function stripLineComment(line: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "s" | "d" | "t" | "block" = "code";
  while (i < line.length) {
    const ch = line[i]!;
    const next = line[i + 1];
    if (state === "s") {
      out += ch;
      if (ch === "\\" && i + 1 < line.length) {
        out += line[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === "'") state = "code";
      i++;
      continue;
    }
    if (state === "d") {
      out += ch;
      if (ch === "\\" && i + 1 < line.length) {
        out += line[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === '"') state = "code";
      i++;
      continue;
    }
    if (state === "t") {
      out += ch;
      if (ch === "\\" && i + 1 < line.length) {
        out += line[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === "`") state = "code";
      i++;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        out += " ";
        i += 2;
        state = "code";
        continue;
      }
      i++;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "#") {
      // Keep hash in shebangs and HTML/CSS colors and anchors, drop Python/Ruby/shell comments.
      const prev = out.trimEnd();
      if (prev.length === 0 || /[\s;{(),=]/.test(out[out.length - 1] ?? " ")) break;
    }
    if (ch === "/" && next === "*") {
      state = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      state = "s";
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      state = "d";
      out += ch;
      i++;
      continue;
    }
    if (ch === "`") {
      state = "t";
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/\s+$/, "");
}

export function isCommentOnly(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return true;
  if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) return true;
  return stripLineComment(line).trim().length === 0;
}

/** True when the line, after stripping comments, has no executable code. */
export function hasCode(line: string): boolean {
  return stripLineComment(line).trim().length > 0;
}

const IGNORE_RE = /codesane-ignore(?:\s*:\s*([A-Za-z0-9_,\-\s]+))?/;

export function ignoreRulesOnLine(line: string): "all" | string[] | undefined {
  const match = line.match(IGNORE_RE);
  if (!match) return undefined;
  const listed = match[1]?.trim();
  if (!listed) return "all";
  const rules = listed
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  return rules.length > 0 ? rules : "all";
}

export function lineIgnoresRule(line: string, rule: string): boolean {
  const ignored = ignoreRulesOnLine(line);
  if (!ignored) return false;
  if (ignored === "all") return true;
  return ignored.includes(rule);
}

export function isSuppressed(newContent: string, line: number | undefined, rule: string): boolean {
  if (line == null || line < 1) return false;
  const lines = splitLines(newContent);
  const current = lines[line - 1];
  if (current && lineIgnoresRule(current, rule)) return true;
  if (line >= 2) {
    const prev = lines[line - 2];
    if (prev && lineIgnoresRule(prev, rule)) return true;
  }
  return false;
}

export function wordHas(text: string, token: string): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${token}([^A-Za-z0-9_]|$)`);
  return re.test(text);
}

export function countMatches(text: string, pattern: RegExp): number {
  const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  const clone = new RegExp(global.source, global.flags);
  return (text.match(clone) ?? []).length;
}

export function firstMatch(text: string, pattern: RegExp): { index: number; text: string } | undefined {
  const clone = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const match = clone.exec(text);
  if (!match) return undefined;
  return { index: match.index, text: match[0] ?? "" };
}
