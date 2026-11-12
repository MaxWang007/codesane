import { resolve } from "node:path";
import type { CheckOptions, CodesaneReport, Finding } from "./types.js";
import { loadConfig } from "./config.js";
import { findGitRoot, getWorktreeDiffs, resolveBase } from "./git.js";
import { applyAllowlist, detectWeakening } from "./detect/index.js";
import { verdictOf } from "./report.js";

export { loadConfig, ruleEnabled } from "./config.js";
export { detectWeakening, applyAllowlist } from "./detect/index.js";
export { formatReport, toJson, formatMarkdown } from "./report.js";
export {
  getWorktreeDiffs,
  findGitRoot,
  detectDefaultBase,
  resolveBase,
  parseUnifiedDiff,
} from "./git.js";
export { RULES, formatRuleDoc } from "./rules.js";
export { RULE_IDS, CodesaneError } from "./types.js";
export type {
  AllowRule,
  CheckOptions,
  CodesaneConfig,
  CodesaneReport,
  DiffFile,
  Finding,
  RuleId,
} from "./types.js";

export async function codesaneCheck(options: CheckOptions = {}): Promise<CodesaneReport> {
  const startedIn = resolve(options.cwd ?? process.cwd());
  const gitRoot = findGitRoot(startedIn);
  const { config } = loadConfig(gitRoot, options.configPath);
  const base = resolveBase(gitRoot, options.base ?? config.base);
  const diffs = getWorktreeDiffs(gitRoot, base);
  const findings: Finding[] = applyAllowlist(detectWeakening(diffs, config), config.allow);

  const blocking = findings.filter((f) => {
    if (f.allowed && !options.failOnWarning) return false;
    if (f.severity === "error") return true;
    if (f.severity === "warning" && options.failOnWarning) return true;
    return false;
  });
  const sane = blocking.length === 0;
  return {
    verdict: verdictOf(sane),
    sane,
    exitCode: sane ? 0 : 1,
    base,
    cwd: gitRoot,
    findings,
  };
}
