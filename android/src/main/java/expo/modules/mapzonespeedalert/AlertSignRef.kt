package expo.modules.mapzonespeedalert

import android.graphics.Bitmap
import android.util.Base64
import expo.modules.kotlin.runtime.Runtime
import expo.modules.kotlin.sharedobjects.SharedRef
import java.io.ByteArrayOutputStream

/**
 * Hands a sign Bitmap to JS without copying pixels. `nativeRefType = "image"`
 * is what lets `expo-image` accept the ref directly as `source`.
 *
 * The Bitmap is deliberately NOT recycled on release: expo-image may still be
 * drawing it. Dropping the reference is enough for the Java GC to reclaim it.
 */
class AlertSignRef(bitmap: Bitmap, runtime: Runtime) : SharedRef<Bitmap>(bitmap, runtime) {
  override val nativeRefType: String = "image"

  /** PNG bytes as base64 for hosts that do not use `expo-image`. */
  fun toPngBase64(): String {
    val out = ByteArrayOutputStream()
    ref.compress(Bitmap.CompressFormat.PNG, 100, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
