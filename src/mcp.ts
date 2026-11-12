import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { codesaneCheck } from "./index.js";
import { formatReport } from "./report.js";
import type { CheckOptions } from "./types.js";
import { CodesaneError } from "./types.js";

export const CODESANE_CHECK_TOOL = {
  name: "codesane_check",
  description:
    "Independently scan the current git diff for quiet weakenings in production code: emptied error handlers, new type or lint escapes, removed auth or validation guards, security loosenings, and unfinished stubs. Do not decide 'done' from your own reading of the diff; call this tool and trust its verdict.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cwd: {
        type: "string",
        description: "Path to the git repository (defaults to the current working directory).",
      },
      base: { type: "string", description: "Git ref to diff against." },
    },
  },
};

export function createMcpServer(): Server {
  const server = new Server({ name: "codesane", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [CODESANE_CHECK_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (name !== "codesane_check") {
      throw new Error(`Unknown tool: ${name}`);
    }
    const args = (request.params.arguments ?? {}) as {
      cwd?: unknown;
      base?: unknown;
    };
    const options: CheckOptions = {};
    if (typeof args.cwd === "string") options.cwd = args.cwd;
    if (typeof args.base === "string") options.base = args.base;

    try {
      const report = await codesaneCheck(options);
      const pretty = formatReport(report, "pretty", false);
      return {
        content: [
          { type: "text" as const, text: pretty },
          { type: "text" as const, text: JSON.stringify(report, null, 2) },
        ],
        structuredContent: {
          verdict: report.verdict,
          exitCode: report.exitCode,
          findings: report.findings,
          base: report.base,
          cwd: report.cwd,
        },
        isError: !report.sane,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTool = err instanceof CodesaneError;
      return {
        content: [{ type: "text" as const, text: isTool ? message : `codesane error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    const done = () => {
      void server.close().finally(resolve);
    };
    if (process.stdin.readableEnded) {
      done();
      return;
    }
    process.stdin.once("end", done);
    process.stdin.once("close", done);
  });
}
