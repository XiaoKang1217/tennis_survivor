# Repository instructions

These instructions apply to the whole repository. A deeper `AGENTS.md` may add
stricter rules for its subtree.

## Product priority

The live-score backend is being migrated to a small tennis data platform. Its
authoritative design documents live in `docs/architecture/`. When implementation
and a design document disagree, stop, record the proposed decision in an ADR,
and obtain review before changing either production behavior or an architectural
boundary.

Correctness means that data is traceable, replayable, explainable, replaceable
by source, configurable by competition, and capable of honest degradation. It
does not mean hiding uncertainty or adding a one-off parser branch.

## Change discipline

- Preserve unrelated user changes.
- Make one migration phase per pull request.
- Do not combine architecture migration, bug fixes, UI changes, and deployment.
- Every production bug fix must add a frozen, sanitized real-source payload and
  a regression test. If an authorized payload cannot be obtained, record the
  specific reason in the fixture manifest; the regression remains blocked and
  the affected capability must not influence production.
- Never label a handcrafted payload as a real fixture.
- Never commit credentials, API keys, signed URLs, session identifiers, or
  personal data that is not required for the test.
- Do not deploy, change production secrets, or switch traffic unless the task
  explicitly authorizes that action and the release gates pass.

## Required verification

For changes under `server/live-score/`, run the single authoritative gate:

```sh
npm run verify:phase0
```

from `server/live-score/`. `npm test` and `npm run test:phase0` remain useful
diagnostics, but they do not replace the baseline-count check in the authoritative
command. Report the commands, pass/fail counts, changed files, and any release
gate that remains unverified.
