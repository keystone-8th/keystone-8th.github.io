// HTTPS in front of the dev server, so an iPhone on the same Wi-Fi gets a
// SECURE CONTEXT and can therefore register a service worker.
//
//   node tools/https-proxy.js            (then https://<lan-ip>:8443)
//
// Without this an iOS device can only reach the app over plain http on a LAN
// address, which Safari refuses to give a worker - so the app would look fine
// on Wi-Fi and be dead the moment it went underground, which is the opposite
// of what it is for. The certificate is self-signed, so the phone has to be
// told to trust it once: fetch /cert.pem, install the profile, then
// Settings > General > About > Certificate Trust Settings.
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const HERE = path.join(__dirname, "tls");
const PORT = Number(process.env.HTTPS_PORT || 8443);
const TARGET = Number(process.env.TARGET_PORT || 8138);

const opts = {
  key: fs.readFileSync(path.join(HERE, "key.pem")),
  cert: fs.readFileSync(path.join(HERE, "cert.pem"))
};

const server = https.createServer(opts, (req, res) => {
  // Hand the certificate out over the same connection, so the phone can be
  // pointed at one address for everything.
  if (req.url === "/cert.pem" || req.url === "/cert") {
    const body = fs.readFileSync(path.join(HERE, "cert.pem"));
    res.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="athena-test.pem"',
      "Content-Length": body.length
    });
    return res.end(body);
  }
  const up = http.request(
    { host: "127.0.0.1", port: TARGET, path: req.url, method: req.method, headers: req.headers },
    r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  );
  up.on("error", e => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("dev server not reachable on " + TARGET + ": " + e.message);
  });
  req.pipe(up);
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets))
    for (const n of nets[name])
      if (n.family === "IPv4" && !n.internal) ips.push(n.address);
  console.log("HTTPS on " + PORT + ", proxying to " + TARGET);
  ips.forEach(ip => console.log("  https://" + ip + ":" + PORT + "/index.html?s=MG"));
  console.log("  certificate: https://" + (ips[0] || "localhost") + ":" + PORT + "/cert.pem");
});
