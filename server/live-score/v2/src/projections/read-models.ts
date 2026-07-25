import type {
  CanonicalPlayerProfileFields,
  Authority,
  CompetitionClass,
  Circuit,
  Discipline,
  DrawId,
  DrawNodeId,
  DrawStage,
  MatchId,
  MatchScore,
  MatchStatus,
  ParticipantSideId,
  ParticipantStats,
  PlayerId,
  PointsLedgerEntryId,
  TournamentEditionId,
  TournamentLevel
} from '../domain/canonical.js';

export interface VersionedView {
  readonly version: number;
  readonly asOf: string;
}

export interface TodayScoresView extends VersionedView {
  readonly date: string;
  readonly matches: readonly MatchCardDTO[];
}

export interface MatchDetailView extends VersionedView {
  readonly match: MatchDetailDTO;
}

export interface PlayerSummaryDTO {
  readonly playerId?: PlayerId;
  readonly displayName: string;
}

export type PlayerSideDTO =
  | readonly [PlayerSummaryDTO]
  | readonly [PlayerSummaryDTO, PlayerSummaryDTO];

export interface ParticipantSideDTO {
  readonly sideId: ParticipantSideId;
  readonly resolution: 'resolved' | 'provisional' | 'unknown' | 'bye';
  readonly players?: PlayerSideDTO;
  readonly candidateSides?: readonly PlayerSideDTO[];
}

export interface MatchCardDTO {
  readonly id: MatchId;
  readonly tournamentEditionId: TournamentEditionId;
  readonly status: MatchStatus;
  readonly scheduledAt?: string;
  readonly courtLabel?: string;
  readonly sides: readonly [ParticipantSideDTO, ParticipantSideDTO];
  readonly score: MatchScore;
  readonly coverage: 'point' | 'game' | 'set' | 'result_only' | 'none';
  readonly dataNotice?: 'delayed' | 'partial' | 'unavailable';
  readonly version: number;
  readonly asOf: string;
}

export interface MatchDetailDTO extends MatchCardDTO {
  readonly round: string;
  readonly stage: DrawStage;
  readonly winnerSideId?: ParticipantSideId;
  readonly statsAvailability: 'live' | 'post_match' | 'none';
}

export interface MatchStatsView extends VersionedView {
  readonly matchId: MatchId;
  readonly availability: 'live' | 'post_match' | 'none';
  readonly participantStats: readonly ParticipantStats[];
  readonly dataNotice?: 'partial' | 'delayed';
}

export interface DrawTreeNode {
  readonly id: DrawNodeId;
  readonly kind: 'round' | 'section' | 'tie' | 'slot' | 'match' | 'gap';
  readonly label: string;
  readonly children: readonly DrawTreeNode[];
  readonly matchId?: MatchId;
  readonly advancesToNodeId?: DrawNodeId;
}

export interface TournamentDrawView extends VersionedView {
  readonly drawId: DrawId;
  readonly stage: DrawStage;
  readonly completeness: 'full' | 'partial' | 'none';
  readonly knownGaps: readonly string[];
  readonly roots: readonly DrawTreeNode[];
}

export interface RankingEntry {
  readonly playerId: PlayerId;
  readonly rank: number;
  readonly points: number;
  readonly tied: boolean;
  readonly movement?: number;
}

export interface RankingSnapshot extends VersionedView {
  readonly authority: 'ATP' | 'WTA';
  readonly rankingType: 'official' | 'live' | 'race';
  readonly publishedOn: string;
  readonly effectiveOn: string;
  readonly policyVersion: string;
  readonly completeness: 'full' | 'partial';
  readonly knownGaps: readonly string[];
  readonly entries: readonly RankingEntry[];
}

export interface PointsLedgerEntry {
  readonly id: PointsLedgerEntryId;
  readonly playerId: PlayerId;
  readonly kind: 'earned' | 'defending' | 'expired' | 'dropped' | 'replacement' | 'penalty' | 'correction';
  readonly points: number;
  readonly eventId?: TournamentEditionId;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
}

export interface PlayerPointsCompositionView extends VersionedView {
  readonly playerId: PlayerId;
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly knownGaps: readonly string[];
  readonly total: number | null;
  readonly entries: readonly PointsLedgerEntry[];
  readonly unexplainedDifference: number | null;
}

export interface PlayerProfileView extends VersionedView {
  readonly playerId: PlayerId;
  readonly fields: CanonicalPlayerProfileFields;
  readonly conflicts: readonly string[];
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly dataNotice?: 'partial' | 'stale';
}

export interface H2HDefinition {
  readonly version: string;
  readonly discipline: Discipline;
  readonly competitionClass: CompetitionClass;
  readonly includeQualifying: boolean;
  readonly includeRetirements: boolean;
  readonly includeWalkovers: false;
  readonly includedAuthorities: readonly Authority[];
  readonly includedCircuits: readonly Circuit[];
  readonly includedLevels: readonly TournamentLevel[];
  readonly includedStages: readonly DrawStage[];
  readonly includedStatuses: readonly Extract<MatchStatus, 'retired' | 'finished'>[];
  readonly from?: string;
  readonly to?: string;
}

export interface H2HCoverage {
  readonly from?: string;
  readonly to?: string;
  readonly gaps: readonly string[];
}

export interface H2HView extends VersionedView {
  readonly firstPlayerId: PlayerId;
  readonly secondPlayerId: PlayerId;
  readonly definition: H2HDefinition;
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly coverage: H2HCoverage;
  readonly firstWins: number | null;
  readonly secondWins: number | null;
  readonly matches: readonly MatchId[];
}

export type OfficialRankingView = RankingSnapshot & { readonly rankingType: 'official' };
export type LiveRankingView = RankingSnapshot & { readonly rankingType: 'live' };
export type RaceRankingView = RankingSnapshot & { readonly rankingType: 'race' };
