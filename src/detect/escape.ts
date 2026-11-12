import type { DiffFile, Finding } from "../types.js";
import { addedLinesOf, snippetFor } from "../git.js";
import { countMatches, isSuppressed } from "../text.js";

interface EscapePattern {
  id: string;
  pattern: RegExp;
  label: string;
}

const ESCAPES: EscapePattern[] = [
  { id: "as-any", pattern: /\bas\s+any\b/, label: "`as any`" },
  { id: "as-unknown-as", pattern: /\bas\s+unknown\s+as\b/, label: "`as unknown as`" },
  { id: "ts-ignore", pattern: /@ts-ignore\b/, label: "`@ts-ignore`" },
  { id: "ts-nocheck", pattern: /@ts-nocheck\b/, label: "`@ts-nocheck`" },
  { id: "ts-expect-error", pattern: /@ts-expect-error\b/, label: "`@ts-expect-error`" },
  { id: "eslint-disable-next-line", pattern: /eslint-disable-next-line\b/, label: "`eslint-disable-next-line`" },
  { id: "eslint-disable", pattern: /eslint-disable\b/, label: "`eslint-disable`" },
  { id: "noqa", pattern: /#\s*noqa\b/, label: "`# noqa`" },
  { id: "type-ignore-hash", pattern: /#\s*type:\s*ignore\b/, label: "`# type: ignore`" },
  { id: "type-ignore", pattern: /(?<![\w])type:\s*ignore\b/, label: "`type: ignore`" },
  { id: "pyright-ignore", pattern: /#\s*pyright:\s*ignore\b/, label: "`# pyright: ignore`" },
  { id: "nolint-space", pattern: /\/\/\s*nolint\b/, label: "`// nolint`" },
  { id: "nolint", pattern: /\/\/nolint\b/, label: "`//nolint`" },
  { id: "suppress-warnings", pattern: /@SuppressWarnings\b/, label: "`@SuppressWarnings`" },
];

function labelsOn(text: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const esc of ESCAPES) {
    if (!esc.pattern.test(text)) continue;
    // The next-line form is a more specific eslint disable.
    if (esc.id === "eslint-disable" && /\beslint-disable-next-line\b/.test(text) && !/eslint-disable(?:\s|$)/.test(text.replace("eslint-disable-next-line", ""))) {
      continue;
    }
    if (esc.id === "type-ignore" && /#\s*type:\s*ignore\b/.test(text)) continue;
    if (seen.has(esc.label)) continue;
    seen.add(esc.label);
    labels.push(esc.label);
  }
  return labels;
}

export function detectEscape(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const added = addedLinesOf(file);

  for (const row of added) {
    const labels = labelsOn(row.content);
    if (labels.length === 0) continue;

    // Only flag when this kind of escape is actually new in the file, so a
    // moved `as any` (deleted in one place, added in another) is left alone.
    const stillNew = labels.filter((label) => {
      const esc = ESCAPES.find((e) => e.label === label);
      if (!esc) return false;
      return countMatches(file.newContent, esc.pattern) > countMatches(file.oldContent, esc.pattern);
    });
    if (stillNew.length === 0) continue;
    if (isSuppressed(file.newContent, row.line, "escape")) continue;

    findings.push({
      rule: "escape",
      severity: "error",
      path: file.path,
      line: row.line,
      message: `Newly added type or lint escape (${stillNew.join(", ")})`,
      evidence: snippetFor(file, (l) => l.type === "add" && l.newLine === row.line),
    });
  }
  return findings;
}
