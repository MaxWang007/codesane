import type { DiffFile, Finding } from "../types.js";
import { addedLineSet, addedLinesOf, snippetFor } from "../git.js";
import { isCommentOnly, isSuppressed, stripLineComment } from "../text.js";
import { langFamily, lineNumberAt, splitLines } from "../paths.js";

const STUB_LINE = [
  { id: "not-implemented", pattern: /\bnot\s+implemented\b/i, label: "`not implemented`" },
  { id: "not-implemented-error", pattern: /\bNotImplementedError\b/, label: "`NotImplementedError`" },
  { id: "unimplemented", pattern: /\bunimplemented!\s*\(/, label: "`unimplemented!()`" },
  { id: "todo-macro", pattern: /\btodo!\s*\(/, label: "`todo!()`" },
  { id: "throw-todo", pattern: /\bthrow\s+new\s+Error\s*\(\s*['"`]TODO\b/i, label: "throw new Error('TODO')" },
  { id: "todo-implement-hash", pattern: /#\s*TODO:\s*implement\b/i, label: "`# TODO: implement`" },
  { id: "todo-implement-slash", pattern: /\/\/\s*TODO:\s*implement\b/i, label: "`// TODO: implement`" },
  { id: "fixme-implement", pattern: /(?:#|\/\/)\s*(?:FIXME|XXX):\s*implement\b/i, label: "`FIXME: implement`" },
];

interface StubFn {
  startLine: number;
  endLine: number;
  name: string;
  exported: boolean;
  body: string;
  header: string;
}

function isStubBody(body: string): boolean {
  const lines = splitLines(body);
  let sawCode = false;
  for (const line of lines) {
    if (isCommentOnly(line)) {
      continue;
    }
    const code = stripLineComment(line).trim();
    if (!code || /^[\s{}[\](),;]*$/.test(code)) continue;
    if (/^(pass|\.\.\.|return;?|return\s+undefined\s*;?|return\s+None|return\s+nil|nil|None)$/.test(code)) {
      continue;
    }
    if (
      /\bnot\s+implemented\b/i.test(code) ||
      /\bNotImplementedError\b/.test(code) ||
      /\b(todo|unimplemented)!\s*\(/.test(code) ||
      /\bthrow\s+new\s+Error\s*\(\s*['"`](?:TODO|not implemented)\b/i.test(code)
    ) {
      continue;
    }
    sawCode = true;
  }
  if (sawCode) return false;
  // An empty / pass / return; body counts as a stub. A TODO comment alone also does.
  return true;
}

function hasTodoComment(body: string, header: string): boolean {
  return /(?:TODO|FIXME|XXX)/i.test(body) || /(?:TODO|FIXME|XXX)/i.test(header);
}

function findJsFunctions(content: string): StubFn[] {
  const out: StubFn[] = [];
  const re =
    /(?:^|\n)([ \t]*)((?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) != null) {
    const header = match[2] ?? "";
    const name = match[3] ?? "";
    const exported = /^\s*export\b/.test(header);
    const braceAt = (match.index ?? 0) + (match[0]?.lastIndexOf("{") ?? 0);
    const close = matchBrace(content, braceAt);
    if (close < 0) continue;
    const body = content.slice(braceAt + 1, close);
    const startLine = lineNumberAt(content, match.index + (match[1]?.length ?? 0) + 1);
    const endLine = lineNumberAt(content, close);
    out.push({ startLine, endLine, name, exported, body, header });
  }

  const arrow =
    /(?:^|\n)([ \t]*)((?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w]+)\s*(?::\s*[^=]+)?=>\s*)/g;
  while ((match = arrow.exec(content)) != null) {
    const header = match[2] ?? "";
    const name = match[3] ?? "";
    const exported = /^\s*export\b/.test(header);
    const bodyStart = (match.index ?? 0) + match[0].length;
    let body: string;
    let endIdx: number;
    if (content[bodyStart] === "{") {
      endIdx = matchBrace(content, bodyStart);
      if (endIdx < 0) continue;
      body = content.slice(bodyStart + 1, endIdx);
    } else {
      endIdx = bodyStart;
      while (endIdx < content.length && content[endIdx] !== "\n" && content[endIdx] !== ";") endIdx++;
      body = `return ${content.slice(bodyStart, endIdx)}`;
    }
    const startLine = lineNumberAt(content, match.index + (match[1]?.length ?? 0) + 1);
    const endLine = lineNumberAt(content, endIdx);
    out.push({ startLine, endLine, name, exported, body, header });
  }
  return out;
}

function matchBrace(content: string, openIdx: number): number {
  if (content[openIdx] !== "{") return -1;
  let depth = 0;
  let state: "code" | "s" | "d" | "t" | "line" | "block" = "code";
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];
    if (state === "line") {
      if (ch === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i++;
      }
      continue;
    }
    if (state === "s") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") state = "code";
      continue;
    }
    if (state === "d") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') state = "code";
      continue;
    }
    if (state === "t") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "`") state = "code";
      continue;
    }
    if (ch === "/" && next === "/") {
      state = "line";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block";
      i++;
      continue;
    }
    if (ch === "'") {
      state = "s";
      continue;
    }
    if (ch === '"') {
      state = "d";
      continue;
    }
    if (ch === "`") {
      state = "t";
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findPyFunctions(content: string): StubFn[] {
  const lines = splitLines(content);
  const out: StubFn[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const m = raw.match(/^([ \t]*)((?:async\s+)?def\s+(\w+)\s*\([^)]*\))\s*:/);
    if (!m) continue;
    const indent = (m[1] ?? "").replace(/\t/g, "    ").length;
    const name = m[3] ?? "";
    const header = m[2] ?? raw;
    const startLine = i + 1;
    let j = i + 1;
    const bodyLines: string[] = [];
    while (j < lines.length) {
      const row = lines[j] ?? "";
      if (!row.trim()) {
        bodyLines.push(row);
        j++;
        continue;
      }
      const ind = (row.match(/^([ \t]*)/)?.[1] ?? "").replace(/\t/g, "    ").length;
      if (ind <= indent && row.trim() && !row.trim().startsWith("#")) break;
      bodyLines.push(row);
      j++;
    }
    // Module-level functions are "exported" in the Python sense of being public API
    // when they do not start with an underscore and sit at indent 0.
    const exported = indent === 0 && !name.startsWith("_");
    out.push({
      startLine,
      endLine: Math.max(startLine, j),
      name,
      exported,
      body: bodyLines.join("\n"),
      header,
    });
  }
  return out;
}

function findFunctions(path: string, content: string): StubFn[] {
  const family = langFamily(path);
  if (family === "js") return findJsFunctions(content);
  if (family === "py") return findPyFunctions(content);
  return [];
}

function functionIsNew(fn: StubFn, added: Set<number>): boolean {
  for (let line = fn.startLine; line <= fn.endLine; line++) {
    if (added.has(line)) return true;
  }
  return false;
}

function headerIsNew(fn: StubFn, added: Set<number>): boolean {
  return added.has(fn.startLine);
}

export function detectStub(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const addedSet = addedLineSet(file);

  for (const row of addedLinesOf(file)) {
    const hits = STUB_LINE.filter((p) => p.pattern.test(row.content));
    if (hits.length === 0) continue;
    if (isSuppressed(file.newContent, row.line, "stub")) continue;
    findings.push({
      rule: "stub",
      severity: "error",
      path: file.path,
      line: row.line,
      message: `Unfinished work left in the diff (${hits.map((h) => h.label).join(", ")})`,
      evidence: snippetFor(file, (l) => l.type === "add" && l.newLine === row.line),
    });
  }

  const funcs = findFunctions(file.path, file.newContent);
  for (const fn of funcs) {
    if (!functionIsNew(fn, addedSet)) continue;
    if (!isStubBody(fn.body)) continue;
    // Newly added exported/public function whose body is only a stub.
    // Non-exported functions are only flagged when a TODO/FIXME/XXX is present,
    // or when the body itself uses a not-implemented form (already caught above
    // if those words sit on added lines).
    const unfinishedMarker = hasTodoComment(fn.body, fn.header) || /not\s+implemented|NotImplementedError|todo!|unimplemented!/i.test(fn.body);
    if (!fn.exported && !unfinishedMarker) continue;
    if (!fn.exported && unfinishedMarker && !headerIsNew(fn, addedSet) && !addedLinesIn(fn, addedSet)) {
      continue;
    }
    if (isSuppressed(file.newContent, fn.startLine, "stub")) continue;
    let ignored = false;
    for (let line = fn.startLine; line <= fn.endLine; line++) {
      if (isSuppressed(file.newContent, line, "stub")) {
        ignored = true;
        break;
      }
    }
    if (ignored) continue;
    if (findings.some((f) => f.line != null && f.line >= fn.startLine && f.line <= fn.endLine && f.rule === "stub")) {
      continue;
    }
    findings.push({
      rule: "stub",
      severity: "error",
      path: file.path,
      line: fn.startLine,
      message: fn.exported
        ? `Newly added exported function '${fn.name}' is only a stub`
        : `Newly added function '${fn.name}' is unfinished`,
      evidence: snippetFor(
        file,
        (l) =>
          (l.type === "add" && l.newLine != null && l.newLine >= fn.startLine && l.newLine <= fn.endLine) ||
          (l.type === "context" && l.newLine != null && l.newLine >= fn.startLine && l.newLine <= fn.endLine),
        8,
      ),
    });
  }

  return findings;
}

function addedLinesIn(fn: StubFn, added: Set<number>): boolean {
  for (let line = fn.startLine; line <= fn.endLine; line++) {
    if (added.has(line)) return true;
  }
  return false;
}
