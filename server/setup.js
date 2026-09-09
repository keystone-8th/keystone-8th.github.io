/* Create or replace the admin password.
   Usage:  node server/setup.js "your password here" [--allow-weak]

   The password is never stored — only a PBKDF2-SHA256 hash with a random
   per-install salt, plus a random secret used to sign session cookies.

   The 10-character minimum exists because this password is the only thing
   guarding the publish endpoint. --allow-weak skips it for a localhost-only
   dev box, and flags the config so the server can warn on every start. */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA   = path.join(__dirname, "data");
const CONFIG = path.join(DATA, "config.json");
const ITERATIONS = 210000;   // OWASP guidance for PBKDF2-SHA256
const MIN_LENGTH = 10;

const argv     = process.argv.slice(2);
const weakOk   = argv.includes("--allow-weak");
const password = argv.filter(a => a !== "--allow-weak").join(" ");

if (!password) {
  console.error('Usage: node server/setup.js "your password" [--allow-weak]');
  process.exit(1);
}

if (password.length < MIN_LENGTH && !weakOk) {
  console.error("Use at least " + MIN_LENGTH + " characters — this password is the only thing " +
                "guarding the publish endpoint.");
  console.error("For a localhost-only dev box, override with --allow-weak.");
  process.exit(1);
}

fs.mkdirSync(DATA, { recursive: true });

const salt = crypto.randomBytes(16).toString("hex");
const cfg = {
  salt: salt,
  iterations: ITERATIONS,
  hash: crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha256").toString("hex"),
  secret: crypto.randomBytes(32).toString("hex"),
  weak: password.length < MIN_LENGTH,
  createdAt: new Date().toISOString()
};

fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });

console.log("Admin password set (" + password.length + " characters).");
console.log("Config written to server/data/config.json — it holds the session-signing");
console.log("secret, so never commit it.");

if (cfg.weak) {
  console.log("");
  console.log("  !! WEAK PASSWORD. Acceptable while this only listens on localhost.");
  console.log("     Change it before the server is reachable from anywhere else.");
}
