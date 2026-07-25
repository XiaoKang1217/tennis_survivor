type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type PlayerId = Brand<string, 'PlayerId'>;
export type CompetitionId = Brand<string, 'CompetitionId'>;
export type TournamentEditionId = Brand<string, 'TournamentEditionId'>;
export type DrawId = Brand<string, 'DrawId'>;
export type DrawNodeId = Brand<string, 'DrawNodeId'>;
export type MatchId = Brand<string, 'MatchId'>;
export type TeamTieId = Brand<string, 'TeamTieId'>;
export type ParticipantSideId = Brand<string, 'ParticipantSideId'>;
export type VenueId = Brand<string, 'VenueId'>;
export type PointsLedgerEntryId = Brand<string, 'PointsLedgerEntryId'>;
export type SourceEventId = string & { readonly __sourceEventId: unique symbol };

export type Authority = 'ATP' | 'WTA' | 'ITF' | 'JOINT' | 'OTHER';
export type Circuit =
  | 'atp_tour'
  | 'atp_challenger'
  | 'wta_tour'
  | 'wta_125'
  | 'itf_world_tennis_tour'
  | 'itf_junior'
  | 'grand_slam'
  | 'team'
  | 'other';
export type CompetitionClass = 'professional' | 'junior' | 'other';
export type AgeCategory = 'open' | 'u18' | 'u16' | 'u14' | 'u12' | 'unknown';
export type Discipline = 'singles' | 'doubles' | 'mixed_doubles';
export type EventFormat = 'individual' | 'team';
export type DrawStage =
  | 'pre_qualifying'
  | 'qualifying'
  | 'main_draw'
  | 'round_robin'
  | 'playoff'
  | 'rubber'
  | 'unknown';
export type TournamentLevel =
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

export type MatchStatus =
  | 'unknown'
  | 'scheduled'
  | 'delayed'
  | 'postponed'
  | 'live'
  | 'interrupted'
  | 'suspended'
  | 'cancelled'
  | 'walkover'
  | 'retired'
  | 'abandoned'
  | 'finished';

declare const reducedMatchStatusBrand: unique symbol;

/**
 * A status accepted by the pure match reducer. The brand symbol is intentionally
 * private: callers can observe this value as MatchStatus, but cannot construct it
 * without a forbidden type assertion outside the reducer boundary.
 */
export type ReducedMatchStatus = MatchStatus & {
  readonly [reducedMatchStatusBrand]: 'ReducedMatchStatus';
};

export interface FieldProvenance {
  readonly sourceEventId: SourceEventId;
  readonly provider: string;
  readonly sourceUpdatedAt?: string;
  readonly observedAt: string;
  readonly selectedAt: string;
  readonly policyVersion: string;
  readonly reasonCode: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly overrideId?: string;
}

export interface Coverage {
  readonly score: 'point' | 'game' | 'set' | 'result_only' | 'none';
  readonly stats: 'live' | 'post_match' | 'none';
  readonly draw: 'full' | 'partial' | 'none';
  readonly h2hHistory: 'complete' | 'partial' | 'unknown';
  readonly scheduleHistory: 'complete' | 'partial' | 'unknown';
  readonly officialRanking: 'full' | 'partial' | 'none';
  readonly liveRanking: 'full' | 'partial' | 'none';
  readonly raceRanking: 'full' | 'partial' | 'none';
  readonly pointsComposition: 'complete' | 'partial' | 'unknown';
  readonly playerProfile: 'complete' | 'partial' | 'unknown';
}

export interface CanonicalMatchStats {
  readonly aces?: number;
  readonly doubleFaults?: number;
  readonly firstServePercentage?: number;
  readonly firstServePointsWonPercentage?: number;
  readonly secondServePointsWonPercentage?: number;
  readonly breakPointsSaved?: number;
  readonly breakPointsFaced?: number;
  readonly breakPointsWon?: number;
  readonly returnPointsWonPercentage?: number;
  readonly winners?: number;
  readonly unforcedErrors?: number;
  readonly netPointsWon?: number;
  readonly netPointsPlayed?: number;
  readonly totalPointsWon?: number;
  readonly fastestServeKph?: number;
  readonly averageFirstServeKph?: number;
}

export interface ParticipantStats {
  readonly sideId: ParticipantSideId;
  readonly stats: CanonicalMatchStats;
}

export interface CanonicalPlayerProfileFields {
  readonly displayName?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly dateOfBirth?: string;
  readonly nationalityCode?: string;
  readonly birthplace?: string;
  readonly residence?: string;
  readonly handedness?: 'left' | 'right' | 'unknown';
  readonly backhand?: 'one_handed' | 'two_handed' | 'unknown';
  readonly heightCm?: number;
  readonly turnedProYear?: number;
  readonly activeStatus?: 'active' | 'inactive' | 'retired' | 'unknown';
  readonly imageAssetId?: string;
}

export interface Competition {
  readonly id: CompetitionId;
  readonly authority: Authority;
  readonly circuit: Circuit;
  readonly competitionClass: CompetitionClass;
}

export interface TournamentEdition {
  readonly id: TournamentEditionId;
  readonly competitionId: CompetitionId;
  readonly seasonId: string;
  readonly eventFormat: EventFormat;
  readonly venueTimezone: string;
  readonly surface: 'hard' | 'clay' | 'grass' | 'carpet' | 'unknown';
  readonly environment: 'indoor' | 'outdoor' | 'unknown';
  readonly startsOn: string;
  readonly endsOn: string;
  readonly drawIds: readonly DrawId[];
}

export interface DrawDefinition {
  readonly id: DrawId;
  readonly tournamentEditionId: TournamentEditionId;
  readonly authority: Authority;
  readonly level: TournamentLevel;
  readonly competitionClass: CompetitionClass;
  readonly ageCategory: AgeCategory;
  readonly gender: 'men' | 'women' | 'mixed';
  readonly discipline: Discipline;
  readonly stage: DrawStage;
  readonly parentDrawId?: DrawId;
  readonly policyId: string;
}

export type PlayerSide = readonly [PlayerId] | readonly [PlayerId, PlayerId];

export interface ParticipantSide {
  readonly id: ParticipantSideId;
  readonly resolution: 'resolved' | 'provisional' | 'unknown' | 'bye';
  readonly playerIds?: PlayerSide;
  readonly candidatePlayerSides?: readonly PlayerSide[];
  readonly entryDesignation?: 'direct' | 'qualifier' | 'lucky_loser' | 'wild_card' | 'alternate';
}

export interface MatchScore {
  readonly sets: readonly {
    readonly first?: number;
    readonly second?: number;
    readonly tiebreakFirst?: number;
    readonly tiebreakSecond?: number;
  }[];
  readonly currentGame?: {
    readonly first?: string;
    readonly second?: string;
  };
  readonly servingSideId?: ParticipantSideId;
  readonly servingPlayerId?: PlayerId;
}

export interface CanonicalMatch {
  readonly id: MatchId;
  readonly tournamentEditionId: TournamentEditionId;
  readonly drawId: DrawId;
  readonly teamTieId?: TeamTieId;
  readonly discipline: Discipline;
  readonly round: string;
  readonly stage: DrawStage;
  readonly sides: readonly [ParticipantSide, ParticipantSide];
  readonly scheduledAt?: string;
  readonly venueTimezone: string;
  readonly courtId?: VenueId;
  readonly status: ReducedMatchStatus;
  readonly score: MatchScore;
  readonly winnerSideId?: ParticipantSideId;
  readonly coverage: Coverage;
  readonly version: number;
  readonly asOf: string;
  readonly provenanceByField: Readonly<Record<string, FieldProvenance>>;
}
