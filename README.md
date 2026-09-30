# Integration Guide — `@mapzone/speed-alert`

This guide walks you through adding speed, camera, toll and restriction alerts
to an Expo / React Native driving app with `@mapzone/speed-alert`. It assumes
you already have a source of GPS fixes. **No route is needed**: the driver can
go anywhere and the SDK follows.

> Following a planned route instead? Use `@mapzone/nav-speed-alert`. Both
> packages can live in the same app (§10).

## 1. Overview

The SDK does one job: given a stream of **GPS fixes**, it tells you — once per
fix — which signs to show and which voice cues to play at that moment. It loads
the road network around the vehicle from the MapZone service on its own,
reloads it as the vehicle moves, and map-matches every fix onto it. It does not
read GPS itself; your app supplies the fixes.

```
your GPS source ──► onLocation(fix) at ~1 Hz
                          │
                          ▼
                 native zone engine ── loads / reloads the zone around the vehicle
                          │
   ┌──────────┬───────────┼───────────────┬──────────────┬──────────┬─────────┐
   ▼          ▼           ▼               ▼              ▼          ▼         ▼
onSigns  onAccess-   onStop-         onBuildupArea    onVoice   onResult  onReady
(speed/  Restriction Restriction     (built-up area)  (WAV clip, (zone     (zone
camera/  (road closed, (no stopping,                  optional)  load ok / loaded)
toll)    vehicle ban)  no parking)                               error)
```

Sign images arrive as native references (`AlertSignRef`) that you hand straight
to `expo-image`. Voice plays through a built-in native player unless you choose
to receive the clips yourself.

## 2. Prerequisites

| Requirement | Value |
|---|---|
| Expo SDK | ≥ 57 (React Native ≥ 0.86), **New Architecture only** |
| Build type | Development build or `expo run:*` — **not Expo Go** |
| iOS | ≥ 16.4 |
| Android | minSdk 24; ABIs `arm64-v8a`, `armeabi-v7a` only (**no x86 / x86_64**) |
| Peer dependency | `expo-image` (renders the native sign references) |
| Credentials | `baseUrl`, `apiKeyId`, `apiKey`, `vehicleId` issued by MapZone |

**Your application id must be registered with the alert service.** The SDK
sends the running app's id (Android `applicationId`, iOS bundle identifier)
when it authenticates. Build variants with an id suffix (`com.foo.debug`) are
rejected unless they are registered too. A mismatch shows up as a `2xxx` error
code in `onResult` (§8). Register every platform id you test with.

**Android emulators:** the native library has no x86 slice, so standard Intel
emulator images cannot load it — the SDK stays inert and reports `-5` in
`onResult`. Test on a physical device or an arm64 emulator image.

The SDK requires location data but does **not** request the permission itself.
Declare the location permission in your app config and request it at runtime
as you would for any driving app (the example in §5 uses `expo-location`). If
alerts must keep running while the app is in the background, you also need
background location — and on iOS the `location` background mode, plus `audio`
so voice cues keep playing.

## 3. Installation

```sh
npx expo install @mapzone/speed-alert expo-image
```

### Android

The native SDK (`com.github.mapzone-global:mapzone_speed_alert_android`) is
resolved from JitPack. If your project locks repositories with
`RepositoriesMode.FAIL_ON_PROJECT_REPOS` in `settings.gradle`, add JitPack
there:

```groovy
dependencyResolutionManagement {
  repositories {
    maven { url 'https://jitpack.io' }
  }
}
```

The AAR ships its own consumer ProGuard rules and declares only the `INTERNET`
permission; nothing else to add. Location permissions are yours to declare.

### iOS

Run `npx pod-install` after installing. The CocoaPods dependency
`MapZoneSpeedAlertSDK` is declared by the module's podspec. The module is a
static framework — keep CocoaPods' default linkage, or use
`use_frameworks! :linkage => :static` if you enable frameworks.

### Rebuild

Native code changed, so rebuild the app:

```sh
npx expo run:android
npx expo run:ios
```

## 4. Configuration

Call `configure()` **once**, before the first `onLocation()`. All fields are
required.

```ts
import * as SpeedAlert from '@mapzone/speed-alert';

SpeedAlert.configure({
  baseUrl: 'https://driving.map.zone', // must start with https://
  apiKeyId: '<your-api-key-id>',
  apiKey: '<your-api-key>',            // a credential: keep it out of source control and logs
  vehicleId: '<your-vehicle-id>',
  vehicleType: 1,                      // 1..9, see table below
  seats: 5,                            // integer
  weights: 1500,                       // gross weight in kg (fractions are truncated)
});
```

| `vehicleType` | Vehicle |
|---|---|
| 1 | Car |
| 2 | Motorcycle |
| 3 | Truck |
| 4 | Coach |
| 5 | Bus |
| 6 | Taxi |
| 7 | Bicycle |
| 8 | Pedestrian |
| 9 | Emergency vehicle |

`vehicleType`, `seats` and `weights` decide which alerts apply to you. The
"vehicle restricted" sign (§6.3) is computed for exactly this profile, and
`vehicleType` also picks which artwork that sign uses.

### Changing the vehicle profile

The profile is fixed for a session. When the driver switches vehicle, call
`reset()` and then `configure()` again with the new values.

## 5. Session lifecycle

```ts
// Once, before the first fix (and again after a profile change):
SpeedAlert.configure(options);

// Every GPS fix, ~1 Hz:
SpeedAlert.onLocation({ lat, lng, bearing, speedKmh, accuracy, fixTimeMillis });

// Session ends:
SpeedAlert.reset();
```

### `onLocation(fix)`

Feed every GPS fix as it arrives, at the usual GPS cadence (~1 Hz). The call
returns immediately; results arrive as events. Each field:

| Field | Unit / meaning |
|---|---|
| `lat`, `lng` | WGS84 degrees |
| `bearing` | Heading in degrees, 0 = north, 90 = east. Pass `0` if unknown — never `NaN`. |
| `speedKmh` | Current speed in **km/h** (most platform APIs give m/s — multiply by 3.6). |
| `accuracy` | Horizontal accuracy in metres. Pass a large value (e.g. 100) if unknown, not 0. |
| `fixTimeMillis` | Fix timestamp, **epoch milliseconds (UTC)**. Pass the fix's own timestamp, not `Date.now()`: voice throttling and stop detection are timed against it. Throws `TypeError` when not finite; fractions are rounded. |

A minimal source using `expo-location` (foreground only):

```ts
import * as Location from 'expo-location';
import * as SpeedAlert from '@mapzone/speed-alert';

async function startGps() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission denied');

  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
    (loc) => {
      const { heading, speed, accuracy } = loc.coords;
      SpeedAlert.onLocation({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        bearing: heading != null && heading >= 0 ? heading : 0, // iOS reports -1 when unknown
        speedKmh: Math.max(0, (speed ?? 0) * 3.6),              // iOS reports -1 when unknown
        accuracy: accuracy ?? 100,
        fixTimeMillis: loc.timestamp,
      });
    }
  );
}
// Later: (await startGps()).remove();
```

Pass the **raw** GPS fix. The engine map-matches it onto its own road network;
there is no route to snap to.

### `reset()`

Drops the loaded zone and the engine state; the next `onLocation()` loads a
fresh zone. The mute set, voice profile and voice speed (§7) are kept. Safe to
call repeatedly. Call it when the session ends or the vehicle profile changes;
also call it on component unmount so a hot reload does not leave a stale
session running. On iOS it also stops the clip being played and drops the
voice queue.

## 6. Receiving signs

This is the part most apps spend their time on, so it is covered in detail.

### 6.1 `AlertSignRef` — the image handle

Every image field is an `AlertSignRef | null`. `null` means "nothing to show in
this slot — hide it". A non-null ref is a native image (Bitmap on Android,
UIImage on iOS) that:

- renders directly with `expo-image`: `<Image source={ref} />`;
- can be converted with `ref.toBase64()` (PNG bytes as base64) if you render
  with something other than `expo-image`;
- **must be released** with `ref.release()` once you no longer display it.
  Skipping this leaks a native image per slot per tick.

### 6.2 Three ways to subscribe

**A. `useSpeedAlertSigns()` — recommended.** The hook keeps the latest value of
each of the four sign events in React state and releases the image refs of
superseded events for you, including events that were batched between renders.

```tsx
import { useSpeedAlertSigns } from '@mapzone/speed-alert';
import { Image } from 'expo-image';

function SpeedOverlay() {
  const { signs, accessRestriction, stopRestriction, buildupArea } = useSpeedAlertSigns();
  return (
    <>
      {signs?.current && <Image source={signs.current} style={S.sign} />}
      {signs?.camera && (
        <>
          <Image source={signs.camera} style={S.sign} />
          <Text>{signs.cameraDistMeters} m</Text>
        </>
      )}
      {accessRestriction?.image && <Image source={accessRestriction.image} style={S.sign} />}
      {stopRestriction?.image && <Image source={stopRestriction.image} style={S.sign} />}
      {buildupArea?.image && <Image source={buildupArea.image} style={S.buildupArea} />}
    </>
  );
}
```

Mount **one** instance of the component that calls the hook for the whole
driving screen. Unmounting it removes the listeners and releases the last refs.

**B. Listeners — manual.** Use `addSignsListener`, `addAccessRestrictionListener`,
`addStopRestrictionListener` and `addBuildupAreaListener` when you keep your own
state (e.g. outside React, or in a store). Each returns a subscription with
`remove()`. You own the release protocol: release every ref in an event once you
have replaced it with a newer one, and release the last event's refs when you
stop.

```ts
let last: SignsEvent | null = null;
const sub = SpeedAlert.addSignsListener((e) => {
  render(e);
  if (last) for (const k of ['current', 'next', 'camera', 'toll'] as const) last[k]?.release();
  last = e;
});
// On stop:
sub.remove();
if (last) for (const k of ['current', 'next', 'camera', 'toll'] as const) last[k]?.release();
```

Restriction events carry a single ref, `image`; release it the same way.

**C. `toBase64()` — non-`expo-image` hosts.** Subscribe as in B, call
`ref.toBase64()` on the refs you need, release the ref immediately, and render
`data:image/png;base64,…` with your image component.

### 6.3 Events and slots

`onSigns` carries four image slots plus `speedStatus`. Three restriction events
carry one slot each. Slots are independent — several can be non-null at once.
Every distance is metres ahead of the current position; `0` means "on it now".

#### `SignsEvent` — every fix matched to a road

| Field | Sign | Shown | Distance |
|---|---|---|---|
| `current` | Current speed limit | Always while matched to a road | — |
| `speedStatus` | `0` within limit · `1` within 5 km/h of it · `2` over limit | Always | — |
| `next` | Next speed-limit sign ahead | When one is near ahead | `nextDistMeters` |
| `camera` | Nearest camera ahead (speed / enforcement / red-light / AI — the artwork already shows which) | When a camera is ahead; gone once passed | `cameraDistMeters` |
| `toll` | Toll booth ahead | When a toll booth is ahead; gone once passed | `tollDistMeters` |

**No event while unmatched.** `onSigns` fires only on fixes the engine could
place on a road. Off the network (parking garage, brand-new road, GPS spike) no
event arrives at all, so the last signs stay on screen. If that matters for your
UI, clear the slots yourself after a few seconds without an `onSigns` event.

#### Restriction events — only when the group changes

Three independent groups, each with its own event and display slot. They answer
different questions and genuinely co-occur — a street inside a built-up area
can also ban stopping — so give each its own slot; one firing says nothing about
the other two.

| Event | Question | `kind` |
|---|---|---|
| `onAccessRestriction` | May I drive here at all? | `AccessRestrictionKind`: `NONE` 0, `ROAD_CLOSED` 3, `VEHICLE_RESTRICTED` 4 |
| `onStopRestriction` | May I stop here? | `StopRestrictionKind`: `NONE` 0, `NO_PARKING` 1, `NO_STOPPING` 2 |
| `onBuildupArea` | Which speed regime applies? | `BuildupAreaKind`: `NONE` 0, `START` 5 (entering), `END` 6 (leaving) |

Payload: `{ image, kind, distMeters }`.

- `distMeters === 0` means "on it now" (hide the distance label); `> 0` means it
  starts that far ahead.
- `image` is `null` when the slot must be hidden: `kind === 0`, or no artwork
  exists yet for that sign. Never treat it as an error.
- The stop-restriction sign shows at **any speed**; only its voice cue waits
  until the vehicle slows down or stops.
- The built-up area artwork is a **landscape rectangle**, not a circle.

**Replay for late subscribers.** These events fire only on change, not every
tick. So that a screen mounted mid-drive still shows an active restriction,
**the first listener of each event receives a replay of the current state**. A
listener added while another is still registered does not — so if something
subscribes early and stays subscribed (analytics, logging), screens mounted
afterwards miss the replay. Share one hook or subscription per event. After
`reset()` the replayed state is the last one native reported; the next matched
fix corrects it.

## 7. Voice

### Built-in player (default)

With no `onVoice` listener the native engine plays voice cues itself through a
priority-aware queue: speed-limit changes, "approaching" warnings, speeding
warnings, camera / toll / restriction announcements. Nothing to do. The module
switches the player on at start-up on both platforms, so iOS and Android behave
the same.

- On iOS the player uses the shared `AVAudioSession` (`.playback`, ducking other
  audio) while it speaks. If your app manages the audio session itself, those
  calls act on your session too. An audio interruption (phone call, Siri) drops
  the clip being played and the queue; the next clip plays normally.

Adjust the playback speed:

```ts
SpeedAlert.setVoiceSpeed(1.25); // 1.0 = recorded speed; clamped to 0.5..2.0, pitch kept
```

### Receiving clips yourself

Subscribe to `onVoice` if you want to mix the audio into your own player, duck
music, or route it to a specific audio session. **While at least one listener
exists the built-in player is silent** and your app is responsible for playing
every clip; removing the last listener hands playback back to the built-in
player.

```ts
const sub = SpeedAlert.addVoiceListener((e) => {
  // e.wavBase64: WAV, PCM 16-bit LE, mono, 22 050 Hz
  // e.priority:  0 = "current" (drop first if you fall behind), 1 = normal, 2 = speeding (never drop)
  // e.trigger:   native VoiceTrigger id — useful for logging / analytics
  playWav(e.wavBase64, e.priority);
});
```

`wavBase64` is a complete WAV file; write it to a temporary file and play it
with your audio library, or decode it and feed an audio track directly. If
clips can queue up, honour `priority`: shed priority 0 first, then 1, never 2.

Clips the built-in player had already queued when you subscribe are dropped at
once on iOS and finish playing on Android.

### Muting categories

```ts
import { VoiceAlertType } from '@mapzone/speed-alert';

SpeedAlert.setMutedAlertTypes([VoiceAlertType.SPEED_CAMERA, VoiceAlertType.TOLL]);
SpeedAlert.setMutedAlertTypes([]); // unmute everything
```

| `VoiceAlertType` | Value | Meaning |
|---|---|---|
| `SPEED_CAMERA` | 3 | Speed camera |
| `TOLL` | 4 | Toll booth |
| `TRAFFIC_ENFORCEMENT_CAMERA` | 6 | Traffic-enforcement camera |
| `RED_LIGHT_CAMERA` | 7 | Red-light / surveillance camera |
| `AI_CAMERA` | 8 | AI camera |
| `NO_LEFT_TURN` / `NO_RIGHT_TURN` / `NO_UTURN` / `NO_STRAIGHT` | 9 / 10 / 11 / 15 | Turn restrictions |
| `NO_OVERTAKING` / `NO_OVERTAKING_END` | 12 / 13 | No-overtaking zone start / end |
| `NO_PARKING` | 14 | No parking |
| `BUILDUP_AREA_START` / `BUILDUP_AREA_END` | 16 / 17 | Built-up area start / end |
| `REST_STATION` | 18 | Rest station |
| `NO_STOPPING` | 19 | No stopping |
| `ROAD_CLOSED` | 20 | Road closed |
| `VEHICLE_RESTRICTED` | 21 | Your vehicle type not allowed |

- Speed-limit and speeding voices are core safety cues and **cannot** be muted —
  they have no entry in the enum.
- Muting a **camera or toll** category hides its sign as well (there is one
  slot each; a category you do not want should not occupy it).
- Muting any other category silences the voice only; restriction signs are
  still delivered.

The mute set persists across zone reloads and `reset()`. See `VoiceAlertType`
in [`src/MapZoneSpeedAlert.types.ts`](./src/MapZoneSpeedAlert.types.ts).

### Ding-only profile

```ts
import { VoiceProfile } from '@mapzone/speed-alert';

SpeedAlert.setVoiceProfile(VoiceProfile.DING_ONLY); // short tones instead of speech
SpeedAlert.setVoiceProfile(VoiceProfile.FULL);      // spoken phrases (default)
```

In `DING_ONLY`, cameras and no-stopping / no-parking become a ding, speeding a
distinct ding, and everything else is silent. The mute set is applied first, so
a muted alert never becomes a ding.

**Choose the profile when a session starts, not mid-drive.** An alert is marked
as announced when it fires, before the profile turns it into a ding or silence.
A toll booth passed in `DING_ONLY` counts as announced even though nothing was
heard, so switching back to `FULL` on the same stretch does not replay it.

## 8. Results
```ts
SpeedAlert.addResultListener((e) => {
  if (!e.success) console.warn(`speed alert ${e.errorCode}: ${e.errorMessage}`);
});
```

| `errorCode` | Meaning |
|---|---|
| `0` | Success — zone loaded |
| `1001` | Location is outside the supported area |
| other `1xxx` | Invalid request |
| `2xxx` | Session expired / unauthorized — `apiKeyId`, `apiKey` or application id mismatch (§2) |
| `3003` | `vehicleType` not supported (must be 1..9) |
| `3004` | No map data for this area |
| other `3xxx` | Requested data not found |
| `5xxx` | Server temporarily unavailable — retry later |
| `-1` | Response could not be verified |
| `-2` | Map data empty, malformed or unusable |
| `-3` | Secure session could not be established |
| `-4` | Server unreachable — check connectivity |
| `-5` | Native engine unavailable: library missing for this device's ABI (§2), configuration rejected, or a native call failed. Reported once per outage, not on every fix. |
| `-99` | Older spelling of `-5` from older engine builds; same meaning. |

`errorMessage` is a short, display-ready English sentence derived from
`errorCode` alone — the server's own wording never reaches your app. Localise
off `errorCode` if you need another language, and quote the number in bug
reports.

### `onReady` — zone loaded

```ts
SpeedAlert.addReadyListener(({ linkCount, alertCount }) => {
  console.log(`zone ready: ${linkCount} links, ${alertCount} alerts`);
});
```

Fired after each successful zone load, with the number of road links and alerts
in the zone. Useful for a "ready" indicator and for diagnosing an area with no
alerts.

## 9. Putting it together

A complete minimal integration: configure, feed GPS and reset from one session
hook, render the signs from one overlay.

```tsx
import * as SpeedAlert from '@mapzone/speed-alert';
import { useSpeedAlertSigns } from '@mapzone/speed-alert';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// 1. Session driver. Pass a stable `options` object (module constant or
//    useMemo): a new object on every render would reset the engine each time.
export function useSpeedAlertSession(options: SpeedAlert.ConfigureOptions) {
  useEffect(() => {
    let isCancelled = false;
    let gps: Location.LocationSubscription | undefined;

    SpeedAlert.configure(options);
    const subs = [
      SpeedAlert.addResultListener((e) => {
        if (!e.success) console.warn('speed alert', e.errorCode, e.errorMessage);
      }),
      SpeedAlert.addReadyListener((e) => console.log('zone ready', e.linkCount, e.alertCount)),
    ];

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || isCancelled) return;
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        ({ coords, timestamp }) =>
          SpeedAlert.onLocation({
            lat: coords.latitude,
            lng: coords.longitude,
            bearing: coords.heading != null && coords.heading >= 0 ? coords.heading : 0,
            speedKmh: Math.max(0, (coords.speed ?? 0) * 3.6),
            accuracy: coords.accuracy ?? 100,
            fixTimeMillis: timestamp,
          })
      );
      // Unmounted while the permission prompt or the watch was pending.
      if (isCancelled) subscription.remove();
      else gps = subscription;
    })();

    return () => {
      isCancelled = true;
      gps?.remove();
      subs.forEach((s) => s.remove());
      SpeedAlert.reset();
    };
  }, [options]);
}

// 2. Overlay: mount once on the driving screen.
export function SpeedAlertOverlay() {
  const { signs, accessRestriction, stopRestriction, buildupArea } = useSpeedAlertSigns();
  return (
    <View style={S.row}>
      <Slot sign={signs?.current} tint={signs?.speedStatus} />
      <Slot sign={signs?.next} dist={signs?.nextDistMeters} />
      <Slot sign={signs?.camera} dist={signs?.cameraDistMeters} />
      <Slot sign={signs?.toll} dist={signs?.tollDistMeters} />
      <Slot sign={accessRestriction?.image} dist={accessRestriction?.distMeters} />
      <Slot sign={stopRestriction?.image} dist={stopRestriction?.distMeters} />
      <Slot sign={buildupArea?.image} dist={buildupArea?.distMeters} wide />
    </View>
  );
}

function Slot({
  sign,
  dist,
  tint,
  wide,
}: {
  sign?: SpeedAlert.AlertSignRef | null;
  dist?: number;
  tint?: SpeedAlert.SpeedStatus;
  wide?: boolean;
}) {
  if (!sign) return null;
  const border = tint === 2 ? '#F44336' : tint === 1 ? '#FF9800' : 'transparent';
  return (
    <View style={S.slot}>
      <Image source={sign} style={wide ? S.wide : [S.sign, { borderColor: border }]} />
      {dist !== undefined && dist > 0 ? <Text style={S.dist}>{dist} m</Text> : null}
    </View>
  );
}

const S = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { alignItems: 'center' },
  sign: { width: 72, height: 72, borderWidth: 3, borderRadius: 36 },
  wide: { width: 108, height: 72 },
  dist: { fontSize: 12 },
});
```