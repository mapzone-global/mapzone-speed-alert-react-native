#!/usr/bin/env bash
# Checks that the native MapZone Speed Alert SDK and the native MapZone Alert
# View SDK can live in one app: no shared exported native symbol, JVM class,
# Android resource, provider authority, Objective-C class or Swift module.
#
# Works on the PUBLISHED artifacts (JitPack AAR + CocoaPods xcframework), so it
# answers "what a host app actually links", not what a local build produces.
#
#   internal/coexistence/check-native-symbols.sh
#
# Versions default to the ones pinned in android/build.gradle / the podspec;
# override with SPEED_ALERT_ANDROID_VERSION, SPEED_ALERT_IOS_VERSION,
# ALERT_VIEW_VERSION.
# Needs: curl, git, unzip, nm (llvm-nm from Xcode), c++filt.
# Exit 1 on any FAIL, 2 when an artifact cannot be fetched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pinned_android_version=$(grep -o 'mapzone_speed_alert_android:[0-9.]*' "$REPO_ROOT/android/build.gradle" | cut -d: -f2)
pinned_ios_version=$(grep -o "'MapZoneSpeedAlertSDK', '= [0-9.]*'" "$REPO_ROOT/ios/MapZoneSpeedAlert.podspec" | grep -o '[0-9][0-9.]*')
SPEED_ALERT_ANDROID_VERSION="${SPEED_ALERT_ANDROID_VERSION:-$pinned_android_version}"
SPEED_ALERT_IOS_VERSION="${SPEED_ALERT_IOS_VERSION:-$pinned_ios_version}"
ALERT_VIEW_VERSION="${ALERT_VIEW_VERSION:-1.0.1}"

WORK_DIR="${COEXISTENCE_WORK_DIR:-${TMPDIR:-/tmp}/mapzone-coexistence}"
mkdir -p "$WORK_DIR"

SPEED_ALERT_AAR_URL="https://jitpack.io/com/github/mapzone-global/mapzone_speed_alert_android/${SPEED_ALERT_ANDROID_VERSION}/mapzone_speed_alert_android-${SPEED_ALERT_ANDROID_VERSION}.aar"
ALERT_VIEW_AAR_URL="https://jitpack.io/com/github/mapzone-global/mapzone-alert-view-android/${ALERT_VIEW_VERSION}/mapzone-alert-view-android-${ALERT_VIEW_VERSION}.aar"
SPEED_ALERT_IOS_REPO="https://github.com/mapzone-global/mapzone_speed_alert_ios.git"
ALERT_VIEW_IOS_REPO="https://github.com/mapzone-global/mapzone-alert-view-ios.git"

failure_count=0

report() { # report <PASS|FAIL|INFO> <item> <detail>
  printf '%-4s  %-34s %s\n' "$1" "$2" "$3"
  if [[ "$1" == "FAIL" ]]; then failure_count=$((failure_count + 1)); fi
}

# Prints the lines two sorted files have in common.
common_lines() { comm -12 "$1" "$2"; }

fetch_aar() { # fetch_aar <url> <dir>
  if [[ ! -f "$2/classes.jar" ]]; then
    mkdir -p "$2"
    curl -sfL -m 300 -o "$2/package.aar" "$1" || { echo "ERROR: cannot download $1 (not published?)" >&2; exit 2; }
    unzip -qo "$2/package.aar" -d "$2"
  fi
}

fetch_ios() { # fetch_ios <repo> <tag> <dir>
  if [[ ! -d "$3" ]]; then
    git clone -q --depth 1 --branch "$2" "$1" "$3" || { echo "ERROR: cannot clone tag $2 of $1" >&2; exit 2; }
  fi
}

# ---------------------------------------------------------------- Android --
speed_alert_android="$WORK_DIR/android-speed-alert-$SPEED_ALERT_ANDROID_VERSION"
alert_view_android="$WORK_DIR/android-alert-view-$ALERT_VIEW_VERSION"
fetch_aar "$SPEED_ALERT_AAR_URL" "$speed_alert_android"
fetch_aar "$ALERT_VIEW_AAR_URL" "$alert_view_android"

echo "== Android: speed-alert $SPEED_ALERT_ANDROID_VERSION vs alert-view $ALERT_VIEW_VERSION"

# 1. Shared-library file names: identical names collide in the APK.
(cd "$speed_alert_android/jni" && find . -name '*.so' | sort) > "$WORK_DIR/so-speed.txt"
(cd "$alert_view_android/jni" && find . -name '*.so' | sort) > "$WORK_DIR/so-view.txt"
shared=$(common_lines "$WORK_DIR/so-speed.txt" "$WORK_DIR/so-view.txt")
if [[ -z "$shared" ]]; then report PASS "android .so file names" "$(xargs -n1 basename < "$WORK_DIR/so-speed.txt" | sort -u | tr '\n' ' ')"
else report FAIL "android .so file names" "$shared"; fi

# 2. Exported dynamic symbols per ABI. Each .so is dlopen'ed RTLD_LOCAL, but a
#    shared exported name is still worth knowing about.
for abi_dir in "$speed_alert_android"/jni/*/; do
  abi=$(basename "$abi_dir")
  [[ -d "$alert_view_android/jni/$abi" ]] || continue
  nm -D --defined-only "$abi_dir"*.so 2>/dev/null | awk '{print $NF}' | sort -u > "$WORK_DIR/dyn-speed-$abi.txt"
  nm -D --defined-only "$alert_view_android/jni/$abi/"*.so 2>/dev/null | awk '{print $NF}' | sort -u > "$WORK_DIR/dyn-view-$abi.txt"
  all_shared=$(common_lines "$WORK_DIR/dyn-speed-$abi.txt" "$WORK_DIR/dyn-view-$abi.txt" | grep -v '^JNI_OnLoad$' || true)
  # typeinfo / typeinfo name / vtable of libc++ `std::__ndk1` types keep
  # default visibility even under -fvisibility=hidden (cross-DSO exception
  # matching needs them). A library loaded by System.loadLibrary is not
  # RTLD_GLOBAL, so each .so binds its own copy — reported, not failed.
  runtime_shared=$(echo "$all_shared" | grep -E '^_ZT[ISV]NSt6__ndk1' || true)
  shared=$(echo "$all_shared" | grep -vE '^_ZT[ISV]NSt6__ndk1' | grep -v '^$' || true)
  exported=$(wc -l < "$WORK_DIR/dyn-speed-$abi.txt" | tr -d ' ')
  if [[ -z "$shared" ]]; then report PASS "android exported symbols ($abi)" "speed-alert exports $exported, none shared (JNI_OnLoad ignored)"
  else report FAIL "android exported symbols ($abi)" "$(echo "$shared" | head -5 | tr '\n' ' ')"; fi
  if [[ -n "$runtime_shared" ]]; then
    report INFO "android libc++ RTTI ($abi)" "$(echo "$runtime_shared" | wc -l | tr -d ' ') shared std::__ndk1 typeinfo/vtable, bound per .so: $(echo "$runtime_shared" | c++filt | head -1)"
  fi
done

# 3. JVM classes: a duplicate fully-qualified class fails D8 with "Duplicate class".
unzip -Z1 "$speed_alert_android/classes.jar" | grep '\.class$' | sort > "$WORK_DIR/classes-speed.txt"
unzip -Z1 "$alert_view_android/classes.jar" | grep '\.class$' | sort > "$WORK_DIR/classes-view.txt"
shared=$(common_lines "$WORK_DIR/classes-speed.txt" "$WORK_DIR/classes-view.txt")
if [[ -z "$shared" ]]; then report PASS "android JVM classes" "$(cut -d/ -f1-3 "$WORK_DIR/classes-speed.txt" | sort -u | tr '\n' ' ')"
else report FAIL "android JVM classes" "$(echo "$shared" | head -5 | tr '\n' ' ')"; fi

# 4. Resources: same type+name from two libraries → one silently wins.
awk '{print $2"/"$3}' "$speed_alert_android/R.txt" 2>/dev/null | sort -u > "$WORK_DIR/res-speed.txt"
awk '{print $2"/"$3}' "$alert_view_android/R.txt" 2>/dev/null | sort -u > "$WORK_DIR/res-view.txt"
shared=$(common_lines "$WORK_DIR/res-speed.txt" "$WORK_DIR/res-view.txt")
if [[ -z "$shared" ]]; then report PASS "android resources" "$(wc -l < "$WORK_DIR/res-speed.txt" | tr -d ' ') speed-alert resources, none shared"
else report FAIL "android resources" "$(echo "$shared" | head -5 | tr '\n' ' ')"; fi

# 5. Manifest: provider authorities must differ; <application> attributes set
#    by a library are merged into the host and may conflict with it.
authorities() { grep -o 'android:authorities="[^"]*"' "$1" | sort -u || true; }
authorities "$speed_alert_android/AndroidManifest.xml" > "$WORK_DIR/auth-speed.txt"
authorities "$alert_view_android/AndroidManifest.xml" > "$WORK_DIR/auth-view.txt"
shared=$(common_lines "$WORK_DIR/auth-speed.txt" "$WORK_DIR/auth-view.txt")
if [[ -z "$shared" ]]; then report PASS "android provider authorities" "$(tr '\n' ' ' < "$WORK_DIR/auth-speed.txt")"
else report FAIL "android provider authorities" "$shared"; fi
for side in speed_alert_android alert_view_android; do
  attributes=$(tr '\n' ' ' < "${!side}/AndroidManifest.xml" | grep -o '<application[^>]*>' | grep -o 'android:[a-zA-Z]*="[^"]*"' | tr '\n' ' ' || true)
  [[ -n "$attributes" ]] && report INFO "android <application> ($side)" "$attributes"
done

# ------------------------------------------------------------------- iOS --
speed_alert_ios="$WORK_DIR/ios-speed-alert-$SPEED_ALERT_IOS_VERSION"
alert_view_ios="$WORK_DIR/ios-alert-view-$ALERT_VIEW_VERSION"
fetch_ios "$SPEED_ALERT_IOS_REPO" "ios-$SPEED_ALERT_IOS_VERSION" "$speed_alert_ios"
fetch_ios "$ALERT_VIEW_IOS_REPO" "ios-$ALERT_VIEW_VERSION" "$alert_view_ios"

echo "== iOS: speed-alert $SPEED_ALERT_IOS_VERSION vs alert-view $ALERT_VIEW_VERSION"

framework_binary() { # framework_binary <xcframework dir> <slice>
  local framework
  framework=$(find "$1" -maxdepth 3 -path "*/$2/*.framework" -type d | head -1)
  echo "$framework/$(basename "$framework" .framework)"
}

speed_alert_xcframework=$(find "$speed_alert_ios" -maxdepth 1 -name '*.xcframework' | head -1)
alert_view_xcframework=$(find "$alert_view_ios" -maxdepth 1 -name '*.xcframework' | head -1)
if [[ -z "$speed_alert_xcframework" || -z "$alert_view_xcframework" ]]; then
  echo "ERROR: xcframework missing in $speed_alert_ios or $alert_view_ios" >&2
  exit 2
fi

# 6. Swift module / framework names: two images with one module name clash.
speed_module=$(basename "$speed_alert_xcframework" .xcframework)
view_module=$(basename "$alert_view_xcframework" .xcframework)
if [[ "$speed_module" != "$view_module" ]]; then report PASS "ios module names" "$speed_module vs $view_module"
else report FAIL "ios module names" "$speed_module"; fi

for slice in ios-arm64 ios-arm64_x86_64-simulator; do
  speed_binary=$(framework_binary "$speed_alert_xcframework" "$slice")
  view_binary=$(framework_binary "$alert_view_xcframework" "$slice")
  [[ -f "$speed_binary" && -f "$view_binary" ]] || { report INFO "ios $slice" "slice missing, skipped"; continue; }

  report INFO "ios linkage ($slice)" "speed-alert: $(file -b "$speed_binary" | head -1 | cut -c1-48) | alert-view: $(file -b "$view_binary" | head -1 | cut -c1-48)"

  # 7. Objective-C classes live in one process-wide namespace: a duplicate is
  #    "Class X is implemented in both" and undefined behaviour.
  nm -gU "$speed_binary" | grep -o '_OBJC_CLASS_\$_.*' | sort -u > "$WORK_DIR/objc-speed.txt"
  nm -gU "$view_binary" | grep -o '_OBJC_CLASS_\$_.*' | sort -u > "$WORK_DIR/objc-view.txt"
  shared=$(common_lines "$WORK_DIR/objc-speed.txt" "$WORK_DIR/objc-view.txt")
  if [[ -z "$shared" ]]; then report PASS "ios objc classes ($slice)" "$(wc -l < "$WORK_DIR/objc-speed.txt" | tr -d ' ') vs $(wc -l < "$WORK_DIR/objc-view.txt" | tr -d ' ') classes, none shared"
  else report FAIL "ios objc classes ($slice)" "$(echo "$shared" | head -5 | tr '\n' ' ')"; fi

  # 8. Exported symbols. Dynamic frameworks bind two-level, so a shared strong
  #    symbol still resolves per image; weak definitions can be coalesced
  #    across images by dyld, so those are the ones that matter most.
  nm -gU "$speed_binary" | awk '{print $NF}' | sort -u > "$WORK_DIR/sym-speed.txt"
  nm -gU "$view_binary" | awk '{print $NF}' | sort -u > "$WORK_DIR/sym-view.txt"
  shared=$(common_lines "$WORK_DIR/sym-speed.txt" "$WORK_DIR/sym-view.txt" | grep -v '^__mh_dylib_header$' || true)
  cpp_count=$(grep -c '^__Z' "$WORK_DIR/sym-speed.txt" || true)
  weak_count=$(nm -gU "$speed_binary" | awk '$2 == "W" || $2 == "w"' | wc -l | tr -d ' ')
  if [[ -z "$shared" ]]; then report PASS "ios exported symbols ($slice)" "speed-alert exports $cpp_count C++ ($weak_count weak), none shared"
  else report FAIL "ios exported symbols ($slice)" "$(echo "$shared" | c++filt | head -5 | tr '\n' ' ')"; fi
done

echo
if [[ "$failure_count" -eq 0 ]]; then
  echo "RESULT: PASS — no coexistence conflict found"
else
  echo "RESULT: FAIL — $failure_count conflict(s)"
  exit 1
fi
