import assert from "node:assert/strict";
import { test } from "node:test";
import { findingsFor, rulesOf } from "./helpers.js";

const CASES: { name: string; path: string; oldLine: string; newLine: string }[] = [
  {
    name: "rejectUnauthorized: false",
    path: "src/tls.ts",
    oldLine: "  return tls.connect({ url, rejectUnauthorized: true });",
    newLine: "  return tls.connect({ url, rejectUnauthorized: false });",
  },
  {
    name: "verify=False",
    path: "src/http.py",
    oldLine: "    return requests.get(url, verify=True)",
    newLine: "    return requests.get(url, verify=False)",
  },
  {
    name: "NODE_TLS_REJECT_UNAUTHORIZED",
    path: "src/tls.ts",
    oldLine: "  process.env.NODE_ENV = 'production';",
    newLine: "  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
  },
  {
    name: "InsecureSkipVerify",
    path: "src/tls.go",
    oldLine: "\tcfg := &tls.Config{MinVersion: tls.VersionTLS12}",
    newLine: "\tcfg := &tls.Config{InsecureSkipVerify: true}",
  },
  {
    name: "curl -k",
    path: "scripts/fetch.sh",
    oldLine: "curl https://example.com",
    newLine: "curl -k https://example.com",
  },
  {
    name: "Access-Control-Allow-Origin: *",
    path: "src/cors.ts",
    oldLine: "  res.setHeader('Access-Control-Allow-Origin', 'https://app.example');",
    newLine: "  res.setHeader('Access-Control-Allow-Origin', '*');",
  },
  {
    name: "origin: '*'",
    path: "src/cors.ts",
    oldLine: "  const cors = { origin: 'https://app.example' };",
    newLine: "  const cors = { origin: '*' };",
  },
  {
    name: "dangerouslySetInnerHTML",
    path: "src/view.tsx",
    oldLine: "  return <div>{text}</div>;",
    newLine: "  return <div dangerouslySetInnerHTML={{ __html: text }} />;",
  },
  {
    name: ".innerHTML =",
    path: "src/view.ts",
    oldLine: "  el.textContent = html;",
    newLine: "  el.innerHTML = html;",
  },
  {
    name: "eval(",
    path: "src/run.ts",
    oldLine: "  return JSON.parse(code);",
    newLine: "  return eval(code);",
  },
  {
    name: "new Function(",
    path: "src/run.ts",
    oldLine: "  return JSON.parse(code);",
    newLine: "  return new Function(code)();",
  },
  {
    name: "shell=True",
    path: "src/run.py",
    oldLine: "    subprocess.run(cmd, shell=False)",
    newLine: "    subprocess.run(cmd, shell=True)",
  },
  {
    name: "chmod 777",
    path: "scripts/setup.sh",
    oldLine: "chmod 755 ./data",
    newLine: "chmod 777 ./data",
  },
];

for (const item of CASES) {
  test(`loosen: flags ${item.name}`, () => {
    const old = `export function apply() {\n${item.oldLine}\n}\n`;
    const neu = `export function apply() {\n${item.newLine}\n}\n`;
    const findings = findingsFor(item.path, old, neu);
    assert.ok(
      findings.some((f) => f.rule === "loosen"),
      `expected loosen for ${item.name}, got ${JSON.stringify(findings)}`,
    );
  });
}

test("loosen: does not flag exec( or rejectUnauthorized: true", () => {
  const old = `export function apply() {
  return run(cmd);
}
`;
  const neu = `export function apply() {
  return exec(cmd);
}
`;
  assert.equal(rulesOf(findingsFor("src/run.ts", old, neu)).includes("loosen"), false);

  const oldTls = `export function connect(url: string) {
  return tls.connect({ url });
}
`;
  const neuTls = `export function connect(url: string) {
  return tls.connect({ url, rejectUnauthorized: true });
}
`;
  assert.equal(rulesOf(findingsFor("src/tls.ts", oldTls, neuTls)).includes("loosen"), false);
});

test("loosen: does not flag a pre-existing loosening or a test file", () => {
  const src = `export function connect(url: string) {
  return tls.connect({ url, rejectUnauthorized: false });
}
`;
  const neu = `export function connect(url: string) {
  return tls.connect({ url, rejectUnauthorized: false });
}

export function label() { return "ok"; }
`;
  assert.equal(rulesOf(findingsFor("src/tls.ts", src, neu)).includes("loosen"), false);
  assert.equal(
    findingsFor(
      "src/tls.test.ts",
      "it('x', () => {});",
      "it('x', () => { tls.connect({ rejectUnauthorized: false }); });",
    ).length,
    0,
  );
});

test("loosen: honors codesane-ignore", () => {
  const old = `export function connect(url: string) {\n  return tls.connect({ url });\n}\n`;
  const neu = `export function connect(url: string) {\n  return tls.connect({ url, rejectUnauthorized: false }); // codesane-ignore: loosen\n}\n`;
  assert.equal(rulesOf(findingsFor("src/tls.ts", old, neu)).includes("loosen"), false);
});
