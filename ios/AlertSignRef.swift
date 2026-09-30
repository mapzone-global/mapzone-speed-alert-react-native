import ExpoModulesCore
import UIKit

/// Hands a sign UIImage to JS without copying pixels. `nativeRefType = "image"`
/// is what lets `expo-image` accept the ref directly as `source`.
///
/// Releasing only drops this reference; expo-image may still be drawing the
/// image, and ARC reclaims it once nobody holds it.
final class AlertSignRef: SharedRef<UIImage> {
  override var nativeRefType: String { "image" }

  static func wrap(_ image: UIImage?) -> AlertSignRef? {
    image.map { AlertSignRef($0) }
  }

  /// PNG bytes as base64 for hosts that do not use `expo-image`.
  func toPngBase64() -> String {
    ref.pngData()?.base64EncodedString() ?? ""
  }
}
