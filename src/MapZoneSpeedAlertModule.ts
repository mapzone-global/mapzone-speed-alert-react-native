import { NativeModule, requireNativeModule } from 'expo';

import type { ConfigureOptions, MapZoneSpeedAlertEvents } from './MapZoneSpeedAlert.types';

/** Raw native surface. Method order mirrors `ZoneNetworkManager` in the native SDK. */
declare class MapZoneSpeedAlertNativeModule extends NativeModule<MapZoneSpeedAlertEvents> {
  configure(options: ConfigureOptions): void;
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
