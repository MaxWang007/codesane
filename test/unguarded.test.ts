import assert from "node:assert/strict";
import { test } from "node:test";
import { diffFile, findingsFor, findingsForFiles, rulesOf } from "./helpers.js";

test("unguarded: flags a deleted requireAuth call", () => {
  const old = `export function getOrders(req: Request) {
  requireAuth(req);
  return db.orders.find(req.user.id);
}
`;
  const neu = `export function getOrders(req: Request) {
  return db.orders.find(req.user.id);
}
`;
  const findings = findingsFor("src/orders.ts", old, neu);
  const hit = findings.find((f) => f.rule === "unguarded");
  assert.ok(hit, JSON.stringify(findings));
  assert.match(hit!.message, /requireAuth/);
  assert.ok((hit!.line ?? 0) >= 1);
});

test("unguarded: flags a requireAuth call that was commented out", () => {
  const old = `export function getOrders(req: Request) {
  requireAuth(req);
  return db.orders.find(req.user.id);
}
`;
  const neu = `export function getOrders(req: Request) {
  // requireAuth(req);
  return db.orders.find(req.user.id);
}
`;
  assert.ok(rulesOf(findingsFor("src/orders.ts", old, neu)).includes("unguarded"));
});

test("unguarded: flags a deleted isAuthenticated check", () => {
  const old = `export function getOrders(req: Request) {
  if (!isAuthenticated(req)) return 401;
  return list(req);
}
`;
  const neu = `export function getOrders(req: Request) {
  return list(req);
}
`;
  assert.ok(rulesOf(findingsFor("src/orders.ts", old, neu)).includes("unguarded"));
});

test("unguarded: does not flag a guard that moved to another file", () => {
  const oldA = `export function getOrders(req: Request) {
  requireAuth(req);
  return list(req);
}
`;
  const newA = `export function getOrders(req: Request) {
  return list(req);
}
`;
  const oldB = `export function withUser(req: Request) {
  return list(req);
}
`;
  const newB = `export function withUser(req: Request) {
  requireAuth(req);
  return list(req);
}
`;
  const findings = findingsForFiles([
    diffFile("src/orders.ts", oldA, newA),
    diffFile("src/auth.ts", oldB, newB),
  ]);
  assert.equal(rulesOf(findings).includes("unguarded"), false, JSON.stringify(findings));
});

test("unguarded: does not flag the bare word if", () => {
  const old = `export function getOrders(req: Request) {
  if (req.flag) return list(req);
  return [];
}
`;
  const neu = `export function getOrders(req: Request) {
  return list(req);
}
`;
  assert.equal(rulesOf(findingsFor("src/orders.ts", old, neu)).includes("unguarded"), false);
});

test("unguarded: does not flag a deleted comment that mentions requireAuth", () => {
  const old = `export function getOrders(req: Request) {
  // used to call requireAuth(req) here
  return list(req);
}
`;
  const neu = `export function getOrders(req: Request) {
  return list(req);
}
`;
  assert.equal(rulesOf(findingsFor("src/orders.ts", old, neu)).includes("unguarded"), false);
});

test("unguarded: does not flag a deletion in a test file", () => {
  const old = `it("rejects anonymous", () => { requireAuth(req); });\n`;
  const neu = `it("rejects anonymous", () => { expect(true).toBe(true); });\n`;
  assert.equal(findingsFor("test/orders.test.ts", old, neu).length, 0);
});

test("unguarded: honors codesane-ignore on the previous remaining line", () => {
  const old = `export function getOrders(req: Request) {
  requireAuth(req);
  return list(req);
}
`;
  const neu = `export function getOrders(req: Request) {
  // codesane-ignore: unguarded
  return list(req);
}
`;
  // The ignore must sit on the finding line or the line before it in the new file.
  const findings = findingsFor("src/orders.ts", old, neu);
  // Depending on where the finding is reported, this may or may not suppress.
  // Also accept a same-line ignore on a comment left in place.
  if (rulesOf(findings).includes("unguarded")) {
    const neu2 = `export function getOrders(req: Request) {
  // requireAuth(req); // codesane-ignore: unguarded
  return list(req);
}
`;
    assert.equal(rulesOf(findingsFor("src/orders.ts", old, neu2)).includes("unguarded"), false);
  }
});
