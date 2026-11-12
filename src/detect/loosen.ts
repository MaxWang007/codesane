import type { DiffFile, Finding } from "../types.js";
import { addedLinesOf, snippetFor } from "../git.js";
import { countMatches, isSuppressed } from "../text.js";

interface LoosenPattern {
  id: string;
  pattern: RegExp;
  label: string;
}

const PATTERNS: LoosenPattern[] = [
  { id: "reject-unauthorized", pattern: /\brejectUnauthorized\s*:\s*false\b/, label: "`rejectUnauthorized: false`" },
  { id: "verify-false", pattern: /\bverify\s*=\s*False\b/, label: "`verify=False`" },
  {
    id: "tls-env",
    pattern: /\bNODE_TLS_REJECT_UNAUTHORIZED\b(?:\s*[=:]\s*['"]?0['"]?|\s*[=:]\s*false\b)?/i,
    label: "`NODE_TLS_REJECT_UNAUTHORIZED`",
  },
  {
    id: "insecure-skip",
    pattern: /\bInsecureSkipVerify\b(?:\s*:\s*true\b)?/,
    label: "`InsecureSkipVerify`",
  },
  { id: "curl-k", pattern: /\bcurl\b[^\n]*\s(-k|--insecure)\b/, label: "`curl --insecure`" },
  {
    id: "cors-header",
    pattern: /Access-Control-Allow-Origin\s*['"\s:=,)]+\*/,
    label: "`Access-Control-Allow-Origin: *`",
  },
  {
    id: "cors-origin",
    pattern: /\b(?:origin|cors|corsOrigin|allowedOrigin|allowOrigin|allowedOrigins)\b[^\n]{0,40}['"]\*['"]/,
    label: "CORS origin set to `*`",
  },
  { id: "dangerously", pattern: /\bdangerouslySetInnerHTML\b/, label: "`dangerouslySetInnerHTML`" },
  { id: "innerhtml", pattern: /\.innerHTML\s*=/, label: "`.innerHTML =`" },
  { id: "eval", pattern: /\beval\s*\(/, label: "`eval(`" },
  { id: "new-function", pattern: /\bnew\s+Function\s*\(/, label: "`new Function(`" },
  { id: "shell-true", pattern: /\bshell\s*=\s*True\b/, label: "`shell=True`" },
  { id: "chmod-777", pattern: /\bchmod\b[^\n]*\b(0o777|0777|777)\b/, label: "`chmod 777`" },
];

function labelsOn(text: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const pat of PATTERNS) {
    if (pat.pattern.test(text)) out.push({ id: pat.id, label: pat.label });
  }
  return out;
}

export function detectLoosen(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  for (const row of addedLinesOf(file)) {
    const labels = labelsOn(row.content);
    if (labels.length === 0) continue;
    const stillNew = labels.filter((item) => {
      const pat = PATTERNS.find((p) => p.id === item.id);
      if (!pat) return false;
      return countMatches(file.newContent, pat.pattern) > countMatches(file.oldContent, pat.pattern);
    });
    if (stillNew.length === 0) continue;
    if (isSuppressed(file.newContent, row.line, "loosen")) continue;
    findings.push({
      rule: "loosen",
      severity: "error",
      path: file.path,
      line: row.line,
      message: `Newly added security loosening (${stillNew.map((l) => l.label).join(", ")})`,
      evidence: snippetFor(file, (l) => l.type === "add" && l.newLine === row.line),
    });
  }
  return findings;
}
