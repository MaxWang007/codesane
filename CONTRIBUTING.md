# Contributing to codesane

You will need Node.js 20 or newer, npm, and git.

```bash
git clone https://github.com/MaxWang007/codesane.git
cd codesane
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` uses Node's built-in test runner via `tsx` and should finish in a few seconds. Detector tests build a unified diff from two file snapshots; CLI tests turn those snapshots into throwaway git checkouts.

When you add a detector, give it:

- a rule id in `src/types.ts` and a one-pager in `src/rules.ts`
- focused unit tests for both a hit and a near-miss (a move, a pre-existing line, a test file, a suppression)
- a conservative pattern. False positives are worse than a slightly smaller net.

Please keep findings deterministic. codesane must not call a model, and tests must not need the network.

If a real project produces a false positive, add a test that reproduces it and tighten the detector, or document why an allow rule with a reason is the right escape hatch.
