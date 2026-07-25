# ADR 0001: Modular monolith with immutable source-event ledger

- Status: Proposed
- Date: 2026-07-25

This ADR requires independent architecture approval before its status can become
Accepted. Creation of Phase 0 assets is not that approval.

## Context

The existing live-score service combines provider access, official parsing,
schedule selection, match-state decisions, caching, and publication in large
legacy modules. Repeated incident fixes have increased special-case branches and
cannot reliably replay the original provider input.

The product must cover ATP, WTA, Challenger, ITF, and junior tennis, tolerate
provider gaps, support source replacement, and serve web and mini-program clients
at roughly 10,000 DAU.

## Decision

Build V2 as a Node/TypeScript modular monolith with:

- capability-based source adapters;
- append-only raw source events;
- canonical identity and tennis models;
- deterministic replayable match reducer;
- field-level reconciliation with provenance;
- versioned page projections and one shared BFF;
- Postgres durability and Redis ephemeral coordination/cache.

Do not introduce microservices, Kafka, or Kubernetes at this stage.

During Phase 0, freeze `poller.mjs`, `official-validator.mjs`, and
`normalizer.mjs` byte-for-byte. Preserve their behavior suite while V2 is built
beside them. The hotfix commit `7c8fe48` is mined for scenarios but not merged as
the target architecture.

## Consequences

Positive:

- parser fixes can replay historical events;
- provider changes are adapter work rather than UI/state rewrites;
- every selected field is explainable;
- source outages degrade honestly without resetting matches;
- one maintainer can operate the deployment.

Costs:

- raw event retention and replay tooling;
- canonical identity review queues;
- more up-front contracts and tests;
- dual-run storage/compute during migration;
- manual classification/override workflow for irreducible ambiguity.

## Enforcement

- repository and service `AGENTS.md`;
- exact production/legacy checksum baseline;
- recursive dependency/provider-field architecture scan with negative tests;
- fixture manifest truthfulness and hash validation;
- single `npm run verify:phase0` gate and CI workflow;
- an ADR and independent review for exceptions.
