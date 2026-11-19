import type { SharedRef } from 'expo-modules-core';

/**
 * Vehicle the alerts are computed for. Each value is the MapZone server's own
 * vehicle code and is sent unchanged. Values MUST match `VehicleType.java` /
 * `VehicleType` (Swift) in the native SDK. The type must also be enabled for
 * the API key, otherwise sign-in reports `1001` and zone loads `3003`.
 */
export enum VehicleType {
  CAR = 1,
  TAXI = 2,
  BUS = 3,
  COACH = 4,
  TRUCK = 5,
  MOTORCYCLE = 7,
}

/**
 * Credentials, signed-in identity and vehicle profile for the native engine.
 * Call `configure()` when the user signs in — and on every app launch with a
 * user already signed in — and await it before the first `onLocation()`. When
 * the vehicle profile changes, call `reset()` and then `configure()` again.
 * The application id (bundle id) is resolved natively.
 */
export type ConfigureOptions = {
  /** Bare host of the zone API, e.g. `https://driving.map.zone`. Must start with `https://`. */
  baseUrl: string;
  apiKeyId: string;
  /** Authentication secret paired with `apiKeyId`. Do not log it or ship it in source control. */
  apiKey: string;
  /**
   * The signed-in user or vehicle, e.g. the account's phone number
   * `"+84901234567"`. Sent verbatim and matched exactly — `"0901…"` and
   * `"+84901…"` are two different users. Non-empty, at most 128 characters,
   * no `"` and no control characters. One identity is active on one device at
   * a time.
   */
  identity: string;
  vehicleType: VehicleType;
  /** Number of seats, 0 or more. Integer. */
  seats: number;
  /** Vehicle gross weight in **tonnes** (1500 kg → `1.5`), 0 or more. */
  weightsTons: number;
  /**
   * Optional information about this device / user, stored with the session
   * when it is opened (first sign-in on this device, or a new identity).
   * Serialised to JSON: at most 2048 UTF-8 bytes, nesting depth at most 16.
   * The SDK adds `model` and `os` unless you set them.
   */
  metadata?: Record<string, unknown> | null;
};

/** Result of `logout()`. `success` is also `true` when nobody was signed in. */
export type LogoutResult = {
  success: boolean;
  /** `0` on success, otherwise a code from the `onResult` table (see `MapZoneError`). */
  errorCode: number;
  errorMessage: string;
};

/**
 * Codes the SDK acts on, delivered through `onResult` and `logout()`. Values
 * MUST match `MapZoneError` in the native SDK. Branch on the number; the
 * message that comes with it is an English sentence for logs and fallback UI.
 */
export enum MapZoneError {
  /** No identity signed in: `logout()` was called, or `configure()` never was. */
  NOT_LOGGED_IN = -6,
  /** The device cannot be read yet; the SDK retries about once a minute. Show a notice. */
  DEVICE_NOT_READY = -8,
  /** The identity is now in use on another device. Call `logout()` and send the user to sign in. */
  SESSION_MOVED = 2006,
  /** Device or identity locked by an administrator. */
  LOCKED = 2007,
  /** The account on this device changed too recently; the SDK retries after 20 minutes. */
  SWITCH_TOO_SOON = 2008,
  /** Trial API key: this identity is not one of the key's sample identities. */
  TRIAL_IDENTITY_NOT_ALLOWED = 2010,
  /** The API key cannot register more new devices. */
  NEW_DEVICE_LIMIT = 3012,
  /** Too many requests; the SDK waits for the server's Retry-After. */
  TOO_MANY_REQUESTS = 4000,
  /** The API key has used up its request quota. */
  REQUEST_QUOTA_EXCEEDED = 4001,
}

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
 * Result of a sign-in or zone-load attempt. `errorCode === 0` on success;
 * positive codes are server-reported, negative codes are local SDK failures
 * (named ones in `MapZoneError`). `errorMessage` is produced by the native SDK
 * from the code alone — localise off the code.
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

/**
 * The fix moved onto the road the engine is serving. Emitted once per fix
 * matched to a road (none while unmatched — keep the marker where it was);
 * inside a short coverage hole the same point can repeat.
 */
export type SnappedLocationEvent = {
  latitude: number;
  longitude: number;
  /** Road bearing in the direction of travel, 0 = north, clockwise, `[0, 360)`. */
  bearingDegrees: number;
};

export type MapZoneSpeedAlertEvents = {
  onSigns: (event: SignsEvent) => void;
  onAccessRestriction: (event: AccessRestrictionEvent) => void;
  onStopRestriction: (event: StopRestrictionEvent) => void;
  onBuildupArea: (event: BuildupAreaEvent) => void;
  onVoice: (event: VoiceEvent) => void;
  onResult: (event: ResultEvent) => void;
  onReady: (event: ReadyEvent) => void;
  onSnappedLocation: (event: SnappedLocationEvent) => void;
};
