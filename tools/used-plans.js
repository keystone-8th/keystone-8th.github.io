// Print the image files the published map actually needs, one a line, for the
// build to copy. Floor-plan backdrops are no longer among them - the multi-map
// view that drew them is gone, so plans/ ships nothing. What remains is the
// turn photographs, which are part of the directions themselves.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "map.js"), "utf8");
const seen = new Set();
let m;
// Turn photographs are part of the directions, not decoration: a bundle
// without them is a bundle that goes blank at the one junction that needed it.
const pic = /"photo"\s*:\s*"([^"]+)"/g;
while ((m = pic.exec(src))) seen.add("photos/" + m[1] + ".jpg");
// The floor plan is drawn on screen again, so the level backdrop ships too.
const plan = /"image"\s*:\s*"([^"]+)"/g;
while ((m = plan.exec(src))) seen.add(m[1]);
for (const p of seen) console.log(p);
