# SLOs and Release Gates

Status: **Phase 0 acceptance contract**

SLOs separate provider delay, ingestion delay, platform processing, network
delivery, and client rendering. “Seconds-fast live score” cannot be proven from
server response time alone.

## Required timestamps

Every source event/projection path must make these measurable:

| Timestamp | Meaning |
|---|---|
| `provider_event_at` | provider-declared event/update time |
| `provider_received_at` | time the platform receives provider bytes/message |
| `ingested_at` | raw event durably accepted |
| `published_at` | projection version available to clients |
| `client_seen_at` | instrumented client receipt/render time |

If a provider does not expose `provider_event_at`, mark it unavailable; do not
substitute platform time.

## Target SLOs

| Indicator | Target |
|---|---:|
| Major-tour provider event to client, P95 | ≤ 8 seconds |
| Platform delivery (`provider_received_at` → `client_seen_at`), P95 | ≤ 1 second |
| Platform received to projection published, P95 | ≤ 200 ms |
| Server projection API, P95 | ≤ 300 ms |
| Mainland client API, P95 | ≤ 800 ms |
| WebSocket connection, P95 | ≤ 1.5 seconds |
| Known in-contract schedule coverage | ≥ 99.9% |
| Unjustified terminal rollback | 0 |
| Duplicate/out-of-order illegal state | 0 |
| Upstream incident detection/degradation | ≤ 30 seconds |
| 30-minute realtime abnormal disconnect rate | < 2% |
| Every displayed match exposes `asOf` | 100% |

“Known in-contract” requires a documented denominator from supplier/official
coverage. It must not silently exclude missing competitions.

Latency and coverage are reported separately for:

- Grand Slam/ATP/WTA main tour;
- Challenger/WTA 125;
- ITF adult;
- junior;
- singles, doubles/mixed doubles, qualifying, and team rubbers.

The platform-delivery P95 target applies whenever the client is connected,
regardless of circuit. Provider-event-to-client targets are capability-aware:
main-tour live point/game feeds target ≤8 seconds; Challenger, ITF, and junior
feeds report the provider contract/observed upstream delay plus the same ≤1
second platform budget. Result-only coverage cannot be marketed as point-live.

## Correctness and completeness scorecard

| Domain | Measurement/release condition |
|---|---|
| Schedule | expected in-contract matches vs canonical matches; ≥99.9%, with missing list |
| Duplicate match | canonical duplicates per edition/day; 0 unresolved at release |
| Identity | false high-confidence merges; 0 known; medium/low queue rate reported |
| State | illegal transition and unjustified terminal rollback; 0 |
| Draw | expected nodes/edges vs published tree for sources declaring full; 100% or downgrade to partial |
| H2H | completeness proof per requested scope; definitive totals blocked on any known gap |
| Official ranking | row count, unique player identity, order/ties, points vs source; 100% reconciled or partial |
| Live/race ranking | ledger replay total vs projection and official checkpoints; unexplained difference 0 |
| Points composition | breakdown sum vs ledger/live-ranking total; unexplained difference 0 |
| Player profile | per-field conflict/freshness/identity confidence reported; no silent whole-record overwrite |
| Source coverage | observations and gaps by provider/capability/circuit/discipline/stage |

## Phase gates

### Gate A — Baseline integrity

- Source baseline is commit `142c687` from `origin/main`.
- Baseline environment recorded as Node `v24.14.0`; supported runtime remains
  `>=18` until a runtime ADR changes it.
- Existing suite is 61/61 before Phase 0 additions.
- Production `src`, deploy files, live-score frontend assets, root `index.html`,
  and `start` command are unchanged in Phase 0.
- Production dependency maps and service-root lockfile set are unchanged; the
  TypeScript dependency is isolated under `v2/`.
- The three legacy files pass exact checksum freeze.
- A hard-coded `git diff 142c687` scope gate protects the same production paths
  so a manifest edit cannot bless a production change.

### Gate B — Architecture contract

- Root and service `AGENTS.md` exist.
- Architecture, domain, state, source, and SLO documents exist.
- An ADR records modular-monolith and freeze decisions.
- TypeScript-AST architecture scanner recursively covers
  JS/MJS/CJS/TS/MTS/CTS/JSX/TSX, static imports/exports, `require`, and dynamic
  `import`.
- Resolved transitive dependency traversal rejects `domain → shared → database`
  and unresolved bare aliases unless explicitly reviewed as pure.
- Domain traversal rejects non-statically-resolvable `import()`/`require()` and
  captured `require` references.
- Protected layers reject `eval`, `Function`, and `Proxy`. Constant propagation
  catches segmented provider/status keys, while normal typed dynamic map/DTO
  access and non-status reflection remain legal.
- Negative self-tests prove prohibited dependencies, computed provider keys,
  direct/constant-resolved/reflective status writes, and direct status-brand
  assertion bypasses fail without blocking ordinary DTO/map access.
- A TypeScript-program safety pass rejects explicit `any` and unsafe assignment,
  member, return, argument, call, construction, and spread flows. In particular,
  `JSON.parse(...)` cannot flow into `CanonicalMatch` without an
  `unknown`-first typed schema parser.
- Unknown-to-generic/concrete type assertions and TypeScript suppression
  directives are rejected. Assertions that preserve `unknown` and exhaustive
  `never` remain legal.
- V2 contracts live under `v2/`, pass strict TypeScript checking, use
  entity-specific IDs and typed observations/DTOs.
- A state-mutation gate with negative tests reserves status construction for the
  allowlisted pure reducer.

#### Gate threat model

These static checks are contributor guardrails against common and reusable
architecture bypasses; they are not a hostile-JavaScript security sandbox and
do not claim to enumerate every possible reflection/metaprogramming trick.
Phase 1 must runtime-freeze reducer outputs and test the freeze boundary.
Changes to gate scripts, workflows, baseline commit/hash data, provider
registries, or allowlists require an independent reviewer and protected-branch
approval. A contributor cannot weaken those governance files and approve the
same change.

### Gate C — Fixture truthfulness

- No handcrafted input is labeled real.
- Fixture manifest/schema validates.
- Payload hashes validate for quarantine/verified entries.
- Real API Tennis/WTA/ATP PDF payload absence is an explicit blocker, not hidden.
- A safe local intake command and review process exist.
- API Tennis capture tests reject a malicious host and repository-local output
  without making a network request or leaking the test key.

The Phase 0 code asset may satisfy the truthfulness mechanism while data
readiness remains blocked. With the current all-`pending_capture` manifest, Gate
C is **failed/blocked**, so overall Phase 0 is **not complete** and must not be
reported green. At minimum, authorized API Tennis fixture/live samples plus
relevant WTA and ATP official samples must be quarantined and reviewed before
this gate can be declared complete for adapter implementation.

### Gate D — Legacy-case continuity

- The nine new scenarios from hotfix commit `7c8fe48` are individually recorded
  with source test, target phase, and pending/migrated status.
- The strengthened pipeline-invalidation regression is recorded separately.
- The hotfix production changes are not merged wholesale.

### Gate E — Single-command verification

- `npm run verify:phase0` runs strict V2 typecheck, the exact 61-test existing
  suite, and explicit Phase 0 gates.
- Any command failure returns non-zero; CI does not use `continue-on-error`.

### Gate F — CI coverage

- CI triggers for changes to live-score source/tests/scripts/package files,
  architecture documents, both `AGENTS.md` files, root `index.html`, frontend
  live-score assets, deployment files, and the workflow itself.
- CI runs on pull requests and relevant pushes using a supported Node runtime.

Residual governance risk: a pull request can attempt to weaken its own workflow,
baseline, allowlist, or ADR. Repository branch protection must require this
workflow plus an independent reviewer for changes to those files, disallow
direct pushes to the protected release branch, and require review dismissal
after new commits. CI alone cannot approve its own trust policy.

### Gate G — Scope and handoff

- Phase 0 contains no production behavior, provider integration, deploy, traffic,
  or Goalserve change.
- Diff, commands, tests, missing fixtures, and remaining risks are reported.
- An independent architecture review approves all A–G gates before Phase 1.

If any gate fails, Phase 0 is not complete.

## Later release gates

Before shadow mode:

- real contract fixtures for every active adapter capability;
- reducer invariant/property tests;
- deterministic replay test from raw events;
- identity and competition ambiguity queues;
- source-health state machine and alerts.

Before user traffic:

- 14–30 day dual-source report;
- ATP/WTA/Challenger/ITF/junior coverage samples;
- no open P0/P1 correctness issue;
- load test at 2,000 realtime connections and 100 API requests/second for
  30 minutes, with CPU mostly below 70%, no OOM, and at least 20% memory headroom;
- mainland China Mobile/Unicom/Telecom measurements from the Singapore origin;
- 5% → 25% → 100% staged rollout;
- one-action rollback to V1 tested.

## Server-location decision

At 10,000 DAU, server location is a measured network decision, not a compute
requirement. Continue with the Singapore origin until mainland API latency or
realtime stability fails the stated gates. Optimize payloads, static asset
delivery, memory, and server size before introducing a mainland gateway. A split
Singapore-ingestion/mainland-distribution topology requires a separate ADR,
compliance review, and measured need.
