/* ============================================================
   School wayfinding — map publishing backend

   Scope, deliberately small: log in, upload a map, validate it with
   the SAME engine the app uses, and publish it if it passes.

   No dependencies. Node's stdlib only, so there is nothing to npm
   install, nothing to keep patched, and it runs anywhere Node runs.

   Publishing writes a static map.js into the app directory. The
   visitor app therefore stays 100% static and never calls this
   server — which is the whole point of the architecture.
   ============================================================ */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const { createEngine } = require("../engine.js");

const ROOT     = path.resolve(__dirname, "..");
const DATA     = path.join(__dirname, "data");
const VERSIONS = path.join(DATA, "versions");
const CONFIG   = path.join(DATA, "config.json");
const PORT     = Number(process.env.PORT || 8138);

const MAX_UPLOAD   = 4 * 1024 * 1024;   // a map is tens of KB; 4 MB is generous
const MAX_PLAN     = 40 * 1024 * 1024;  // architects' PDFs are not small
const PLANS        = path.join(ROOT, "plans");
const SESSION_MS   = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX    = 8;

/* ---------- tiny fs helpers ---------- */
const ensureDir = d => fs.mkdirSync(d, { recursive: true });

function writeAtomic(file, text) {
  // Never leave a half-written map.js behind if the process dies mid-write.
  const tmp = file + ".tmp-" + crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const readJson = (f, dflt) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; }
};

/* ---------- config & auth ---------- */
function loadConfig() {
  const c = readJson(CONFIG, null);
  if (!c) {
    console.error("\n  No admin configured yet. Run:  node server/setup.js <password>\n");
    process.exit(1);
  }
  return c;
}

function hashPassword(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), iterations, 32, "sha256")
               .toString("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;         // length alone is not secret here
  return crypto.timingSafeEqual(ba, bb);
}

/* Session = base64(payload).hmac — signed, not encrypted. Carries no secrets. */
function issueSession(cfg) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", cfg.secret).update(payload).digest("base64url");
  return payload + "." + sig;
}

function validSession(cfg, token) {
  if (!token || token.indexOf(".") < 0) return false;
  const [payload, sig] = token.split(".");
  const want = crypto.createHmac("sha256", cfg.secret).update(payload).digest("base64url");
  if (!safeEqual(sig, want)) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch { return false; }
}

const cookies = req => Object.fromEntries(
  (req.headers.cookie || "").split(";").map(c => {
    const i = c.indexOf("=");
    return i < 0 ? ["", ""] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));

const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = (attempts.get(ip) || []).filter(t => now - t < LOGIN_WINDOW);
  attempts.set(ip, rec);
  return rec.length >= LOGIN_MAX;
}
const noteAttempt = ip => attempts.set(ip, (attempts.get(ip) || []).concat(Date.now()));

/* ---------- request helpers ---------- */
function send(res, code, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, Object.assign({
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8"
                                             : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  }, headers));
  res.end(text);
}

class TooLarge extends Error {}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    req.on("data", c => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        // Drain rather than destroy, so the client still receives our 413.
        req.resume();
        reject(new TooLarge("Upload exceeds " + (limit / 1048576) + " MB"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", e => { if (!done) reject(e); });
  });
}

function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    req.on("data", c => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; req.resume(); reject(new TooLarge("File exceeds " + (limit/1048576) + " MB")); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on("error", e => { if (!done) reject(e); });
  });
}

/* Image dimensions straight from the file header - the editor needs the aspect
   ratio to set the drawing size, and a whole image library for two numbers is
   not worth the dependency. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)          // PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {          // JPEG
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* Read + parse, keeping "too large" distinct from "malformed". */
async function readBundle(req, res) {
  let raw;
  try { raw = await readBody(req); }
  catch (e) {
    send(res, e instanceof TooLarge ? 413 : 400, { error: e.message });
    return null;
  }
  try { return { value: JSON.parse(raw) }; }
  catch (e) { send(res, 400, { error: "Invalid JSON: " + e.message }); return null; }
}

/* ---------- validation ---------- */
const REQUIRED = ["levels", "nodes", "edges"];

function structuralCheck(map) {
  const issues = [];
  if (!map || typeof map !== "object") { issues.push({ sev: "err", msg: "Payload is not an object" }); return issues; }
  REQUIRED.forEach(k => {
    if (!Array.isArray(map[k]) || !map[k].length)
      issues.push({ sev: "err", msg: "Missing or empty required array: " + k });
  });
  ["blocks", "slotRuns", "allotments", "areas"].forEach(k => {
    if (map[k] !== undefined && !Array.isArray(map[k]))
      issues.push({ sev: "err", msg: k + " must be an array" });
  });
  const ids = new Set();
  (map.nodes || []).forEach(n => {
    if (!n.id) issues.push({ sev: "err", msg: "A node is missing an id" });
    else if (ids.has(n.id)) issues.push({ sev: "err", msg: "Duplicate node id: " + n.id });
    else ids.add(n.id);
    if (!Array.isArray(n.xy) || n.xy.length !== 2 || n.xy.some(v => typeof v !== "number"))
      issues.push({ sev: "err", msg: "Node " + (n.id || "?") + " needs xy: [x, y] numbers" });
  });
  (map.levels || []).forEach(l => {
    if (l.image && typeof l.image !== "string")
      issues.push({ sev: "err", msg: "Level " + l.id + " image must be a path" });
    if (l.imageBox && (!Array.isArray(l.imageBox) || l.imageBox.length !== 4))
      issues.push({ sev: "err", msg: "Level " + l.id + " imageBox must be [x, y, w, h]" });
  });

  const nodeIds = new Set((map.nodes || []).map(n => n.id));
  (map.areas || []).forEach(a => {
    if (!Array.isArray(a.points) || a.points.length < 3)
      issues.push({ sev: "err", msg: "Area " + (a.id || "?") + " needs at least 3 points" });
    if (a.node && !nodeIds.has(a.node))
      issues.push({ sev: "err", msg: "Area " + (a.id || "?") + " references unknown node '" + a.node + "'" });
    if (!a.name)
      issues.push({ sev: "warn", msg: "Area " + (a.id || "?") + " has no name, so it will render unlabelled" });
  });

  const eids = new Set();
  (map.edges || []).forEach(e => {
    if (!e.id) issues.push({ sev: "err", msg: "An edge is missing an id" });
    else if (eids.has(e.id)) issues.push({ sev: "err", msg: "Duplicate edge id: " + e.id });
    else eids.add(e.id);
    if (!Array.isArray(e.mode) || !e.mode.length)
      issues.push({ sev: "err", msg: "Edge " + (e.id || "?") + " needs a non-empty mode array" });
    if (typeof e.len !== "number" || e.len <= 0)
      issues.push({ sev: "err", msg: "Edge " + (e.id || "?") + " needs a positive len" });
  });
  return issues;
}

function validateBundle(bundle) {
  const map = bundle.map || bundle;
  let issues = structuralCheck(map);
  // Only run the graph engine once the shape is sane - it assumes well-formed input.
  if (!issues.some(i => i.sev === "err")) {
    try {
      issues = issues.concat(createEngine(map).validate());
    } catch (e) {
      issues.push({ sev: "err", msg: "Engine threw while validating: " + e.message });
    }
  }
  const pts = bundle.scanPoints;
  if (Array.isArray(pts)) {
    const nodeIds = new Set((map.nodes || []).map(n => n.id));
    const seen = new Set();
    pts.forEach(p => {
      if (!p.id) issues.push({ sev: "err", msg: "A scan point is missing an id" });
      else if (seen.has(p.id)) issues.push({ sev: "err", msg: "Duplicate scan point id: " + p.id });
      else seen.add(p.id);
      if (!nodeIds.has(p.node))
        issues.push({ sev: "err", msg: "Scan point " + p.id + " points at unknown node '" + p.node + "'" });
      if (p.id && !/^[A-Z0-9]{1,6}$/.test(p.id))
        issues.push({ sev: "warn", msg: "Scan point id '" + p.id + "' should be short uppercase alphanumerics - it goes inside the QR" });
    });
  }
  return issues;
}

/* ---------- publishing ---------- */
const jsBanner = "/* GENERATED by the publish backend. Do not hand-edit - the next publish overwrites it. */\n";

/* The app loads placards from scanpoints.js, so publishing must WRITE that
   file. Previously this dropped them into a .json nothing reads, which meant
   every placard edited in the editor silently had no effect. */
/* A phone caches the plan for offline use, so a 10 MB architectural render is
   not acceptable. Shrink anything large to a sensible width and re-encode as
   JPEG. Best effort: if Pillow is not available the original is kept. */
function shrinkPlan(file) {
  const NL = String.fromCharCode(10);
  const py = [
    "import sys",
    "from PIL import Image",
    "src, dst, w = sys.argv[1], sys.argv[2], int(sys.argv[3])",
    "im = Image.open(src).convert('RGB')",
    "im.thumbnail((w, w * 4), Image.LANCZOS)",
    "im.save(dst, 'JPEG', quality=78, optimize=True, progressive=True)",
    "print(im.size[0], im.size[1])"
  ].join(NL);

  const out = file.replace(/\.[^.]+$/, "") + "-web.jpg";
  const r = require("child_process").spawnSync("python", ["-c", py, file, out, "1700"],
                                               { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  const dims = (r.stdout || "").trim().split(/\s+/).map(Number);
  return { file: out, w: dims[0], h: dims[1] };
}

function writeScanPoints(points) {
  const NL = String.fromCharCode(10);
  const q  = v => JSON.stringify(String(v == null ? "" : v));

  const entries = points.map(p => [
    "    { id: " + q(p.id) + ", node: " + q(p.node) + ", level: " + q(p.level) +
    ", audience: " + q(p.audience || "both") + ",",
    "      label: " + q(p.label) + ",",
    "      mount: " + q(p.mount) + ", rev: " + (Number(p.rev) || 1) + " }"
  ].join(NL)).join("," + NL + NL);

  const src = [
    jsBanner.trim(),
    "var SCANPOINTS = (function () {",
    "  var LIST = [",
    entries,
    "  ];",
    "",
    "  var RETIRED = [];",
    "",
    "  var BY_ID = {};",
    "  LIST.forEach(function (s) { BY_ID[s.id.toUpperCase()] = s; });",
    "",
    "  return {",
    "    all: LIST,",
    "    retired: RETIRED,",
    "    byId: function (id) { return BY_ID[String(id || '').toUpperCase()] || null; },",
    "    byNode: function (n) {",
    "      for (var i = 0; i < LIST.length; i++) if (LIST[i].node === n) return LIST[i];",
    "      return null;",
    "    },",
    "    url: function (base, id) { return base.replace(/[/]+$/, '') + '/?s=' + id; }",
    "  };",
    "})();",
    "",
    "if (typeof module !== 'undefined' && module.exports) module.exports = SCANPOINTS;",
    ""
  ].join(NL);

  writeAtomic(path.join(ROOT, "scanpoints.js"), src);
}

function publish(bundle, note) {
  const map = bundle.map || bundle;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  ensureDir(VERSIONS);

  writeAtomic(path.join(VERSIONS, stamp + ".json"), JSON.stringify(bundle, null, 2));

  writeAtomic(path.join(ROOT, "map.js"), jsBanner + "const MAP = " + JSON.stringify(map, null, 2) + ";\n");
  if (Array.isArray(bundle.scanPoints)) writeScanPoints(bundle.scanPoints);

  const current = { version: stamp, publishedAt: new Date().toISOString(), note: note || "" };
  writeAtomic(path.join(DATA, "current.json"), JSON.stringify(current, null, 2));
  return current;
}

function versions() {
  ensureDir(VERSIONS);
  return fs.readdirSync(VERSIONS).filter(f => f.endsWith(".json"))
           .map(f => f.replace(/\.json$/, "")).sort().reverse();
}

/* ---------- static files ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

/* Never served, whatever the URL says. server/ lives inside the app directory,
   and server/data/config.json holds the password hash and the session-signing
   secret - serving it would hand an attacker the ability to forge sessions. */
const DENY = [path.join(ROOT, "server"), path.join(ROOT, ".git"), path.join(ROOT, "node_modules")];

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); }
  catch { return send(res, 400, "Bad path"); }
  rel = rel.replace(/^\/+/, "") || "index.html";

  const file = path.resolve(ROOT, rel);

  // Containment: the resolved path must sit inside ROOT.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");
  // Denylist: server internals and dotfiles are never web-reachable.
  if (DENY.some(d => file === d || file.startsWith(d + path.sep))) return send(res, 403, "Forbidden");
  if (path.basename(file).startsWith(".")) return send(res, 403, "Forbidden");

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found");

  // The service worker caches the app shell by cache name. Serving a fixed
  // name in development means edits stay invisible behind a stale cache, so
  // stamp it with a hash of what is actually on disk - the same thing
  // build-dist.sh does for the deployed bundle.
  if (path.basename(file) === "sw.js") {
    let stamp = crypto.createHash("sha1");
    ["index.html", "engine.js", "map.js", "scanpoints.js"].forEach(f => {
      try { stamp.update(fs.readFileSync(path.join(ROOT, f))); } catch {}
    });
    const body = fs.readFileSync(file, "utf8")
      .replace(/const VERSION\s*=\s*"[^"]*"/,
               'const VERSION    = "school-' + stamp.digest("hex").slice(0, 12) + '"');
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8",
                         "Cache-Control": "no-cache",
                         "X-Content-Type-Options": "nosniff" });
    return res.end(body);
  }
  // This is a dev/publish tool, not the production host. Revalidate always,
  // so an edit is never masked by the browser cache.
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
                       "Cache-Control": "no-cache",
                       "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}

/* ---------- routes ---------- */
const cfg = loadConfig();
ensureDir(VERSIONS);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const authed = validSession(cfg, cookies(req).ap_session);

  const requireAuth = () => {
    if (authed) return true;
    send(res, 401, { error: "Not signed in" });
    return false;
  };

  try {
    if (p === "/api/status") {
      return send(res, 200, {
        authed,
        current: readJson(path.join(DATA, "current.json"), null),
        versionCount: versions().length
      });
    }

    if (p === "/api/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress || "?";
      if (rateLimited(ip)) return send(res, 429, { error: "Too many attempts. Wait 15 minutes." });
      const body = JSON.parse(await readBody(req, 4096) || "{}");
      const given = hashPassword(String(body.password || ""), cfg.salt, cfg.iterations);
      if (!safeEqual(given, cfg.hash)) {
        noteAttempt(ip);
        return send(res, 401, { error: "Wrong password" });
      }
      attempts.delete(ip);
      return send(res, 200, { ok: true }, {
        "Set-Cookie": "ap_session=" + issueSession(cfg) +
                      "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + (SESSION_MS / 1000)
      });
    }

    if (p === "/api/logout" && req.method === "POST") {
      return send(res, 200, { ok: true },
        { "Set-Cookie": "ap_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }

    if (p === "/api/validate" && req.method === "POST") {
      if (!requireAuth()) return;
      const parsed = await readBundle(req, res);
      if (!parsed) return;
      const issues = validateBundle(parsed.value);
      return send(res, 200, {
        ok: !issues.some(i => i.sev === "err"),
        errors: issues.filter(i => i.sev === "err").length,
        warnings: issues.filter(i => i.sev === "warn").length,
        issues
      });
    }

    if (p === "/api/publish" && req.method === "POST") {
      if (!requireAuth()) return;
      const parsed = await readBundle(req, res);
      if (!parsed) return;
      const bundle = parsed.value;
      const issues = validateBundle(bundle);
      const errors = issues.filter(i => i.sev === "err");
      if (errors.length) {
        // A map that fails validation never goes live. This is the whole point.
        return send(res, 422, { ok: false, error: "Validation failed - nothing published",
                                errors: errors.length, issues });
      }
      const current = publish(bundle, url.searchParams.get("note"));
      return send(res, 200, { ok: true, published: current, issues });
    }

    if (p === "/api/versions") {
      if (!requireAuth()) return;
      return send(res, 200, { current: readJson(path.join(DATA, "current.json"), null),
                              versions: versions() });
    }

    if (p.startsWith("/api/rollback/") && req.method === "POST") {
      if (!requireAuth()) return;
      const v = p.slice("/api/rollback/".length);
      if (!/^[A-Za-z0-9_-]+$/.test(v)) return send(res, 400, { error: "Bad version id" });
      const file = path.join(VERSIONS, v + ".json");
      if (!fs.existsSync(file)) return send(res, 404, { error: "No such version" });
      const bundle = readJson(file, null);
      const issues = validateBundle(bundle);
      if (issues.some(i => i.sev === "err"))
        return send(res, 422, { ok: false, error: "That version no longer validates", issues });
      return send(res, 200, { ok: true, published: publish(bundle, "rollback to " + v) });
    }

    if (p === "/api/plan" && req.method === "POST") {
      if (!requireAuth()) return;
      let raw;
      try { raw = await readBinary(req, MAX_PLAN); }
      catch (e) { return send(res, e instanceof TooLarge ? 413 : 400, { error: e.message }); }

      const given = String(url.searchParams.get("name") || "plan");
      // never trust a filename from the client
      let base = path.basename(given).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");
      let ext = path.extname(base).toLowerCase();
      base = base.slice(0, base.length - ext.length).slice(0, 40) || "plan";

      ensureDir(PLANS);
      const isPdf = raw.length > 4 && raw.slice(0, 4).toString() === "%PDF";

      if (isPdf) {
        // Rasterise page 1. Python with pymupdf is how the plan got here in the
        // first place; if it is missing, say so plainly rather than half-fail.
        const tmp = path.join(PLANS, base + ".pdf");
        writeAtomic(tmp, raw);
        const outPng = path.join(PLANS, base + ".png");
        const py = [
          "import pymupdf,sys",
          "d=pymupdf.open(sys.argv[1]); p=d[0]",
          "p.get_pixmap(matrix=pymupdf.Matrix(2.2,2.2)).save(sys.argv[2])"
        ].join(String.fromCharCode(10));
        const r = require("child_process").spawnSync("python", ["-c", py, tmp, outPng],
                                                     { encoding: "utf8" });
        try { fs.unlinkSync(tmp); } catch {}
        if (r.status !== 0 || !fs.existsSync(outPng)) {
          return send(res, 422, { error: "Could not convert that PDF. Export it as PNG or JPG " +
                                         "and upload that instead.",
                                  detail: (r.stderr || "").slice(0, 300) });
        }
        let png = fs.readFileSync(outPng);
        let size = imageSize(png) || { w: 1000, h: 1000 };
        let outPath = "plans/" + base + ".png";
        const small = shrinkPlan(outPng);
        if (small) {
          try { fs.unlinkSync(outPng); } catch {}
          outPath = "plans/" + path.basename(small.file);
          size = { w: small.w, h: small.h };
        }
        return send(res, 200, { ok: true, path: outPath,
                                width: size.w, height: size.h,
                                note: "Page 1 rasterised and resized for offline use. Crop the " +
                                      "title block and tables out for a cleaner map." });
      }

      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext))
        return send(res, 415, { error: "Upload a PNG, JPG, WEBP or PDF." });

      let size = imageSize(raw);
      let saved = path.join(PLANS, base + ext);
      writeAtomic(saved, raw);
      let note;

      // Visitors cache this offline; anything past ~1.2 MB or 2200px is too much.
      if (raw.length > 1200000 || (size && size.w > 2200)) {
        const small = shrinkPlan(saved);
        if (small) {
          try { fs.unlinkSync(saved); } catch {}
          saved = small.file;
          size = { w: small.w, h: small.h };
          note = "Resized to " + small.w + "x" + small.h + " (" +
                 Math.round(fs.statSync(saved).size / 1024) + " KB) so it can be cached offline.";
        } else {
          note = "This image is " + Math.round(raw.length / 1048576) +
                 " MB - too large to cache on a phone. Shrink it before going live.";
        }
      }

      return send(res, 200, { ok: true, path: "plans/" + path.basename(saved),
                              width: size ? size.w : null, height: size ? size.h : null,
                              note: note });
    }

    if (p.startsWith("/api/")) return send(res, 404, { error: "No such endpoint" });

    return serveStatic(req, res, p);

  } catch (e) {
    if (e instanceof TooLarge) return send(res, 413, { error: e.message });
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log("School wayfinding backend on http://localhost:" + PORT);
  console.log("  app     ->  http://localhost:" + PORT + "/");
  console.log("  admin   ->  http://localhost:" + PORT + "/admin.html");
});
