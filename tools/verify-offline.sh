#!/usr/bin/env bash
# ============================================================
# Prove the deployed site works with the network switched off.
#
#   bash tools/verify-offline.sh                       # the live site
#   bash tools/verify-offline.sh https://other/url/    # somewhere else
#
# This is the only test that matters for this app. Everything else - the
# routing, the wording, the layout - is verifiable in a browser tab on a
# desk. Whether it still works in a basement with no signal is not, and it
# is the whole reason the app exists.
#
# So the test does the real thing: load the site on a real Android runtime,
# let the service worker install, cut the radios, RELOAD, and then build a
# route from nothing but what was cached. A test that only checks the files
# are reachable proves the opposite of what we care about.
#
# Needs the emulator (or any adb device) running:  bash tools/emulator.sh start
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-C:/Users/shyam/AppData/Local/Android/Sdk}"
ADB="$SDK/platform-tools/adb.exe"
URL="${1:-https://athena-parking.github.io/park/}"
URL="${URL%/}/index.html?s=MG"
EVAL="$ROOT/tools/devtools-eval.js"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

ev() { DEVTOOLS_MATCH="${2:-github.io}" node "$EVAL" "$1" 2>/dev/null | tail -1; }

echo "verifying: $URL"

"$ADB" get-state >/dev/null 2>&1 || { echo "  no adb device. Run: bash tools/emulator.sh start"; exit 1; }

# --- put the device online and load the page fresh -------------------------
"$ADB" shell settings put global airplane_mode_on 0 >/dev/null 2>&1
"$ADB" shell svc wifi enable  >/dev/null 2>&1
"$ADB" shell svc data enable  >/dev/null 2>&1
sleep 4
"$ADB" shell am force-stop com.android.chrome >/dev/null 2>&1
sleep 1
"$ADB" shell am start -a android.intent.action.VIEW -d "$URL" com.android.chrome >/dev/null 2>&1
sleep 12
"$ADB" forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null 2>&1
sleep 2

# Stale tabs from earlier runs shadow the one we just opened, and the eval
# helper picks the first match - so clear them out.
node -e '
const p=process.env.DEVTOOLS_PORT||"9222";
fetch("http://localhost:"+p+"/json/list").then(r=>r.json()).then(async t=>{
  const pages=t.filter(x=>x.type==="page");
  for (const x of pages.slice(1)) await fetch("http://localhost:"+p+"/json/close/"+x.id);
}).catch(()=>{});' 2>/dev/null
sleep 2

sw=$(ev "(async function(){
  for (var i=0;i<15;i++){
    if (navigator.serviceWorker && navigator.serviceWorker.controller) break;
    await new Promise(function(r){setTimeout(r,1000);});
  }
  var ks = await caches.keys();
  var n  = ks.length ? (await (await caches.open(ks[0])).keys()).length : 0;
  return JSON.stringify({secure: window.isSecureContext, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller), files: n});
})()")
echo "  online state: $sw"
case "$sw" in
  *'"secure":true'*)     ok "secure context (a service worker is even allowed here)" ;;
  *) bad "NOT a secure context - no service worker, so no offline. Is this https or localhost?" ;;
esac
case "$sw" in
  *'"controlled":true'*) ok "service worker installed and controlling the page" ;;
  *) bad "service worker never took control" ;;
esac
case "$sw" in
  *'"files":0'*|*'"files":null'*) bad "cache is empty - nothing to serve offline" ;;
  *'"files"'*) ok "cache populated ($(echo "$sw" | grep -o '"files":[0-9]*' | cut -d: -f2) files)" ;;
esac

# --- now take the network away ---------------------------------------------
echo "  cutting the radios..."
"$ADB" shell svc wifi disable >/dev/null 2>&1
"$ADB" shell svc data disable >/dev/null 2>&1
"$ADB" shell settings put global airplane_mode_on 1 >/dev/null 2>&1
sleep 6

# Trust nothing: ask the page itself whether the network is really gone. An
# "offline" test that was quietly still online is worse than no test.
probe=$(ev "(async function(){
  try { await fetch('$URL'.split('?')[0].replace(/[^/]*\$/,'') + 'nope-' + Date.now(), {cache:'no-store'});
        return 'STILL-ONLINE'; }
  catch (e) { return 'OFFLINE'; }
})()")
case "$probe" in
  OFFLINE) ok "device is genuinely offline (a live fetch throws)" ;;
  *)       bad "device still has a network - the rest of this test would be meaningless" ;;
esac

# --- the actual test: reload with nothing but the cache ---------------------
ev "location.reload(); 'go'" >/dev/null
sleep 10

route=$(ev "(function(){
  if (!document.getElementById('modesw')) return JSON.stringify({rendered:false});
  var q = document.getElementById('q');
  document.getElementById('pr-to').click();
  q.value = 'D-1204'; q.dispatchEvent(new Event('input'));
  var f = document.querySelector('#picklist .item');
  if (f) f.click();
  return 'picked';
})()")
sleep 2
res=$(ev "JSON.stringify({
  onLine: navigator.onLine,
  rendered: !!document.getElementById('modesw'),
  dest: (document.getElementById('r-dest')||{}).textContent,
  steps: document.querySelectorAll('#prog .pdot').length
})")
echo "  offline state: $res"
case "$res" in
  *'"rendered":true'*) ok "app rendered after a full reload with no network" ;;
  *) bad "app did NOT come back offline - the shell was not cached" ;;
esac
case "$res" in
  *'"steps":0'*|*'"steps":null'*) bad "no route built offline" ;;
  *'"steps"'*) ok "route built offline ($(echo "$res" | grep -o '"steps":[0-9]*' | cut -d: -f2) steps to $(echo "$res" | grep -o '"dest":"[^"]*"' | cut -d'"' -f4))" ;;
esac

# --- put the device back the way we found it -------------------------------
"$ADB" shell settings put global airplane_mode_on 0 >/dev/null 2>&1
"$ADB" shell svc wifi enable >/dev/null 2>&1
"$ADB" shell svc data enable >/dev/null 2>&1

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
