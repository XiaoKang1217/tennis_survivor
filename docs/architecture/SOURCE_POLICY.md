# Source, Reconciliation, and Degradation Policy

Status: **Phase 0 contract; source-specific rules require measured evidence**

## Principle

There is no universal “newest source wins” rule. Authority, continuity,
capability, freshness, confidence, and correction policy are evaluated per data
field. Provider health and coverage are visible outputs.

## Planned authority by domain

| Domain | Preferred policy |
|---|---|
| Live score and server | Fresh, continuous, contract-tested commercial live source |
| Schedule, court, round | Official draw/OOP or validated commercial schedule source |
| Fast final result | Commercial source, subject to official correction |
| Draw | Official source or commercial source proven structurally complete |
| Historical H2H | Canonical historical match ledger |
| Official ranking | Immutable ATP/WTA dated snapshot |
| Live ranking | Audited points-ledger projection or separately accepted supplier |
| Race ranking | Season-points projection or separately accepted supplier |
| Player profile | Field-level merge in the identity store |

This table does not activate a provider. Each capability must pass fixture,
shadow, coverage, and SLO gates.

## Field selection record

Every selected canonical field records:

```ts
type SelectionDecision = {
  canonicalEntityId: string;
  field: string;
  value: unknown;
  sourceEventId: string;
  provider: string;
  sourceUpdatedAt?: string;
  observedAt: string;
  selectedAt: string;
  policyVersion: string;
  reasonCode: string;
  confidence: 'high' | 'medium' | 'low';
  overrideId?: string;
};
```

The reason code must be machine-readable, such as
`preferred_live_source_continuous`, `official_correction`,
`higher_identity_confidence`, or `operator_override`.

## Reconciliation rules

1. Resolve canonical identity before comparing provider records.
2. Reject schema-invalid input to quarantine.
3. Reject older same-source sequence/timestamp updates for the affected field.
4. Prefer continuity for live snapshots over isolated freshness.
5. Do not splice score, server, and current game from inconsistent snapshots.
6. Preserve accepted terminal state until an authorized correction.
7. Preserve schedule records through an empty/error response.
8. Treat source omission as evidence about source health, not cancellation.
9. Keep ambiguous identity/competition records separate.
10. Record every decision and make it replayable.

## Capability and honest degradation

Each provider observation declares:

```ts
type SourceCoverage = {
  score: 'point' | 'game' | 'set' | 'result_only' | 'none';
  stats: 'live' | 'post_match' | 'none';
  draw: 'full' | 'partial' | 'none';
  h2hHistory: 'complete' | 'partial' | 'unknown';
  scheduleHistory: 'complete' | 'partial' | 'unknown';
  officialRanking: 'full' | 'partial' | 'none';
  liveRanking: 'full' | 'partial' | 'none';
  raceRanking: 'full' | 'partial' | 'none';
  pointsComposition: 'complete' | 'partial' | 'unknown';
  playerProfile: 'complete' | 'partial' | 'unknown';
};
```

Expected behavior:

- no points: show games/sets without invented point score;
- no live feed: show latest accepted state and `asOf`;
- partial draw: label it partial and do not infer missing branches;
- partial H2H: report coverage, not a definitive zero;
- unknown competition: basic display plus classification queue;
- stale provider: preserve state and show delay;
- all providers unavailable: serve last accepted projection with an outage
  indicator.

Automatic/degraded/operator-review percentages are not yet measured, so Phase 0
sets no fabricated 95/4/1 acceptance target. Shadow operation must establish a
baseline by circuit/capability before an ADR introduces thresholds. Uncertainty
must remain explicit regardless of the eventual target.

## API Tennis migration policy

API Tennis is the first compatibility adapter because it represents current
behavior. During its wrapping phase:

- preserve V1 output and regression behavior;
- record raw responses before parsing;
- move raw field names into the adapter only;
- do not optimize match rules during adapter extraction;
- compare V1 and V2 projections before switching.

## Goalserve evaluation policy

Goalserve is a second independent source-shape validation and supplier
candidate. It is not automatically authoritative.

Before production influence it must:

1. have legally obtained, sanitized real contract fixtures;
2. declare capabilities and raw schema;
3. map through the same canonical model;
4. run without user impact for 14–30 days;
5. compare coverage, source-to-platform latency, state, result, stats, and ITF
   availability against API Tennis and official evidence;
6. meet release gates and have a rollback switch.

Provider purchase and final primary/backup selection follow measurement, not
precede it.

## Official sources

ATP, WTA, and ITF official sources are independent capability adapters. They may
provide schedule, OOP, draw, ranking, historical match, or correction evidence.
Official parsing must not live in a poller or directly mutate live state.

Source use must respect contracts, licensing, rate limits, and robots/access
rules. A fixture registry entry records acquisition method without storing
credentials or signed URLs.

## Operator overrides

Allowed override types:

- identity merge/split;
- competition classification;
- match primary source;
- official date/round/court;
- provider-record rejection;
- Q/LL/WC/alternate replacement.

Every override requires author, reason, evidence, timestamp, scope, and
expiry/review date. Overrides are append-only inputs to replay.
