# Phase 0 Baseline and Scope

Current decision status: **code assets under verification; overall Phase 0
blocked by Gate C real-fixture absence and pending independent ADR review.**

## Immutable starting point

- Branch starting point: `origin/main`
- Commit: `142c687`
- Commit subject: `Auto update current data`
- Test command: `cd server/live-score && npm test`
- Baseline result: 61 tests, 61 passed, 0 failed
- Test runtime observed during Phase 0: Node `v24.14.0`
- Package runtime declaration at baseline: Node `>=18`

The executable production-surface and legacy checksums are stored in
`server/live-score/test/architecture/production-baseline.json`.

## Phase 0 allowed changes

- root and service agent instructions;
- architecture documents and ADRs;
- architecture/baseline/fixture registry tests;
- fixture manifest, schema, README, and safe local intake script;
- package verification scripts without changing `scripts.start`;
- a dedicated GitHub CI workflow.

New V2 contracts are isolated under `server/live-score/v2/`, with a separate
strict TypeScript project and reproducible lockfile. No V2 module may be added to
the frozen V1 `src/` tree.

## Phase 0 prohibited changes

- any file under `server/live-score/src/`;
- any file under `server/live-score/deploy/`;
- any file under `assets/live-score/`;
- root `index.html`;
- production dependencies or the start command;
- provider integration or credentials;
- live data, cache, parsing, state, API, frontend, or deploy behavior;
- cherry-picking the hotfix production implementation;
- deployment or traffic changes.

## Legacy freeze

The following files are frozen byte-for-byte:

| File | Lines | Bytes | SHA-256 |
|---|---:|---:|---|
| `src/poller.mjs` | 555 | 19,306 | `54989b772285b9227a10cd2f72155b0b55ec1ebc9ae7ab246e91af0945190933` |
| `src/official-validator.mjs` | 706 | 26,204 | `87dd8119fded196aed710535d5af27f55431129f0a1d6618ba324f36c1a111b1` |
| `src/normalizer.mjs` | 313 | 13,808 | `41190a66542a78af129d7b6101af9f6cbc4eb2b2c9bdecfe060268173e9ccdb6` |

An approved future ADR may replace the checksum gate with a responsibility
removal gate during migration. Phase 0 may not do so.

The full V1 source/deploy/live-score assets and root `index.html` are protected
twice: current bytes/file set must match the manifest, and `git diff` against
the hard-coded immutable base `142c687` must be empty. Editing the manifest in
the same change therefore cannot bless a production change.

## Hotfix evidence

Commit `7c8fe48` has 70 passing tests but also expands legacy production code. It
is evidence, not the V2 base. Its nine new scenarios are registered in
`server/live-score/test/fixtures/legacy-case-migration.json`. Its modified
pipeline invalidation case is tracked as a strengthened existing regression.

No real raw provider response was found as a standalone fixture in the baseline
repository. Inline unit-test objects are synthetic/derived test inputs and are
not promoted to real payload fixtures.

## Phase 0 blockers carried forward

- capture and legal review of sanitized API Tennis fixtures;
- capture and legal review of WTA official payloads;
- capture and legal review of ATP OOP PDF bytes;
- Goalserve samples after trial access;
- real ITF, Challenger, junior, doubles, suspend/resume, retirement, walkover,
  postponement, correction, and empty/error samples;
- measured production latency/coverage baselines.

These blockers do not justify fabricated payloads. They prevent relevant later
capabilities from leaving shadow mode.
