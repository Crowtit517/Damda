import { writeFileSync } from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result;
const shot = async name => { await sleep(400); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync('shots/' + name, Buffer.from(r.result.data, 'base64')); };
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5500/' }); await sleep(2000);
await evalJs(`localStorage.clear(); localStorage.setItem('ple-theme','"light"')`); await send('Page.reload'); await sleep(1500);
await evalJs(`document.querySelector('#menuBtn').click()`); await sleep(200);
await evalJs(`document.querySelector('#menuModal [data-act="cat-ledger"]').click()`); await sleep(400);
await shot('drag-1-manager.png');
await evalJs(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rows = [...document.querySelectorAll('#categoryModal .mgr-row')];
  const hd = rows[0].querySelector('.mgr-handle'); const h = hd.getBoundingClientRect();
  const ev = (t, y) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: h.left + 20, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' });
  hd.dispatchEvent(ev('pointerdown', h.top + 24));
  const end = rows[2].getBoundingClientRect().top + 20;
  for (let y = h.top + 24; y <= end; y += 10) { document.querySelector('#categoryModal').dispatchEvent(ev('pointermove', y)); await wait(10); }
})()`);
await shot('drag-2-dragging.png');
ws.close(); process.exit(0);
