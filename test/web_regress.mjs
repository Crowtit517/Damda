// 폰·웹(크롬)에서는 PC 화면이 켜지지 않는지: headless 크롬(9333)으로 확인
import { spawn } from 'child_process';
import fs from 'fs';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const prof = process.env.TEMP + '/damda-regress-' + Date.now();
const p = spawn(chrome, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${prof}`, 'about:blank']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const ok = (n, c) => console.log(c ? '✅' : '❌', n);
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Runtime.enable');
const errors = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); });
for (const [name, w, h, mobile] of [['폰', 390, 844, true], ['웹', 1280, 860, false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: 'http://localhost:5500/?tab=calendar' }); await sleep(2500);
  ok(`${name}: PC 화면 꺼짐 (desk-app 없음, 탭 없음, 위젯 버튼 없음)`, await ev(`!document.documentElement.classList.contains('desk-app') && !document.querySelector('.desk-tabs') && !document.querySelector('[data-act="widget"]')`));
  const look = await ev(`(() => { const a = getComputedStyle(document.querySelector('.app')); return { maxWidth: a.maxWidth, radius: a.borderRadius }; })()`);
  console.log(`   ${name} 화면 판:`, JSON.stringify(look));
  await ev(`document.querySelector('#view-calendar .cell.today').click()`); await sleep(600);
  const panel = await ev(`(() => { const r = document.getElementById('dayPanel').getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) }; })()`);
  console.log(`   ${name} 하루 패널:`, JSON.stringify(panel));
  const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`regress-${w}.png`, Buffer.from(r.result.data, 'base64'));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(400);
  await ev(`document.getElementById('menuBtn').click()`); await sleep(400);
  await ev(`document.querySelector('#menuModal [data-screen="tasks"]').click()`); await sleep(600);
  ok(`${name}: 할 일 화면으로 바뀌면 캘린더는 숨음 (원래대로)`, await ev(`document.getElementById('view-calendar').hidden && !document.getElementById('view-tasks').hidden`));
  await ev(`localStorage.setItem('ple-tab', JSON.stringify('calendar'))`);
}
ok('스크립트 오류 없음', errors.length === 0); if (errors.length) console.log(errors);
ws.close(); p.kill();
