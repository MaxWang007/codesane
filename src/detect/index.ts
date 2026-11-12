import type { AllowRule, CodesaneConfig, DiffFile, Finding, RuleId } from "../types.js";
import { isSourceLike, isTestFile, matchPath } from "../paths.js";
import { ruleEnabled } from "../config.js";
import { detectSwallow } from "./swallow.js";
import { detectEscape } from "./escape.js";
import { addedGuardTokens, detectUnguarded } from "./unguarded.js";
import { detectLoosen } from "./loosen.js";
import { detectStub } from "./stub.js";

function shouldScan(file: DiffFile, config: CodesaneConfig): boolean {
  if (isTestFile(file.path)) return false;
  if (file.oldPath && isTestFile(file.oldPath)) return false;
  if (!isSourceLike(file.path) && file.status !== "deleted") return false;
  if (file.status === "deleted" && !isSourceLike(file.path) && !(file.oldPath && isSourceLike(file.oldPath))) {
    return false;
  }
  const ignored = config.ignore ?? [];
  for (const pattern of ignored) {
    if (matchPath(pattern, file.path)) return false;
    if (file.oldPath && matchPath(pattern, file.oldPath)) return false;
  }
  return true;
}

export function detectWeakening(files: DiffFile[], config: CodesaneConfig = {}): Finding[] {
  const findings: Finding[] = [];
  const scanned = files.filter((f) => shouldScan(f, config));
  const addedTokens = addedGuardTokens(scanned);

  for (const file of scanned) {
    if (ruleEnabled(config, "swallow")) findings.push(...detectSwallow(file));
    if (ruleEnabled(config, "escape")) findings.push(...detectEscape(file));
    if (ruleEnabled(config, "unguarded")) findings.push(...detectUnguarded(file, addedTokens));
    if (ruleEnabled(config, "loosen")) findings.push(...detectLoosen(file));
    if (ruleEnabled(config, "stub")) findings.push(...detectStub(file));
  }

  findings.sort((a, b) => {
    const path = a.path.localeCompare(b.path);
    if (path !== 0) return path;
    const line = (a.line ?? 0) - (b.line ?? 0);
    if (line !== 0) return line;
    return a.rule.localeCompare(b.rule);
  });
  return findings;
}

export function applyAllowlist(findings: Finding[], allow?: AllowRule[]): Finding[] {
  if (!allow || allow.length === 0) return findings;
  return findings.map((finding) => {
    const hit = allow.find(
      (rule) => rule.rule === finding.rule && matchPath(rule.path, finding.path),
    );
    if (!hit) return finding;
    return { ...finding, allowed: true, allowReason: hit.reason };
  });
}

export function enabledRules(config: CodesaneConfig): RuleId[] {
  const all: RuleId[] = ["swallow", "escape", "unguarded", "loosen", "stub"];
  return all.filter((rule) => ruleEnabled(config, rule));
}
