import assert from "node:assert/strict";
import { test } from "node:test";
import { findingsFor, rulesOf } from "./helpers.js";

const CASES: { name: string; path: string; line: string }[] = [
  { name: "as any", path: "src/a.ts", line: "  return payload as any;" },
  { name: "as unknown as", path: "src/a.ts", line: "  return payload as unknown as User;" },
  { name: "@ts-ignore", path: "src/a.ts", line: "  // @ts-ignore" },
  { name: "@ts-nocheck", path: "src/a.ts", line: "// @ts-nocheck" },
  { name: "@ts-expect-error", path: "src/a.ts", line: "  // @ts-expect-error hidden null" },
  { name: "eslint-disable", path: "src/a.ts", line: "  /* eslint-disable no-explicit-any */" },
  { name: "eslint-disable-next-line", path: "src/a.ts", line: "  // eslint-disable-next-line no-explicit-any" },
  { name: "# noqa", path: "src/a.py", line: "    x = f()  # noqa" },
  { name: "# type: ignore", path: "src/a.py", line: "    x = f()  # type: ignore" },
  { name: "# pyright: ignore", path: "src/a.py", line: "    x = f()  # pyright: ignore" },
  { name: "// nolint", path: "src/a.go", line: "\treturn err // nolint:errcheck" },
  { name: "@SuppressWarnings", path: "src/A.java", line: "    @SuppressWarnings(\"unchecked\")" },
];

for (const item of CASES) {
  test(`escape: flags newly added ${item.name}`, () => {
    const old = "export function f() {\n  return payload;\n}\n";
    const neu = `export function f() {\n${item.line}\n}\n`;
    const path = item.path;
    const oldFor = path.endsWith(".ts") ? old : old.replace("export function f()", "def f():").replace("return payload;", "    return payload");
    const findings = findingsFor(path, oldFor, neu);
    assert.ok(
      findings.some((f) => f.rule === "escape"),
      `expected escape for ${item.name}, got ${JSON.stringify(findings)}`,
    );
  });
}

test("escape: does not flag as anyone or a pre-existing as any", () => {
  const unchanged = `export function label(name: string) {
  return name as anyone;
}
`;
  assert.equal(rulesOf(findingsFor("src/a.ts", unchanged, unchanged.replace("anyone", "anyone "))).includes("escape"), false);

  const old = `export function f(payload: unknown) {
  return payload as any;
}
`;
  const neu = `export function f(payload: unknown) {
  return payload as any;
}

export function g() { return 1; }
`;
  assert.equal(rulesOf(findingsFor("src/a.ts", old, neu)).includes("escape"), false);
});

test("escape: does not flag an as any that only moved inside the same file", () => {
  const old = `export function f(payload: unknown) {
  return payload as any;
}

export function g() { return 1; }
`;
  const neu = `export function g() { return 1; }

export function f(payload: unknown) {
  return payload as any;
}
`;
  assert.equal(rulesOf(findingsFor("src/a.ts", old, neu)).includes("escape"), false);
});

test("escape: does not flag an added escape in a test file", () => {
  const old = `it("works", () => { expect(1).toBe(1); });\n`;
  const neu = `it("works", () => { expect(1 as any).toBe(1); });\n`;
  assert.equal(findingsFor("src/foo.test.ts", old, neu).length, 0);
});

test("escape: honors codesane-ignore on the same line", () => {
  const old = `export function f(payload: unknown) {\n  return payload;\n}\n`;
  const neu = `export function f(payload: unknown) {\n  return payload as any; // codesane-ignore: escape\n}\n`;
  assert.equal(rulesOf(findingsFor("src/a.ts", old, neu)).includes("escape"), false);
});
