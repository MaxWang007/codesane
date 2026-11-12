import type { RuleId } from "./types.js";

export interface RuleDoc {
  id: RuleId;
  title: string;
  summary: string;
  examples: string[];
}

export const RULES: Record<RuleId, RuleDoc> = {
  swallow: {
    id: "swallow",
    title: "An error handler was emptied or turned into a no-op",
    summary:
      "Flags empty or no-op catch / except / rescue handlers added in the diff, handlers that only log and return a success-ish value (null, [], {}, 0, false) without rethrowing, and handlers that previously rethrew or returned the error after that line was removed.",
    examples: ["catch (err) { throw err; } → catch (err) {}", "except Exception: raise → except Exception: pass"],
  },
  escape: {
    id: "escape",
    title: "A type or lint escape was added",
    summary:
      "Flags newly added as any, as unknown as, @ts-ignore, @ts-nocheck, @ts-expect-error, eslint-disable, eslint-disable-next-line, # noqa, # type: ignore, # pyright: ignore, // nolint, and @SuppressWarnings. A move of the same escape inside the file is not flagged.",
    examples: ["return payload as any", "// @ts-ignore"],
  },
  unguarded: {
    id: "unguarded",
    title: "An auth or validation guard disappeared",
    summary:
      "Flags deleted lines that call a specific auth, permission, validation, or sanitization helper (requireAuth, isAuthenticated, verifyToken, sanitize, and similar). If a similar call is added anywhere in the same diff, the change is treated as a move and is not flagged.",
    examples: ["requireAuth(req); deleted", "requireAuth(req); → // requireAuth(req);"],
  },
  loosen: {
    id: "loosen",
    title: "A security control was loosened",
    summary:
      "Flags newly added TLS verification opt-outs (rejectUnauthorized: false, verify=False, NODE_TLS_REJECT_UNAUTHORIZED, InsecureSkipVerify, curl -k), CORS origins set to *, and a tight list of dangerous sinks (dangerouslySetInnerHTML, .innerHTML =, eval(, new Function(, shell=True, chmod 777). Bare exec( is not flagged.",
    examples: ["rejectUnauthorized: true → rejectUnauthorized: false", "origin: '*'"],
  },
  stub: {
    id: "stub",
    title: "Unfinished work was left in the diff",
    summary:
      "Flags added not implemented / NotImplementedError / unimplemented!() / todo!() / throw new Error('TODO') lines, TODO: implement comments, and newly added exported functions whose body is only pass, return, or a stub.",
    examples: ["export function refund() { throw new Error('not implemented'); }", "def refund(): pass"],
  },
};

export function formatRuleDoc(id: RuleId): string {
  const rule = RULES[id];
  const lines = [
    `${rule.id} — ${rule.title}`,
    "",
    rule.summary,
    "",
    "Examples:",
    ...rule.examples.map((e) => `  - ${e}`),
  ];
  return lines.join("\n");
}
