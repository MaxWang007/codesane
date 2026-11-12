import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReport, toJson } from "../src/report.js";
import type { CodesaneReport } from "../src/types.js";

function sample(): CodesaneReport {
  return {
    verdict: "not_sane",
    sane: false,
    exitCode: 1,
    base: "HEAD",
    cwd: "/tmp/demo",
    findings: [
      {
        rule: "swallow",
        severity: "error",
        path: "src/orders.ts",
        line: 14,
        message: "Empty or no-op catch handler swallows errors",
        evidence: "+  } catch (err) {}",
      },
    ],
  };
}

test("JSON report includes the documented schema fields", () => {
  const json = toJson(sample());
  assert.equal(json.verdict, "not_sane");
  assert.equal(json.exitCode, 1);
  assert.equal(json.base, "HEAD");
  assert.ok(Array.isArray(json.findings));
  const finding = (json.findings as Record<string, unknown>[])[0];
  assert.equal(finding?.rule, "swallow");
  assert.equal(finding?.path, "src/orders.ts");
  assert.equal(finding?.line, 14);
  assert.equal(finding?.severity, "error");
});

test("markdown report includes rule ids and file:line", () => {
  const md = formatReport(sample(), "markdown");
  assert.match(md, /swallow/);
  assert.match(md, /src\/orders\.ts:14/);
  assert.match(md, /Verdict: not sane/);
  assert.match(md, /exit 1/);
});

test("pretty report includes a copyable verdict line", () => {
  const text = formatReport(sample(), "pretty", false);
  assert.match(text, /codesane\s+v0\.1\.0/);
  assert.match(text, /Don't ship a quiet weakening/);
  assert.match(text, /Verdict: not sane\s+\(exit 1\)/);
  assert.match(text, /swallow/);
  assert.match(text, /src\/orders\.ts:14/);
});

test("pretty report of a clean run says Findings none and verdict sane", () => {
  const text = formatReport(
    { verdict: "sane", sane: true, exitCode: 0, base: "HEAD", cwd: "/tmp/demo", findings: [] },
    "pretty",
    false,
  );
  assert.match(text, /Findings\s+none/);
  assert.match(text, /Verdict: sane\s+\(exit 0\)/);
});
