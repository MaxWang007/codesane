# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-11-12

Initial release.

- `codesane check` reads the worktree diff (unstaged and staged) against `--base` and flags quiet weakenings in production code.
- Deterministic detectors for emptied error handlers (`swallow`), new type or lint escapes (`escape`), removed auth or validation guards (`unguarded`), security loosenings (`loosen`), and unfinished stubs (`stub`).
- Test files are skipped; shipsane covers that side.
- `--json` and `--markdown` reports, `codesane hook install`, a stdio MCP server (`codesane_check`), and a GitHub Action.
- Optional `.codesane.yml` for disabled rules, ignore paths, a default base, and an allowlist that requires a reason.
- Inline suppressions with `codesane-ignore` or `codesane-ignore: <rule>` on the same or previous line.
