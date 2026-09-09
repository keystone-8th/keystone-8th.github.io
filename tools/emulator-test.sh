#!/usr/bin/env bash
# ============================================================
# Boot an Android emulator and load the parking app in Chrome.
#
# The app runs on the HOST at :8138. Inside an AVD the host
# loopback is 10.0.2.2, so no LAN or firewall changes are needed
# to reach it from the emulated device.
#
#   ./tools/emulator-test.sh create   # one-time AVD creation
#   ./tools/emulator-test.sh boot     # start it (headless)
#   ./tools/emulator-test.sh open G1  # open a placard URL
#   ./tools/emulator-test.sh shot out.png
#   ./tools/emulator-test.sh stop
# ============================================================
set -u

SDK="${ANDROID_SDK_ROOT:-C:/Users/shyam/AppData/Local/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
ADB="$SDK/platform-tools/adb.exe"
EMU="$SDK/emulator/emulator.exe"
AVDMAN="$SDK/cmdline-tools/latest/bin/avdmanager.bat"

AVD_NAME="athena_pixel"
IMAGE="system-images;android-34;google_apis;x86_64"
HOST_URL="http://10.0.2.2:8138"

case "${1:-}" in

  create)
    echo "no" | "$AVDMAN" create avd \
      --name "$AVD_NAME" \
      --package "$IMAGE" \
      --device "pixel_5" \
      --force
    echo "AVD '$AVD_NAME' created."
    ;;

  boot)
    # -no-window: nothing can display a window in this environment, but
    # adb screencap still captures the framebuffer, which is what we need.
    "$EMU" -avd "$AVD_NAME" \
      -no-window -no-audio -no-boot-anim -no-snapshot \
      -gpu swiftshader_indirect \
      -netdelay none -netspeed full &
    echo "emulator starting (headless)..."
    ;;

  wait)
    "$ADB" wait-for-device
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      sleep 3
    done
    "$ADB" shell input keyevent 82 >/dev/null 2>&1   # dismiss lock screen
    echo "boot complete"
    ;;

  open)
    SP="${2:-G1}"
    "$ADB" shell am start -a android.intent.action.VIEW \
      -d "$HOST_URL/?s=$SP" com.android.chrome >/dev/null 2>&1 \
      || "$ADB" shell am start -a android.intent.action.VIEW -d "$HOST_URL/?s=$SP"
    echo "opened $HOST_URL/?s=$SP"
    ;;

  shot)
    OUT="${2:-emulator-shot.png}"
    "$ADB" exec-out screencap -p > "$OUT"
    echo "saved $OUT"
    ;;

  stop)
    "$ADB" emu kill 2>/dev/null || true
    echo "emulator stopped"
    ;;

  *)
    echo "usage: $0 {create|boot|wait|open <SCANPOINT>|shot <file>|stop}"
    ;;
esac
