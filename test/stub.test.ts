import assert from "node:assert/strict";
import { test } from "node:test";
import { findingsFor, rulesOf } from "./helpers.js";

test("stub: flags throw new Error('not implemented')", () => {
  const old = `export function refund(id: string) {
  return db.refunds.create(id);
}
`;
  const neu = `export function refund(id: string) {
  throw new Error('not implemented');
}
`;
  const findings = findingsFor("src/refunds.ts", old, neu);
  assert.ok(findings.some((f) => f.rule === "stub"), JSON.stringify(findings));
});

test("stub: flags NotImplementedError", () => {
  const old = `def refund(id):
    return db.refunds.create(id)
`;
  const neu = `def refund(id):
    raise NotImplementedError
`;
  assert.ok(rulesOf(findingsFor("src/refunds.py", old, neu)).includes("stub"));
});

test("stub: flags unimplemented!() and todo!()", () => {
  const old = `pub fn refund(id: &str) -> Result<()> {\n    db::refund(id)\n}\n`;
  const neu = `pub fn refund(id: &str) -> Result<()> {\n    unimplemented!()\n}\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.rs", old, neu)).includes("stub"));
  const neu2 = `pub fn refund(id: &str) -> Result<()> {\n    todo!()\n}\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.rs", old, neu2)).includes("stub"));
});

test("stub: flags throw new Error('TODO')", () => {
  const old = `export function refund(id: string) {\n  return save(id);\n}\n`;
  const neu = `export function refund(id: string) {\n  throw new Error("TODO");\n}\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.ts", old, neu)).includes("stub"));
});

test("stub: flags // TODO: implement and # TODO: implement", () => {
  const oldTs = `export function refund(id: string) {\n  return save(id);\n}\n`;
  const neuTs = `export function refund(id: string) {\n  // TODO: implement\n  return save(id);\n}\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.ts", oldTs, neuTs)).includes("stub"));
  const oldPy = `def refund(id):\n    return save(id)\n`;
  const neuPy = `def refund(id):\n    # TODO: implement\n    return save(id)\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.py", oldPy, neuPy)).includes("stub"));
});

test("stub: flags a newly added exported function whose body is only a stub", () => {
  const old = `export function list() {\n  return db.rows;\n}\n`;
  const neu = `export function list() {\n  return db.rows;\n}\n\nexport function refund(id: string) {\n  return;\n}\n`;
  const findings = findingsFor("src/refunds.ts", old, neu);
  assert.ok(findings.some((f) => f.rule === "stub"), JSON.stringify(findings));
});

test("stub: flags a newly added Python def that is only pass", () => {
  const old = `def list():\n    return rows\n`;
  const neu = `def list():\n    return rows\n\ndef refund(id):\n    pass\n`;
  assert.ok(rulesOf(findingsFor("src/refunds.py", old, neu)).includes("stub"));
});

test("stub: does not flag a pre-existing TODO on an unchanged line", () => {
  const old = `export function refund(id: string) {
  // TODO: implement retry
  return save(id);
}
`;
  const neu = `export function refund(id: string) {
  // TODO: implement retry
  return save(id);
}

export function list() { return []; }
`;
  assert.equal(rulesOf(findingsFor("src/refunds.ts", old, neu)).includes("stub"), false);
});

test("stub: does not flag a real exported implementation", () => {
  const old = `export function list() {\n  return db.rows;\n}\n`;
  const neu = `export function list() {\n  return db.rows;\n}\n\nexport function refund(id: string) {\n  return db.refunds.create(id);\n}\n`;
  assert.equal(rulesOf(findingsFor("src/refunds.ts", old, neu)).includes("stub"), false);
});

test("stub: does not flag unfinished work in a test file", () => {
  const old = `it("refunds", () => { expect(true).toBe(true); });\n`;
  const neu = `it("refunds", () => { throw new Error("not implemented"); });\n`;
  assert.equal(findingsFor("src/refunds.test.ts", old, neu).length, 0);
});

test("stub: honors codesane-ignore", () => {
  const old = `export function list() {\n  return db.rows;\n}\n`;
  const neu = `export function list() {\n  return db.rows;\n}\n\nexport function refund(id: string) {\n  throw new Error('not implemented'); // codesane-ignore: stub\n}\n`;
  assert.equal(rulesOf(findingsFor("src/refunds.ts", old, neu)).includes("stub"), false);
});

test("stub: does not flag a generic TODO that is not an implement marker", () => {
  const old = `export function refund(id: string) {\n  return save(id);\n}\n`;
  const neu = `export function refund(id: string) {\n  // TODO: mention this in the docs\n  return save(id);\n}\n`;
  assert.equal(rulesOf(findingsFor("src/refunds.ts", old, neu)).includes("stub"), false);
});
