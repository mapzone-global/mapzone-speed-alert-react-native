import ExpoModulesCore
import MapZoneSpeedAlertSDK
import UIKit

/// Expo Module wrapping the native `ZoneNetworkManager`. Function order mirrors
/// the native class and the Kotlin module so the three can be diffed side by side.
///
/// Every event except `onVoice` is wired for the module's lifetime. `onVoice`
/// is wired only while JS has a listener: the native closure, when set, takes
/// every clip away from the built-in player.
///
/// The built-in player is switched on at creation. Natively it defaults to off
/// on iOS but plays by default on Android; turning it on here gives JS the same
/// behaviour on both platforms.
///
/// The three restriction groups fire natively only when they change, so the
/// latest state of each is cached and replayed when JS starts observing that
/// event — a screen mounted while the vehicle is already inside a built-up area
/// still shows the sign.
///
/// Threading: every call into the manager goes through `onMain`. Its public
/// API is documented as safe from the main thread, and native `processGps`
/// runs synchronously on the caller's thread, reading the closures and
/// `useBuiltInVoicePlayer` as it goes — so writing those properties on main
/// while a tick ran on the JS thread would race. One FIFO (the main queue)
/// also keeps `configure` / `reset` / `onLocation` in the order JS issued
/// them. Native callbacks fire on main too, which is where the restriction
/// cache lives.
///
/// Events go through `emit(event:payload:)` (JSI), not `sendEvent`: the latter
/// still uses the legacy bridge emitter on iOS, which serializes the body and
/// drops `SharedObject` values such as `AlertSignRef`. Payloads carrying sign
/// images are `Record`s for the same reason (see `EventPayloads.swift`).
public class MapZoneSpeedAlertModule: Module {
  private let manager = ZoneNetworkManager()
  /// The instance that last started; only it may reset the shared native engine.
  private static weak var activeModule: MapZoneSpeedAlertModule?

  private var lastAccessRestriction: RestrictionState?
  private var lastStopRestriction: RestrictionState?
  private var lastBuildupArea: RestrictionState?

  public func definition() -> ModuleDefinition {
    Name("MapZoneSpeedAlert")

    Events(
      "onSigns",
      "onAccessRestriction",
      "onStopRestriction",
      "onBuildupArea",
      "onVoice",
      "onResult",
      "onReady"
    )

    Class(AlertSignRef.self) {
      Function("toBase64") { (ref: AlertSignRef) in ref.toPngBase64() }
    }

    OnCreate {
      onMain { [weak self] in
        guard let self else { return }
        MapZoneSpeedAlertModule.activeModule = self
        let manager = self.manager
        manager.useBuiltInVoicePlayer = true
        // The trailing voiceWav is never forwarded: with the built-in player on
        // it is always nil, and with `onVoice` set every clip goes there.
        manager.onBitmap = { [weak self] current, speedStatus, next, nextDistMeters, camera, cameraDistMeters, toll, tollDistMeters, _ in
          let payload = SignsPayload(
            current: current, speedStatus: speedStatus, next: next, nextDistMeters: nextDistMeters,
            camera: camera, cameraDistMeters: cameraDistMeters, toll: toll, tollDistMeters: tollDistMeters
          )
          self?.emit(event: "onSigns", payload: payload)
        }
        manager.onAccessRestriction = { [weak self] image, kind, distMeters in
          let state = RestrictionState(image: image, kind: kind, distMeters: distMeters)
          self?.lastAccessRestriction = state
          self?.emit(event: "onAccessRestriction", payload: RestrictionPayload(state))
        }
        manager.onStopRestriction = { [weak self] image, kind, distMeters in
          let state = RestrictionState(image: image, kind: kind, distMeters: distMeters)
          self?.lastStopRestriction = state
          self?.emit(event: "onStopRestriction", payload: RestrictionPayload(state))
        }
        manager.onBuildupArea = { [weak self] image, kind, distMeters in
          let state = RestrictionState(image: image, kind: kind, distMeters: distMeters)
          self?.lastBuildupArea = state
          self?.emit(event: "onBuildupArea", payload: RestrictionPayload(state))
        }
        manager.onResult = { [weak self] success, errorCode, errorMessage in
          let payload: [String: Any?] = [
            "success": success, "errorCode": errorCode, "errorMessage": errorMessage,
          ]
          self?.emit(event: "onResult", payload: payload)
        }
        manager.onReady = { [weak self] linkCount, alertCount in
          let payload: [String: Any?] = ["linkCount": linkCount, "alertCount": alertCount]
          self?.emit(event: "onReady", payload: payload)
        }
      }
    }

    // Replay is dispatched so it reaches JS after the listener that triggered
    // it has been registered, and on the main thread where the cache lives.
    OnStartObserving("onAccessRestriction") {
      DispatchQueue.main.async { [weak self] in
        self?.replay("onAccessRestriction", self?.lastAccessRestriction)
      }
    }
    OnStartObserving("onStopRestriction") {
      DispatchQueue.main.async { [weak self] in
        self?.replay("onStopRestriction", self?.lastStopRestriction)
      }
    }
    OnStartObserving("onBuildupArea") {
      DispatchQueue.main.async { [weak self] in
        self?.replay("onBuildupArea", self?.lastBuildupArea)
      }
    }

    OnStartObserving("onVoice") {
      onMain { [weak self] in
        self?.manager.onVoice = { [weak self] wav, trigger, priority in
          let payload: [String: Any?] = [
            "wavBase64": wav.base64EncodedString(),
            "trigger": trigger,
            "priority": priority,
          ]
          self?.emit(event: "onVoice", payload: payload)
        }
      }
    }
    OnStopObserving("onVoice") {
      onMain { [weak self] in self?.manager.onVoice = nil }
    }

    Function("configure") { (options: ConfigureRecord) in
      let manager = self.manager
      onMain {
        // Weight is truncated like Android's `(int) weights`; JS has already
        // rejected non-finite values, which would trap here.
        manager.configure(
          baseUrl: options.baseUrl, apiKeyId: options.apiKeyId, apiKey: options.apiKey,
          vehicleId: options.vehicleId, vehicleType: options.vehicleType, seats: options.seats,
          weights: Int(options.weights)
        )
      }
    }
    // `updateLocation` enqueues the zone load on the SDK's serial queue;
    // `processGps` then matches this tick synchronously (on main, see above)
    // against whatever zone is loaded.
    Function("onLocation") { (lat: Double, lng: Double, bearing: Double, speedKmh: Double, accuracy: Double, fixTimeMillis: Int64) in
      let manager = self.manager
      onMain {
        manager.updateLocation(lat: lat, lng: lng, speedKmh: speedKmh, bearingDeg: bearing)
        manager.processGps(
          lat: lat, lng: lng, bearing: bearing, speedKmh: speedKmh, accuracy: accuracy,
          timestampMs: fixTimeMillis
        )
      }
    }
    // The restriction cache is kept: it mirrors what native last emitted.
    Function("reset") {
      let manager = self.manager
      onMain { manager.reset() }
    }
    Function("setMutedAlertTypes") { (codes: [Int]) in
      let manager = self.manager
      onMain { manager.setMutedAlertTypeValues(codes.map { NSNumber(value: $0) }) }
    }
    Function("setVoiceProfile") { (profileValue: Int) in
      let manager = self.manager
      onMain { manager.setVoiceProfile(VoiceProfile(rawValue: profileValue) ?? .full) }
    }
    Function("setVoiceSpeed") { (speed: Float) in
      let manager = self.manager
      onMain { manager.setVoiceSpeed(speed) }
    }

    OnDestroy {
      // Drop every closure so a torn-down module (JS reload) receives no ticks,
      // and stop the built-in player so the next module does not overlap it.
      // The engine behind every manager is one shared native instance: only
      // reset it when no newer module has taken over.
      let manager = self.manager
      let isActiveModule = MapZoneSpeedAlertModule.activeModule === self
      onMain {
        manager.onBitmap = nil
        manager.onAccessRestriction = nil
        manager.onStopRestriction = nil
        manager.onBuildupArea = nil
        manager.onVoice = nil
        manager.onResult = nil
        manager.onReady = nil
        manager.useBuiltInVoicePlayer = false
        if isActiveModule { manager.reset() }
      }
    }
  }

  /// Nothing to replay when no group state was seen yet or the group is currently inactive.
  private func replay(_ eventName: String, _ state: RestrictionState?) {
    guard let state, state.kind != 0 else { return }
    emit(event: eventName, payload: RestrictionPayload(state))
  }
}

/// Runs `work` now when already on the main thread, otherwise asynchronously on it.
private func onMain(_ work: @escaping () -> Void) {
  if Thread.isMainThread {
    work()
  } else {
    DispatchQueue.main.async(execute: work)
  }
}
