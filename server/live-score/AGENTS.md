# Live-score service instructions

These rules apply to `server/live-score/` and are mandatory for every agent and
human contributor.

## Current phase

Phase 0 establishes documentation, behavior baselines, fixture intake, and
executable architecture gates. It must not alter production behavior.

The following files are frozen legacy code during Phase 0:

- `src/poller.mjs`
- `src/official-validator.mjs`
- `src/normalizer.mjs`

The root `index.html`, `assets/live-score/`, and `deploy/` are also frozen
production surfaces. Baseline/allowlist/workflow changes require independent
review and must not be used to bless a production diff.

Do not edit, grow, reformat, rename, or move them. Do not add tournament
exceptions, name regular expressions, source-specific fields, or new business
rules to them. A future migration may remove responsibility from legacy files
only after an approved ADR updates the freeze gate.

## Mandatory architecture

All new V2 implementation belongs under `v2/` (for example
`v2/src/domain/`). Do not place V2 modules inside the frozen V1 `src/` tree.

The target is a modular monolith with this one-way flow:

```text
source adapters -> immutable source events -> canonical identity/model
  -> deterministic state/reconciliation -> projections -> HTTP/realtime API
```

The detailed contracts are authoritative in `../../docs/architecture/`.

Hard boundaries:

- `domain` imports no adapter, HTTP, database, cache, UI, projection, or API
  module. Domain behavior is deterministic and side-effect free.
- Provider payload fields and provider identifiers may exist only inside that
  provider's adapter, fixture, raw-event envelope, or explicit source-entity
  mapping. They must not appear in canonical business models, projections, API
  DTOs, or UI.
- Adapters validate raw schemas and emit observations. They do not decide match
  terminality, display dates, translations, sorting, or current page state.
- Match state changes only through the canonical reducer. An empty source
  response changes source health, not match state.
- Canonical status is opaque outside the reducer. Do not use resolved `status`
  reflection or direct branded/canonical type assertions to forge it. Explicit
  `any` and unsafe implicit-`any` flows are forbidden in V2; legitimate
  `unknown` narrowing and exhaustive `never` remain allowed.
- Do not cast `unknown` directly to a type parameter or concrete business type;
  validate it through a typed schema/parser. `@ts-ignore`, `@ts-nocheck`, and
  `@ts-expect-error` are forbidden in V2 application code.
- Domain module loads must be statically resolvable. Protected layers may not
  use `eval`, `Function`, or `Proxy`. Typed dynamic map/DTO access is allowed;
  segmented provider/status keys are still detected through constant
  propagation.
- Raw source events are append-only. Corrections are new events, never mutation
  of history.
- APIs read projections; clients never consume provider payloads.
- ATP, WTA, Challenger, ITF, and junior differences are policies/capabilities,
  not separate copies of the pipeline.
- Unknown competition or identity matches are quarantined or honestly degraded;
  never guessed into a high-confidence canonical entity.

The static gates are contributor guardrails, not an adversarial JavaScript
sandbox. Do not expand them into indiscriminate reflection bans. Future reducer
outputs must be runtime-frozen with nested mutation tests. Gate/workflow,
baseline, registry, and allowlist changes require independent review enforced
through protected-branch ownership; an author cannot self-approve a weakened
gate.

## Provider adapter requirements

Each future adapter must declare:

- implemented capabilities;
- raw schema and schema version;
- provider-specific field registry used by the architecture gate;
- source and observed timestamps;
- retry, rate-limit, and reconnect behavior;
- real sanitized contract fixtures.

Adding a provider requires contract and replay tests before it can affect a
production projection. Goalserve must first run in shadow mode.

## Testing and definition of done

Every change must preserve the existing behavior suite and pass Phase 0 gates.
State/reconciliation work additionally requires idempotence, stale-event,
out-of-order, terminal-state, and replay tests.

A phase is not complete merely because tests pass. The handoff must list:

1. changed files;
2. requirement-to-test mapping;
3. all test commands and results;
4. legacy logic not yet migrated;
5. missing real fixtures and unverified SLOs;
6. whether an architecture exception or provider-field leak remains.

If a requested shortcut conflicts with these rules, stop and propose an ADR
instead of implementing it.
