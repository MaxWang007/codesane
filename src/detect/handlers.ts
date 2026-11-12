import { langFamily, lineNumberAt, splitLines } from "../paths.js";
import { isCommentOnly, stripLineComment } from "../text.js";

export type HandlerKind = "catch" | "except" | "rescue" | "promise_catch";

export interface Handler {
  kind: HandlerKind;
  startLine: number;
  endLine: number;
  bodyStart: number;
  bodyEnd: number;
  header: string;
  body: string;
}

const RETRY_RE =
  /^(throw|raise|rethrow)\b|^(return\s+)?(Promise\.)?reject\b|^return\s+(e|err|error|exc|exception|ex)\s*;?\s*$|^(next|cb|callback|done)\s*\(\s*(e|err|error)\b/;

const LOG_RE =
  /^(console\.(log|warn|debug|info)|logger\.(info|debug|log|warn)|log\.(info|debug|log|warn)|logging\.(info|debug|warning)|print|puts)\s*[.(]/;

const SUCCESS_RETURN_RE =
  /^return(?:\s+(?:null|undefined|None|nil|false|False|0|\{\s*\}|\[\s*\])\s*)?;?\s*$/;

const NOOP_EXPR_RE = /^(pass|nil|None|undefined|\.\.\.|null)\s*;?\s*$/;

export function isRethrowLine(line: string): boolean {
  const code = stripLineComment(line).trim();
  return RETRY_RE.test(code);
}

export function isLogLine(line: string): boolean {
  const code = stripLineComment(line).trim();
  return LOG_RE.test(code);
}

export function isSuccessReturn(line: string): boolean {
  const code = stripLineComment(line).trim();
  return SUCCESS_RETURN_RE.test(code);
}

export function isNoopExpr(line: string): boolean {
  const code = stripLineComment(line).trim();
  return code.length === 0 || NOOP_EXPR_RE.test(code);
}

/** Classify a handler body: empty/no-op, log-and-success, has-rethrow, or other. */
export function classifyBody(body: string): "noop" | "success" | "rethrow" | "other" {
  const lines = splitLines(body);
  let sawLog = false;
  let sawSuccess = false;
  let sawOther = false;
  for (const line of lines) {
    if (isCommentOnly(line)) continue;
    const code = stripLineComment(line).trim().replace(/^[\s{([]+/, "").replace(/[\s})\];]+$/, "");
    // Keep original classification on the raw-stripped line too.
    if (isRethrowLine(line)) return "rethrow";
    if (isLogLine(line)) {
      sawLog = true;
      continue;
    }
    if (isSuccessReturn(line) || isNoopExpr(line)) {
      if (isSuccessReturn(line)) sawSuccess = true;
      continue;
    }
    // A closing or opening brace leftover after strip.
    if (!code || /^[\s{}[\](),;]*$/.test(stripLineComment(line).trim())) continue;
    sawOther = true;
  }
  if (sawOther) return "other";
  if (sawLog || sawSuccess) return "success";
  return "noop";
}

export function isSwallowBody(body: string): boolean {
  const kind = classifyBody(body);
  return kind === "noop" || kind === "success";
}

export function findHandlers(path: string, content: string): Handler[] {
  const family = langFamily(path);
  if (family === "js") return findJsHandlers(content);
  if (family === "py") return findPyHandlers(content);
  if (family === "rb") return findRbHandlers(content);
  return [];
}

interface ScanState {
  kind: "code" | "s" | "d" | "t" | "line" | "block" | "regex";
  tmplDepth: number;
}

function skipJsStringy(content: string, i: number, state: ScanState): { i: number; consumed: boolean } {
  const ch = content[i]!;
  const next = content[i + 1];
  if (state.kind === "line") {
    if (ch === "\n") state.kind = "code";
    return { i: i + 1, consumed: true };
  }
  if (state.kind === "block") {
    if (ch === "*" && next === "/") {
      state.kind = "code";
      return { i: i + 2, consumed: true };
    }
    return { i: i + 1, consumed: true };
  }
  if (state.kind === "s" || state.kind === "d" || state.kind === "t") {
    if (ch === "\\" && i + 1 < content.length) return { i: i + 2, consumed: true };
    if (state.kind === "s" && ch === "'") state.kind = "code";
    else if (state.kind === "d" && ch === '"') state.kind = "code";
    else if (state.kind === "t") {
      if (ch === "`" && state.tmplDepth === 0) state.kind = "code";
      if (ch === "$" && next === "{") {
        state.tmplDepth++;
        state.kind = "code";
        return { i: i + 2, consumed: true };
      }
    }
    return { i: i + 1, consumed: true };
  }
  if (state.kind === "regex") {
    if (ch === "\\" && i + 1 < content.length) return { i: i + 2, consumed: true };
    if (ch === "/") state.kind = "code";
    return { i: i + 1, consumed: true };
  }
  return { i, consumed: false };
}

function enterJsStringy(content: string, i: number, state: ScanState, prevCode: string): number | undefined {
  const ch = content[i]!;
  const next = content[i + 1];
  if (ch === "/" && next === "/") {
    state.kind = "line";
    return i + 2;
  }
  if (ch === "/" && next === "*") {
    state.kind = "block";
    return i + 2;
  }
  if (ch === "'") {
    state.kind = "s";
    return i + 1;
  }
  if (ch === '"') {
    state.kind = "d";
    return i + 1;
  }
  if (ch === "`") {
    state.kind = "t";
    state.tmplDepth = 0;
    return i + 1;
  }
  if (ch === "/" && canStartRegex(prevCode)) {
    state.kind = "regex";
    return i + 1;
  }
  if (ch === "}" && state.tmplDepth > 0) {
    state.tmplDepth--;
    state.kind = "t";
    return i + 1;
  }
  return undefined;
}

function canStartRegex(prevCode: string): boolean {
  const t = prevCode.trimEnd();
  if (!t) return true;
  return /[([{},;=!&|?:]$/.test(t) || /\b(return|throw|case|in|of)$/.test(t);
}

function matchWordAt(content: string, i: number, word: string): boolean {
  if (content.slice(i, i + word.length) !== word) return false;
  const before = i === 0 ? "" : content[i - 1]!;
  const after = content[i + word.length] ?? "";
  if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) return false;
  return true;
}

function skipWs(content: string, i: number): number {
  while (i < content.length && /[\s]/.test(content[i]!)) i++;
  return i;
}

function skipBalanced(content: string, i: number, open: string, close: string, state: ScanState): number {
  if (content[i] !== open) return i;
  let depth = 0;
  let prevCode = "";
  while (i < content.length) {
    const skipped = skipJsStringy(content, i, state);
    if (skipped.consumed) {
      i = skipped.i;
      continue;
    }
    const entered = enterJsStringy(content, i, state, prevCode);
    if (entered != null) {
      i = entered;
      continue;
    }
    const ch = content[i]!;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    prevCode += ch;
    i++;
  }
  return i;
}

function skipJsFunctionArg(content: string, i: number, state: ScanState): { start: number; end: number; body: string; bodyStart: number; bodyEnd: number } | undefined {
  i = skipWs(content, i);
  const start = i;
  // async? (args) => body    or   function (args) { body }
  if (matchWordAt(content, i, "async")) {
    i = skipWs(content, i + 5);
  }
  if (matchWordAt(content, i, "function")) {
    i = skipWs(content, i + 8);
    while (i < content.length && /[A-Za-z0-9_$]/.test(content[i]!)) i++;
    i = skipWs(content, i);
    if (content[i] === "(") i = skipBalanced(content, i, "(", ")", state);
    i = skipWs(content, i);
    if (content[i] !== "{") return undefined;
    const bodyOpen = i;
    const bodyClose = skipBalanced(content, i, "{", "}", state);
    const bodyInner = content.slice(bodyOpen + 1, bodyClose - 1);
    return {
      start,
      end: bodyClose,
      body: bodyInner,
      bodyStart: lineNumberAt(content, bodyOpen + 1),
      bodyEnd: lineNumberAt(content, Math.max(bodyOpen + 1, bodyClose - 2)),
    };
  }
  // arrow: (args) =>  or ident =>
  let afterParams = i;
  if (content[i] === "(") {
    afterParams = skipBalanced(content, i, "(", ")", state);
  } else if (/[A-Za-z_$]/.test(content[i] ?? "")) {
    while (afterParams < content.length && /[A-Za-z0-9_$]/.test(content[afterParams]!)) afterParams++;
  } else {
    return undefined;
  }
  afterParams = skipWs(content, afterParams);
  if (content.slice(afterParams, afterParams + 2) !== "=>") return undefined;
  let bodyAt = skipWs(content, afterParams + 2);
  if (content[bodyAt] === "{") {
    const bodyClose = skipBalanced(content, bodyAt, "{", "}", state);
    const bodyInner = content.slice(bodyAt + 1, bodyClose - 1);
    return {
      start,
      end: bodyClose,
      body: bodyInner,
      bodyStart: lineNumberAt(content, bodyAt + 1),
      bodyEnd: lineNumberAt(content, Math.max(bodyAt + 1, bodyClose - 2)),
    };
  }
  // concise arrow body until comma or closing paren at depth 0
  const exprStart = bodyAt;
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let prevCode = "";
  while (bodyAt < content.length) {
    const skipped = skipJsStringy(content, bodyAt, state);
    if (skipped.consumed) {
      bodyAt = skipped.i;
      continue;
    }
    const entered = enterJsStringy(content, bodyAt, state, prevCode);
    if (entered != null) {
      bodyAt = entered;
      continue;
    }
    const ch = content[bodyAt]!;
    if (ch === "(") depthParen++;
    else if (ch === ")") {
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) break;
      depthParen--;
    } else if (ch === "{") depthBrace++;
    else if (ch === "}") {
      if (depthBrace === 0) break;
      depthBrace--;
    } else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;
    else if ((ch === "," || ch === ";") && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      break;
    }
    prevCode += ch;
    bodyAt++;
  }
  const body = content.slice(exprStart, bodyAt);
  return {
    start,
    end: bodyAt,
    body: body.trim() ? `return ${body.trim()}` : "",
    bodyStart: lineNumberAt(content, exprStart),
    bodyEnd: lineNumberAt(content, Math.max(exprStart, bodyAt - 1)),
  };
}

export function findJsHandlers(content: string): Handler[] {
  const handlers: Handler[] = [];
  const state: ScanState = { kind: "code", tmplDepth: 0 };
  let i = 0;
  let prevCode = "";
  while (i < content.length) {
    const skipped = skipJsStringy(content, i, state);
    if (skipped.consumed) {
      i = skipped.i;
      continue;
    }
    const entered = enterJsStringy(content, i, state, prevCode);
    if (entered != null) {
      i = entered;
      continue;
    }
    if (matchWordAt(content, i, "catch")) {
      const start = i;
      const afterDot = prevCode.trimEnd().endsWith(".");
      let j = skipWs(content, i + 5);
      if (afterDot && content[j] === "(") {
        const arg = skipJsFunctionArg(content, j + 1, state);
        if (arg) {
          handlers.push({
            kind: "promise_catch",
            startLine: lineNumberAt(content, start),
            endLine: lineNumberAt(content, Math.max(start, arg.end - 1)),
            bodyStart: arg.bodyStart,
            bodyEnd: arg.bodyEnd,
            header: content.slice(start, arg.start),
            body: arg.body,
          });
          prevCode += content.slice(i, arg.end);
          i = arg.end;
          continue;
        }
      } else {
        if (content[j] === "(") j = skipBalanced(content, j, "(", ")", state);
        j = skipWs(content, j);
        if (content[j] === "{") {
          const bodyOpen = j;
          const bodyClose = skipBalanced(content, j, "{", "}", state);
          const bodyInner = content.slice(bodyOpen + 1, bodyClose - 1);
          handlers.push({
            kind: "catch",
            startLine: lineNumberAt(content, start),
            endLine: lineNumberAt(content, Math.max(start, bodyClose - 1)),
            bodyStart: lineNumberAt(content, bodyOpen + 1),
            bodyEnd: lineNumberAt(content, Math.max(bodyOpen + 1, bodyClose - 2)),
            header: content.slice(start, bodyOpen),
            body: bodyInner,
          });
          prevCode += content.slice(i, bodyClose);
          i = bodyClose;
          continue;
        }
      }
    }
    prevCode += content[i]!;
    if (prevCode.length > 80) prevCode = prevCode.slice(-80);
    i++;
  }
  return handlers;
}

function pyIndent(line: string): number | undefined {
  if (!line.trim() || line.trimStart().startsWith("#")) return undefined;
  const match = line.match(/^([ \t]*)/);
  const ws = match?.[1] ?? "";
  return ws.replace(/\t/g, "    ").length;
}

export function findPyHandlers(content: string): Handler[] {
  const lines = splitLines(content);
  const handlers: Handler[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) continue;
    const except = trimmed.match(/^except\b([^:]*):[ \t]*(.*)$/);
    if (!except) continue;
    const headerIndent = pyIndent(raw);
    if (headerIndent == null) continue;
    const sameLineBody = except[2] ?? "";
    const startLine = i + 1;
    if (sameLineBody.trim() && !sameLineBody.trim().startsWith("#")) {
      handlers.push({
        kind: "except",
        startLine,
        endLine: startLine,
        bodyStart: startLine,
        bodyEnd: startLine,
        header: raw,
        body: sameLineBody,
      });
      continue;
    }
    let j = i + 1;
    const bodyLines: string[] = [];
    while (j < lines.length) {
      const row = lines[j] ?? "";
      if (!row.trim()) {
        bodyLines.push(row);
        j++;
        continue;
      }
      if (row.trim().startsWith("#")) {
        const ind = (row.match(/^([ \t]*)/)?.[1] ?? "").replace(/\t/g, "    ").length;
        if (ind > headerIndent) {
          bodyLines.push(row);
          j++;
          continue;
        }
        break;
      }
      const ind = pyIndent(row);
      if (ind == null || ind <= headerIndent) break;
      bodyLines.push(row);
      j++;
    }
    handlers.push({
      kind: "except",
      startLine,
      endLine: Math.max(startLine, j),
      bodyStart: startLine + 1,
      bodyEnd: Math.max(startLine, j),
      header: raw,
      body: bodyLines.join("\n"),
    });
  }
  return handlers;
}

export function findRbHandlers(content: string): Handler[] {
  const lines = splitLines(content);
  const handlers: Handler[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) continue;
    const postfix = trimmed.match(/^(.*)\brescue\s+nil\s*$/);
    if (postfix && !trimmed.startsWith("rescue")) {
      const startLine = i + 1;
      handlers.push({
        kind: "rescue",
        startLine,
        endLine: startLine,
        bodyStart: startLine,
        bodyEnd: startLine,
        header: raw,
        body: "nil",
      });
      continue;
    }
    const oneLiner = trimmed.match(/^rescue\b(.*)$/);
    if (!oneLiner) continue;
    const rest = (oneLiner[1] ?? "").trim();
    // rescue nil   or   rescue StandardError => e; nil
    const startLine = i + 1;
    if (/\bnil\b/.test(rest) && !rest.includes("\n")) {
      const after = rest.replace(/^[^;]*;?\s*/, "");
      handlers.push({
        kind: "rescue",
        startLine,
        endLine: startLine,
        bodyStart: startLine,
        bodyEnd: startLine,
        header: raw,
        body: /\bnil\b/.test(after) || rest === "nil" || /rescue\s+nil/.test(trimmed) ? "nil" : rest,
      });
      continue;
    }
    const headerIndent = (raw.match(/^([ \t]*)/)?.[1] ?? "").length;
    let j = i + 1;
    const bodyLines: string[] = [];
    while (j < lines.length) {
      const row = lines[j] ?? "";
      const t = row.trim();
      if (t === "end" || t.startsWith("end ") || t === "ensure" || t.startsWith("ensure ") || /^rescue\b/.test(t)) {
        break;
      }
      if (t && (row.match(/^([ \t]*)/)?.[1] ?? "").length <= headerIndent && !t.startsWith("#")) {
        break;
      }
      bodyLines.push(row);
      j++;
    }
    handlers.push({
      kind: "rescue",
      startLine,
      endLine: Math.max(startLine, j),
      bodyStart: startLine + 1,
      bodyEnd: Math.max(startLine, j),
      header: raw,
      body: bodyLines.join("\n") || rest,
    });
  }
  return handlers;
}

export function handlerOverlapsLines(handler: Handler, lines: Set<number>, mode: "new" | "old"): boolean {
  const start = handler.startLine;
  const end = handler.endLine;
  for (const line of lines) {
    if (line >= start && line <= end) return true;
  }
  // Body-only overlap for added/deleted lines just inside the block.
  void mode;
  return false;
}

export function swallowMessage(handler: Handler, kind: "noop" | "success"): string {
  if (handler.kind === "except") {
    return kind === "noop"
      ? "Empty or no-op except handler swallows errors"
      : "except handler logs or returns a success value without re-raising";
  }
  if (handler.kind === "rescue") {
    return kind === "noop"
      ? "Empty or no-op rescue handler swallows errors"
      : "rescue handler returns a success value without raising";
  }
  if (handler.kind === "promise_catch") {
    return kind === "noop"
      ? "Empty .catch() handler swallows errors"
      : ".catch() handler returns a success value without rethrowing";
  }
  return kind === "noop"
    ? "Empty or no-op catch handler swallows errors"
    : "catch handler logs or returns a success value without rethrowing";
}
