#!/usr/bin/env bash
# ============================================================
# Athena Parking — Android emulator helper
#
#   bash tools/emulator.sh start      # boot the AVD (visible window) + open the app
#   bash tools/emulator.sh open RD    # jump to another placard, e.g. RD, LD, VP
#   bash tools/emulator.sh shot a.png # screenshot the device
#   bash tools/emulator.sh stop
#   bash tools/emulator.sh create     # one-time: (re)create the AVD
#
# The app runs on the HOST at :8138, reached through `adb reverse` so the
# device sees it on ITS OWN localhost. That matters more than convenience: a
# service worker only registers in a secure context, and localhost is one
# while 10.0.2.2 is not. Testing against 10.0.2.2 looks identical right up to
# the moment the network goes away - which is the only moment that counts.
# ============================================================
set -u

SDK="${ANDROID_SDK_ROOT:-C:/Users/shyam/AppData/Local/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
ADB="$SDK/platform-tools/adb.exe"
EMU="$SDK/emulator/emulator.exe"
AVDMAN="$SDK/cmdline-tools/latest/bin/avdmanager.bat"

AVD="athena_pixel"
IMAGE="system-images;android-34;google_apis;x86_64"
URL="http://localhost:8138"

boot_wait() {
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 4; done
  "$ADB" reverse tcp:8138 tcp:8138 >/dev/null 2>&1 || true
  "$ADB" shell input keyevent 82 >/dev/null 2>&1 || true    # dismiss lock screen
}

open_app() {
  local sp="${1:-G1}"
  "$ADB" shell am start -a android.intent.action.VIEW \
    -d "$URL/?s=$sp" com.android.chrome >/dev/null 2>&1
  echo "opened $URL/?s=$sp"
}

case "${1:-}" in

  create)
    echo "no" | "$AVDMAN" create avd --name "$AVD" --package "$IMAGE" --device pixel_5 --force
    ;;

  start)
    if "$ADB" devices 2>/dev/null | grep -q "emulator-"; then
      echo "emulator already running"
    else
      # Visible window so you can tap around yourself.
      "$EMU" -avd "$AVD" -no-audio -no-boot-anim \
             -gpu host -netdelay none -netspeed full >/dev/null 2>&1 &
      echo "emulator starting — the window takes a minute or two to appear"
    fi
    boot_wait
    # Skip Chrome's first-run wizard so the app loads straight away.
    "$ADB" shell "echo 'chrome --disable-fre --no-first-run --no-default-browser-check --disable-search-engine-choice-screen' > /data/local/tmp/chrome-command-line" 2>/dev/null || true
    "$ADB" shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true
    open_app "${2:-G1}"
    ;;

  open)  open_app "${2:-G1}" ;;
  shot)  "$ADB" exec-out screencap -p > "${2:-emulator-shot.png}"; echo "saved ${2:-emulator-shot.png}" ;;
  stop)  "$ADB" emu kill >/dev/null 2>&1; echo "emulator stopped" ;;

  *) sed -n '3,12p' "$0" ;;
esac
