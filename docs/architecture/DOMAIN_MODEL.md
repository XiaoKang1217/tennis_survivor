# Canonical Domain Model

Status: **Phase 0 contract; implementation begins after Phase 0 approval**

The canonical model represents tennis, not a provider response. Provider keys
are stored only in source mappings and event provenance.

## Identity

Every durable entity receives an internal immutable ID:

- `canonicalPlayerId`
- `competitionId`
- `tournamentEditionId`
- `canonicalMatchId`
- `venueId`

External identity is many-to-one:

```ts
type SourceEntityMapping = {
  provider: string;
  entityType: 'player' | 'competition' | 'edition' | 'match' | 'venue';
  sourceEntityId: string;
  canonicalEntityId: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: IdentityEvidence[];
  decidedAt: string;
  decidedBy: 'automatic' | 'operator';
};
```

Player evidence can include normalized names, birth date, nationality, gender,
official IDs, and historical opponents/events. Decision policy:

- high confidence: merge automatically;
- medium confidence: queue for review and keep provenance;
- low confidence: keep separate temporary entities;
- conflicting official IDs: never auto-merge.

Name equality alone is insufficient. A manual merge or split is an auditable,
replayable override, not a direct database rewrite.

## Competition, edition, draw, and stage

```ts
type Competition = {
  id: string;
  authority: 'ATP' | 'WTA' | 'ITF' | 'JOINT' | 'OTHER';
  circuit:
    | 'atp_tour'
    | 'atp_challenger'
    | 'wta_tour'
    | 'wta_125'
    | 'itf_world_tennis_tour'
    | 'itf_junior'
    | 'grand_slam'
    | 'team'
    | 'other';
};

type TournamentEdition = {
  id: string;
  competitionId: string;
  seasonId: string;
  eventFormat: 'individual' | 'team';
  venueTimezone: string;
  surface: 'hard' | 'clay' | 'grass' | 'carpet' | 'unknown';
  environment: 'indoor' | 'outdoor' | 'unknown';
  startsOn: string;
  endsOn: string;
  drawIds: string[];
};

type DrawDefinition = {
  id: string;
  tournamentEditionId: string;
  authority: 'ATP' | 'WTA' | 'ITF' | 'JOINT' | 'OTHER';
  level:
    | 'grand_slam'
    | 'masters_1000'
    | 'tour_500'
    | 'tour_250'
    | 'wta_1000'
    | 'wta_500'
    | 'wta_250'
    | 'wta_125'
    | 'challenger_175'
    | 'challenger_125'
    | 'challenger_100'
    | 'challenger_75'
    | 'challenger_50'
    | 'itf_m25'
    | 'itf_m15'
    | 'itf_w100'
    | 'itf_w75'
    | 'itf_w50'
    | 'itf_w35'
    | 'itf_w15'
    | 'junior_j500'
    | 'junior_j300'
    | 'junior_j200'
    | 'junior_j100'
    | 'junior_j60'
    | 'junior_j30'
    | 'team_rubber'
    | 'unknown';
  competitionClass: 'professional' | 'junior' | 'other';
  ageCategory: 'open' | 'u18' | 'u16' | 'u14' | 'u12' | 'unknown';
  gender: 'men' | 'women' | 'mixed';
  discipline: 'singles' | 'doubles' | 'mixed_doubles';
  stage:
    | 'pre_qualifying'
    | 'qualifying'
    | 'main_draw'
    | 'round_robin'
    | 'playoff'
    | 'rubber'
    | 'unknown';
  parentDrawId?: string;
  policyId: string;
};
```

An edition can contain multiple draws and stages: men's/women's singles,
doubles, mixed doubles, qualifying, main draw, round robin, or team-event
rubbers. A team event is an edition format; `team` is not a player discipline.
Team ties and their individual rubbers receive separate canonical identities.

Do not infer circuit, tier, authority, age group, discipline, or stage from a
tournament name inside application code. `CompetitionPolicy` and reviewed
source mappings supply those facts. Unknown draws remain displayable in basic
mode and enter the classification queue. Tier changes are effective-dated
policy/mapping changes, not string conditions.

`CompetitionPolicy` defines, with an effective date:

- best-of-three or best-of-five;
- deciding-set/tiebreak rules;
- draw/stage set and order;
- ranking system plus versioned points-table reference;
- available score granularity;
- complete valid-status transition map;
- effective-dated draw, scoring, points, and transition exceptions.

ATP, WTA, Challenger, ITF, and junior competitions use the same entities with
different policies and declared capabilities.

## Match and participants

```ts
type CanonicalMatch = {
  id: string;
  tournamentEditionId: string;
  drawId: string;
  teamTieId?: string;
  discipline: 'singles' | 'doubles' | 'mixed_doubles';
  round: string;
  stage: string;
  sides: [ParticipantSide, ParticipantSide];
  scheduledAt?: string;
  venueTimezone: string;
  courtId?: string;
  status: ReducedMatchStatus;
  score: MatchScore;
  winnerSideId?: string;
  coverage: Coverage;
  version: number;
  asOf: string;
  provenanceByField: Record<string, FieldProvenance>;
};
```

`ReducedMatchStatus` is an opaque branded `MatchStatus`. Its brand key is not
exported, so a complete `CanonicalMatch` cannot be constructed with a plain
`status: 'live'`. Only the allowlisted pure reducer may perform the audited
brand assertion. Architecture tests reject direct assertions to
`ReducedMatchStatus`, `CanonicalMatch`, or `CanonicalMatch['status']`, and V2
forbids explicit `any` plus type-checked unsafe `any` flow. Ordinary narrowing
through `unknown` and exhaustive `never` assertions remain legal. Page DTOs
expose the readable `MatchStatus`; the opaque write boundary does not prevent
normal `dto.status`, `dto['status']`, `entries[index]`, or typed map reads.

A participant side contains exactly one player for singles or exactly two
players for doubles/mixed doubles. The two sides of a match are distinct from
the players inside each side. A side may be:

- resolved to one canonical one-player or two-player side tuple;
- provisional with explicit candidates such as qualifier/LL;
- unknown;
- a bye.

Provisional candidate sides are represented as alternatives to the whole side
and must not be collapsed into a doubles pair. LL, Q, WC, alternate, and
replacement information is modeled as side qualification and replacement
history. Observations and page DTOs preserve the singles one-player or doubles
two-player tuple cardinality.

Missing values are absent/unknown, never silently converted to zero.

## Coverage

```ts
type Coverage = {
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

Coverage drives honest UI degradation:

- point coverage may display current points and server;
- game coverage displays games but no fabricated points;
- set coverage displays sets and last update;
- result-only coverage displays the result;
- stale data preserves the last accepted state with a delay indicator.

## Data-specific storage models

Not every domain uses the match state machine:

| Data | Canonical mechanism |
|---|---|
| Live match | Replayable state reducer |
| Draw | Versioned snapshot and structural diff |
| Official ranking | Immutable dated snapshot |
| Player points composition | Immutable earning/defending points ledger |
| Live ranking | Points-ledger projection |
| Race ranking | Season-points projection |
| H2H | Historical canonical-match aggregation |
| Player profile | Field-level entity merge with provenance |

Draw state is a versioned tree of draw, round, tie/section, participant slots,
match links, and advancement edges. A partial draw retains explicit missing
nodes/edges; it never fabricates an opponent or advancement.

An official `RankingSnapshot` contains authority, ranking type, publication/effective
date, depth/coverage, schema/policy version, and ordered `RankingEntry` records.
Each entry contains canonical player, rank, points, movement/tie metadata, and
field-level provenance.

The `PointsLedger` stores append-only earning, defending, expiry/drop,
replacement, penalty, and correction entries by player/event/rule period.
`PlayerPointsBreakdown` is an as-of projection whose sum must reconcile to the
applicable live/official ranking total or explicitly expose the difference.

A `PlayerProfile` is a field-level merge, never a whole-record winner. It carries
provenance and freshness for name, date of birth, nationality, handedness,
height, status, media, official IDs, and other supported fields; unresolved
conflicts remain visible.

Canonical statistics and profile fields are closed typed contracts. An adapter
must explicitly map each raw field to a defined canonical key and unit (for
example percentage versus count, and km/h versus mph). Unknown provider fields
are recorded/quarantined for schema review; they cannot pass through an
arbitrary `Record<string, unknown>` into an observation or page DTO.

### H2H definition and completeness

H2H is derived from the canonical historical match ledger under a versioned
`H2HDefinition`. Every request/output declares:

- two high-confidence canonical players;
- singles/doubles/team-rubber discipline scope;
- adult/junior scope;
- included authorities, circuits, levels, stages, statuses, and date range;
- coverage `{ from, to, gaps }`, definition version, and `asOf`.

Default career singles H2H includes sanctioned adult singles in ATP, WTA,
Challenger, Grand Slam, ITF World Tennis Tour, and eligible team-event rubbers,
including qualifying. A retirement with an official winner counts. Walkover,
cancelled, and abandoned matches do not. Junior H2H is a separate requested
scope and is never silently mixed into adult H2H.

The label `complete` is allowed only when historical coverage is verified for
every included authority/circuit and date range for both players, identity
resolution is high confidence, and no unresolved duplicate/conflict remains.
Otherwise the projection is `partial`/`unknown`, lists gaps, and must not publish
a definitive career total or “0–0”. Missing verified ITF history blocks a
“complete H2H” claim.

## Time

- Persist timestamps as UTC instants plus the source timezone when supplied.
- Tournament-day assignment uses the tournament venue timezone.
- Beijing time is a presentation preference, not canonical match identity.
- A match crossing Beijing midnight remains attached to its official tournament
  day.
- Source timestamps, platform observation timestamps, and display timestamps are
  distinct.

## Provenance and override

Every reconciled field has its own provenance entry. Provenance is never one
match-level source label because schedule, score, result, court, and identity may
legitimately come from different accepted evidence.

```ts
type FieldProvenance = {
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

Operator overrides support identity merge/split, competition classification,
primary match source, date/round correction, provider-record rejection, and
participant replacement. They require reason, author, timestamp, scope, and
expiry/review date.
