package expo.modules.mapzonespeedalert

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.records.Required

/**
 * Mirrors `NativeConfigureOptions` in `src/MapZoneSpeedAlertModule.ts`:
 * `ConfigureOptions` with `metadata` already serialised to JSON by JS.
 */
class ConfigureRecord : Record {
  @Field @Required val baseUrl: String = ""
  @Field @Required val apiKeyId: String = ""
  @Field @Required val apiKey: String = ""
  @Field @Required val identity: String = ""
  @Field @Required val vehicleType: Int = 0
  @Field @Required val seats: Int = 0
  @Field @Required val weightsTons: Double = 0.0
  @Field val metadata: String? = null
}
