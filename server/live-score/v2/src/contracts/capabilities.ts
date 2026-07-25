import type {
  CanonicalPlayerProfileFields,
  DrawId,
  DrawStage,
  MatchId,
  MatchStatus,
  PlayerId,
  ParticipantStats,
  TournamentEditionId
} from '../domain/canonical.js';
import type { MatchObservation } from '../domain/state-machine.js';
import type { SourceCapability, SourceEvent } from './source-event.js';

export interface CapabilityDeclaration {
  readonly capability: SourceCapability;
  readonly schemaVersion: string;
  readonly collectionMode: 'poll' | 'stream' | 'document' | 'import';
  readonly coverageDescription: string;
}

export interface SourceAdapter<Observation> {
  readonly declaration: CapabilityDeclaration;
  validate(event: SourceEvent): boolean;
  toObservations(event: SourceEvent): readonly Observation[];
}

export interface ObservationBase {
  readonly sourceEventId: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt?: string;
}

export interface ParticipantMemberObservation {
  readonly sourcePlayerId?: string;
  readonly canonicalPlayerId?: PlayerId;
  readonly normalizedDisplayName: string;
}

export type ObservedPlayerSide =
  | readonly [ParticipantMemberObservation]
  | readonly [ParticipantMemberObservation, ParticipantMemberObservation];

export interface ParticipantSideObservation {
  readonly side: 1 | 2;
  readonly members: ObservedPlayerSide;
  readonly candidateSides?: readonly ObservedPlayerSide[];
}

export interface ScheduleObservation extends ObservationBase {
  readonly sourceMatchId: string;
  readonly canonicalMatchId?: MatchId;
  readonly scheduledAt?: string;
  readonly status?: MatchStatus;
  readonly round?: string;
  readonly stage?: DrawStage;
  readonly sides: readonly [ParticipantSideObservation, ParticipantSideObservation];
}

export interface DrawNodeObservation {
  readonly sourceNodeId: string;
  readonly kind: 'round' | 'section' | 'tie' | 'slot' | 'match';
  readonly label: string;
  readonly childSourceNodeIds: readonly string[];
  readonly sourceMatchId?: string;
}

export interface DrawObservation extends ObservationBase {
  readonly sourceDrawId: string;
  readonly canonicalDrawId?: DrawId;
  readonly canonicalEditionId?: TournamentEditionId;
  readonly completeness: 'full' | 'partial';
  readonly nodes: readonly DrawNodeObservation[];
}

export interface MatchStatsObservation extends ObservationBase {
  readonly sourceMatchId: string;
  readonly canonicalMatchId?: MatchId;
  readonly availability: 'live' | 'post_match';
  readonly participantStats: readonly ParticipantStats[];
}

export interface PlayerProfileObservation extends ObservationBase {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId?: PlayerId;
  readonly fields: CanonicalPlayerProfileFields;
}

export interface RankingEntryObservation {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId?: PlayerId;
  readonly rank: number;
  readonly points: number;
  readonly tied: boolean;
}

export interface RankingSnapshotObservation extends ObservationBase {
  readonly rankingType: 'official' | 'live' | 'race';
  readonly publishedOn: string;
  readonly effectiveOn: string;
  readonly completeness: 'full' | 'partial';
  readonly entries: readonly RankingEntryObservation[];
}

export interface PointsLedgerObservation extends ObservationBase {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId?: PlayerId;
  readonly kind: 'earned' | 'defending' | 'expired' | 'dropped' | 'replacement' | 'penalty' | 'correction';
  readonly points: number;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly sourceEventEntityId?: string;
}

export interface HistoricalMatchObservation extends ObservationBase {
  readonly sourceMatchId: string;
  readonly canonicalMatchId?: MatchId;
  readonly playedAt: string;
  readonly status: Extract<MatchStatus, 'walkover' | 'retired' | 'abandoned' | 'finished'>;
  readonly sides: readonly [ParticipantSideObservation, ParticipantSideObservation];
  readonly winnerSide?: 1 | 2;
}

export interface LiveScoreSource extends SourceAdapter<MatchObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'live_score' };
}
export interface ScheduleSource extends SourceAdapter<ScheduleObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'schedule' };
}
export interface DrawSource extends SourceAdapter<DrawObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'draw' };
}
export interface MatchStatsSource extends SourceAdapter<MatchStatsObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'match_stats' };
}
export interface PlayerProfileSource extends SourceAdapter<PlayerProfileObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'player_profile' };
}
export interface OfficialRankingSource extends SourceAdapter<RankingSnapshotObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'official_ranking' };
}
export interface LiveRankingSource extends SourceAdapter<RankingSnapshotObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'live_ranking' };
}
export interface RaceRankingSource extends SourceAdapter<RankingSnapshotObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'race_ranking' };
}
export interface RankingPointsCompositionSource extends SourceAdapter<PointsLedgerObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'points_composition' };
}
export interface HistoricalMatchSource extends SourceAdapter<HistoricalMatchObservation> {
  readonly declaration: CapabilityDeclaration & { readonly capability: 'historical_match' };
}
