package expo.modules.mapzonespeedalert

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import map.zone.speedalertsdk.VoiceAlertType
import map.zone.speedalertsdk.VoiceCallback
import map.zone.speedalertsdk.VoiceProfile
import map.zone.speedalertsdk.ZoneNetworkManager

/**
 * Expo Module wrapping the native `ZoneNetworkManager`. Function order mirrors
 * the native class and the Swift module so the three can be diffed side by side.
 *
 * Every event except `onVoice` is wired for the module's lifetime. `onVoice`
 * is wired only while JS has a listener, preserving native semantics: the
 * built-in voice player stays active until a voice callback is set.
 *
 * The three restriction groups fire natively only when they change, so the
 * latest state of each is cached and replayed when JS starts observing that
 * event — a screen mounted while the vehicle is already inside a built-up area
 * still shows the sign.
 */
class MapZoneSpeedAlertModule : Module() {
  private val manager = ZoneNetworkManager()
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Latest native payload of one restriction group. Written and read on the main thread only. */
  private data class RestrictionState(val bitmap: Bitmap?, val kind: Int, val distMeters: Int)

  private var lastAccessRestriction: RestrictionState? = null
  private var lastStopRestriction: RestrictionState? = null
  private var lastBuildupArea: RestrictionState? = null

  override fun definition() = ModuleDefinition {
    Name("MapZoneSpeedAlert")

    Events(
      "onSigns",
      "onAccessRestriction",
      "onStopRestriction",
      "onBuildupArea",
      "onVoice",
      "onResult",
      "onReady",
    )

    Class(AlertSignRef::class) {
      Function("toBase64") { ref: AlertSignRef -> ref.toPngBase64() }
    }

    OnCreate {
      activeModule = this@MapZoneSpeedAlertModule
      // The trailing voiceWav is never forwarded: with no VoiceCallback the
      // built-in player owns playback, with one every clip goes to onVoice.
      manager.setBitmapCallback { current, speedStatus, next, nextDistMeters, camera, cameraDistMeters, toll, tollDistMeters, _ ->
        sendEvent(
          "onSigns",
          mapOf(
            "current" to wrap(current),
            "speedStatus" to speedStatus,
            "next" to wrap(next),
            "nextDistMeters" to nextDistMeters,
            "camera" to wrap(camera),
            "cameraDistMeters" to cameraDistMeters,
            "toll" to wrap(toll),
            "tollDistMeters" to tollDistMeters,
          ),
        )
      }
      manager.setAccessRestrictionCallback { bitmap, kind, distMeters ->
        val state = RestrictionState(bitmap, kind, distMeters)
        lastAccessRestriction = state
        sendRestriction("onAccessRestriction", state)
      }
      manager.setStopRestrictionCallback { bitmap, kind, distMeters ->
        val state = RestrictionState(bitmap, kind, distMeters)
        lastStopRestriction = state
        sendRestriction("onStopRestriction", state)
      }
      manager.setBuildupAreaCallback { bitmap, kind, distMeters ->
        val state = RestrictionState(bitmap, kind, distMeters)
        lastBuildupArea = state
        sendRestriction("onBuildupArea", state)
      }
      manager.setResultCallback { success, errorCode, errorMessage ->
        sendEvent(
          "onResult",
          mapOf("success" to success, "errorCode" to errorCode, "errorMessage" to errorMessage),
        )
      }
      manager.setReadyCallback { _, linkCount, alertCount ->
        sendEvent("onReady", mapOf("linkCount" to linkCount, "alertCount" to alertCount))
      }
    }

    // Replay is posted so it reaches JS after the listener that triggered it
    // has been registered, and on the main thread where the cache lives.
    OnStartObserving("onAccessRestriction") {
      mainHandler.post { replay("onAccessRestriction", lastAccessRestriction) }
    }
    OnStartObserving("onStopRestriction") {
      mainHandler.post { replay("onStopRestriction", lastStopRestriction) }
    }
    OnStartObserving("onBuildupArea") {
      mainHandler.post { replay("onBuildupArea", lastBuildupArea) }
    }

    OnStartObserving("onVoice") {
      // Explicit object, not a lambda: a SAM lambda would bind the 1-arg
      // overload and lose trigger/priority.
      manager.setVoiceCallback(
        object : VoiceCallback {
          override fun onVoice(wavBytes: ByteArray) = onVoice(wavBytes, 0, 0)

          override fun onVoice(wavBytes: ByteArray, trigger: Int, priority: Int) {
            sendEvent(
              "onVoice",
              mapOf(
                "wavBase64" to Base64.encodeToString(wavBytes, Base64.NO_WRAP),
                "trigger" to trigger,
                "priority" to priority,
              ),
            )
          }
        },
      )
    }
    OnStopObserving("onVoice") {
      if (activeModule === this@MapZoneSpeedAlertModule) manager.setVoiceCallback(null)
    }

    Function("configure") { options: ConfigureRecord ->
      manager.configure(
        options.baseUrl, options.apiKeyId, options.apiKey, options.vehicleId,
        options.vehicleType, options.seats, options.weights,
      )
    }
    // Both calls only enqueue work on the SDK's single-thread executor, so the
    // zone load (if any) always runs before this tick's matching.
    Function("onLocation") { lat: Double, lng: Double, bearing: Double, speedKmh: Double, accuracy: Double, fixTimeMillis: Long ->
      manager.updateLocation(lat, lng, speedKmh, bearing)
      manager.processGps(lat, lng, bearing, speedKmh, accuracy, fixTimeMillis)
    }
    // The restriction cache is kept: it mirrors what native last emitted, and
    // native re-emits after a reset whenever the state really differs.
    Function("reset") { manager.reset() }
    Function("setMutedAlertTypes") { codes: List<Int> ->
      manager.setMutedAlertTypes(VoiceAlertType.values().filter { it.triggerValue in codes }.toSet())
    }
    Function("setVoiceProfile") { profileValue: Int ->
      manager.setVoiceProfile(VoiceProfile.values().firstOrNull { it.profileValue == profileValue } ?: VoiceProfile.FULL)
    }
    Function("setVoiceSpeed") { speed: Float -> manager.setVoiceSpeed(speed) }

    OnDestroy {
      // Callbacks and the engine are process-wide in the native bridge. When a
      // newer module instance already took them over (its OnCreate ran before
      // this OnDestroy, e.g. on reload), leave them alone — clearing them would
      // silence the live instance.
      if (activeModule !== this@MapZoneSpeedAlertModule) return@OnDestroy
      activeModule = null
      // Drop them so a torn-down module neither keeps the built-in player muted
      // nor receives ticks.
      manager.setBitmapCallback(null)
      manager.setAccessRestrictionCallback(null)
      manager.setStopRestrictionCallback(null)
      manager.setBuildupAreaCallback(null)
      manager.setVoiceCallback(null)
      manager.setResultCallback(null)
      manager.setReadyCallback(null)
      manager.reset()
    }
  }

  private fun sendRestriction(eventName: String, state: RestrictionState) {
    sendEvent(
      eventName,
      mapOf("image" to wrap(state.bitmap), "kind" to state.kind, "distMeters" to state.distMeters),
    )
  }

  /** Nothing to replay when no group state was seen yet or the group is currently inactive. */
  private fun replay(eventName: String, state: RestrictionState?) {
    if (state == null || state.kind == 0) return
    sendRestriction(eventName, state)
  }

  private fun wrap(bitmap: Bitmap?): AlertSignRef? = bitmap?.let { AlertSignRef(it, runtime) }

  private companion object {
    /** The instance that currently owns the process-wide native callbacks. */
    @Volatile
    var activeModule: MapZoneSpeedAlertModule? = null
  }
}
