// Render a QR placard PNG for every scan point in the published map.
//
//   node tools/make-placards.js                      # uses the url in site.json
//   node tools/make-placards.js http://localhost:8139  # or any other base
//
// The base URL is baked into every code, so it is the one thing to get right
// before anything is printed. Writes qr-png/<ID>.png and placards.html, a
// print sheet with one placard per place.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const QR = require(path.join(ROOT, "qr.js"));
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, "site.json"), "utf8"));
const BASE = (process.argv[2] || SITE.url).replace(/\/+$/, "");
const OUT = path.join(ROOT, "qr-png");

const points = eval(fs.readFileSync(path.join(ROOT, "scanpoints.js"), "utf8") + ";SCANPOINTS.all");
if (!points.length) { console.error("no scan points in the published map"); process.exit(1); }

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, matrix, size, scale, quiet) {
  const W = (size + quiet * 2) * scale;
  const rows = [];
  for (let y = 0; y < W; y++) {
    const line = [0];
    for (let x = 0; x < W; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && matrix[my][mx];
      const v = dark ? 0 : 255;
      line.push(v, v, v);
    }
    rows.push(Buffer.from(line));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
console.log("base: " + BASE);
points.forEach(p => {
  const url = BASE + "/index.html?s=" + p.id;
  // Q recovers from about a quarter of the code being damaged, which is what a
  // scuffed basement wall does to a printed sticker.
  const r = QR.encode(url, "Q");
  writePng(path.join(OUT, p.id + ".png"), r.mod, r.size, 8, 4);
  console.log("  " + p.id.padEnd(4) + " v" + r.version + "  " + p.label.padEnd(24) + url);
});
/* A print sheet: one card per placard, with the code, the place and where to
   stick it. Opens in any browser; print at 100%. */
const card = p => {
  const url = BASE + "/index.html?s=" + p.id;
  const r = QR.encode(url, "Q");
  return '<div class="c"><div class="t">Scan for directions</div><div class="l">' + p.label + '</div>' +
    '<div class="q">' + QR.svg(url, { ecc: "Q", quiet: 4 }).svg + '</div>' +
    '<div class="i">Point your camera at the code. No app needed.</div>' +
    '<div class="m"><b>Mount:</b> ' + p.mount + '</div><div class="u">' + p.id + ' &middot; v' + r.version + ' &middot; ' + BASE.replace(/^https?:\/\//, "") + '</div></div>';
};
fs.writeFileSync(path.join(ROOT, "placards.html"),
  '<!doctype html><meta charset=utf-8><title>School placards</title><style>' +
  'body{font:15px system-ui;margin:24px;background:#fff;color:#111}h1{font-size:19px;margin:0 0 4px}p{color:#555;margin:0 0 20px}' +
  '.g{display:flex;flex-wrap:wrap;gap:16px}.c{border:1.5px solid #333;border-radius:12px;padding:14px;text-align:center;width:250px;break-inside:avoid}' +
  '.t{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:#0d7a4f}.l{font-weight:800;font-size:18px;margin:2px 0 8px}' +
  '.q svg{width:100%;height:auto;display:block}.i{font-size:11px;color:#444;margin-top:8px}' +
  '.m{font-size:10px;color:#555;margin-top:8px;border-top:1px dashed #bbb;padding-top:6px;text-align:left}.u{color:#888;font-size:9.5px;margin-top:6px;word-break:break-all}' +
  '@media print{body{margin:8mm}p,h1{display:none}.c{border-style:dashed}}</style>' +
  '<h1>School placards</h1><p>Print this page at 100%, cut along the dashed lines, and stick each card where its mount note says.</p>' +
  '<div class=g>' + points.map(card).join("") + '</div>');
console.log("\n" + points.length + " placards in qr-png/ and placards.html");
console.log("Verify before printing:  python -c \"import cv2,glob;d=cv2.QRCodeDetector();" +
            "print([d.detectAndDecode(cv2.imread(f))[0] for f in glob.glob('qr-png/*.png')])\"");
