// Evaluate JavaScript inside the page running on the emulator, over the
// Chrome DevTools protocol. `adb forward tcp:9222 localabstract:chrome_devtools_remote`
// must be in place first.
const expr = process.argv.slice(2).join(" ");
if (!expr) { console.error("usage: node emu-eval.js <expression>"); process.exit(1); }

(async () => {
  const PORT = process.env.DEVTOOLS_PORT || "9222";
  const list = await (await fetch("http://localhost:" + PORT + "/json/list")).json();
  const pages = list.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pages.length) { console.error("no debuggable page"); process.exit(1); }
    const want = process.env.DEVTOOLS_MATCH;
  const page = (want && pages.find(t => t.url.includes(want))) || pages[0];
  console.error("page: " + page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  await new Promise(r => ws.addEventListener("open", r));
  const r = await send("Runtime.evaluate", {
    expression: expr, returnByValue: true, awaitPromise: true, userGesture: true
  });
  const res = r.result || {};
  if (res.exceptionDetails) console.log("EXCEPTION: " + (res.exceptionDetails.exception || {}).description);
  else console.log(typeof res.result.value === "string"
    ? res.result.value : JSON.stringify(res.result.value));
  ws.close();
})();
