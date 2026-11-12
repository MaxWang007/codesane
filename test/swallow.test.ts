import assert from "node:assert/strict";
import { test } from "node:test";
import { findingsFor, rulesOf } from "./helpers.js";

test("swallow: flags an added empty catch {}", () => {
  const old = `export function parse(text: string) {
  return JSON.parse(text);
}
`;
  const neu = `export function parse(text: string) {
  try {
    return JSON.parse(text);
  } catch {}
}
`;
  const findings = findingsFor("src/parse.ts", old, neu);
  assert.ok(findings.some((f) => f.rule === "swallow"));
  const hit = findings.find((f) => f.rule === "swallow");
  assert.ok((hit?.line ?? 0) >= 1);
  assert.match(hit!.message, /swallow/i);
});

test("swallow: flags catch (e) {} and comment-only bodies", () => {
  const old = `export function load() {
  return read();
}
`;
  const neu = `export function load() {
  try { return read(); } catch (e) { /* ignore */ }
}
`;
  assert.ok(rulesOf(findingsFor("src/load.ts", old, neu)).includes("swallow"));
});

test("swallow: flags except: pass", () => {
  const old = `def load(path):
    return open(path).read()
`;
  const neu = `def load(path):
    try:
        return open(path).read()
    except:
        pass
`;
  assert.ok(rulesOf(findingsFor("src/load.py", old, neu)).includes("swallow"));
});

test("swallow: flags except Exception: pass", () => {
  const old = `def load(path):
    return open(path).read()
`;
  const neu = `def load(path):
    try:
        return open(path).read()
    except Exception:
        pass
`;
  assert.ok(rulesOf(findingsFor("src/load.py", old, neu)).includes("swallow"));
});

test("swallow: flags rescue nil", () => {
  const old = `def load(path)
  File.read(path)
end
`;
  const neu = `def load(path)
  File.read(path) rescue nil
end
`;
  assert.ok(rulesOf(findingsFor("src/load.rb", old, neu)).includes("swallow"));
});

test("swallow: flags a catch that only logs and returns a success value", () => {
  const old = `export function items() {
  return fetchItems();
}
`;
  const neu = `export function items() {
  try {
    return fetchItems();
  } catch (e) {
    console.log(e);
    return [];
  }
}
`;
  const findings = findingsFor("src/items.ts", old, neu);
  assert.ok(findings.some((f) => f.rule === "swallow" && /success|return/i.test(f.message)));
});

test("swallow: flags a rethrow that was removed from the same handler", () => {
  const old = `export function items() {
  try {
    return fetchItems();
  } catch (err) {
    console.error(err);
    throw err;
  }
}
`;
  const neu = `export function items() {
  try {
    return fetchItems();
  } catch (err) {
    console.log(err);
    return null;
  }
}
`;
  assert.ok(rulesOf(findingsFor("src/items.ts", old, neu)).includes("swallow"));
});

test("swallow: does not flag a catch that rethrows", () => {
  const old = `export function items() {
  return fetchItems();
}
`;
  const neu = `export function items() {
  try {
    return fetchItems();
  } catch (err) {
    console.error(err);
    throw err;
  }
}
`;
  assert.equal(rulesOf(findingsFor("src/items.ts", old, neu)).includes("swallow"), false);
});

test("swallow: does not flag a pre-existing empty catch on an unchanged line", () => {
  const src = `export function items() {
  try {
    return fetchItems();
  } catch {}
}

export function label() {
  return "ok";
}
`;
  const neu = `export function items() {
  try {
    return fetchItems();
  } catch {}
}

export function label() {
  return "ready";
}
`;
  assert.equal(rulesOf(findingsFor("src/items.ts", src, neu)).includes("swallow"), false);
});

test("swallow: does not flag an empty catch in a test file", () => {
  const old = `it("works", () => { expect(1).toBe(1); });
`;
  const neu = `it("works", () => {
  try { expect(1).toBe(1); } catch {}
});
`;
  assert.equal(findingsFor("src/items.test.ts", old, neu).length, 0);
});

test("swallow: honors codesane-ignore on the previous line", () => {
  const old = `export function items() {
  return fetchItems();
}
`;
  const neu = `export function items() {
  try {
    return fetchItems();
    // codesane-ignore: swallow
  } catch {}
}
`;
  assert.equal(rulesOf(findingsFor("src/items.ts", old, neu)).includes("swallow"), false);
});

test("swallow: flags a no-op promise .catch()", () => {
  const old = `export function items() {
  return fetchItems();
}
`;
  const neu = `export function items() {
  return fetchItems().catch(() => []);
}
`;
  assert.ok(rulesOf(findingsFor("src/items.ts", old, neu)).includes("swallow"));
});
