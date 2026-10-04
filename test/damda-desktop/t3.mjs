const t = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.url.startsWith('http://localhost:5500/') && !t.url.includes('__damda'));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const measure = () => ev(`(() => { const g = document.querySelector('#view-calendar .grid').getBoundingClientRect(), p = document.querySelector('.desk-tabs').getBoundingClientRect(); return { 창: innerWidth, 캘린더오른쪽끝: Math.round(g.right), 오른쪽구역시작: Math.round(p.left), 오른쪽넓이: Math.round(p.width) }; })()`);
const drag = async x => {
  const r = await ev(`(() => { const b = document.querySelector('.desk-resizer').getBoundingClientRect(); return [b.left + 3, innerHeight / 2]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + (x - r[0]) * i / 10, y: r[1], button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: r[1], button: 'left', clickCount: 1 });
  await sleep(200);
};
for (const [label, ratio] of [['처음', null], ['오른쪽을 조금 넓힘', 0.72], ['오른쪽을 끝까지 넓히려 함', 0.1], ['다시 끝까지 좁힘', 0.95]]) {
  if (ratio !== null) await drag(Math.round((await ev('innerWidth')) * ratio));
  const m = await measure();
  const ok = m.캘린더오른쪽끝 <= m.오른쪽구역시작 && m.오른쪽넓이 <= Math.ceil(m.창 / 3) + 1;
  console.log(ok ? '✅' : '❌', label, JSON.stringify(m));
}
ws.close();
