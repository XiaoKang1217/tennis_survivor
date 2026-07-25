import type {
  CanonicalMatch,
  Coverage,
  MatchScore,
  MatchId,
  MatchStatus,
  ParticipantSide,
  ParticipantSideId,
  DrawStage,
  SourceEventId
} from './canonical.js';

export const TERMINAL_MATCH_STATES = [
  'cancelled',
  'walkover',
  'retired',
  'abandoned',
  'finished'
] as const satisfies readonly MatchStatus[];

export const MATCH_TRANSITIONS = {
  unknown: ['scheduled', 'delayed', 'postponed', 'live', 'interrupted', 'suspended', 'walkover', 'cancelled', 'retired', 'abandoned', 'finished'],
  scheduled: ['delayed', 'postponed', 'live', 'walkover', 'cancelled', 'retired', 'abandoned', 'finished'],
  delayed: ['scheduled', 'postponed', 'live', 'walkover', 'cancelled', 'retired', 'abandoned', 'finished'],
  postponed: ['scheduled', 'delayed', 'live', 'walkover', 'cancelled', 'retired', 'abandoned', 'finished'],
  live: ['interrupted', 'suspended', 'retired', 'abandoned', 'finished'],
  interrupted: ['live', 'suspended', 'postponed', 'retired', 'abandoned', 'finished'],
  suspended: ['live', 'interrupted', 'postponed', 'retired', 'abandoned', 'finished'],
  cancelled: [],
  walkover: [],
  retired: [],
  abandoned: [],
  finished: []
} as const satisfies Readonly<Record<MatchStatus, readonly MatchStatus[]>>;

export type MatchObservationKind =
  | 'schedule'
  | 'score_snapshot'
  | 'status'
  | 'result'
  | 'participant_withdrawal'
  | 'correction';

interface ObservationBase {
  readonly sourceEventId: SourceEventId;
  readonly canonicalMatchId?: MatchId;
  readonly observedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly sequence?: number;
  readonly coverage: Coverage;
}

export interface PlayStartedEvidence {
  readonly kind: 'nonzero_score_snapshot' | 'official_retirement_result';
  readonly evidenceSourceEventId: SourceEventId;
}

export type MatchObservation =
  | (ObservationBase & {
      readonly kind: 'schedule' | 'score_snapshot' | 'status' | 'result';
      readonly value: {
        readonly status?: MatchStatus;
        readonly score?: MatchScore;
      };
      readonly playStartedEvidence?: PlayStartedEvidence;
    })
  | (ObservationBase & {
      readonly kind: 'participant_withdrawal';
      readonly value: {
        readonly withdrawnSideId: ParticipantSideId;
        readonly outcome: 'replacement' | 'walkover' | 'cancelled';
        readonly replacementSide?: ParticipantSide;
      };
    })
  | (ObservationBase & {
      readonly kind: 'correction';
      readonly value: {
        readonly previousStatus: MatchStatus;
        readonly replacementStatus: MatchStatus;
        readonly replacementScore?: MatchScore;
        readonly reason: string;
        readonly evidenceReference: string;
      };
    });

export interface EffectiveDatedCompetitionException {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly kind: 'draw_structure' | 'scoring' | 'ranking_points' | 'transition';
  readonly ruleReference: string;
}

export interface CompetitionPolicy {
  readonly id: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly bestOf: 3 | 5;
  readonly decidingSetRule: string;
  readonly drawStructure: {
    readonly stages: readonly DrawStage[];
    readonly stageOrder: readonly DrawStage[];
  };
  readonly ranking: {
    readonly system: 'atp' | 'wta' | 'itf' | 'junior' | 'none';
    readonly pointsTableId?: string;
    readonly pointsTableVersion?: string;
  };
  readonly scoreCoverage: readonly ('point' | 'game' | 'set' | 'result_only')[];
  readonly validTransitions: Readonly<Record<MatchStatus, readonly MatchStatus[]>>;
  readonly exceptions: readonly EffectiveDatedCompetitionException[];
}

export const PREMATCH_RETIREMENT_GUARD = {
  from: ['unknown', 'scheduled', 'delayed', 'postponed'],
  requiredEvidence: ['nonzero_score_snapshot', 'official_retirement_result']
} as const;

export interface TransitionDecision {
  readonly accepted: boolean;
  readonly reasonCode: string;
  readonly correctionRequired: boolean;
}

export interface MatchReducerResult {
  readonly match: CanonicalMatch;
  readonly decision: TransitionDecision;
}

export type MatchReducer = (
  previous: CanonicalMatch,
  observation: MatchObservation,
  policy: CompetitionPolicy
) => MatchReducerResult;

export type SourceHealth = 'healthy' | 'degraded' | 'stale' | 'unavailable' | 'recovering';

export const SOURCE_HEALTH_TRANSITIONS = {
  healthy: ['degraded', 'stale'],
  degraded: ['healthy', 'stale', 'unavailable'],
  stale: ['recovering', 'unavailable'],
  unavailable: ['recovering'],
  recovering: ['healthy', 'degraded', 'stale', 'unavailable']
} as const satisfies Readonly<Record<SourceHealth, readonly SourceHealth[]>>;
