import type { EventSubscription } from 'expo-modules-core';

import {
  VehicleType,
  type AccessRestrictionEvent,
  type BuildupAreaEvent,
  type ConfigureOptions,
  type LocationFix,
  type LogoutResult,
  type ReadyEvent,
  type ResultEvent,
  type SignsEvent,
  type SnappedLocationEvent,
  type StopRestrictionEvent,
  type VoiceAlertType,
  type VoiceEvent,
  type VoiceProfile,
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
 * Sign the identity in and set the vehicle profile. Call it when the user
 * signs in and on every app launch with a user already signed in, and await it
 * before the first `onLocation()`. Everything that fails later (sign-in
 * rejected, account in use elsewhere, …) arrives through `onResult`.
 *
 * Rejects — and applies nothing, the previous configuration stays — when the
 * native SDK refuses an input (identity, seats, weight, metadata), with its
 * reason as the message. Also rejects, before reaching native, when `baseUrl`
 * is not `https://`, `vehicleType` is not a `VehicleType`, `seats` is not an
 * integer or `weightsTons` is not finite, so both platforms fail the same way.
 */
export async function configure(options: ConfigureOptions): Promise<void> {
  if (!options.baseUrl.startsWith('https://')) {
    throw new Error('MapZoneSpeedAlert.configure: baseUrl must start with https://');
  }
  requireInteger('configure', 'vehicleType', options.vehicleType);
  if (VehicleType[options.vehicleType] === undefined) {
    throw new TypeError(
      `MapZoneSpeedAlert.configure: vehicleType must be a VehicleType, got ${options.vehicleType}`
    );
  }
  requireInteger('configure', 'seats', options.seats);
  if (!Number.isFinite(options.weightsTons)) {
    throw new TypeError(
      `MapZoneSpeedAlert.configure: weightsTons must be a finite number of tonnes, got ${options.weightsTons}`
    );
  }
  const nativeOptions = {
    baseUrl: options.baseUrl,
    apiKeyId: options.apiKeyId,
    apiKey: options.apiKey,
    identity: options.identity,
    vehicleType: options.vehicleType,
    seats: options.seats,
    weightsTons: options.weightsTons,
    metadata: options.metadata == null ? null : JSON.stringify(options.metadata),
  };
  // Reaches native synchronously, so it stays in order with the calls that
  // follow it (Android: JS thread; iOS: main queue).
  const rejectionReason = await MapZoneSpeedAlertModule.configure(nativeOptions);
  if (rejectionReason != null) {
    throw new Error(`MapZoneSpeedAlert.configure: ${rejectionReason}`);
  }
}

let nextLogoutRequestId = 1;

/**
 * Sign the identity out. Call it when the user signs out of your app, and
 * after `MapZoneError.SESSION_MOVED` (the server then answers "no session",
 * which counts as success). Zone loads stop at once: no `onLocation()` or
 * `configure()` issued after this call can overtake it, and a `configure()`
 * for the next user does not wait for the server. The zone already loaded
 * keeps alerting. Resolves with the server's answer — a failed logout is
 * `success: false`, not a rejection: the SDK then stays signed out locally;
 * call `logout()` again to retry.
 */
export function logout(): Promise<LogoutResult> {
  const requestId = nextLogoutRequestId++;
  return new Promise((resolve, reject) => {
    const subscription = MapZoneSpeedAlertModule.addListener('onLogoutResult', (event) => {
      if (event.requestId !== requestId) return;
      subscription.remove();
      resolve({
        success: event.success,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      });
    });
    try {
      MapZoneSpeedAlertModule.logout(requestId);
    } catch (error) {
      subscription.remove();
      reject(error);
    }
  });
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
 * and voice speed are kept. Does not sign the user out — use `logout()`.
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

/**
 * Each matched fix moved onto the road, for drawing the vehicle marker.
 * The native callback is only registered while at least one listener exists.
 */
export function addSnappedLocationListener(
  listener: (event: SnappedLocationEvent) => void
): EventSubscription {
  return MapZoneSpeedAlertModule.addListener('onSnappedLocation', listener);
}
