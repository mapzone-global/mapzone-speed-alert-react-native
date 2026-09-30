import type { SharedRef } from 'expo-modules-core';

/**
 * Credentials and vehicle profile for the native engine. All fields are
 * required; call `configure()` once before the first `onLocation()`. When the
 * vehicle profile changes, call `reset()` and then `configure()` again. The
 * application id (bundle id) is resolved natively.
 */
export type ConfigureOptions = {
  /** Bare host of the zone API, e.g. `https://driving.map.zone`. Must start with `https://`. */
  baseUrl: string;
  apiKeyId: string;
  /** Authentication secret paired with `apiKeyId`. Do not log it or ship it in source control. */
  apiKey: string;
  vehicleId: string;
  /** Vehicle category code as defined by the alert service. Integer. */
  vehicleType: number;
  /** Integer. */
  seats: number;
  /** Vehicle gross weight in kg. Fractions are truncated natively. */
  weights: number;
};

/** One GPS sample forwarded to the engine. */
export type LocationFix = {
  lat: number;
  lng: number;
  /** Heading in degrees, 0 = north. */
  bearing: number;
  speedKmh: number;
  /** Horizontal accuracy in metres. */
  accuracy: number;
  /**
   * Epoch milliseconds of the fix itself (the location timestamp), never
   * `Date.now()`: voice throttling and stop detection are timed against it.
   */
  fixTimeMillis: number;
};

/**
 * Voice alert categories that can be muted. Values MUST match
 * `VoiceAlertType.java` / `VoiceAlertType` (Swift) in the native SDK.
 * Speed-limit and speeding cues are not mutable and have no entry here.
 */
export enum VoiceAlertType {
  SPEED_CAMERA = 3,
  TOLL = 4,
  TRAFFIC_ENFORCEMENT_CAMERA = 6,
  RED_LIGHT_CAMERA = 7,
  AI_CAMERA = 8,
  NO_LEFT_TURN = 9,
  NO_RIGHT_TURN = 10,
  NO_UTURN = 11,
  NO_OVERTAKING = 12,
  NO_OVERTAKING_END = 13,
  NO_PARKING = 14,
  NO_STRAIGHT = 15,
  BUILDUP_AREA_START = 16,
  BUILDUP_AREA_END = 17,
  REST_STATION = 18,
  NO_STOPPING = 19,
  ROAD_CLOSED = 20,
  VEHICLE_RESTRICTED = 21,
}

/**
 * How alerts sound. Values MUST match `VoiceProfile.java` / `VoiceProfile`
 * (Swift) in the native SDK.
 *
 * - `FULL`: a spoken phrase per alert kind.
 * - `DING_ONLY`: cameras and no-stopping/no-parking become a ding, speeding a
 *   distinct ding, everything else is silent. Pick it when a session starts —
 *   switching mid-zone can leave an alert passed in `DING_ONLY` unannounced.
 */
export enum VoiceProfile {
  FULL = 0,
  DING_ONLY = 1,
}

/** 0 = within limit, 1 = approaching the limit, 2 = over the limit. */
export type SpeedStatus = 0 | 1 | 2;

/** `kind` of `onAccessRestriction`. */
export enum AccessRestrictionKind {
  NONE = 0,
  ROAD_CLOSED = 3,
  VEHICLE_RESTRICTED = 4,
}

/** `kind` of `onStopRestriction`. */
export enum StopRestrictionKind {
  NONE = 0,
  NO_PARKING = 1,
  NO_STOPPING = 2,
}

/** `kind` of `onBuildupArea`: `START` = entering a built-up area, `END` = leaving it. */
export enum BuildupAreaKind {
  NONE = 0,
  START = 5,
  END = 6,
}

/**
 * Native reference to a rendered sign image (Bitmap on Android, UIImage on
 * iOS). Pass it straight to `expo-image` as `source`. Call `release()` when
 * the event it belongs to is no longer displayed.
 */
export declare class AlertSignRef extends SharedRef<'image'> {
  /** PNG-encoded bytes as base64 for hosts that do not use `expo-image`. */
  toBase64(): string;
}

/**
 * Emitted on every GPS tick matched to a road (no event while unmatched); a
 * `null` slot means nothing to show there.
 */
export type SignsEvent = {
  current: AlertSignRef | null;
  speedStatus: SpeedStatus;
  next: AlertSignRef | null;
  nextDistMeters: number;
  camera: AlertSignRef | null;
  cameraDistMeters: number;
  toll: AlertSignRef | null;
  tollDistMeters: number;
};

/**
 * One restriction group. Emitted only when the group changes, never on every
 * tick. `image` is `null` when the slot must be hidden (`kind === 0`, or no
 * artwork for that sign) — never an error. `distMeters === 0` means "on it
 * now"; `> 0` means it starts that far ahead.
 */
export type RestrictionEvent<Kind extends number> = {
  image: AlertSignRef | null;
  kind: Kind;
  distMeters: number;
};

/** Road closed / vehicle type restricted — "may I drive here at all?". */
export type AccessRestrictionEvent = RestrictionEvent<AccessRestrictionKind>;
/**
 * No stopping / no parking — "may I stop here?". The sign is raised at any
 * speed; only its voice cue waits until the vehicle slows down or stops.
 */
export type StopRestrictionEvent = RestrictionEvent<StopRestrictionKind>;
/** Built-up area — which speed regime applies. The artwork is a landscape rectangle. */
export type BuildupAreaEvent = RestrictionEvent<BuildupAreaKind>;

/**
 * Emitted instead of playing through the built-in player while at least one
 * `onVoice` listener is registered. `wavBase64` is PCM16 mono 22050 Hz WAV.
 */
export type VoiceEvent = {
  wavBase64: string;
  trigger: number;
  /** 0 = current-position cue (drop first when congested), 1 = normal, 2 = speeding. */
  priority: number;
};

/**
 * Result of a zone-load attempt. `errorCode === 0` on success; positive codes
 * are server-reported, negative codes are local SDK failures. `errorMessage`
 * is produced by the native SDK from the code alone — localise off the code.
 */
export type ResultEvent = {
  success: boolean;
  errorCode: number;
  errorMessage: string;
};

/** Emitted after each successful zone load. */
export type ReadyEvent = {
  linkCount: number;
  alertCount: number;
};

export type MapZoneSpeedAlertEvents = {
  onSigns: (event: SignsEvent) => void;
  onAccessRestriction: (event: AccessRestrictionEvent) => void;
  onStopRestriction: (event: StopRestrictionEvent) => void;
  onBuildupArea: (event: BuildupAreaEvent) => void;
  onVoice: (event: VoiceEvent) => void;
  onResult: (event: ResultEvent) => void;
  onReady: (event: ReadyEvent) => void;
};
