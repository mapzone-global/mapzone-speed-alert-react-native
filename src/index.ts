import type { EventSubscription } from 'expo-modules-core';

import type {
  AccessRestrictionEvent,
  BuildupAreaEvent,
  ConfigureOptions,
  LocationFix,
  ReadyEvent,
  ResultEvent,
  SignsEvent,
  StopRestrictionEvent,
  VoiceAlertType,
  VoiceEvent,
  VoiceProfile,
} from './MapZoneSpeedAlert.types';
import MapZoneSpeedAlertModule from './MapZoneSpeedAlertModule';

export * from './MapZoneSpeedAlert.types';
export { useSpeedAlertSigns } from './useSpeedAlertSigns';

/**
 * Integer-bridged arguments must be finite whole numbers: iOS converts them
 * with a trapping `Int(...)` (NaN / Infinity terminate the app) while Android
 * silently turns them into 0. Rejecting them here makes both platforms fail
 * the same, recoverable way.
 */
function requireInteger(functionName: string, argumentName: string, value: number) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(
      `MapZoneSpeedAlert.${functionName}: ${argumentName} must be an integer, got ${value}`
    );
  }
}

/**
 * Configure credentials and vehicle profile. Must precede the first
 * `onLocation()`. Throws when `baseUrl` is not `https://` or a numeric field
 * is not a finite number — checked here so both platforms fail the same way
 * (natively Android throws on the URL, iOS reports it through `onResult`).
 */
export function configure(options: ConfigureOptions): void {
  if (!options.baseUrl.startsWith('https://')) {
    throw new Error('MapZoneSpeedAlert.configure: baseUrl must start with https://');
  }
  requireInteger('configure', 'vehicleType', options.vehicleType);
  requireInteger('configure', 'seats', options.seats);
  if (!Number.isFinite(options.weights) || Math.abs(options.weights) > 2 ** 31 - 1) {
    throw new TypeError(
      `MapZoneSpeedAlert.configure: weights must be a finite number of kg, got ${options.weights}`
    );
  }
  MapZoneSpeedAlertModule.configure(options);
}

/**
 * Feed one GPS fix (~1 Hz). Loads the zone around the vehicle when needed and
 * runs matching + alerting for this tick — native `updateLocation` followed by
 * `processGps`. Returns immediately; results arrive as events. Throws when
 * `fixTimeMillis` is not a finite number; fractions (iOS location timestamps
 * have them) are rounded.
 */
export function onLocation(fix: LocationFix): void {
  if (!Number.isFinite(fix.fixTimeMillis)) {
    throw new TypeError(
      `MapZoneSpeedAlert.onLocation: fixTimeMillis must be a finite number, got ${fix.fixTimeMillis}`
    );
  }
  MapZoneSpeedAlertModule.onLocation(
    fix.lat,
    fix.lng,
    fix.bearing,
    fix.speedKmh,
    fix.accuracy,
    Math.round(fix.fixTimeMillis)
  );
}

/**
 * Drop loaded zone data and engine state. Call when a session ends or the
 * vehicle profile changes (then `configure()` again). Mute set, voice profile
 * and voice speed are kept.
 */
export function reset(): void {
  MapZoneSpeedAlertModule.reset();
}

/**
 * Mute voice for the given categories. Camera/toll mutes also hide their
 * signs; the other categories only silence the voice. Pass `[]` to unmute
 * everything. Kept across zone reloads and `reset()`.
 */
export function setMutedAlertTypes(types: VoiceAlertType[]): void {
  MapZoneSpeedAlertModule.setMutedAlertTypes(types.map((type) => type as number));
}

/**
 * Speak alerts in full or reduce them to dings. Applied after the mute set, so
 * a muted alert never becomes a ding. Choose it when a session starts.
 */
export function setVoiceProfile(profile: VoiceProfile): void {
  MapZoneSpeedAlertModule.setVoiceProfile(profile as number);
}

/**
 * Playback speed of the built-in voice player: `1.0` = recorded speed, clamped
 * natively to `0.5..2.0`. No effect while an `onVoice` listener is registered
 * (the host then owns playback), nor below Android 6.0.
 */
export function setVoiceSpeed(speed: number): void {
  MapZoneSpeedAlertModule.setVoiceSpeed(speed);
}

export function addSignsListener(listener: (event: SignsEvent) => void): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onSigns', listener);
}

/**
 * Road closed / vehicle type restricted. Fires only on change; when the first
 * listener subscribes, the current state (if any) is replayed to it.
 */
export function addAccessRestrictionListener(
  listener: (event: AccessRestrictionEvent) => void
): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onAccessRestriction', listener);
}

/** No stopping / no parking. Same change-only + replay contract as `addAccessRestrictionListener`. */
export function addStopRestrictionListener(
  listener: (event: StopRestrictionEvent) => void
): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onStopRestriction', listener);
}

/** Built-up area. Same change-only + replay contract as `addAccessRestrictionListener`. */
export function addBuildupAreaListener(
  listener: (event: BuildupAreaEvent) => void
): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onBuildupArea', listener);
}

/**
 * While at least one listener exists the built-in voice player is silent and
 * every clip is delivered here; removing the last listener restores it.
 */
export function addVoiceListener(listener: (event: VoiceEvent) => void): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onVoice', listener);
}

export function addResultListener(listener: (event: ResultEvent) => void): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onResult', listener);
}

export function addReadyListener(listener: (event: ReadyEvent) => void): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onReady', listener);
}
