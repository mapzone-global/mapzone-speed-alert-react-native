import { NativeModule, requireNativeModule } from 'expo';

import type { LogoutResult, MapZoneSpeedAlertEvents, VehicleType } from './MapZoneSpeedAlert.types';

/** What `configure()` hands to native: `metadata` already serialised to JSON. */
export type NativeConfigureOptions = {
  baseUrl: string;
  apiKeyId: string;
  apiKey: string;
  identity: string;
  vehicleType: VehicleType;
  seats: number;
  weightsTons: number;
  metadata: string | null;
};

/** Server answer to one `logout(requestId)` call. Internal to `logout()` in `index.ts`. */
export type LogoutResultEvent = LogoutResult & { requestId: number };

type NativeEvents = MapZoneSpeedAlertEvents & {
  onLogoutResult: (event: LogoutResultEvent) => void;
};

/** Raw native surface. Method order mirrors `ZoneNetworkManager` in the native SDK. */
declare class MapZoneSpeedAlertNativeModule extends NativeModule<NativeEvents> {
  /**
   * `null` when applied, otherwise the native reason it was rejected. Android
   * answers synchronously (the call stays in order with `onLocation` on the JS
   * thread); iOS answers through a promise settled on the main thread.
   */
  configure(options: NativeConfigureOptions): string | null | Promise<string | null>;
  /**
   * Closes the zone gate before returning (Android: on the JS thread; iOS: on
   * the main queue, ahead of later calls). The server answer comes back as
   * `onLogoutResult` carrying the same `requestId`.
   */
  logout(requestId: number): void;
  onLocation(
    lat: number,
    lng: number,
    bearing: number,
    speedKmh: number,
    accuracy: number,
    fixTimeMillis: number
  ): void;
  reset(): void;
  setMutedAlertTypes(codes: number[]): void;
  setVoiceProfile(profile: number): void;
  setVoiceSpeed(speed: number): void;
}

export default requireNativeModule<MapZoneSpeedAlertNativeModule>('MapZoneSpeedAlert');
