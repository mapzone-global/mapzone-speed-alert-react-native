package expo.modules.mapzonespeedalert

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.records.Required

/** Mirrors `ConfigureOptions` in `src/MapZoneSpeedAlert.types.ts`. */
class ConfigureRecord : Record {
  @Field @Required val baseUrl: String = ""
  @Field @Required val apiKeyId: String = ""
  @Field @Required val apiKey: String = ""
  @Field @Required val vehicleId: String = ""
  @Field @Required val vehicleType: Int = 0
  @Field @Required val seats: Int = 0
  @Field @Required val weights: Double = 0.0
}
