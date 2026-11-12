import type { DiffFile, Finding } from "../types.js";
import { addedLineSet, deletedLineSet, snippetFor } from "../git.js";
import { isSuppressed } from "../text.js";
import {
  classifyBody,
  findHandlers,
  handlerOverlapsLines,
  isRethrowLine,
  isSwallowBody,
  swallowMessage,
  type Handler,
} from "./handlers.js";
import { splitLines } from "../paths.js";

function evidenceFor(file: DiffFile, handler: Handler): string {
  const oldHandlers = findHandlers(file.path, file.oldContent);
  const previous = oldHandlers.find(
    (h) => h.kind === handler.kind && Math.abs(h.startLine - handler.startLine) <= 80,
  );
  const newLo = handler.startLine;
  const newHi = handler.endLine;
  const oldLo = previous?.startLine ?? newLo;
  const oldHi = previous?.endLine ?? newHi;
  const snippet = snippetFor(
    file,
    (line) => {
      if (line.type === "add" && line.newLine != null) return line.newLine >= newLo && line.newLine <= newHi;
      if (line.type === "del" && line.oldLine != null) return line.oldLine >= oldLo && line.oldLine <= oldHi;
      return false;
    },
    8,
  );
  if (snippet) return snippet;
  const lines = splitLines(file.newContent);
  const from = Math.max(0, handler.startLine - 1);
  const to = Math.min(lines.length, handler.endLine);
  return lines
    .slice(from, to)
    .map((l) => `+${l}`)
    .join("\n");
}

function matchOldHandler(oldHandlers: Handler[], neu: Handler): Handler | undefined {
  const sameKind = oldHandlers.filter((h) => h.kind === neu.kind);
  if (sameKind.length === 0) return undefined;
  let best: Handler | undefined;
  let bestDist = Infinity;
  for (const old of sameKind) {
    const dist = Math.abs(old.startLine - neu.startLine);
    if (dist < bestDist) {
      best = old;
      bestDist = dist;
    }
  }
  // A catch that jumped more than ~80 lines is probably a different handler.
  if (best && bestDist <= 80) return best;
  return undefined;
}

export function detectSwallow(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const newHandlers = findHandlers(file.path, file.newContent);
  if (newHandlers.length === 0 && file.status === "deleted") return findings;

  const added = addedLineSet(file);
  const deleted = deletedLineSet(file);
  const oldHandlers = findHandlers(file.path, file.oldContent);

  for (const handler of newHandlers) {
    if (!handlerOverlapsLines(handler, added, "new") && !overlapsDeletedBody(handler, oldHandlers, deleted)) {
      // Unchanged handler — even if it is a no-op, it is pre-existing.
      continue;
    }
    if (!isSwallowBody(handler.body)) continue;
    const old = matchOldHandler(oldHandlers, handler);
    if (old && isSwallowBody(old.body) && classifyBody(old.body) === classifyBody(handler.body)) {
      // Same no-op after a nearby edit or a whitespace-only change.
      continue;
    }
    const kind = classifyBody(handler.body);
    if (kind !== "noop" && kind !== "success") continue;
    if (isSuppressed(file.newContent, handler.startLine, "swallow")) continue;
    findings.push({
      rule: "swallow",
      severity: "error",
      path: file.path,
      line: handler.startLine,
      message: swallowMessage(handler, kind),
      evidence: evidenceFor(file, handler),
    });
  }

  // Rethrow removed from a handler that is still present but maybe not classified
  // as a swallow above (e.g. the body now calls some helper). Only flag when
  // nothing equivalent remains in the same handler.
  for (const old of oldHandlers) {
    if (!handlerOverlapsLines(old, deleted, "old")) continue;
    const oldLines = splitLines(old.body);
    const hadRethrow = oldLines.some((l) => isRethrowLine(l));
    if (!hadRethrow) continue;
    const neu = matchOldHandler(newHandlers, old);
    if (!neu) continue;
    if (splitLines(neu.body).some((l) => isRethrowLine(l))) continue;
    if (!isSwallowBody(neu.body)) continue;
    if (findings.some((f) => f.line === neu.startLine && f.rule === "swallow")) continue;
    if (isSuppressed(file.newContent, neu.startLine, "swallow")) continue;
    findings.push({
      rule: "swallow",
      severity: "error",
      path: file.path,
      line: neu.startLine,
      message: "Rethrow or error return was removed from this error handler",
      evidence: evidenceFor(file, neu),
    });
  }

  return findings;
}

function overlapsDeletedBody(handler: Handler, oldHandlers: Handler[], deleted: Set<number>): boolean {
  const old = oldHandlers.find((h) => h.kind === handler.kind && Math.abs(h.startLine - handler.startLine) <= 80);
  if (!old) return false;
  return handlerOverlapsLines(old, deleted, "old");
}
