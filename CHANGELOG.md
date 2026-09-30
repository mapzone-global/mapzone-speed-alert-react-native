# Changelog

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
