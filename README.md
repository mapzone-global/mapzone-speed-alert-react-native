# Integration Guide — `@mapzone/speed-alert`

This guide walks you through adding speed, camera, toll and restriction alerts
to an Expo / React Native driving app with `@mapzone/speed-alert`. It assumes
you already have a source of GPS fixes. **No route is needed**: the driver can
go anywhere and the SDK follows.

> Following a planned route instead? Use `@mapzone/nav-speed-alert`. Both
> packages can live in the same app (§10).

> **Upgrading from 1.x?** 2.0.0 runs on native SDK 3.0.1 and is a breaking
> release: the user now signs in. See [Upgrading from 1.x](#upgrading-from-1x).

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
to receive the clips yourself. If you draw the vehicle on a map,
`onSnappedLocation` gives each fix moved onto the matched road (§5).

Every request is made for a **signed-in identity** — the user of your app —
passed to `configure()` and signed out with `logout()` (§4, §5).

## 2. Prerequisites

| Requirement | Value |
|---|---|
| Expo SDK | ≥ 57 (React Native ≥ 0.86), **New Architecture only** |
| Build type | Development build or `expo run:*` — **not Expo Go** |
| iOS | ≥ 16.4 |
| Android | minSdk 24; ABIs `arm64-v8a`, `armeabi-v7a` only (**no x86 / x86_64**) |
| Peer dependency | `expo-image` (renders the native sign references) |
| Credentials | `baseUrl`, `apiKeyId`, `apiKey` issued by MapZone, plus the signed-in user's `identity` |
| Native SDK | Android `com.github.mapzone-global:mapzone_speed_alert_android:3.0.1`, iOS pod `MapZoneSpeedAlertSDK 3.0.1` (declared by the module) |

**Your application id must be registered with the alert service.** The SDK
sends the running app's id (Android `applicationId`, iOS bundle identifier)
when it authenticates. Build variants with an id suffix (`com.foo.debug`) are
rejected unless they are registered too. A mismatch shows up as `2004` in
`onResult` (§8). Register every platform id you test with.

**Store privacy forms.** The SDK sends a device identifier and the precise
location, linked to the signed-in user. Declare them in Google Play's *Data
safety* form (Device or other IDs + Precise location) and in the App Store
privacy details (Device ID + Precise Location, app functionality, not used
for tracking).

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

Call `configure()` when the user signs in — and on every app launch with a
user already signed in (the SDK does not remember the identity across
launches) — and **await it before the first `onLocation()`**.

```ts
import * as SpeedAlert from '@mapzone/speed-alert';
import { VehicleType } from '@mapzone/speed-alert';

try {
  await SpeedAlert.configure({
    baseUrl: 'https://driving.map.zone', // must start with https://
    apiKeyId: '<your-api-key-id>',
    apiKey: '<your-api-key>',            // a credential: keep it out of source control and logs
    identity: '+84901234567',            // the signed-in user — see Identity
    vehicleType: VehicleType.CAR,        // see table below
    seats: 5,                            // integer, 0 or more
    weightsTons: 1.5,                    // gross weight in TONNES
    metadata: { appVersion: '1.4.0' },   // optional — see Metadata
  });
} catch (error) {
  // Rejected: nothing was applied, the previous configuration stays in effect.
}
```

`configure()` **rejects** when an input is invalid — identity, vehicle type,
seats, weight, metadata, or a `baseUrl` that is not `https://` — with a short
English reason as the message, and then applies nothing. Everything that fails
*after* that (sign-in refused, account in use elsewhere, server down) arrives
through `onResult` as a numeric code (§8), never as a rejection.

| `VehicleType` | Code | Vehicle |
|---|---|---|
| `CAR` | 1 | Car |
| `TAXI` | 2 | Taxi |
| `BUS` | 3 | Bus |
| `COACH` | 4 | Coach |
| `TRUCK` | 5 | Truck |
| `MOTORCYCLE` | 7 | Motorcycle |

Each code is the MapZone server's own vehicle code and is sent unchanged; any
other number is rejected. The type must also be enabled for your API key —
otherwise sign-in reports `1001` and zone loads `3003`.

`vehicleType`, `seats` and `weightsTons` decide which alerts apply to you. The
"vehicle restricted" sign (§6.3) is computed for exactly this profile, and
`vehicleType` also picks which artwork that sign uses.

### Identity

The user (or vehicle) signed in on this device, sent verbatim with every
request — typically the account's phone number in `+84…` form. Pick one kind of
identity for your app and keep it: the service matches it **exactly**
(`"0901234567"` and `"+84901234567"` are two different people).

- Non-empty, at most **128** characters, no `"` and no control characters.
- One identity is active on one device at a time. Signing the same identity in
  on another device moves its session there, and this device receives `2006`.
- Switching to a **different** identity on the same device is only allowed
  **20 minutes** after this device last opened a session (`2008` otherwise).

### Metadata

`metadata` is optional, free-form information agreed between you and MapZone
(app version, internal user id, …). The SDK adds the device `model` and `os`
unless you set them.

- A plain object, serialised to JSON: at most **2048 UTF-8 bytes**, nesting
  depth at most **16**. `null` or omitted = none.
- Recorded only when a session is **opened**: on the first sign-in on this
  device, or when the identity changes. Calling `configure()` again with the
  same identity keeps the metadata stored at sign-in; to record new metadata
  the user has to `logout()` and sign in again.

### Changing the vehicle profile

The profile is fixed for a session. When the driver switches vehicle, call
`reset()` and then `configure()` again with the new values.

## 5. Session lifecycle

```ts
// On sign-in / app launch, before the first fix (and again after a profile change):
await SpeedAlert.configure(options);

// Every GPS fix, ~1 Hz:
SpeedAlert.onLocation({ lat, lng, bearing, speedKmh, accuracy, fixTimeMillis });

// Driving session ends:
SpeedAlert.reset();

// The user signs out of your app (and after 2006):
await SpeedAlert.logout();
```

```
configure(identity) ──► signed in (the SDK logs in, in the background)
        │                    │ 2006 / 2007 / 2005 / … reported once ──► zone loads stop
        │                    │                                         (loaded zone keeps alerting)
        └── logout() ────────┴─► zone loads stop at once ─► server logout ─► { success: true }
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
voice queue. `reset()` does **not** sign the user out — use `logout()`.

### `logout()`

```ts
const { success, errorCode, errorMessage } = await SpeedAlert.logout();
```

Signs the identity out. Zone loads stop at once: no `onLocation()` or
`configure()` you issue after `logout()` can overtake it, so no later fix can
reopen the session. The zone already loaded keeps alerting, and later loads
report `-6` until `configure()` signs someone in again. The promise resolves
with the server's answer (`success` is also `true` when nobody was signed
in); a failed logout is `success: false`, not a rejection. When `success` is
`false` (e.g. offline) the SDK stays signed out locally — call `logout()`
again to retry.

- **Kicked out (`2006`)**: the identity was signed in on another device and the
  SDK has stopped loading zones. Tell the user ("Your account is in use on
  another device"), call `logout()` — the server answers "no session", which
  counts as success — and take the user back to sign-in. Signing in again
  within 20 minutes may return `2008`.
- Signing the next user in right away is fine: `logout(); configure(next)`
  reaches native in that order, and `configure()` does not wait for the
  server logout (the SDK sends the sign-out before the next sign-in).

### Snapped location

Optional, for drawing the vehicle marker on a map: each fix moved onto the
road the engine is serving, so the marker stays on the road instead of
following raw GPS noise.

```ts
const sub = SpeedAlert.addSnappedLocationListener(({ latitude, longitude, bearingDegrees }) => {
  // bearingDegrees: road bearing in the direction of travel, 0 = north, clockwise, [0, 360)
  moveVehicleMarker(latitude, longitude, bearingDegrees);
});
// Later: sub.remove();
```

It fires once per fix matched to a road. Unmatched fixes (zone not loaded yet,
no road nearby) produce no event — keep the marker where it last was. Inside a
short coverage hole the engine keeps serving the last matched road, so the same
point can repeat. The native callback is registered only while a listener
exists.

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

Whatever the code, the zone already loaded keeps alerting; what changes is
whether the SDK keeps loading new zones. Codes that stop or pause loading are
reported **once**, not on every fix. `MapZoneError` names the codes you are
expected to act on.

| `errorCode` | Meaning | SDK |
|---|---|---|
| `0` | Success — zone loaded | — |
| `2006` `SESSION_MOVED` | The identity is now in use on another device | Stops until `configure()` — see `logout()` (§5) |
| `2007` `LOCKED` | Device or identity locked by an administrator | Stops until `configure()` |
| `2002` / `2003` / `2004` | API key, signature or application id not accepted (§2) | Stops until `configure()` |
| `2005` | Service plan expired | Stops until `configure()` |
| `2010` `TRIAL_IDENTITY_NOT_ALLOWED` | Trial API key: this identity is not one of the key's sample identities | Stops until `configure()` |
| `3003` | Vehicle type not enabled for the API key | Stops until `configure()` |
| `3011` / `3012` `NEW_DEVICE_LIMIT` | Device limit of the API key reached | Stops until `configure()` |
| `4001` `REQUEST_QUOTA_EXCEEDED` | Request quota of the API key used up | Stops until `configure()` |
| `1002` | Missing parameter | Stops until `configure()` |
| `1001` | Sign-in: identity or vehicle rejected · Zone: request rejected (e.g. outside the served area) | Sign-in: stops until `configure()` · Zone: keeps going |
| `2008` `SWITCH_TOO_SOON` | Account on this device changed too recently | Pauses **20 minutes**, then resumes on its own |
| `4000` `TOO_MANY_REQUESTS` / `5000` / `5004` / `2009` | Server busy or failing | Waits for the server's `Retry-After` (or backs off), then resumes |
| `2000` | Device clock is wrong — fix the time | Keeps going |
| other `1000`–`5999` | Request invalid / not found / server error | Keeps going |
| `-1` | Response could not be verified | Keeps going |
| `-2` | Map data empty, malformed or unusable | Keeps going |
| `-3` | Secure session could not be established — the SDK retries | Keeps going |
| `-4` | Server unreachable — check connectivity | Keeps going |
| `-5` | Native engine unavailable: library missing for this device's ABI (§2), or a native call failed. Reported once per outage. | — |
| `-6` `NOT_LOGGED_IN` | No identity signed in (`logout()` was called, or `configure()` never was) | Stops until `configure()` |
| `-8` `DEVICE_NOT_READY` | The device cannot be read yet (an iPhone not unlocked since restart, a storage read failure on Android). The SDK re-reads about once a minute; show a notice. `logout()` also resolves with `-8` in that state — call it again later | Pauses, then resumes on its own |
| `-99` | Older spelling of `-5` from older engine builds; same meaning. | — |

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

A complete minimal integration: sign in, feed GPS and reset from one session
hook, render the signs from one overlay. Call `logout()` from your own
sign-out flow.

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

    const subs = [
      SpeedAlert.addResultListener((e) => {
        if (!e.success) console.warn('speed alert', e.errorCode, e.errorMessage);
      }),
      SpeedAlert.addReadyListener((e) => console.log('zone ready', e.linkCount, e.alertCount)),
    ];

    (async () => {
      try {
        await SpeedAlert.configure(options);
      } catch (error) {
        console.warn('speed alert configuration rejected', error);
        return;
      }
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
## Upgrading from 1.x

2.0.0 moves to native SDK 3.0.1 (Android `3.0.1`, iOS `3.0.1`). Code written
for 1.x no longer type-checks.

| 1.x | 2.0.0 |
|---|---|
| `configure(options): void` | `configure(options): Promise<void>` — await it; rejects with the reason when an input is refused |
| `vehicleId: string` | `identity: string` — the signed-in user (§4); put the old value in `metadata` if you still need it |
| `vehicleType: number` (1 car, 2 motorcycle, 3 truck, 4 coach, 5 bus, 6 taxi, 7–9) | `vehicleType: VehicleType` — server codes, see the mapping below |
| `weights: number` (kg) | `weightsTons: number` (tonnes): 1500 kg → `1.5` |
| — | `metadata?: object` (§4) |
| — | `logout(): Promise<LogoutResult>` (§5) |
| — | `addSnappedLocationListener` / `onSnappedLocation` (§5) |
| — | `MapZoneError` constants and new codes (§8) |

| Vehicle | 1.x number | 2.0.0 |
|---|---|---|
| Car | `1` | `VehicleType.CAR` |
| Motorcycle | `2` | `VehicleType.MOTORCYCLE` |
| Truck | `3` | `VehicleType.TRUCK` |
| Coach | `4` | `VehicleType.COACH` |
| Bus | `5` | `VehicleType.BUS` |
| Taxi | `6` | `VehicleType.TAXI` |
| Bicycle / pedestrian / emergency | `7` / `8` / `9` | Not supported — contact MapZone |

Do **not** pass an old number straight through: `3` was a truck in 1.x and is a
bus in 2.0.0.

Steps:

1. `npx expo install @mapzone/speed-alert@^2.0.0`, then rebuild (`npx pod-install`
   on iOS picks up `MapZoneSpeedAlertSDK 3.0.1`).
2. Replace `vehicleId` with `identity`, convert `vehicleType` with the table,
   pass the weight in tonnes as `weightsTons`.
3. `await configure()` on every sign-in and app launch with a signed-in user,
   and handle its rejection.
4. Call `logout()` when the user signs out, and after `2006`.
5. Update your `onResult` handling for the new codes (§8).
6. Update the store privacy forms (§2).

Unchanged: `onLocation`, `reset`, every sign / restriction / voice event,
`useSpeedAlertSigns`, muting, voice profile and voice speed.
