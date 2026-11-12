export const RULE_IDS = ["swallow", "escape", "unguarded", "loosen", "stub"] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type Severity = "error" | "warning";

export type VerdictName = "sane" | "not_sane" | "error";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  path: string;
  line?: number;
  message: string;
  evidence?: string;
  allowed?: boolean;
  allowReason?: string;
}

export interface AllowRule {
  path: string;
  rule: RuleId | string;
  reason: string;
}

export interface CodesaneConfig {
  base?: string;
  ignore?: string[];
  disabled?: RuleId[];
  rules?: Partial<Record<RuleId, boolean>>;
  allow?: AllowRule[];
}

export interface CheckOptions {
  cwd?: string;
  base?: string;
  configPath?: string;
  failOnWarning?: boolean;
}

export interface CodesaneReport {
  verdict: VerdictName;
  sane: boolean;
  exitCode: 0 | 1 | 2;
  base: string;
  cwd: string;
  findings: Finding[];
  error?: string;
}

export interface DiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export class CodesaneError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string) {
    super(message);
    this.name = "CodesaneError";
  }
}
