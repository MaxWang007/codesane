import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AllowRule, CodesaneConfig, RuleId } from "./types.js";
import { RULE_IDS, CodesaneError } from "./types.js";

function isRuleId(value: string): value is RuleId {
  return (RULE_IDS as readonly string[]).includes(value);
}

function readYamlFile(path: string): CodesaneConfig {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesaneError(`Failed to parse ${path}: ${message}`);
  }
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new CodesaneError(`Invalid config in ${path}: expected a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const config: CodesaneConfig = {};
  if (obj.base !== undefined) {
    if (typeof obj.base !== "string") {
      throw new CodesaneError(`Invalid config in ${path}: base must be a string`);
    }
    config.base = obj.base;
  }
  if (obj.ignore !== undefined) {
    if (!Array.isArray(obj.ignore) || obj.ignore.some((p) => typeof p !== "string")) {
      throw new CodesaneError(`Invalid config in ${path}: ignore must be a list of paths`);
    }
    config.ignore = obj.ignore as string[];
  }
  if (obj.disabled !== undefined) {
    if (!Array.isArray(obj.disabled) || obj.disabled.some((r) => typeof r !== "string")) {
      throw new CodesaneError(`Invalid config in ${path}: disabled must be a list of rule ids`);
    }
    const disabled: RuleId[] = [];
    for (const rule of obj.disabled as string[]) {
      if (!isRuleId(rule)) {
        throw new CodesaneError(`Invalid config in ${path}: unknown rule '${rule}'`);
      }
      disabled.push(rule);
    }
    config.disabled = disabled;
  }
  if (obj.rules !== undefined) {
    if (typeof obj.rules !== "object" || obj.rules == null || Array.isArray(obj.rules)) {
      throw new CodesaneError(`Invalid config in ${path}: rules must be a mapping of rule id to boolean`);
    }
    const rules: Partial<Record<RuleId, boolean>> = {};
    for (const [key, value] of Object.entries(obj.rules as Record<string, unknown>)) {
      if (!isRuleId(key)) {
        throw new CodesaneError(`Invalid config in ${path}: unknown rule '${key}'`);
      }
      if (typeof value !== "boolean") {
        throw new CodesaneError(`Invalid config in ${path}: rules.${key} must be a boolean`);
      }
      rules[key] = value;
    }
    config.rules = rules;
  }
  if (obj.allow !== undefined) {
    if (!Array.isArray(obj.allow)) {
      throw new CodesaneError(`Invalid config in ${path}: allow must be a list`);
    }
    config.allow = obj.allow.map((entry, i) => parseAllow(entry, path, i));
  }
  return config;
}

function parseAllow(entry: unknown, path: string, index: number): AllowRule {
  if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
    throw new CodesaneError(`Invalid allow entry in ${path}[${index}]`);
  }
  const obj = entry as Record<string, unknown>;
  if (typeof obj.path !== "string" || typeof obj.rule !== "string") {
    throw new CodesaneError(`Invalid allow entry in ${path}[${index}]: path and rule are required`);
  }
  if (typeof obj.reason !== "string" || !obj.reason.trim()) {
    throw new CodesaneError(
      `Invalid allow entry in ${path}[${index}]: a non-empty reason is required`,
    );
  }
  const rule = obj.rule;
  if (!isRuleId(rule)) {
    throw new CodesaneError(`Invalid allow entry in ${path}[${index}]: unknown rule '${rule}'`);
  }
  return { path: obj.path, rule, reason: obj.reason.trim() };
}

function merge(base: CodesaneConfig, overlay: CodesaneConfig): CodesaneConfig {
  return {
    base: overlay.base ?? base.base,
    ignore: overlay.ignore ?? base.ignore,
    disabled: overlay.disabled ?? base.disabled,
    rules: overlay.rules ? { ...base.rules, ...overlay.rules } : base.rules,
    allow: overlay.allow ?? base.allow,
  };
}

export function ruleEnabled(config: CodesaneConfig, rule: RuleId): boolean {
  if (config.rules && config.rules[rule] === false) return false;
  if (config.disabled?.includes(rule)) return false;
  return true;
}

export function loadConfig(
  cwd: string,
  configPath?: string,
): { config: CodesaneConfig; sources: string[] } {
  if (configPath) {
    const resolved = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
    if (!existsSync(resolved)) {
      throw new CodesaneError(`Config file not found: ${resolved}`);
    }
    return { config: readYamlFile(resolved), sources: [resolved] };
  }

  const candidates = [
    join(homedir(), ".codesane.yml"),
    join(homedir(), ".codesane.yaml"),
    join(cwd, ".codesane.yml"),
    join(cwd, ".codesane.yaml"),
  ];
  let config: CodesaneConfig = {};
  const sources: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    config = merge(config, readYamlFile(path));
    sources.push(path);
  }
  return { config, sources };
}
