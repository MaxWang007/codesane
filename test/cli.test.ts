import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTemps, git, makeRepo, runCli, trackTemp } from "./helpers.js";

after(() => cleanupTemps());

const before = {
  "src/orders.ts": `export function getOrders(req: Request) {
  requireAuth(req);
  try {
    return fetchOrders(req.user);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export function connectUpstream(url: string) {
  return tls.connect({ url, rejectUnauthorized: true });
}
`,
};

const afterTree = {
  "src/orders.ts": `export function getOrders(req: Request) {
  // requireAuth(req);
  try {
    return fetchOrders(req.user) as any;
  } catch (err) {}
}

export function connectUpstream(url: string) {
  return tls.connect({ url, rejectUnauthorized: false });
}

export function refundOrder(id: string) {
  throw new Error('not implemented');
}
`,
};

test("CLI --json exits 1 and reports each rule with file:line", () => {
  const dir = trackTemp(makeRepo(before, afterTree));
  const result = runCli(["check", dir, "--base", "HEAD", "--json"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout) as {
    verdict: string;
    exitCode: number;
    findings: { rule: string; path: string; line?: number }[];
  };
  assert.equal(json.verdict, "not_sane");
  assert.equal(json.exitCode, 1);
  const rules = new Set(json.findings.map((f) => f.rule));
  for (const rule of ["swallow", "escape", "unguarded", "loosen", "stub"]) {
    assert.ok(rules.has(rule), `missing ${rule}: ${result.stdout}`);
  }
  for (const f of json.findings) {
    assert.equal(f.path, "src/orders.ts");
    assert.ok((f.line ?? 0) >= 1);
  }
});

test("CLI --markdown includes rule ids and file:line", () => {
  const dir = trackTemp(makeRepo(before, afterTree));
  const result = runCli(["check", dir, "--base", "HEAD", "--markdown"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /swallow/);
  assert.match(result.stdout, /src\/orders\.ts:\d+/);
  assert.match(result.stdout, /not sane/);
});

test("CLI exits 0 on a clean production change", () => {
  const dir = trackTemp(
    makeRepo(
      { "src/orders.ts": "export function getOrders() {\n  return requireAuthThenList();\n}\n" },
      { "src/orders.ts": "export function getOrders() {\n  const user = requireAuth();\n  return listFor(user);\n}\n" },
    ),
  );
  const result = runCli(["check", dir, "--base", "HEAD"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Verdict: sane/);
});

test("CLI exits 2 when the path is not a git repository", () => {
  const dir = trackTemp(mkdtempSync(join(tmpdir(), "codesane-nogit-")));
  const result = runCli(["check", dir]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Not a git repository/i);
});

test("CLI exits 2 when --json and --markdown are combined", () => {
  const dir = trackTemp(makeRepo(before));
  const result = runCli(["check", dir, "--json", "--markdown"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /json|markdown/i);
});

test("explain prints a one-pager for swallow", () => {
  const result = runCli(["explain", "swallow"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /swallow/);
  assert.match(result.stdout, /catch/);
});

test("explain unknown rule exits 2", () => {
  const result = runCli(["explain", "not_a_rule"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown rule/);
});

test("hook install writes a v2 hook that delegates to codesane hook run", () => {
  const dir = trackTemp(makeRepo(before));
  const result = runCli(["hook", "install", "--pre-commit", "--pre-push"], dir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const preCommit = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8");
  const prePush = readFileSync(join(dir, ".git", "hooks", "pre-push"), "utf8");
  assert.match(preCommit, /codesane-hook-v2/);
  assert.match(preCommit, /codesane hook run pre-commit/);
  assert.match(prePush, /codesane hook run pre-push/);
  assert.doesNotMatch(prePush, /--base HEAD/);
});

test("hook run pre-push diffs against the remote SHA, not HEAD", () => {
  const dir = trackTemp(makeRepo(before, afterTree));
  const shaBefore = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  git(dir, ["add", "-A"]);
  const committed = git(dir, ["commit", "-m", "agent emptied a catch"]);
  assert.equal(committed.status, 0, committed.stderr);
  const shaAfter = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  const stdin = `refs/heads/main ${shaAfter} refs/heads/main ${shaBefore}\n`;
  const headCheck = runCli(["check", dir, "--base", "HEAD"]);
  assert.equal(headCheck.status, 0, headCheck.stderr || headCheck.stdout);
  const result = runCli(["hook", "run", "pre-push"], dir, undefined, stdin);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /swallow/);
  assert.match(result.stdout, /Verdict: not sane/);
});

test("hook uninstall removes only codesane hooks", () => {
  const dir = trackTemp(makeRepo(before));
  runCli(["hook", "install", "--pre-commit"], dir);
  const other = join(dir, ".git", "hooks", "pre-push");
  writeFileSync(other, "#!/bin/sh\necho leftover\n");
  const result = runCli(["hook", "uninstall"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(dir, ".git", "hooks", "pre-commit")));
  assert.ok(existsSync(other));
});

test("npx-style default command (no subcommand) runs check", () => {
  const dir = trackTemp(makeRepo(before, afterTree));
  const result = runCli([dir, "--base", "HEAD"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /Verdict: not sane/);
});

test("MCP stdio server lists codesane_check and returns a structured verdict", async () => {
  const dir = trackTemp(makeRepo(before, afterTree));
  const { CLI, TSX_LOADER } = await import("./helpers.js");
  const proc = spawn(process.execPath, ["--import", TSX_LOADER, CLI, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });

  const chunks: Buffer[] = [];
  proc.stdout.on("data", (b: Buffer) => chunks.push(b));
  const errChunks: Buffer[] = [];
  proc.stderr.on("data", (b: Buffer) => errChunks.push(b));

  const send = (msg: unknown) => {
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const readMessages = async (minCount: number, timeoutMs = 8000): Promise<unknown[]> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const buf = Buffer.concat(chunks).toString("utf8");
      const messages = buf
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        });
      if (messages.length >= minCount) return messages;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `timed out waiting for MCP messages; stdout=${Buffer.concat(chunks).toString("utf8")} stderr=${Buffer.concat(errChunks).toString("utf8")}`,
    );
  };

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "codesane-test", version: "0.0.0" },
    },
  });

  const first = await readMessages(1);
  const init = first[0] as { id: number; result?: { serverInfo?: { name: string } } };
  assert.equal(init.id, 1);
  assert.equal(init.result?.serverInfo?.name, "codesane");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  const listed = (await readMessages(2)).find((m) => (m as { id?: number }).id === 2) as {
    result?: { tools?: { name: string }[] };
  };
  assert.ok(listed?.result?.tools?.some((t) => t.name === "codesane_check"));

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "codesane_check",
      arguments: { cwd: dir, base: "HEAD" },
    },
  });

  const called = (await readMessages(3)).find((m) => (m as { id?: number }).id === 3) as {
    result?: {
      isError?: boolean;
      structuredContent?: { verdict?: string; findings?: { rule: string }[] };
      content?: { type: string; text: string }[];
    };
  };
  const payload = called?.result;
  assert.ok(payload, `missing tools/call result: ${JSON.stringify(called)}`);
  const structured = payload.structuredContent;
  const fromText = payload.content?.find((c) => c.text.startsWith("{"));
  const body =
    structured ??
    (fromText ? (JSON.parse(fromText.text) as { verdict: string; findings: { rule: string }[] }) : undefined);
  assert.ok(body, `no structured verdict: ${JSON.stringify(payload)}`);
  assert.equal(body.verdict, "not_sane");
  const findings = (body as { findings?: { rule: string }[] }).findings ?? [];
  assert.ok(findings.some((f) => f.rule === "swallow"));

  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => proc.once("close", () => resolve()));
});
