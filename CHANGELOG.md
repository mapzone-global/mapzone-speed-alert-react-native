# Changelog

## 2.0.0 (unreleased)

Moves to native MapZone Speed Alert SDK **3.0.0** — Android JitPack
`com.github.mapzone-global:mapzone_speed_alert_android:3.0.0`, iOS CocoaPods
`MapZoneSpeedAlertSDK 3.0.0`. Breaking; see "Upgrading from 1.x" in the README.

- `configure()` now signs a user in and returns `Promise<void>`: await it
  before the first `onLocation()`; it rejects with the native reason (and
  applies nothing) when an input is refused.
- `ConfigureOptions`: `identity` replaces `vehicleId`; `vehicleType` is the new
  `VehicleType` enum with server codes (`CAR` 1, `TAXI` 2, `BUS` 3, `COACH` 4,
  `TRUCK` 5, `MOTORCYCLE` 7); `weightsTons` (tonnes) replaces `weights` (kg);
  optional `metadata` object.
- New `logout()`, resolving with `{ success, errorCode, errorMessage }`; it
  reaches native in call order with `configure()` / `onLocation()`.
- New `onSnappedLocation` event / `addSnappedLocationListener`.
- New `MapZoneError` constants; error codes reorganised by the native SDK
  (`2006`, `2008`, `-6`, `-8`, …).

## 1.0.0 (2024-06-19)

Initial release.

- Expo Module wrapping the MapZone Speed Alert SDK (`ZoneNetworkManager`) —
  zone-based speed-limit, camera, toll and restriction alerts with sign images
  and voice cues; no route needed.
- API: `configure`, `onLocation`, `reset`, `setMutedAlertTypes`,
  `setVoiceProfile`, `setVoiceSpeed`; events `onSigns`, `onAccessRestriction`,
  `onStopRestriction`, `onBuildupArea`, `onVoice`, `onResult`, `onReady`;
  hook `useSpeedAlertSigns`.
- Built-in voice player on by default on both platforms; restriction state is
  replayed to the first listener of each restriction event.
- Requires Expo SDK 57 / React Native 0.86, New Architecture only.
- Native SDK: Android JitPack
  `com.github.mapzone-global:mapzone_speed_alert_android:2.0.6`, iOS CocoaPods
  `MapZoneSpeedAlertSDK 2.0.5`.
