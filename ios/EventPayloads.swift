import ExpoModulesCore
import UIKit

// Event payloads are `Record`s, not `[String: Any?]`: a dictionary erases the
// value type to `Optional<Any>`, which Expo's JS converter cannot map (it logs
// `unknownToJavaScriptValue: unsupported native type 'Optional<Any>'` and
// sends `undefined`). A `@Field` typed `AlertSignRef?` goes through the
// SharedObject path and reaches JS as the registered class instance.

/// Mirrors `SignsEvent` in `src/MapZoneSpeedAlert.types.ts`.
struct SignsPayload: Record {
  @Field var current: AlertSignRef?
  @Field var speedStatus: Int = 0
  @Field var next: AlertSignRef?
  @Field var nextDistMeters: Int = 0
  @Field var camera: AlertSignRef?
  @Field var cameraDistMeters: Int = 0
  @Field var toll: AlertSignRef?
  @Field var tollDistMeters: Int = 0

  init() {}

  init(
    current: UIImage?, speedStatus: Int, next: UIImage?, nextDistMeters: Int,
    camera: UIImage?, cameraDistMeters: Int, toll: UIImage?, tollDistMeters: Int
  ) {
    self.current = AlertSignRef.wrap(current)
    self.speedStatus = speedStatus
    self.next = AlertSignRef.wrap(next)
    self.nextDistMeters = nextDistMeters
    self.camera = AlertSignRef.wrap(camera)
    self.cameraDistMeters = cameraDistMeters
    self.toll = AlertSignRef.wrap(toll)
    self.tollDistMeters = tollDistMeters
  }
}

/// Mirrors `RestrictionEvent` in `src/MapZoneSpeedAlert.types.ts` — shared by
/// `onAccessRestriction`, `onStopRestriction` and `onBuildupArea`.
struct RestrictionPayload: Record {
  @Field var image: AlertSignRef?
  @Field var kind: Int = 0
  @Field var distMeters: Int = 0

  init() {}

  init(_ state: RestrictionState) {
    self.image = AlertSignRef.wrap(state.image)
    self.kind = state.kind
    self.distMeters = state.distMeters
  }
}

/// Latest native payload of one restriction group, kept for replay.
struct RestrictionState {
  let image: UIImage?
  let kind: Int
  let distMeters: Int
}
