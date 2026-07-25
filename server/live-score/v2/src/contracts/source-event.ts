export type SourceCapability =
  | 'live_score'
  | 'schedule'
  | 'draw'
  | 'match_stats'
  | 'player_profile'
  | 'official_ranking'
  | 'live_ranking'
  | 'race_ranking'
  | 'points_composition'
  | 'historical_match';

export type SourceEventKind =
  | 'snapshot'
  | 'delta'
  | 'correction'
  | 'empty_response'
  | 'error'
  | 'document';

export interface AcquisitionMetadata {
  readonly method: 'http' | 'websocket' | 'file' | 'manual_import';
  readonly endpointLabel: string;
  readonly capturedAt: string;
}

export type SourcePayload =
  | {
      readonly storage: 'inline_json';
      readonly value: unknown;
    }
  | {
      readonly storage: 'object_ref';
      readonly objectKey: string;
      readonly mediaType: 'application/json' | 'application/pdf';
      readonly bytes: number;
    };

export interface SourceEvent {
  readonly id: string;
  readonly sourceName: string;
  readonly capability: SourceCapability;
  readonly kind: SourceEventKind;
  readonly sourceEntityId?: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly sequence?: number;
  readonly schemaVersion: string;
  readonly payloadHash: string;
  readonly acquisition: AcquisitionMetadata;
  readonly payload: SourcePayload;
}
