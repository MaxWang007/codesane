import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAllowlist } from "../src/detect/index.js";
import { findingsFor, rulesOf } from "./helpers.js";

const oldCatch = `export function parse(text: string) {
  return JSON.parse(text);
}
`;
const newCatch = `export function parse(text: string) {
  try {
    return JSON.parse(text);
  } catch {}
}
`;

test("config: disabled rules are not reported", () => {
  const findings = findingsFor("src/parse.ts", oldCatch, newCatch, { disabled: ["swallow"] });
  assert.equal(rulesOf(findings).includes("swallow"), false);
});

test("config: rules.swallow = false disables the detector", () => {
  const findings = findingsFor("src/parse.ts", oldCatch, newCatch, { rules: { swallow: false } });
  assert.equal(rulesOf(findings).includes("swallow"), false);
});

test("config: ignore paths skip a file", () => {
  const findings = findingsFor("vendor/parse.ts", oldCatch, newCatch, { ignore: ["vendor/**"] });
  assert.equal(findings.length, 0);
});

test("config: allowlist keeps the finding in the report but marks it allowed", () => {
  const raw = findingsFor("src/parse.ts", oldCatch, newCatch);
  const allowed = applyAllowlist(raw, [
    { path: "src/parse.ts", rule: "swallow", reason: "legacy parser, tracked in issue 12" },
  ]);
  const hit = allowed.find((f) => f.rule === "swallow");
  assert.ok(hit);
  assert.equal(hit!.allowed, true);
  assert.match(hit!.allowReason ?? "", /issue 12/);
});

test("config: a broad codesane-ignore suppresses every rule on that line", () => {
  const old = `export function f(payload: unknown) {\n  return payload;\n}\n`;
  const neu = `export function f(payload: unknown) {\n  return payload as any; // codesane-ignore\n}\n`;
  assert.equal(rulesOf(findingsFor("src/a.ts", old, neu)).includes("escape"), false);
});
