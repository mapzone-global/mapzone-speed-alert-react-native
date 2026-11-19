import ExpoModulesCore

/// Mirrors `NativeConfigureOptions` in `src/MapZoneSpeedAlertModule.ts`:
/// `ConfigureOptions` with `metadata` already serialised to JSON by JS.
struct ConfigureRecord: Record {
  @Field(.required) var baseUrl: String = ""
  @Field(.required) var apiKeyId: String = ""
  @Field(.required) var apiKey: String = ""
  @Field(.required) var identity: String = ""
  @Field(.required) var vehicleType: Int = 0
  @Field(.required) var seats: Int = 0
  @Field(.required) var weightsTons: Double = 0
  @Field var metadata: String? = nil
}
