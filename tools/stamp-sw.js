/* Stamp the service worker's cache name with a hash of the app's files.

     node tools/stamp-sw.js

   The site is served straight from this folder, so the stamp has to live in
   sw.js itself. A phone keeps a saved copy of the app under that name and
   only throws it away when the name changes - so without a fresh stamp a
   redrawn map, a renamed room or a fixed bug never reaches a phone that has
   opened the app before. tools/build-school-map.js runs this automatically;
   run it by hand after editing index.html, engine.js or sw.js. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const FILES = ["index.html", "engine.js", "map.js", "scanpoints.js", "manifest.webmanifest"]
  .concat(fs.readdirSync(path.join(ROOT, "plans")).filter(f => f.endsWith(".svg")).map(f => "plans/" + f));

const h = crypto.createHash("sha1");
FILES.forEach(f => { try { h.update(fs.readFileSync(path.join(ROOT, f))); } catch (e) {} });
// sw.js itself, minus its own stamp, so editing the worker also bumps it
const swPath = path.join(ROOT, "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
h.update(sw.replace(/const VERSION\s*=\s*"[^"]*"/, ""));

const stamp = "school-" + h.digest("hex").slice(0, 10);
const out = sw.replace(/const VERSION\s*=\s*"[^"]*"/, 'const VERSION    = "' + stamp + '"');
if (out !== sw) fs.writeFileSync(swPath, out);
console.log("service worker cache: " + stamp + (out === sw ? " (unchanged)" : ""));
